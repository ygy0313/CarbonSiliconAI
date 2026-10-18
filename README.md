# 起居注 · 一个人的档案

[![ci](https://github.com/ygy0313/CarbonSiliconAI/actions/workflows/ci.yml/badge.svg)](https://github.com/ygy0313/CarbonSiliconAI/actions/workflows/ci.yml)

> 记下你怎么活，替你安排下一步。
> 它不问你想要什么，它记得你怎么活的。

**当前状态**：MVP 可运行。三档组局（一个人 / 跟 AI / 一群人）、脱敏档案、授权导出、入局问答、干支历算，全部落地。后端 + H5 + 微信小程序双端。

- 仓库：<https://github.com/ygy0313/CarbonSiliconAI>
- 克隆：`git clone git@github.com:ygy0313/CarbonSiliconAI.git`

## 30 秒跑起来

```bash
cd server && node src/index.js     # 零依赖，不需要 npm install
```

- **H5 端**：浏览器打开 <http://127.0.0.1:8787>（与 API 同源，无跨域）
- **小程序端**：微信开发者工具打开 `miniprogram/`，勾选「不校验合法域名」
- **验收**：

```bash
node server/scripts/smoke.js          # 33 项端到端
node server/scripts/check-privacy.js  # 52 项隐私链路（脱敏/授权/导出/恢复）
node server/scripts/verify-ganzhi.js  # 26 项干支历算
node miniprogram/scripts/check-wxml.js
```

## 它解决什么问题

现在的产品都以「痛点」为切口，人被切成十几个账号。这个项目反过来：

- **档案在人手里**：脱敏存储、票据授权、随时导出带走（`qijuzhu/v1` 格式，带校验和）
- **服务被调用，不被打开**：每个服务声明「我需要什么数据、我产出什么」，编排器自动拼装
- **每次调用都回写**：采纳 / 否决 / 修正 → 置信度变化 → 档案更新。用得越多越懂你

## 核心能力

| 能力 | 说明 |
|---|---|
| 三档组局 | 「一个人想玩」出有结构的独处方案；「和 AI 凑一局」生成有立场、会隐瞒、能顶嘴的 NPC 班底（同一天同一人，NPC 固定不换）；「六个人周末」拼出本+场地+茶歇+时间线+待办 |
| 脱敏档案 | 原文 AES-256-GCM 加密进保险箱，主库只有脱敏文本；手机号/证件号/地址入库即变占位符 |
| 票据授权 | 读 prompt、导出、还原原文，各自签发票据：有用途、有期限、有次数，明文只出现一次，全程审计 |
| 标准导出 | `qijuzhu/v1` 格式，sha256 校验和 + HMAC 签名，可导入恢复成新档案 —— 换设备、换 App、二十年后也能读 |
| 入局问答 | 12 道带梗的题（外卖、香菜、已读不回），答题即建档，每题只采一个维度 |
| 干支历算 | 流年/流月/流日三层，节气用太阳视黄经反解（与历书偏差 2-7 分钟），年柱以立春为界；只谈节奏与宜忌方向，不作吉凶断言 |
| 双端 | H5（零构建，与 API 同源）+ 微信原生小程序，共用一套后端 |

## 目录

```
├── server/                 零依赖 Node 后端（端口 8787）
│   ├── src/security/       脱敏、加密保险箱、授权票据
│   ├── src/domain/         领域词典、干支历算、入局问答、品牌
│   ├── src/agents/         生活服务能力（声明 needs/provides，编排器自动组装）
│   ├── src/services/       抽取 / 画像 / 编排 / 核对 / prompt / 导出
│   └── scripts/            三套回归测试
├── web/                    H5 端（原生 HTML/CSS/JS，由后端静态托管）
├── miniprogram/            微信小程序端
├── preview/                一页总览（架构 / 流程 / 原型 / 成本）
└── docs/
    ├── 01-架构设计.md       概念模型 / 分层 / 数据模型 / 编排算法
    ├── 02-交互设计.md       流程时序 / 页面结构
    ├── 03-费用测算.md       MVP 全免费路径 / 规模化成本
    ├── 04-隐私与授权.md     脱敏规则 / 票据机制 / 导出格式
    ├── 05-部署阿里云ECS.md  Nginx / systemd / HTTPS / 备份 / 容量预估
    ├── 06-小程序注册与备案.md 双备案全流程 / 费用 / 高频驳回原因
    └── 07-上线检查清单.md   从「本地能跑」到「别人能用」的全部步骤
```

## 关键约定（改代码前必读）

1. **对外不出现「硅基」类技术词**。产品名、角色名一律读 `server/src/domain/brand.js`（产品名「起居注」，助手叫「执笔」），改名只改这一个文件
2. **原文永不落主库**。任何新写入路径必须走 `redactDeep()` + `vault.seal()`
3. **agent 不互相调用**，只声明 `needs` / `provides`；新增服务只加一个文件
4. **LLM 是增强层不是依赖层**：不配 key 全流程照跑，LLM 失败一律 null 降级
5. **推荐必带 `why`，尽量带 `evidence`**；说不出理由的建议不许出现
6. **运势只谈节奏与宜忌方向**，不作吉凶、财运、健康、婚恋断言

## 数据安全速览

```
一句话记录 ──┬─ 脱敏文本 → 主库（可展示、可推荐）
             └─ 原文 → AES-256-GCM 密文 → 保险箱（口令派生，不落盘）

读 prompt / 导出 / 还原原文 ──→ 签发票据（15 分钟 · 3 次 · 有用途）──→ 全程审计
```

详细设计见 `docs/04-隐私与授权.md`。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8787 | 服务端口 |
| `QJZ_PASSPHRASE` | （本地密钥文件） | 保险箱口令，生产必设 |
| `SEED_DEMO` | true | 是否生成演示档案，生产设 false |
| `LLM_PROVIDER` | none | none / zhipu / deepseek / openai / ollama |
| `CORS_ORIGINS` | localhost:5173 | H5 独立部署时的跨域白名单 |

## 下一步

见 `docs/07-上线检查清单.md`：AppID、双备案、HTTPS、隐私指引 —— 全办完约 2-4 周、70 元/年。
