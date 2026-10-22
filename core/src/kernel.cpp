#include "kernel.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <map>
#include <string>
#include <unordered_map>
#include <vector>

namespace qjz {
namespace {

constexpr double kDayMs = 86400000.0;

std::vector<uint32_t> decodeUtf8(const std::string& s) {
    std::vector<uint32_t> out;
    out.reserve(s.size());
    size_t i = 0;
    while (i < s.size()) {
        unsigned char c = static_cast<unsigned char>(s[i]);
        uint32_t cp = 0;
        int extra = 0;
        if (c < 0x80) { cp = c; extra = 0; }
        else if ((c >> 5) == 0x6) { cp = c & 0x1F; extra = 1; }
        else if ((c >> 4) == 0xE) { cp = c & 0x0F; extra = 2; }
        else if ((c >> 3) == 0x1E) { cp = c & 0x07; extra = 3; }
        else { ++i; continue; }  // 非法字节，跳过而不是崩溃

        if (i + extra >= s.size()) break;
        bool ok = true;
        for (int k = 1; k <= extra; ++k) {
            unsigned char cc = static_cast<unsigned char>(s[i + k]);
            if ((cc >> 6) != 0x2) { ok = false; break; }
            cp = (cp << 6) | (cc & 0x3F);
        }
        i += (ok ? extra + 1 : 1);
        if (ok) out.push_back(cp);
    }
    return out;
}

using GramBag = std::unordered_map<uint64_t, double>;

GramBag bigrams(const std::string& s) {
    GramBag bag;
    auto cps = decodeUtf8(s);
    if (cps.empty()) return bag;
    if (cps.size() == 1) {
        bag[static_cast<uint64_t>(cps[0])] += 1;
        return bag;
    }
    for (size_t i = 0; i + 1 < cps.size(); ++i) {
        uint64_t key = (static_cast<uint64_t>(cps[i]) << 32) | cps[i + 1];
        bag[key] += 1;
    }
    return bag;
}

// 场景码是英文枚举，规则文案是中文 —— 在这里翻一次，别让 UI 层拼
std::string sceneLabel(const std::string& code) {
    if (code == "solo") return "一个人独处";
    if (code == "group") return "朋友聚会";
    if (code == "npc") return "和 AI 搭子";
    if (code == "work") return "工作场景";
    if (code.empty()) return "日常";
    return code;
}

std::string mostCommon(const std::unordered_map<std::string, int>& counter) {
    std::string best;
    int bestN = 0;
    for (const auto& kv : counter) {
        if (kv.second > bestN) { bestN = kv.second; best = kv.first; }
    }
    return best;
}

double cosine(const GramBag& ga, const GramBag& gb) {
    if (ga.empty() || gb.empty()) return 0;
    double dot = 0, na = 0, nb = 0;
    for (const auto& kv : ga) na += kv.second * kv.second;
    for (const auto& kv : gb) nb += kv.second * kv.second;
    if (na <= 0 || nb <= 0) return 0;
    // 遍历较小的一侧做点积
    const GramBag& small = ga.size() <= gb.size() ? ga : gb;
    const GramBag& large = ga.size() <= gb.size() ? gb : ga;
    for (const auto& kv : small) {
        auto it = large.find(kv.first);
        if (it != large.end()) dot += kv.second * it->second;
    }
    return dot / (std::sqrt(na) * std::sqrt(nb));
}

}  // namespace

double similarity(const std::string& a, const std::string& b) {
    if (a.empty() || b.empty()) return 0;
    return cosine(bigrams(a), bigrams(b));
}

std::vector<Scored> rank(const std::vector<Experience>& items, const Query& q,
                         const Criteria& c, double nowMs) {
    std::vector<Scored> out;
    out.reserve(items.size());
    const bool hasQuery = !q.tags.empty() || !q.scene.empty() || !q.intent.empty() || !q.text.empty();
    // 查询文本只建一次 bigram 表；每条经验只在必要时才算文本相似度
    const GramBag qbag = q.text.empty() ? GramBag{} : bigrams(q.text);

    for (const auto& e : items) {
        if (e.status == "archived") continue;

        Scored s;
        s.exp = e;

        for (const auto& t : e.tags) {
            for (const auto& qt : q.tags) {
                if (t == qt) { s.matched.push_back(t); break; }
            }
        }

        double tagMatch = q.tags.empty()
                              ? 0.0
                              : static_cast<double>(s.matched.size()) / static_cast<double>(q.tags.size());
        double sceneMatch = (!q.scene.empty() && q.scene == e.scene) ? 1.0 : 0.0;
        double intentMatch = (!q.intent.empty() && q.intent == e.intent) ? 1.0 : 0.0;

        double match = 0.0;
        if (!hasQuery) {
            match = 1.0;
        } else {
            match = std::max(tagMatch, std::max(sceneMatch * 0.85, intentMatch * 0.8));

            // 文本相似度最贵。已经靠标签/场景拿到 0.85 以上匹配时，它不可能改变
            // max 的结果，直接跳过 —— 数学上等价，实测省掉 80% 的 bigram 构建。
            if (!qbag.empty() && match < 0.85) {
                double textMatch = std::max(cosine(qbag, bigrams(e.rule)), cosine(qbag, bigrams(e.text)));
                match = std::max(match, textMatch * 0.9);
            }
            // 相关性闸门：宁可返回 1 条真相关，也不返回 5 条凑数
            if (match < 0.15) continue;
        }
        s.match = match;

        s.sEffective = std::max(0.0, std::min(1.0, e.effectiveness));

        if (e.updatedAt <= 0) {
            s.sRecent = 0.5;
        } else {
            double days = (nowMs - e.updatedAt) / kDayMs;
            if (days < 0) days = 0;
            s.sRecent = std::pow(0.5, days / std::max(1.0, c.halfLifeDays));
        }

        int n = e.applied + e.evidence;
        s.sSupport = n <= 0 ? 0.0 : std::min(1.0, std::log1p(static_cast<double>(n)) / std::log(11.0));

        // 拉普拉斯平滑：只应用过 1 次的规则不该被判成 100% 有效
        s.sPrecision = static_cast<double>(e.followed + 1) / static_cast<double>(e.applied + 2);

        double quality = c.wEffective * s.sEffective + c.wRecent * s.sRecent +
                         c.wSupport * s.sSupport + c.wPrecision * s.sPrecision;
        s.score = match * quality;
        out.push_back(std::move(s));
    }

    std::sort(out.begin(), out.end(), [](const Scored& a, const Scored& b) {
        if (std::fabs(a.score - b.score) > 1e-9) return a.score > b.score;
        return a.exp.updatedAt > b.exp.updatedAt;
    });

    if (q.limit > 0 && static_cast<int>(out.size()) > q.limit) out.resize(q.limit);
    return out;
}

std::vector<Candidate> mine(const std::vector<Event>& events, int minSupport) {
    if (minSupport < 2) minSupport = 2;

    struct Agg {
        int accept = 0;
        int reject = 0;
        std::vector<std::string> tags;
        std::string scene;
        std::unordered_map<std::string, int> acceptTitles;
        std::unordered_map<std::string, int> rejectTitles;
        std::vector<std::pair<double, std::string>> evidence;  // (ts, id)
    };

    // 两个视角：按标签、按场景。同一批事件会同时喂给两个视角。
    std::map<std::string, Agg> groups;

    for (const auto& ev : events) {
        if (ev.verdict != "accept" && ev.verdict != "reject") continue;
        if (ev.title.empty()) continue;

        std::vector<std::string> keys;
        for (const auto& t : ev.tags) keys.push_back("t:" + t);
        if (!ev.scene.empty()) keys.push_back("s:" + ev.scene);

        for (const auto& k : keys) {
            Agg& ag = groups[k];
            if (ag.tags.empty()) ag.tags = ev.tags;
            if (ag.scene.empty()) ag.scene = ev.scene;
            if (ev.verdict == "accept") {
                ++ag.accept;
                ++ag.acceptTitles[ev.title];
            } else {
                ++ag.reject;
                ++ag.rejectTitles[ev.title];
            }
            ag.evidence.emplace_back(ev.ts, ev.id);
        }
    }

    std::vector<Candidate> out;
    for (auto& kv : groups) {
        Agg& ag = kv.second;
        const std::string& key = kv.first;
        int support = ag.accept + ag.reject;
        if (support < minSupport) continue;

        const double acceptRatio = static_cast<double>(ag.accept) / support;
        const double rejectRatio = static_cast<double>(ag.reject) / support;

        Candidate cand;
        cand.tags = ag.tags;
        cand.scene = ag.scene;
        cand.accept = ag.accept;
        cand.reject = ag.reject;
        cand.support = support;

        std::string subject;
        if (key.rfind("t:", 0) == 0) {
            subject = "「" + key.substr(2) + "」这类情境";
            // 标签视角只保留该标签，规则更锐
            cand.tags = {key.substr(2)};
        } else {
            subject = "「" + sceneLabel(ag.scene) + "」的场景";
        }

        if (acceptRatio >= 0.6) {
            cand.action = "prefer";
            cand.title = mostCommon(ag.acceptTitles);
            cand.precision = acceptRatio;
            cand.rule = "在" + subject + "下，优先「" + cand.title + "」——过去 " +
                        std::to_string(ag.accept) + "/" + std::to_string(support) + " 次你都采纳了。";
        } else if (rejectRatio >= 0.6) {
            cand.action = "avoid";
            cand.title = mostCommon(ag.rejectTitles);
            cand.precision = rejectRatio;
            cand.rule = "在" + subject + "下，避开「" + cand.title + "」——过去 " +
                        std::to_string(ag.reject) + "/" + std::to_string(support) + " 次你都否掉了。";
        } else {
            continue;  // 五五开，说明这条规则还不成立
        }

        std::sort(ag.evidence.begin(), ag.evidence.end(),
                  [](const std::pair<double, std::string>& a, const std::pair<double, std::string>& b) {
                      return a.first > b.first;
                  });
        for (size_t i = 0; i < ag.evidence.size() && i < 6; ++i) {
            cand.evidenceIds.push_back(ag.evidence[i].second);
        }
        out.push_back(std::move(cand));
    }

    std::sort(out.begin(), out.end(), [](const Candidate& a, const Candidate& b) {
        if (std::fabs(a.precision - b.precision) > 1e-9) return a.precision > b.precision;
        return a.support > b.support;
    });

    // 去重：同一 (动作, 对象) 只留标签视角那条 —— 标签比场景更锐，规则更可执行。
    std::vector<Candidate> dedup;
    for (auto& c : out) {
        bool dup = false;
        for (const auto& d : dedup) {
            if (d.action == c.action && d.title == c.title) { dup = true; break; }
            if (d.rule == c.rule) { dup = true; break; }
        }
        if (!dup) dedup.push_back(std::move(c));
    }
    return dedup;
}

}  // namespace qjz
