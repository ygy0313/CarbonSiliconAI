// 内核数据模型与算法声明。
//
// 这里只有「纯计算」：给定经验条目和查询，算分排序；给定事件流，挖候选经验。
// 不碰数据库、不发网络请求、不读配置 —— 所以它能被单测、能被压测、能被搬到
// 任何宿主（Node 子进程 / Nginx 模块 / 独立服务）里。
#pragma once

#include <string>
#include <vector>

namespace qjz {

struct Experience {
    std::string id;
    std::vector<std::string> tags;
    std::string scene;
    std::string intent;
    std::string text;    // 情境描述
    std::string rule;    // 可执行规则（自然语言指令）
    std::string status;  // active / dormant / archived
    double effectiveness = 0.5;
    int applied = 0;
    int followed = 0;
    int evidence = 0;
    double updatedAt = 0;  // epoch ms
};

struct Criteria {
    double wEffective = 0.45;
    double wRecent = 0.20;
    double wSupport = 0.20;
    double wPrecision = 0.15;
    double halfLifeDays = 45.0;
};

struct Query {
    std::vector<std::string> tags;
    std::string scene;
    std::string intent;
    std::string text;
    int limit = 5;
};

struct Scored {
    Experience exp;
    double score = 0;
    double sEffective = 0;
    double sRecent = 0;
    double sSupport = 0;
    double sPrecision = 0;
    double match = 0;
    std::vector<std::string> matched;
};

// 排序：相关性闸门 × 加权质量分。低于闸门直接丢掉，不拿低相关的分去凑数。
std::vector<Scored> rank(const std::vector<Experience>& items, const Query& q,
                         const Criteria& c, double nowMs);

struct Event {
    std::string id;
    std::vector<std::string> tags;
    std::string scene;
    std::string title;
    std::string verdict;  // accept / reject
    double ts = 0;
};

struct Candidate {
    std::vector<std::string> tags;
    std::string scene;
    std::string action;    // prefer / avoid
    std::string title;
    std::string rule;
    int accept = 0;
    int reject = 0;
    int support = 0;
    double precision = 0;
    std::vector<std::string> evidenceIds;
};

// 从事件流里挖「这类情境下什么有效 / 什么无效」。
// 只挖到 support >= minSupport 且倾向明显的，宁可少挖，不产出噪声规则。
std::vector<Candidate> mine(const std::vector<Event>& events, int minSupport);

// 两段中文/英文混排文本的相似度（字符 bigram 余弦），用于没有向量库时的语义近似。
double similarity(const std::string& a, const std::string& b);

}  // namespace qjz
