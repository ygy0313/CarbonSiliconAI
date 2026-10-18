# 硅基记忆体

> 一个人就是一个 Agent。把个体的行为、判断、履历、记忆编译成可执行的「硅基体」，
> 让 App / Agent / Skill 反过来围着这个人转。

**当前状态**：MVP 可运行。两条流程已跑通 —— 吃什么（给您请安）、组个局（剧本杀工坊）。全流程 0 元。

---

## 30 秒跑起来

```bash
# 1. 起后端（零依赖，不需要 npm install）
cd server && node src/index.js

# 2. 验证两条流程
cd server && node scripts/smoke.js
```

然后用微信开发者工具打开 `miniprogram/` 目录，**详情 → 本地设置 → 勾选「不校验合法域名」**，即可在模拟器里跑完整流程。

真机预览：手机与电脑连同一 Wi-Fi，在小程序「档案 → 开发设置」里把服务地址改成电脑的局域网 IP（如 `http://192.168.1.10:8787`）。

> **AppID**：当前 `project.config.json` 里是 `touristappid`（游客模式），只能本地调试。
> 要发布必须换成自己的正式 AppID，且一个 AppID 只能对应一个小程序 —— 不要和「给您请安」「剧本杀工坊」共用。

## 它解决什么问题

现在的产品都以「痛点」为切口，人被切成十几个账号。这个项目反过来：

- **档案在人手里**：事实、记忆、倾向，本地优先，可导出
- **服务被调用，不被打开**：每个服务声明「我需要什么数据、我产出什么」，编排器自动拼装
- **每次调用都回写**：采纳 / 否决 / 修正 → 置信度变化 → 档案更新。用得越多越懂你

## 目录

```
硅基记忆体/
├── docs/
│   ├── 01-架构设计.md        概念模型 / 分层 / 数据模型 / 编排算法 / 风险
│   ├── 02-交互设计.md        五屏线框 / 两条时序 / 交互细节 / 视觉规范
│   └── 03-费用测算.md        0 元清单 / 三档方案 / LLM 成本模型
├── preview/
│   └── index.html            一页看全：架构、流程、原型、成本（浏览器直接打开）
├── server/
│   ├── src/
│   │   ├── index.js          HTTP 入口：路由 / 校验 / 错误处理 / 优雅停机
│   │   ├── config.js         集中配置 + 启动校验
│   │   ├── errors.js         类型化错误
│   │   ├── logger.js         结构化 JSON 日志
│   │   ├── seed.js           演示档案
│   │   ├── domain/
│   │   │   └── taxonomy.js   12 个事实维度 / 意图词典 / 菜品·剧本·场地库
│   │   ├── agents/           7 个生活服务（needs/provides 声明式）
│   │   │   ├── registry.js   能力注册表 + 依赖图解析
│   │   │   ├── fortune.agent.js     今日节律（干支五行，不做吉凶断言）
│   │   │   ├── weather.agent.js     天气（Open-Meteo，失败降级 mock）
│   │   │   ├── calendar.agent.js    日程核对
│   │   │   ├── meal.agent.js        今日膳食
│   │   │   ├── mystery.agent.js     剧本杀选本
│   │   │   ├── venue.agent.js       场地推荐
│   │   │   └── catering.agent.js    茶歇配套
│   │   ├── services/
│   │   │   ├── extract.service.js       记录 → 事实 + 记忆
│   │   │   ├── profile.service.js       档案编译 / 记忆检索 / 置信度衰减
│   │   │   ├── orchestrator.service.js  意图→召回→依赖→执行→仲裁→组装
│   │   │   └── verify.service.js        核对回写 / 冲突裁决
│   │   ├── llm/provider.js   可插拔 LLM，失败一律降级
│   │   └── store/            Collection 接口 / JSON 原子写 / 写队列
│   └── scripts/smoke.js      33 项端到端检查
└── miniprogram/
    ├── pages/index           硅基体首页
    ├── pages/chat            说一句（编排过程可视化）
    ├── pages/plan            方案详情（时间线 / 待办）
    ├── pages/record          记录（存完告诉你改了什么）
    ├── pages/profile         档案（12 维度 / 置信度 / 冲突裁决）
    ├── pages/services        服务市场
    ├── utils/api.js          API 客户端（统一错误映射）
    ├── utils/mock.js         离线演示数据（后端没起也能看）
    └── scripts/check-wxml.js WXML 发布前体检
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` `/ready` | 存活 / 就绪 |
| GET | `/api/meta` | 维度、意图、服务清单、LLM 状态 |
| POST | `/api/persons` | 建人 |
| GET | `/api/persons/:id/silicon` | 编译后的硅基体 + 待裁决冲突 |
| GET | `/api/persons/:id/profile` | 原始档案 |
| POST | `/api/persons/:id/records` | 记一笔（返回改了哪些事实） |
| POST | `/api/persons/:id/orchestrate` | 编排（返回 cards + trace） |
| POST | `/api/persons/:id/facts` | 手动修正事实 |
| POST | `/api/persons/:id/feedback` | 采纳 / 否决 / 修正 |
| GET | `/api/persons/:id/conflicts` | 待裁决冲突 |
| POST | `/api/persons/:id/conflicts/:cid/resolve` | 裁决 |
| POST | `/api/dev/reset` | 重置演示数据（生产禁用） |

### 试一下

```bash
# 吃什么
curl -s --noproxy '*' -X POST http://127.0.0.1:8787/api/persons/p_owner/orchestrate \
  -H 'Content-Type: application/json' \
  -d '{"text":"今天中午吃什么，一个人，别太辣，预算30"}' | python3 -m json.tool

# 组个局
curl -s --noproxy '*' -X POST http://127.0.0.1:8787/api/persons/p_owner/orchestrate \
  -H 'Content-Type: application/json' \
  -d '{"text":"周六想和朋友组个局，6个人，预算150"}' | python3 -m json.tool

# 记一笔
curl -s --noproxy '*' -X POST http://127.0.0.1:8787/api/persons/p_owner/records \
  -H 'Content-Type: application/json' \
  -d '{"text":"中午吃了羊肉面，下午胃有点胀"}'
```

## 接入一个新服务

在 `server/src/agents/` 下新建一个文件，注册即可，**编排核心不用改**：

```js
const registry = require('./registry')

async function run(ctx) {
  // ctx.facts          档案里的事实（已按置信度过滤）
  // ctx.outputs['xxx'] 上游 agent 的输出
  // ctx.entities       本次抽取的实体（人数/预算/时间…）
  return {
    items: [{
      id: 'wine_1',
      kind: 'primary',        // plan | primary | option | note | context
      title: '贺兰山赤霞珠',
      desc: '人均 128 元 · 配红肉',
      why: ['你偏好咸鲜，这款单宁适中'],   // 必须能说清为什么
      evidence: [{ episodeId, text }],   // 尽量引用具体记忆
      score: 0.8,
      source: '红酒推广 · 配餐',
    }],
    meta: {},
  }
}

registry.register({
  id: 'wine.pair',
  service: '红酒推广',
  name: '配餐建议',
  intents: ['drink', 'gift'],
  needs: ['profile.diet', 'context.fortune'],
  provides: ['wine_pairing'],
  cost: 'free',
  run,
})
```

`needs` 里写 `context.fortune`，编排器就会自动把「今日节律」拉进执行计划。

## 可选：接大模型

不配 key 时走规则引擎，全流程正常。要接的话：

```bash
# 智谱（长期免费档）
LLM_PROVIDER=zhipu LLM_API_KEY=your_key node src/index.js

# 本地 Ollama（完全免费）
LLM_PROVIDER=ollama LLM_MODEL=qwen2.5:3b node src/index.js
```

支持 `zhipu` / `deepseek` / `openai` / `ollama` / `none`。任何一次调用失败都会自动降级，不会阻断编排。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8787 | 服务端口 |
| `DATA_DIR` | `./data` | 数据目录 |
| `LLM_PROVIDER` | `none` | `none`/`zhipu`/`deepseek`/`openai`/`ollama` |
| `LLM_API_KEY` | — | 缺失时自动降级 |
| `MEMORY_HALF_LIFE_DAYS` | 90 | 记忆置信度半衰期 |
| `CORS_ORIGINS` | localhost:5173 | 显式来源，禁止通配符 |
| `SEED_DEMO` | true | 首次启动写入演示档案 |

## 发布前检查

```bash
node miniprogram/scripts/check-wxml.js   # WXML 三类静默失效
node server/scripts/smoke.js             # 33 项端到端
```

WXML 体检拦的是三类「本地不报错、上传才炸」的问题：开标签前紧贴中文、模板里调用数组方法、`wx:for` 缺 `wx:key`。

## 已知边界

- **冷启动**：前 10 条记录之前硅基体没有价值，靠 12 维度清单 + 演示档案兜底
- **录入成本**：目前只有文字 + 快捷标签，语音和拍照识食未接（可复用「给您请安」的 `vision.js`）
- **单用户**：数据层按多用户设计（所有集合都有 `personId`），但未做登录鉴权
- **规则引擎天花板**：词典覆盖不到的表达会漏，意图置信度低时应该反问（当前只提示"还没听懂"）
- **隐私**：档案极敏感，当前只存本地；接 LLM 时未做脱敏，上生产前必须补
