// 零依赖 HTTP/1.1 服务：POSIX socket + 固定线程池 + 短连接。
//
// 为什么不用 libevent/boost::asio：
//   这个内核的职责是「被调用时算得快」，不是做通用网关。200 行 socket 代码
//   换来零依赖、单文件编译、可静态链接到任何地方，比引一个框架划算。
//   真正的网关（TLS、限流、鉴权）交给 Nginx 或 Node 层，各做各的事。
#include <arpa/inet.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <deque>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "kernel.hpp"
#include "minijson.hpp"

namespace qjz {
namespace {

std::atomic<uint64_t> gRequests{0};
std::atomic<uint64_t> gRankCalls{0};
std::atomic<uint64_t> gMineCalls{0};
std::atomic<uint64_t> gScored{0};

struct Request {
    std::string method;
    std::string path;
    std::map<std::string, std::string> headers;
    std::string body;
};

std::string lower(std::string s) {
    for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

std::string trim(const std::string& s) {
    size_t b = s.find_first_not_of(" \t\r\n");
    if (b == std::string::npos) return "";
    size_t e = s.find_last_not_of(" \t\r\n");
    return s.substr(b, e - b + 1);
}

// 读满 want 字节；对端关闭返回 false
bool readN(int fd, size_t want, std::string& out) {
    out.clear();
    out.reserve(want);
    char buf[8192];
    while (out.size() < want) {
        size_t need = std::min(sizeof(buf), want - out.size());
        ssize_t n = ::read(fd, buf, need);
        if (n <= 0) return false;
        out.append(buf, static_cast<size_t>(n));
    }
    return true;
}

bool readRequest(int fd, Request& req) {
    std::string head;
    char buf[4096];
    // 逐块读到头部结束符
    while (head.find("\r\n\r\n") == std::string::npos) {
        ssize_t n = ::read(fd, buf, sizeof(buf));
        if (n <= 0) return false;
        head.append(buf, static_cast<size_t>(n));
        if (head.size() > 64 * 1024) return false;  // 头部上限，防打爆内存
    }

    size_t sep = head.find("\r\n\r\n");
    std::string headerBlock = head.substr(0, sep);
    std::string rest = head.substr(sep + 4);

    size_t lineEnd = headerBlock.find("\r\n");
    std::string requestLine = lineEnd == std::string::npos ? headerBlock : headerBlock.substr(0, lineEnd);
    size_t sp1 = requestLine.find(' ');
    size_t sp2 = requestLine.rfind(' ');
    if (sp1 == std::string::npos || sp2 == std::string::npos || sp2 <= sp1) return false;
    req.method = requestLine.substr(0, sp1);
    req.path = requestLine.substr(sp1 + 1, sp2 - sp1 - 1);

    size_t pos = (lineEnd == std::string::npos) ? headerBlock.size() : lineEnd + 2;
    while (pos < headerBlock.size()) {
        size_t end = headerBlock.find("\r\n", pos);
        std::string line = headerBlock.substr(pos, end == std::string::npos ? std::string::npos : end - pos);
        size_t colon = line.find(':');
        if (colon != std::string::npos) {
            req.headers[lower(trim(line.substr(0, colon)))] = trim(line.substr(colon + 1));
        }
        if (end == std::string::npos) break;
        pos = end + 2;
    }

    size_t contentLength = 0;
    auto it = req.headers.find("content-length");
    if (it != req.headers.end()) {
        contentLength = static_cast<size_t>(std::strtoull(it->second.c_str(), nullptr, 10));
        if (contentLength > 8 * 1024 * 1024) return false;  // 8MB 上限
    }

    req.body = rest;
    if (req.body.size() < contentLength) {
        std::string more;
        if (!readN(fd, contentLength - req.body.size(), more)) return false;
        req.body += more;
    }
    if (req.body.size() > contentLength) req.body.resize(contentLength);
    return true;
}

void writeAll(int fd, const std::string& data) {
    size_t off = 0;
    while (off < data.size()) {
        ssize_t n = ::write(fd, data.data() + off, data.size() - off);
        if (n <= 0) return;  // 对端断开，忽略
        off += static_cast<size_t>(n);
    }
}

void respond(int fd, int status, const std::string& body) {
    const char* reason = status == 200 ? "OK" : status == 400 ? "Bad Request"
                          : status == 404                ? "Not Found"
                          : status == 405                ? "Method Not Allowed"
                                                         : "Internal Server Error";
    std::string head = "HTTP/1.1 " + std::to_string(status) + " " + reason + "\r\n";
    head += "Content-Type: application/json; charset=utf-8\r\n";
    head += "Content-Length: " + std::to_string(body.size()) + "\r\n";
    head += "Connection: close\r\n";
    head += "X-Core: qjz-cpp/1.0\r\n\r\n";
    writeAll(fd, head + body);
}

std::string errBody(const std::string& msg) {
    mjson::Value v = mjson::Value::object();
    v.set("ok", mjson::Value(false));
    v.set("error", mjson::Value(msg));
    return mjson::dump(v);
}

double msSince(const std::chrono::steady_clock::time_point& t0) {
    auto us = std::chrono::duration_cast<std::chrono::microseconds>(
                  std::chrono::steady_clock::now() - t0)
                  .count();
    return static_cast<double>(us) / 1000.0;
}

// ── /v1/experience/rank ──────────────────────────────────
std::string handleRank(const std::string& body) {
    mjson::Value in;
    std::string err;
    if (!mjson::parse(body, in, err)) return errBody("请求体不是合法 JSON：" + err);
    if (!in.isObj()) return errBody("请求体必须是对象");

    auto t0 = std::chrono::steady_clock::now();

    const mjson::Value* arr = in.find("experiences");
    if (!arr || !arr->isArr()) return errBody("缺少 experiences 数组");
    if (arr->arr.size() > 20000) return errBody("experiences 超过 20000 条上限");

    std::vector<Experience> items;
    items.reserve(arr->arr.size());
    for (const auto& node : arr->arr) {
        if (!node.isObj()) continue;
        Experience e;
        e.id = node.strOr("id");
        if (e.id.empty()) continue;
        e.tags = node.strArray("tags");
        e.scene = node.strOr("scene");
        e.intent = node.strOr("intent");
        e.text = node.strOr("text");
        e.rule = node.strOr("rule");
        e.status = node.strOr("status", "active");
        e.effectiveness = node.numOr("effectiveness", 0.5);
        e.applied = static_cast<int>(node.numOr("applied", 0));
        e.followed = static_cast<int>(node.numOr("followed", 0));
        e.evidence = static_cast<int>(node.numOr("evidence", 0));
        e.updatedAt = node.numOr("updatedAt", 0);
        items.push_back(std::move(e));
    }

    Query q;
    if (const mjson::Value* qn = in.find("query")) {
        q.tags = qn->strArray("tags");
        q.scene = qn->strOr("scene");
        q.intent = qn->strOr("intent");
        q.text = qn->strOr("text");
        q.limit = static_cast<int>(qn->numOr("limit", 5));
    }

    Criteria c;
    if (const mjson::Value* cn = in.find("criteria")) {
        c.wEffective = cn->numOr("wEffective", c.wEffective);
        c.wRecent = cn->numOr("wRecent", c.wRecent);
        c.wSupport = cn->numOr("wSupport", c.wSupport);
        c.wPrecision = cn->numOr("wPrecision", c.wPrecision);
        c.halfLifeDays = cn->numOr("halfLifeDays", c.halfLifeDays);
        if (c.halfLifeDays < 1) c.halfLifeDays = 1;
    }

    double now = in.numOr("now", 0);
    if (now <= 0) {
        now = static_cast<double>(std::chrono::duration_cast<std::chrono::milliseconds>(
                                      std::chrono::system_clock::now().time_since_epoch())
                                      .count());
    }

    std::vector<Scored> ranked = rank(items, q, c, now);

    mjson::Value out = mjson::Value::object();
    out.set("ok", mjson::Value(true));
    out.set("count", mjson::Value(static_cast<int>(ranked.size())));
    out.set("considered", mjson::Value(static_cast<int>(items.size())));

    mjson::Value list = mjson::Value::array();
    for (const auto& s : ranked) {
        mjson::Value node = mjson::Value::object();
        node.set("id", mjson::Value(s.exp.id));
        node.set("rule", mjson::Value(s.exp.rule));
        node.set("score", mjson::Value(s.score));
        node.set("match", mjson::Value(s.match));
        node.set("sEffective", mjson::Value(s.sEffective));
        node.set("sRecent", mjson::Value(s.sRecent));
        node.set("sSupport", mjson::Value(s.sSupport));
        node.set("sPrecision", mjson::Value(s.sPrecision));

        mjson::Value matched = mjson::Value::array();
        for (const auto& t : s.matched) matched.push(mjson::Value(t));
        node.set("matched", std::move(matched));

        // 一句人话解释，前端直接展示，不用再拼
        std::string why;
        if (!s.matched.empty()) why += "命中「" + s.matched[0] + "」";
        if (s.sEffective >= 0.6) why += (why.empty() ? "" : "；") + std::string("有效率偏高");
        else if (s.sEffective < 0.35) why += (why.empty() ? "" : "；") + std::string("有效率偏低");
        if (s.exp.applied > 0) {
            why += (why.empty() ? "" : "；") + std::string("用过 ") + std::to_string(s.exp.applied) +
                   " 次、" + std::to_string(s.exp.followed) + " 次奏效";
        }
        node.set("why", mjson::Value(why));
        list.push(std::move(node));
    }
    out.set("items", std::move(list));
    out.set("ms", mjson::Value(msSince(t0)));

    ++gRankCalls;
    gScored += items.size();
    return mjson::dump(out);
}

// ── /v1/reflect/mine ─────────────────────────────────────
std::string handleMine(const std::string& body) {
    mjson::Value in;
    std::string err;
    if (!mjson::parse(body, in, err)) return errBody("请求体不是合法 JSON：" + err);
    if (!in.isObj()) return errBody("请求体必须是对象");

    auto t0 = std::chrono::steady_clock::now();

    std::vector<Event> events;
    if (const mjson::Value* arr = in.find("events")) {
        if (arr->isArr()) {
            events.reserve(arr->arr.size());
            for (const auto& node : arr->arr) {
                if (!node.isObj()) continue;
                Event e;
                e.id = node.strOr("id");
                e.tags = node.strArray("tags");
                e.scene = node.strOr("scene");
                e.title = node.strOr("title");
                e.verdict = node.strOr("verdict");
                e.ts = node.numOr("ts", 0);
                if (!e.id.empty()) events.push_back(std::move(e));
            }
        }
    }

    int minSupport = static_cast<int>(in.numOr("minSupport", 2));
    std::vector<Candidate> cands = mine(events, minSupport);

    mjson::Value out = mjson::Value::object();
    out.set("ok", mjson::Value(true));
    out.set("events", mjson::Value(static_cast<int>(events.size())));
    out.set("count", mjson::Value(static_cast<int>(cands.size())));

    mjson::Value list = mjson::Value::array();
    for (const auto& c : cands) {
        mjson::Value node = mjson::Value::object();
        mjson::Value tags = mjson::Value::array();
        for (const auto& t : c.tags) tags.push(mjson::Value(t));
        node.set("tags", std::move(tags));
        node.set("scene", mjson::Value(c.scene));
        node.set("action", mjson::Value(c.action));
        node.set("title", mjson::Value(c.title));
        node.set("rule", mjson::Value(c.rule));
        node.set("accept", mjson::Value(c.accept));
        node.set("reject", mjson::Value(c.reject));
        node.set("support", mjson::Value(c.support));
        node.set("precision", mjson::Value(c.precision));
        mjson::Value ids = mjson::Value::array();
        for (const auto& id : c.evidenceIds) ids.push(mjson::Value(id));
        node.set("evidenceIds", std::move(ids));
        list.push(std::move(node));
    }
    out.set("candidates", std::move(list));
    out.set("ms", mjson::Value(msSince(t0)));

    ++gMineCalls;
    return mjson::dump(out);
}

void handleConn(int fd) {
    ++gRequests;
    Request req;
    if (!readRequest(fd, req)) {
        respond(fd, 400, errBody("请求格式不合法"));
        ::close(fd);
        return;
    }

    std::string out;
    int status = 200;
    try {
        if (req.method == "GET" && (req.path == "/health" || req.path == "/v1/health")) {
            mjson::Value v = mjson::Value::object();
            v.set("ok", mjson::Value(true));
            v.set("core", mjson::Value("qjz-cpp/1.0"));
            v.set("std", mjson::Value("c++17"));
            v.set("threads", mjson::Value(static_cast<int>(std::thread::hardware_concurrency())));
            out = mjson::dump(v);
        } else if (req.method == "GET" && req.path == "/v1/stats") {
            mjson::Value v = mjson::Value::object();
            v.set("ok", mjson::Value(true));
            v.set("requests", mjson::Value(static_cast<double>(gRequests.load())));
            v.set("rankCalls", mjson::Value(static_cast<double>(gRankCalls.load())));
            v.set("mineCalls", mjson::Value(static_cast<double>(gMineCalls.load())));
            v.set("experiencesScored", mjson::Value(static_cast<double>(gScored.load())));
            out = mjson::dump(v);
        } else if (req.method == "POST" && req.path == "/v1/experience/rank") {
            out = handleRank(req.body);
        } else if (req.method == "POST" && req.path == "/v1/reflect/mine") {
            out = handleMine(req.body);
        } else if (req.path == "/v1/experience/rank" || req.path == "/v1/reflect/mine") {
            status = 405;
            out = errBody("只支持 POST");
        } else {
            status = 404;
            out = errBody("未知路由 " + req.path);
        }
    } catch (const std::exception& e) {
        status = 500;
        out = errBody(std::string("内核异常：") + e.what());
    } catch (...) {
        status = 500;
        out = errBody("内核未知异常");
    }

    respond(fd, status, out);
    ::close(fd);
}

}  // namespace

int serve(int port) {
    int listenFd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (listenFd < 0) {
        std::perror("socket");
        return 1;
    }

    int on = 1;
    ::setsockopt(listenFd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);  // 只监听本机，公网交给 Nginx
    addr.sin_port = htons(static_cast<uint16_t>(port));

    if (::bind(listenFd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
        std::perror("bind");
        ::close(listenFd);
        return 1;
    }
    if (::listen(listenFd, 256) < 0) {
        std::perror("listen");
        ::close(listenFd);
        return 1;
    }

    unsigned hw = std::thread::hardware_concurrency();
    size_t workers = hw == 0 ? 4 : std::min<unsigned>(hw * 2, 16);

    std::mutex mu;
    std::condition_variable cv;
    std::deque<int> queue;
    std::atomic<bool> stop{false};

    for (size_t i = 0; i < workers; ++i) {
        std::thread([&]() {
            while (true) {
                int fd = -1;
                {
                    std::unique_lock<std::mutex> lock(mu);
                    cv.wait(lock, [&]() { return stop.load() || !queue.empty(); });
                    if (stop.load() && queue.empty()) return;
                    fd = queue.front();
                    queue.pop_front();
                }
                handleConn(fd);
            }
        }).detach();
    }

    std::fprintf(stderr, "[qjz-core] listening on 127.0.0.1:%d, workers=%zu\n", port, workers);

    while (true) {
        sockaddr_in peer{};
        socklen_t len = sizeof(peer);
        int fd = ::accept(listenFd, reinterpret_cast<sockaddr*>(&peer), &len);
        if (fd < 0) continue;
        int nodelay = 1;
        ::setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &nodelay, sizeof(nodelay));
        {
            std::lock_guard<std::mutex> lock(mu);
            if (queue.size() > 4096) {  // 过载保护：直接拒绝，别把内存吃光
                ::close(fd);
                continue;
            }
            queue.push_back(fd);
        }
        cv.notify_one();
    }

    return 0;
}

}  // namespace qjz
