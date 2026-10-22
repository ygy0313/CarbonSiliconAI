// minijson —— 只够这个内核用的 JSON 解析/序列化。
//
// 为什么不引第三方库：
//   1. 内核要能一行 clang++ 编译出来，不依赖包管理器；
//   2. 交叉编译到 ARM（阿里云 ECS）时不用带一堆 submodule；
//   3. 我们的 schema 很小，不需要 SAX、不需要 JSON Pointer。
//
// 不支持：注释、NaN/Inf、超过 double 精度的大整数。请求体里出现这些直接 400。
#pragma once

#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

namespace mjson {

struct Value {
    enum Type { Null, Bool, Num, Str, Arr, Obj };

    Type type = Null;
    bool b = false;
    double num = 0;
    std::string str;
    std::vector<Value> arr;
    std::vector<std::pair<std::string, Value>> obj;

    Value() = default;
    explicit Value(bool v) : type(Bool), b(v) {}
    explicit Value(double v) : type(Num), num(v) {}
    explicit Value(int v) : type(Num), num(static_cast<double>(v)) {}
    explicit Value(const std::string& v) : type(Str), str(v) {}
    explicit Value(const char* v) : type(Str), str(v) {}

    static Value object() { Value v; v.type = Obj; return v; }
    static Value array() { Value v; v.type = Arr; return v; }

    bool isObj() const { return type == Obj; }
    bool isArr() const { return type == Arr; }

    // 对象取值：找不到返回 nullptr，调用方自行决定默认值
    const Value* find(const std::string& key) const {
        if (type != Obj) return nullptr;
        for (const auto& kv : obj)
            if (kv.first == key) return &kv.second;
        return nullptr;
    }

    std::string strOr(const std::string& key, const std::string& def = "") const {
        const Value* v = find(key);
        return (v && v->type == Str) ? v->str : def;
    }

    double numOr(const std::string& key, double def = 0) const {
        const Value* v = find(key);
        if (!v) return def;
        if (v->type == Num) return v->num;
        if (v->type == Bool) return v->b ? 1 : 0;
        return def;
    }

    bool boolOr(const std::string& key, bool def = false) const {
        const Value* v = find(key);
        if (!v) return def;
        if (v->type == Bool) return v->b;
        if (v->type == Num) return v->num != 0;
        return def;
    }

    void set(const std::string& key, Value v) {
        if (type != Obj) { type = Obj; obj.clear(); }
        for (auto& kv : obj) {
            if (kv.first == key) { kv.second = std::move(v); return; }
        }
        obj.emplace_back(key, std::move(v));
    }

    void push(Value v) {
        if (type != Arr) { type = Arr; arr.clear(); }
        arr.push_back(std::move(v));
    }

    // 字符串数组读取，非字符串元素跳过
    std::vector<std::string> strArray(const std::string& key) const {
        std::vector<std::string> out;
        const Value* v = find(key);
        if (!v || v->type != Arr) return out;
        for (const auto& item : v->arr)
            if (item.type == Str) out.push_back(item.str);
        return out;
    }
};

// ── 序列化 ────────────────────────────────────────────────
inline void dumpString(const std::string& s, std::string& out) {
    out.push_back('"');
    for (unsigned char c : s) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    // UTF-8 字节原样透传，前端/Node 都能正确解码
                    out.push_back(static_cast<char>(c));
                }
        }
    }
    out.push_back('"');
}

inline void dumpNumber(double d, std::string& out) {
    if (!std::isfinite(d)) { out += "null"; return; }
    // 3 位小数够表达评分，且避免 0.30000000000000004 这种噪声
    char buf[40];
    double r = std::round(d * 1000.0) / 1000.0;
    if (r == static_cast<long long>(r)) {
        std::snprintf(buf, sizeof(buf), "%lld", static_cast<long long>(r));
    } else {
        std::snprintf(buf, sizeof(buf), "%.3f", r);
    }
    out += buf;
}

inline void dump(const Value& v, std::string& out) {
    switch (v.type) {
        case Value::Null: out += "null"; break;
        case Value::Bool: out += v.b ? "true" : "false"; break;
        case Value::Num: dumpNumber(v.num, out); break;
        case Value::Str: dumpString(v.str, out); break;
        case Value::Arr: {
            out.push_back('[');
            for (size_t i = 0; i < v.arr.size(); ++i) {
                if (i) out.push_back(',');
                dump(v.arr[i], out);
            }
            out.push_back(']');
            break;
        }
        case Value::Obj: {
            out.push_back('{');
            for (size_t i = 0; i < v.obj.size(); ++i) {
                if (i) out.push_back(',');
                dumpString(v.obj[i].first, out);
                out.push_back(':');
                dump(v.obj[i].second, out);
            }
            out.push_back('}');
            break;
        }
    }
}

inline std::string dump(const Value& v) {
    std::string out;
    out.reserve(256);
    dump(v, out);
    return out;
}

// ── 解析 ──────────────────────────────────────────────────
class Parser {
public:
    explicit Parser(const std::string& s) : s_(s) {}

    bool parse(Value& out, std::string& err) {
        skip();
        if (!parseValue(out, err)) return false;
        skip();
        if (i_ != s_.size()) { err = "尾部有多余字符"; return false; }
        return true;
    }

private:
    const std::string& s_;
    size_t i_ = 0;

    void skip() {
        while (i_ < s_.size()) {
            char c = s_[i_];
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') { ++i_; continue; }
            break;
        }
    }

    bool lit(const char* word) {
        size_t n = std::char_traits<char>::length(word);
        if (s_.compare(i_, n, word) != 0) return false;
        i_ += n;
        return true;
    }

    bool parseValue(Value& out, std::string& err) {
        if (i_ >= s_.size()) { err = "意外结束"; return false; }
        char c = s_[i_];
        if (c == '{') return parseObject(out, err);
        if (c == '[') return parseArray(out, err);
        if (c == '"') {
            out.type = Value::Str;
            return parseString(out.str, err);
        }
        if (c == 't') { if (!lit("true")) { err = "非法字面量"; return false; } out = Value(true); return true; }
        if (c == 'f') { if (!lit("false")) { err = "非法字面量"; return false; } out = Value(false); return true; }
        if (c == 'n') { if (!lit("null")) { err = "非法字面量"; return false; } out = Value(); return true; }
        return parseNumber(out, err);
    }

    bool parseObject(Value& out, std::string& err) {
        out.type = Value::Obj;
        ++i_;  // {
        skip();
        if (i_ < s_.size() && s_[i_] == '}') { ++i_; return true; }
        while (true) {
            skip();
            if (i_ >= s_.size()) { err = "对象未闭合"; return false; }
            if (s_[i_] != '"') { err = "对象的键必须是字符串"; return false; }
            std::string key;
            if (!parseString(key, err)) return false;
            skip();
            if (i_ >= s_.size() || s_[i_] != ':') { err = "缺少冒号"; return false; }
            ++i_;
            skip();
            Value v;
            if (!parseValue(v, err)) return false;
            out.obj.emplace_back(std::move(key), std::move(v));
            skip();
            if (i_ >= s_.size()) { err = "对象未闭合"; return false; }
            if (s_[i_] == ',') { ++i_; continue; }
            if (s_[i_] == '}') { ++i_; return true; }
            err = "对象里出现意外字符";
            return false;
        }
    }

    bool parseArray(Value& out, std::string& err) {
        out.type = Value::Arr;
        ++i_;  // [
        skip();
        if (i_ < s_.size() && s_[i_] == ']') { ++i_; return true; }
        while (true) {
            skip();
            Value v;
            if (!parseValue(v, err)) return false;
            out.arr.push_back(std::move(v));
            skip();
            if (i_ >= s_.size()) { err = "数组未闭合"; return false; }
            if (s_[i_] == ',') { ++i_; continue; }
            if (s_[i_] == ']') { ++i_; return true; }
            err = "数组里出现意外字符";
            return false;
        }
    }

    static void appendUtf8(std::string& out, uint32_t cp) {
        if (cp < 0x80) {
            out.push_back(static_cast<char>(cp));
        } else if (cp < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else if (cp < 0x10000) {
            out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        }
    }

    bool hex4(uint32_t& out) {
        if (i_ + 4 > s_.size()) return false;
        out = 0;
        for (int k = 0; k < 4; ++k) {
            char c = s_[i_ + k];
            out <<= 4;
            if (c >= '0' && c <= '9') out |= static_cast<uint32_t>(c - '0');
            else if (c >= 'a' && c <= 'f') out |= static_cast<uint32_t>(c - 'a' + 10);
            else if (c >= 'A' && c <= 'F') out |= static_cast<uint32_t>(c - 'A' + 10);
            else return false;
        }
        i_ += 4;
        return true;
    }

    bool parseString(std::string& out, std::string& err) {
        ++i_;  // "
        while (true) {
            if (i_ >= s_.size()) { err = "字符串未闭合"; return false; }
            char c = s_[i_++];
            if (c == '"') return true;
            if (c != '\\') { out.push_back(c); continue; }
            if (i_ >= s_.size()) { err = "转义未完成"; return false; }
            char e = s_[i_++];
            switch (e) {
                case '"': out.push_back('"'); break;
                case '\\': out.push_back('\\'); break;
                case '/': out.push_back('/'); break;
                case 'b': out.push_back('\b'); break;
                case 'f': out.push_back('\f'); break;
                case 'n': out.push_back('\n'); break;
                case 'r': out.push_back('\r'); break;
                case 't': out.push_back('\t'); break;
                case 'u': {
                    uint32_t cp = 0;
                    if (!hex4(cp)) { err = "\\u 后不是四位十六进制"; return false; }
                    // 代理对
                    if (cp >= 0xD800 && cp <= 0xDBFF && i_ + 1 < s_.size() && s_[i_] == '\\' && s_[i_ + 1] == 'u') {
                        size_t save = i_;
                        i_ += 2;
                        uint32_t lo = 0;
                        if (!hex4(lo)) { i_ = save; }
                        else if (lo >= 0xDC00 && lo <= 0xDFFF) {
                            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                        } else {
                            i_ = save;
                        }
                    }
                    appendUtf8(out, cp);
                    break;
                }
                default: err = "未知转义字符"; return false;
            }
        }
    }

    bool parseNumber(Value& out, std::string& err) {
        size_t start = i_;
        if (i_ < s_.size() && (s_[i_] == '-' || s_[i_] == '+')) ++i_;
        bool digits = false;
        while (i_ < s_.size()) {
            char c = s_[i_];
            if (c >= '0' && c <= '9') { digits = true; ++i_; continue; }
            if (c == '.' || c == 'e' || c == 'E' || c == '-' || c == '+') { ++i_; continue; }
            break;
        }
        if (!digits) { err = "不是合法数字"; return false; }
        std::string token = s_.substr(start, i_ - start);
        char* endp = nullptr;
        double d = std::strtod(token.c_str(), &endp);
        if (endp == token.c_str() || !std::isfinite(d)) { err = "数字解析失败"; return false; }
        out = Value(d);
        return true;
    }
};

inline bool parse(const std::string& text, Value& out, std::string& err) {
    Parser p(text);
    return p.parse(out, err);
}

}  // namespace mjson
