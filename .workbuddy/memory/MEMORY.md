# 硅基记忆体 · 工程记忆

> 长期约定与当前状态。单次改动见 `2026-MM-DD.md`。

## 工程信息

| 项 | 值 |
|---|---|
| 工程名 | 硅基记忆体（CarbonSiliconAI） |
| 本地目录 | `~/WorkBuddy/硅基记忆体` |
| GitHub | <https://github.com/ygy0313/CarbonSiliconAI>（公开）SSH：`git@github.com:ygy0313/CarbonSiliconAI.git` |
| 默认分支 | `main`（已建 upstream） |
| 类型 | 微信原生小程序 + 零依赖 Node 后端 |
| 后端端口 | 8787 |
| 小程序 AppID | `touristappid`（⚠️ 游客模式，无法提审；不可与「给您请安」「剧本杀工坊」共用） |
| 数据存储 | `server/data/*.json`（Collection 接口，可换 SQLite）；**已 gitignore**，首次启动由 `src/seed.js` 自动生成 |

## 启动

```bash
cd server && node src/index.js        # 端口 8787
node server/scripts/smoke.js          # 33 项端到端（需 NO_PROXY=127.0.0.1）
node miniprogram/scripts/check-wxml.js
```

微信开发者工具打开 `miniprogram/`，勾选「不校验合法域名」。

## 架构红线（改代码前必读）

1. agent 不互相调用，只声明 `needs` / `provides`；依赖由 `registry.resolvePlan()` 解析。
2. LLM 调用失败一律返回 `null` 降级，不允许抛错阻断编排。
3. 每条推荐必须有 `why`，尽量有 `evidence`（引用 episode）。不能溯源的推荐不许出现。
4. gather 意图必须产出 `kind: 'plan'` 的 bundle（时间线 + 待办 + 人均）。
5. 控制器只做解析/调用/格式化，不写业务判断。
6. 事实冲突进 conflict 队列，不自动覆盖。

## 命令坑

- 本机 curl 走代理，访问本地必须 `curl --noproxy '*'`。
- 后端必须用 `run_in_background: true` 启动，shell 后台进程会被回收。
- WXML 里禁用数组方法（indexOf/includes/filter），一律预计算。
