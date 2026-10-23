# 起居注 · 工程记忆（本地目录名仍为「硅基记忆体」，不改）

> 长期约定与当前状态。单次改动见 `2026-MM-DD.md`。

## 工程信息

| 项 | 值 |
|---|---|
| 工程名 | **起居注**（对外名，2026-10-18 用户选定；原名「硅基记忆体」已废弃，对外禁用） |
| 角色名 | 执笔（对内人格包称谓） |
| 品牌唯一来源 | `server/src/domain/brand.js`（改名只动这一个文件） |
| 本地目录 | `~/WorkBuddy/硅基记忆体`（目录名不改） |
| GitHub | <https://github.com/ygy0313/CarbonSiliconAI>（公开）SSH：`git@github.com:ygy0313/CarbonSiliconAI.git` |
| 默认分支 | `main`（已建 upstream） |
| 类型 | 微信原生小程序 + H5（web/）+ Node 网关（8787）+ C++17 计算内核（8788） |
| 后端端口 | 8787（Node）/ 8788（core/ 内核，仅监听本机） |
| 小程序 AppID | `touristappid`（⚠️ 游客模式，无法提审；不可与「给您请安」「剧本杀工坊」共用） |
| 数据存储 | `server/data/*.json`（Collection 接口，可换 SQLite）；**已 gitignore**，首次启动由 `src/seed.js` 自动生成 |
| 隐私架构 | 原文 AES-256-GCM 进保险箱（`QJZ_PASSPHRASE` 派生），主库只存脱敏文本；读 prompt/导出/还原需 scope 票据 |
| 测试 | 后端：smoke 33 + agents 33 + legal 76 + input 39 + privacy 52 + experience 53 + ganzhi 26；小程序：check-mp 47 + WXML；内核自检 17。CI 全跑 |
| 法律文本 | 唯一来源 `server/src/domain/legal.js`（当前 v2026.11）；H5 `/legal/privacy|terms` 服务端直出，小程序 `pages/legal` 拉同一接口；版本号 `LEGAL_VERSION` 变了用户要重新同意（storage `legalAck`）；运营者占位用环境变量 `QJZ_OPERATOR_NAME` 覆盖 |
| 输入端 | 拍照识食 `services/vision.service.js` + 转写 `services/asr.service.js`，走 `llm/provider.js` 的 `completeVisionJSON/transcribe`（OpenAI 兼容 image_url / /audio/transcriptions）；**照片与录音只在内存过一遍即丢，不落盘不进档案**（check-input 断言）；未配模型时 reason 说「还没接通」而不是「没认出来」（engine=disabled 与 none 区分）；转写结果填输入框由用户确认后才走 records |
| 服务能力 | 膳食 / 节律 / 天气 / 日程 / 选本 / 场地 / 茶歇 / **选酒**（`wine.suggest`）/ **记梦**（`dream.record`） |
| 经验层 | `experiences`（可执行规则，资产核心）+ `criteria`（双环约束点，带版本号）；反思入口 `POST /experiences/reflect` |

## 启动

```bash
cd server && node src/index.js        # 端口 8787
node server/scripts/smoke.js          # 33 项端到端（需 NO_PROXY=127.0.0.1）
node miniprogram/scripts/check-wxml.js
```

微信开发者工具打开 `miniprogram/`，勾选「不校验合法域名」。

## 架构红线（改代码前必读）

1. **对外禁用「硅基/碳基」类技术词**，一切品牌文案读 `domain/brand.js`（产品名=起居注，助手=执笔）。
2. **原文永不落主库**：任何新写入路径必须走 `redactDeep()` + `vault.seal()`；演示 seed 也走同一条流水线。
3. **读 prompt / 导出 / 还原原文必须持 scope 票据**，票据只走 `X-Grant-Token` 请求头，不进 URL。
4. agent 不互相调用，只声明 `needs` / `provides`；依赖由 `registry.resolvePlan()` 解析。
5. LLM 调用失败一律返回 `null` 降级，不允许抛错阻断编排。
6. 每条推荐必须有 `why`，尽量有 `evidence`（引用 episode）。不能溯源的推荐不许出现。
7. gather 意图必须产出 `kind: 'plan'` 的 bundle（时间线 + 待办 + 人均），且先按 `detectGatherMode()` 分 solo/npc/group。
8. 运势只谈节奏与宜忌方向，不作吉凶、财运、健康、婚恋断言。
11. **经验必须能溯源**：没有 evidence 的经验 `createExperience` 会拒收；跨人读经验返回 404 不是 403。
12. **经验必须影响结果**：编排时检索 Top-K 经验参与仲裁（`applyExperienceBoost` 提升已存在候选），不许只贴标签。
13. **Agent 可改经验分数，不可改评估标准**：`POST /criteria` 必须带 `confirm:true`（双环约束）。
14. **内核是加速器不是依赖**：`core/`（C++）与 `src/core/fallback.js`（JS 镜像）算法必须逐项对齐，同构断言在 check-experience.js；改一边必须改另一边。
15. 改 `core/*.cpp` 后必须重启 8788 进程，否则跑旧二进制。
16. **选酒不报价**：卡片只写价位带 + 「价格以店铺为准」，正文不得出现「数字+元」（回归脚本扫描）。
17. **记梦不解梦**：只给意象/情绪/三幕骨架，禁用「预示/吉凶/财运/姻缘/命中注定」，禁词进回归断言。
18. **对外文案一份只写一遍**：法律文本在 `domain/legal.js`，品牌在 `brand.js`；H5 与小程序都从服务端取，不许在页面里再抄一份（check-legal 守着）。
19. **识图/录音不留存**：照片与录音只在内存处理完即丢，改这条必须同步改 legal.js 第九节、docs/07 声明与 check-input 断言（三处一致）。
20. **小程序前端改动必跑 `check-mp.js`**：Page 逻辑用桩环境跑（loadPage），改动页面的数据映射没跑过不算完。
9. 控制器只做解析/调用/格式化，不写业务判断。
10. 事实冲突进 conflict 队列，不自动覆盖。

## 命令坑

- 本机 curl 走代理，访问本地必须 `curl --noproxy '*'`。
- 后端必须用 `run_in_background: true` 启动，shell 后台进程会被回收。
- WXML 里禁用数组方法（indexOf/includes/filter），一律预计算。
