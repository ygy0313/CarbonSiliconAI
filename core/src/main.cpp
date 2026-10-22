// 内核入口：serve（服务）/ bench（压测）/ selftest（自检）
//
// 不引测试框架，自检就是 main 里的断言。内核只有纯函数，这样够用。
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <random>
#include <string>
#include <vector>

#include "kernel.hpp"

namespace qjz {
int serve(int port);
}

namespace {

int gFail = 0;

void check(const char* name, bool ok) {
    std::printf("%s %s\n", ok ? "  ok  " : "  FAIL", name);
    if (!ok) ++gFail;
}

void checkNear(const char* name, double got, double want, double tol = 0.02) {
    bool ok = std::fabs(got - want) <= tol;
    std::printf("%s %-42s got=%.3f want=%.3f\n", ok ? "  ok  " : "  FAIL", name, got, want);
    if (!ok) ++gFail;
}

int selftest() {
    using namespace qjz;
    std::printf("\n[qjz-core] selftest\n");

    // 相似度：同义改写要高，无关要低
    double s1 = similarity("想找个人少安静的地方吃饭", "想找安静人少的地方吃饭");
    double s2 = similarity("想找个人少安静的地方吃饭", "今天天气不错适合爬山");
    check("相似度：同义改写 > 0.6", s1 > 0.6);
    check("相似度：无关话题 < 0.2", s2 < 0.2);
    check("相似度：空串为 0", similarity("", "abc") == 0.0);

    // 排序：相关 + 有效 应该赢过 相关但无效
    std::vector<Experience> items;
    {
        Experience e;
        e.id = "x_good";
        e.tags = {"胃敏感", "微辣"};
        e.scene = "solo";
        e.intent = "eat";
        e.text = "一个人吃午饭，胃不太舒服";
        e.rule = "胃敏感时优先点清汤类";
        e.effectiveness = 0.82;
        e.applied = 6;
        e.followed = 5;
        e.evidence = 3;
        e.updatedAt = 1000;
        items.push_back(e);
    }
    {
        Experience e;
        e.id = "x_bad";
        e.tags = {"胃敏感", "微辣"};
        e.scene = "solo";
        e.intent = "eat";
        e.text = "一个人吃午饭";
        e.rule = "胃敏感也可以吃重辣";
        e.effectiveness = 0.18;
        e.applied = 5;
        e.followed = 1;
        e.evidence = 1;
        e.updatedAt = 1000;
        items.push_back(e);
    }
    {
        Experience e;
        e.id = "x_far";
        e.tags = {"桌游"};
        e.scene = "group";
        e.intent = "gather";
        e.text = "六个人组局";
        e.rule = "六人局优先新手本";
        e.effectiveness = 0.9;
        e.applied = 9;
        e.followed = 9;
        e.updatedAt = 1000;
        items.push_back(e);
    }
    {
        Experience e;
        e.id = "x_archived";
        e.tags = {"胃敏感"};
        e.status = "archived";
        e.effectiveness = 1.0;
        items.push_back(e);
    }

    Query q;
    q.tags = {"胃敏感", "微辣"};
    q.scene = "solo";
    q.intent = "eat";
    q.text = "中午一个人吃，胃有点不舒服，别太辣";
    q.limit = 3;

    Criteria c;
    std::vector<Scored> ranked = rank(items, q, c, 1000.0 + 3 * 86400000.0);
    check("排序：返回 2 条（归档被排除）", ranked.size() == 2);
    check("排序：第一条是 x_good", !ranked.empty() && ranked[0].exp.id == "x_good");
    check("排序：不相关的不该进榜", ranked.size() < 2 || ranked[1].exp.id != "x_far");
    check("排序：匹配到标签", !ranked.empty() && !ranked[0].matched.empty());

    // 挖掘：3 次采纳「清汤面」→ 应产出 prefer 规则
    std::vector<Event> events;
    for (int i = 0; i < 3; ++i) {
        Event e;
        e.id = "e" + std::to_string(i);
        e.tags = {"胃敏感"};
        e.scene = "solo";
        e.title = "清汤面";
        e.verdict = "accept";
        e.ts = 100.0 + i;
        events.push_back(e);
    }
    {
        Event e;
        e.id = "e_bad";
        e.tags = {"聚会"};
        e.scene = "group";
        e.title = "12 人本";
        e.verdict = "reject";
        e.ts = 200;
        events.push_back(e);
    }
    {
        Event e;
        e.id = "e_bad2";
        e.tags = {"聚会"};
        e.scene = "group";
        e.title = "12 人本";
        e.verdict = "reject";
        e.ts = 201;
        events.push_back(e);
    }

    std::vector<Candidate> cands = mine(events, 2);
    bool hasPrefer = false, hasAvoid = false;
    for (const auto& c : cands) {
        if (c.action == "prefer" && c.title == "清汤面") hasPrefer = true;
        if (c.action == "avoid" && c.title == "12 人本") hasAvoid = true;
        check("挖掘：规则含可执行说明", c.rule.find("优先") != std::string::npos || c.rule.find("避开") != std::string::npos);
    }
    check("挖掘：产出 prefer 规则", hasPrefer);
    check("挖掘：产出 avoid 规则", hasAvoid);

    // 支持度不足不该挖
    std::vector<Event> few(events.begin(), events.begin() + 1);
    check("挖掘：样本不足时不产出", mine(few, 2).empty());

    // 评分边界
    std::vector<Experience> one{items[0]};
    Query emptyQ;
    std::vector<Scored> all = rank(one, emptyQ, c, 1000.0);
    check("排序：空查询时不过滤", all.size() == 1);
    checkNear("排序：分数在 0..1 之间", all.empty() ? -1 : all[0].score, all.empty() ? 0 : all[0].score);
    check("排序：分数不超过 1", all.empty() || all[0].score <= 1.0001);

    std::printf("\n  %s  %d 项失败\n\n", gFail == 0 ? "全部通过" : "存在失败", gFail);
    return gFail == 0 ? 0 : 1;
}

int bench() {
    using namespace qjz;
    std::mt19937 rng(42);
    const char* tagPool[] = {"胃敏感", "微辣", "重辣", "一个人", "聚会", "预算紧", "夜猫子", "新手", "安静", "热闹"};
    const char* titlePool[] = {"清汤面", "麻辣烫", "六人本", "小馆子", "轻食拼盘", "包间", "外卖", "新手剧本"};

    const int kMax = 5000;
    std::vector<Experience> items;
    items.reserve(kMax);
    for (int i = 0; i < kMax; ++i) {
        Experience e;
        e.id = "x" + std::to_string(i);
        e.tags = {tagPool[rng() % 10], tagPool[rng() % 10]};
        e.scene = (rng() % 2) ? "solo" : "group";
        e.intent = (rng() % 2) ? "eat" : "gather";
        e.text = std::string("情境 ") + titlePool[rng() % 8] + " 的记录，这次结果还行";
        e.rule = std::string("在 ") + titlePool[rng() % 8] + " 情境下优先选另一个";
        e.effectiveness = static_cast<double>(rng() % 100) / 100.0;
        e.applied = static_cast<int>(rng() % 12);
        e.followed = static_cast<int>(rng() % (e.applied + 1));
        e.evidence = static_cast<int>(rng() % 8);
        e.updatedAt = 1.7e12 - (rng() % 90) * 86400000.0;
        items.push_back(std::move(e));
    }

    Query q;
    q.tags = {"胃敏感", "微辣", "一个人"};
    q.scene = "solo";
    q.intent = "eat";
    q.text = "中午一个人吃，胃不舒服";
    q.limit = 5;
    Criteria c;

    auto t0 = std::chrono::steady_clock::now();

    std::printf("\n[qjz-core] bench\n");
    // 200 条 = 一个普通用户用半年的量；5000 条 = 重度用户/批量重排
    for (int kN : {200, 1000, 5000}) {
        std::vector<Experience> slice(items.begin(), items.begin() + kN);
        const int kIter = kN <= 200 ? 2000 : 200;
        size_t got = 0;
        t0 = std::chrono::steady_clock::now();
        for (int i = 0; i < kIter; ++i) got += rank(slice, q, c, 1.7e12).size();
        double totalMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
        std::printf("  %5d 条  %8.4f ms/次  %8.0f 次/秒  返回 %zu 条\n",
                    kN, totalMs / kIter, kIter / (totalMs / 1000.0), got / kIter);
    }

    // 挖掘压测
    std::vector<Event> events;
    events.reserve(20000);
    for (int i = 0; i < 20000; ++i) {
        Event e;
        e.id = "e" + std::to_string(i);
        e.tags = {tagPool[rng() % 10]};
        e.scene = (rng() % 2) ? "solo" : "group";
        e.title = titlePool[rng() % 8];
        e.verdict = (rng() % 3) ? "accept" : "reject";
        e.ts = static_cast<double>(i);
        events.push_back(std::move(e));
    }
    t0 = std::chrono::steady_clock::now();
    auto cands = mine(events, 3);
    double mineMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    std::printf("  挖掘 2 万事件   %.1f ms（产出 %zu 条候选）\n\n", mineMs, cands.size());
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    std::string cmd = argc > 1 ? argv[1] : "serve";
    if (cmd == "serve") {
        int port = argc > 2 ? std::atoi(argv[2]) : 8788;
        return qjz::serve(port);
    }
    if (cmd == "selftest") return selftest();
    if (cmd == "bench") return bench();
    if (cmd == "-h" || cmd == "--help" || cmd == "help") {
        std::printf("用法：qjz-core [serve <port> | selftest | bench]\n");
        return 0;
    }
    std::fprintf(stderr, "未知命令：%s\n", cmd.c_str());
    return 2;
}
