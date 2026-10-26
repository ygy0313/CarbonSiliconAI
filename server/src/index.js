'use strict'

// HTTP 入口：路由 → 校验 → 服务调用 → 响应。
// 控制器层不写业务逻辑，只做「解析请求 / 调用服务 / 格式化响应」三件事。

const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { config, validate } = require('./config')
const log = require('./logger')
const { AppError, ValidationError, NotFoundError, InternalError } = require('./errors')
const { createRepos } = require('./store/repos')
const { FACT_DIMENSIONS, INTENTS } = require('./domain/taxonomy')
const { BRAND } = require('./domain/brand')
const quiz = require('./domain/quiz')
const geo = require('./domain/geo')
const gz = require('./domain/ganzhi')
const registry = require('./agents/registry')
const baseAgents = require('./agents/registry') // 触发注册
require('./agents/fortune.agent')
require('./agents/weather.agent')
require('./agents/calendar.agent')
require('./agents/meal.agent')
require('./agents/mystery.agent')
require('./agents/venue.agent')
require('./agents/catering.agent')
require('./agents/wine.agent')
require('./agents/dream.agent')
require('./agents/move.agent')
const { extract } = require('./services/extract.service')
const { recordEpisode, compileSilicon } = require('./services/profile.service')
const { orchestrate } = require('./services/orchestrator.service')
const { applyFeedback, resolveConflict, detectAndQueueConflict } = require('./services/verify.service')
const { applyAnswer } = require('./services/quiz.service')
const { buildPersonaPrompt, summarize: summarizePrompt } = require('./services/prompt.service')
const { exportArchive, importArchive, verifyArchive } = require('./services/export.service')
const experienceService = require('./services/experience.service')
const reflectService = require('./services/reflect.service')
const obsidianService = require('./services/obsidian.service')
const vaultSearch = require('./services/vaultsearch.service')
const core = require('./core/client')
const vault = require('./security/vault')
const grant = require('./security/grant')
const { redact, redactDeep } = require('./security/redact')
const llm = require('./llm/provider')
const legal = require('./domain/legal')
const legalPage = require('./services/legal.page')
const visionService = require('./services/vision.service')
const asrService = require('./services/asr.service')
const agendaService = require('./services/agenda.service')
const { seedDemo } = require('./seed')

validate()
log.setLevel(config.logLevel)

const repos = createRepos(config.dataDir)
const PERSON_DEFAULT = 'p_owner'

// ── 工具 ────────────────────────────────────────────────
function json(res, status, body, requestId) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'X-Request-Id': requestId,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(payload)
}

function readBody(req, limit = 100 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        reject(new ValidationError('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (_) {
        reject(new ValidationError('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function requirePerson(personId) {
  const person = repos.person.get(personId)
  if (!person) throw new NotFoundError(`找不到这个人：${personId}`)
  return person
}

function requireString(value, field, max = 2000) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} 必须是非空字符串`)
  }
  if (value.length > max) throw new ValidationError(`${field} 超长（上限 ${max} 字符）`)
  return value.trim()
}

// 授权票据从请求头读，绝不从 URL 读 —— query string 会进访问日志。
function requireGrant(req, personId, scope, meta = {}) {
  const token = req.headers['x-grant-token']
  return grant.consume(repos, personId, token, scope, meta)
}

// ── 路由表 ───────────────────────────────────────────────
const routes = [
  {
    method: 'GET',
    pattern: /^\/health$/,
    handler: async () => ({ status: 'ok', uptime: Math.round(process.uptime()) }),
  },
  {
    method: 'GET',
    pattern: /^\/ready$/,
    handler: async () => ({ ready: true, dataDir: config.dataDir, llm: llm.describe(), core: await core.describe() }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/meta$/,
    handler: async () => ({
      product: BRAND.name,
      fullName: BRAND.fullName,
      tagline: BRAND.tagline,
      slogan: BRAND.slogan,
      intro: BRAND.intro,
      persona: { name: BRAND.personaName, desc: BRAND.personaDesc },
      version: BRAND.version,
      exportFormat: BRAND.exportFormat,
      llm: llm.describe(),
      dimensions: FACT_DIMENSIONS,
      intents: INTENTS.map(i => ({ type: i.type, label: i.label, service: i.service })),
      services: baseAgents.list(),
      memory: { halfLifeDays: config.memory.halfLifeDays },
      experience: {
        minSupport: config.experience.minSupport,
        exposeLimit: config.experience.exposeLimit,
        criteria: experienceService.getCriteria(repos, PERSON_DEFAULT).thresholds,
        engine: 'core/（C++ 内核，可选加速；不可用时自动回落 JS 镜像实现）',
      },
      privacy: {
        vault: vault.describe(),
        defaults: '记录先脱敏再入库，原文只存密文；读取 prompt / 导出 / 还原原文均需显式授权',
      },
      quiz: { total: quiz.QUESTIONS.length, groups: Object.keys(quiz.QUESTIONS.reduce((a, q) => { a[q.group] = 1; return a }, {})) },
      legal: { version: legal.LEGAL_VERSION, effectiveAt: legal.EFFECTIVE_AT, docs: legal.IDS },
    }),
  },

  // ── 法律文本：小程序与 H5 同源，避免两端口径不一致 ──
  {
    method: 'GET',
    pattern: /^\/api\/legal$/,
    handler: async () => ({
      version: legal.LEGAL_VERSION,
      effectiveAt: legal.EFFECTIVE_AT,
      operator: legal.OPERATOR,
      digest: legal.digest(),
      docs: legal.IDS.map(id => {
        const d = legal.get(id)
        return { id: d.id, title: d.title, subtitle: d.subtitle, version: d.version, effectiveAt: d.effectiveAt, sections: d.sections }
      }),
    }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/legal\/(privacy|terms)$/,
    handler: async ({ params }) => {
      const doc = legal.get(params[0])
      if (!doc) throw new NotFoundError('没有这份文本')
      return { ...doc, digest: legal.digest(), operator: legal.OPERATOR, plain: legal.toPlain(doc) }
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/ganzhi$/,
    handler: async ({ query }) => {
      const dateStr = query.get('date')
      const d = dateStr ? new Date(dateStr) : new Date()
      if (Number.isNaN(d.getTime())) throw new ValidationError('date 不是合法日期')
      return gz.ganzhiOf(d, query.get('element') || null)
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/quiz$/,
    handler: async () => ({ questions: quiz.list() }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/services$/,
    handler: async () => ({ services: baseAgents.list() }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons$/,
    handler: async ({ body }) => {
      const name = requireString(body.name, 'name', 40)
      const person = repos.person.create({
        id: body.id || undefined,
        name,
        city: typeof body.city === 'string' ? body.city : '银川',
      })
      log.info('创建人物', { personId: person.id })
      return { person }
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/facts$/,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const key = requireString(body.key, 'key', 64)
      if (!FACT_DIMENSIONS.some(d => d.key === key)) {
        throw new ValidationError(`未知的事实维度：${key}`)
      }
      const value = body.value
      if (value === null || value === undefined || String(value).trim() === '') {
        throw new ValidationError('value 不能为空')
      }
      repos.fact.upsert(params[0], key, value, {
        confidence: 0.95,
        source: 'user_correction',
        note: '用户手动修正',
        updatedAt: new Date().toISOString(),
      })
      return {
        fact: repos.fact.get(params[0], key),
        completeness: compileSilicon(repos, params[0], { limit: 5 }).completeness,
      }
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/persons\/([\w-]+)\/silicon$/,
    handler: async ({ params }) => {
      requirePerson(params[0])
      const silicon = compileSilicon(repos, params[0], { limit: 30 })
      const conflicts = repos.conflict.byPerson(params[0])
      return { silicon, pendingConflicts: conflicts }
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/persons\/([\w-]+)\/profile$/,
    handler: async ({ params }) => {
      requirePerson(params[0])
      return {
        person: repos.person.get(params[0]),
        facts: repos.fact.byPerson(params[0]),
        episodes: repos.episode.byPerson(params[0], 50),
        traits: compileSilicon(repos, params[0])?.traits,
        conflicts: repos.conflict.byPerson(params[0]),
      }
    },
  },
  // ── 输入端：拍照识食 / 语音转写 ──
  // 两者都只做「当场把内容变成可用文本」，不写库、不留原件：
  // 照片与录音在内存里过一遍就丢，转写结果交给用户自己确认后再走 records。
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/vision\/meal$/,
    // 前端压过图，base64 仍在 1MB 上下，默认 100KB 装不下
    bodyLimit: 2 * 1024 * 1024,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const result = await visionService.recognizeMeal(body.image, { label: body.label })
      return {
        ...result,
        // 说清这一步做了什么、没做什么，前端照此提示，不自己编
        notice: result.ok
          ? '照片只在这次识别时用了一下，没有保存。'
          : '照片没有保存，也没有写进档案。',
      }
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/voice\/transcribe$/,
    bodyLimit: 4 * 1024 * 1024,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const result = await asrService.transcribe({ audio: body.audio, mime: body.mime })
      return {
        ...result,
        notice: result.ok ? '录音只在这次转写时用了一下，没有保存。' : '录音没有保存。',
      }
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/records$/,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const text = requireString(body.text, 'text', 1000)
      const tags = Array.isArray(body.tags) ? body.tags.slice(0, 12) : []

      const extracted = await extract({ text, tags })
      const { episode, factChanges } = recordEpisode(repos, params[0], extracted, body.source || 'manual')
      const conflicts = detectAndQueueConflict(repos, params[0], factChanges, episode.id)

      // 记录完立刻重算画像，让前端能看到「刚刚这句话改变了什么」
      const silicon = compileSilicon(repos, params[0])

      return {
        episode,
        factChanges,
        conflicts,
        silicon: {
          completeness: silicon.completeness,
          hints: silicon.traits.personaHints,
          factCount: silicon.facts.length,
          memoryCount: silicon.traits.recordCount,
        },
        extracted: {
          tags: extracted.tags,
          entities: extracted.entities,
          summary: extracted.summary,
          extractor: extracted.extractor,
        },
      }
    },
  },
  // ── 日程：用户认下的事（推荐是算的，日程是定的）──
  {
    method: 'GET',
    pattern: /^\/api\/persons\/([\w-]+)\/agenda$/,
    handler: async ({ params, query }) => {
      requirePerson(params[0])
      const days = Number(query.get('days') || 7)
      return agendaService.list(repos, params[0], { days })
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/agenda$/,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const item = agendaService.create(repos, params[0], {
        date: body.date,
        time: body.time,
        title: body.title,
        place: body.place,
        source: body.source,
      })
      return { item }
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/agenda\/([\w-]+)\/done$/,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const item = agendaService.setDone(repos, params[0], params[1], body.done !== false)
      if (!item) throw new NotFoundError('找不到这条日程')
      return { item }
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/agenda\/([\w-]+)\/remove$/,
    handler: async ({ params }) => {
      requirePerson(params[0])
      const ok = agendaService.remove(repos, params[0], params[1])
      if (!ok) throw new NotFoundError('找不到这条日程')
      return { removed: true }
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/orchestrate$/,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const text = requireString(body.text, 'text', 1000)
      const tags = Array.isArray(body.tags) ? body.tags.slice(0, 12) : []

      // 编排前先把这句话本身落成记忆（用户说的每句话都算数据）
      const extracted = await extract({ text, tags })
      if (body.remember !== false) {
        recordEpisode(repos, params[0], extracted, 'intent')
      }

      // 定位可选：前端给了经纬度就按「就近城市」走，没给就回退档案里的城市
      const g = geo.normalizeGeo(body.geo)
      const result = await orchestrate(repos, params[0], text, {
        tags: extracted.tags,
        entities: extracted.entities,
        geo: g,
      })
      // 前端展示用：定位解析出的城市（人在哪就显示哪，不再显示档案城市）
      result.geoCity = g ? g.city : null
      return result
    },
  },
  // ── 微信运动：code2Session + 解密加密数据（AppSecret 只在服务端）──
  {
    method: 'POST',
    pattern: /^\/api\/wechat\/werun$/,
    handler: async ({ body }) => {
      const code = requireString(body.code, 'code', 64)
      const encryptedData = requireString(body.encryptedData, 'encryptedData', 6144)
      const iv = requireString(body.iv, 'iv', 32)
      if (!config.wx || !config.wx.appid || !config.wx.secret) {
        return { engine: 'disabled', reason: '服务端还没配置微信凭据' }
      }
      const qs = new URLSearchParams({
        appid: config.wx.appid,
        secret: config.wx.secret,
        js_code: code,
        grant_type: 'authorization_code',
      })
      let session = null
      try {
        const res = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${qs}`)
        session = await res.json()
      } catch (_) {
        return { engine: 'none', reason: '连不上微信服务器' }
      }
      if (!session || !session.session_key) {
        return { engine: 'none', reason: (session && session.errmsg) || 'code2Session 失败' }
      }
      let parsed = null
      try {
        const key = Buffer.from(session.session_key, 'base64')
        const data = Buffer.from(encryptedData, 'base64')
        const ivBuf = Buffer.from(iv, 'base64')
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, ivBuf)
        const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
        parsed = JSON.parse(plain)
      } catch (_) {
        return { engine: 'none', reason: '解密失败（数据或会话不匹配）' }
      }
      if (!parsed || !parsed.watermark || parsed.watermark.appid !== config.wx.appid) {
        return { engine: 'none', reason: '数据水印校验不通过' }
      }
      const list = Array.isArray(parsed.stepInfoList) ? parsed.stepInfoList : []
      const days = list.slice(-7).map(x => {
        const d = new Date(x.timestamp * 1000)
        const pad = n => (n < 10 ? '0' + n : '' + n)
        return {
          date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
          step: x.step,
        }
      })
      const todayStr = new Date().toISOString().slice(0, 10)
      const bjToday = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
      const today = days.find(x => x.date === bjToday) || days[days.length - 1] || null
      return {
        engine: 'model',
        today,
        week: days,
        // 参考量级：快走 30 分钟约 3000-4000 步，折算系数按公开指南取 0.04 kcal/步
        kcalEstimate: today ? Math.round(today.step * 0.04) : null,
        fastWalkMin: today ? Math.round((today.step / 3500) * 30) : null,
      }
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/feedback$/,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const action = body.action
      if (!['accept', 'reject', 'edit'].includes(action)) {
        throw new ValidationError('action 必须是 accept / reject / edit')
      }
      if (!body.invocationId) throw new ValidationError('缺少 invocationId')
      return applyFeedback(repos, params[0], {
        invocationId: body.invocationId,
        cardId: body.cardId || null,
        action,
        reason: body.reason || null,
        patch: body.patch || null,
      })
    },
  },
  // ── 经验资产：情境 → 曾经有效的判断 ──
  {
    method: 'GET',
    pattern: /^\/api\/persons\/([\w-]+)\/experiences\/assets$/,
    handler: async ({ params }) => {
      requirePerson(params[0])
      const assets = await experienceService.assets(repos, params[0])
      const engine = await core.describe()
      return { assets, engine: { engine: engine.engine, alive: engine.alive, stats: engine.stats } }
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/persons\/([\w-]+)\/experiences$/,
    handler: async ({ params, query }) => {
      requirePerson(params[0])
      const status = query.get('status')
      if (status && !['active', 'dormant', 'proposed', 'archived'].includes(status)) {
        throw new ValidationError('status 必须是 active / dormant / proposed / archived')
      }
      return {
        experiences: experienceService.list(repos, params[0], { status }),
        criteria: experienceService.getCriteria(repos, params[0]).thresholds,
      }
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/experiences$/,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const rule = requireString(body.rule, 'rule', 300)
      const tags = Array.isArray(body.tags) ? body.tags.slice(0, 6).map(String) : []
      const scene = ['solo', 'group', 'npc', 'work', ''].includes(body.scene) ? body.scene : ''
      return { experience: experienceService.createManual(repos, params[0], { rule, tags, scene }) }
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/experiences\/reflect$/,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const r = await reflectService.reflect(repos, params[0], {
        days: Math.min(365, Math.max(7, Number(body.days) || 120)),
      })
      return r
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/persons\/([\w-]+)\/experiences\/([\w-]+)$/,
    handler: async ({ params }) => {
      requirePerson(params[0])
      const exp = experienceService.get(repos, params[0], params[1])
      // 跨人访问 = 不存在。不返回 403，403 本身就泄漏了「这条经验存在」
      if (!exp) throw new NotFoundError('经验不存在')
      return { experience: exp }
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/experiences\/([\w-]+)\/apply$/,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const outcome = body.outcome
      if (!['worked', 'failed', 'neutral'].includes(outcome)) {
        throw new ValidationError('outcome 必须是 worked / failed / neutral')
      }
      const r = experienceService.applyOutcome(repos, params[0], params[1], outcome, {
        note: body.note || '',
      })
      if (!r) throw new NotFoundError('经验不存在')
      return r
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/experiences\/([\w-]+)\/status$/,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const status = body.status
      if (!['active', 'dormant', 'archived', 'proposed'].includes(status)) {
        throw new ValidationError('status 不合法')
      }
      const exp = experienceService.setStatus(repos, params[0], params[1], status)
      if (!exp) throw new NotFoundError('经验不存在')
      return { experience: exp }
    },
  },

  // ── Obsidian 决策经验同步（vault 路径只认服务端配置，不接受请求体传路径）──
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/experiences\/obsidian\/sync$/,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const summary = obsidianService.sync(repos, params[0], {
        vaultPath: config.obsidian.vaultPath,
        dryRun: body && body.dryRun === true,
      })
      return { summary, vaultConfigured: !!config.obsidian.vaultPath }
    },
  },

  // ── Obsidian 库全文检索（读笔记需 scope=vault 票据，片段不含未授权全文）──
  {
    method: 'GET',
    pattern: /^\/api\/persons\/([\w-]+)\/vault\/search$/,
    handler: async ({ req, params, query }) => {
      requirePerson(params[0])
      requireGrant(req, params[0], 'vault', { route: 'GET /vault/search', q: (query.get('q') || '').slice(0, 50) })
      const q = query.get('q') || ''
      if (!q.trim()) throw new ValidationError('缺少检索词 q')
      const limit = Number(query.get('limit')) || 8
      const result = vaultSearch.search({ vaultPath: config.obsidian.vaultPath, q, limit })
      if (!config.obsidian.vaultPath) {
        throw new ValidationError('没有配置 Obsidian 库路径（OBSIDIAN_VAULT_PATH）')
      }
      return result
    },
  },

  // ── 双环约束点：评估标准只能由用户改 ──
  {
    method: 'GET',
    pattern: /^\/api\/persons\/([\w-]+)\/criteria$/,
    handler: async ({ params }) => {
      requirePerson(params[0])
      return { criteria: experienceService.getCriteria(repos, params[0]) }
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/criteria$/,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const r = experienceService.setCriteria(repos, params[0], body, { confirm: body.confirm === true })
      log.warn('用户修改了经验评估标准', { personId: params[0], version: r.criteria.version })
      return r
    },
  },

  {
    method: 'GET',
    pattern: /^\/api\/persons\/([\w-]+)\/conflicts$/,
    handler: async ({ params }) => {
      requirePerson(params[0])
      return { conflicts: repos.conflict.byPerson(params[0]) }
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/conflicts\/([\w-]+)\/resolve$/,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const decision = body.decision
      if (!['keep_new', 'keep_old', 'both'].includes(decision)) {
        throw new ValidationError('decision 必须是 keep_new / keep_old / both')
      }
      return resolveConflict(repos, params[0], params[1], decision)
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/persons\/([\w-]+)\/invocations$/,
    handler: async ({ params }) => {
      requirePerson(params[0])
      return { invocations: repos.invocation.byPerson(params[0], 20) }
    },
  },
  // ── 入局问答：建档不靠填表 ──
  {
    method: 'GET',
    pattern: /^\/api\/persons\/([\w-]+)\/quiz$/,
    handler: async ({ params }) => {
      requirePerson(params[0])
      return { progress: quiz.progress(repos, params[0]), questions: quiz.list() }
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/quiz$/,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const questionId = requireString(body.questionId, 'questionId', 32)
      const optionKey = requireString(body.optionKey, 'optionKey', 8)
      return applyAnswer(repos, params[0], questionId, optionKey)
    },
  },

  // ── 今日节律：流年 / 流月 / 流日 ──
  {
    method: 'GET',
    pattern: /^\/api\/persons\/([\w-]+)\/ganzhi$/,
    handler: async ({ params, query }) => {
      requirePerson(params[0])
      const dateStr = query.get('date')
      const d = dateStr ? new Date(dateStr) : new Date()
      if (Number.isNaN(d.getTime())) throw new ValidationError('date 不是合法日期')
      const silicon = compileSilicon(repos, params[0], { limit: 1 })
      const el = silicon?.facts?.find(f => f.key === 'self.element' && f.confidence >= 0.4)?.value || null
      // 没答过入局题但有生日时，用出生日的日主当「我」
      let el2 = el
      if (!el2) {
        const bf = repos.fact.get(params[0], 'self.birthDate')
        if (bf && /^\d{4}-\d{2}-\d{2}$/.test(String(bf.value))) {
          const [by, bm, bd] = String(bf.value).split('-').map(Number)
          el2 = gz.dayPillar(new Date(Date.UTC(by, bm - 1, bd, 4))).ganElement
        }
      }
      return gz.ganzhiOf(d, el2)
    },
  },

  // ── 个人八字：出生信息录入与命盘（历法信息，不作吉凶断言）──
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/bazi$/,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const dateStr = requireString(body.date, 'date', 10)
      const md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
      if (!md) throw new ValidationError('date 需为 YYYY-MM-DD')
      const y = Number(md[1])
      const m = Number(md[2])
      const d = Number(md[3])
      if (y < 1900 || y > 2100) throw new ValidationError('出生年份需在 1900-2100 之间')
      const probe = new Date(Date.UTC(y, m - 1, d))
      if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) throw new ValidationError('date 不是真实存在的日期')
      let hour = null
      if (body.hour !== null && body.hour !== undefined && body.hour !== '') {
        hour = Number(body.hour)
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new ValidationError('hour 需为 0-23 的整数')
      }
      const place = body.place ? requireString(body.place, 'place', 20) : ''
      const chart = gz.birthChart({ y, m, d, hour, place })
      repos.fact.upsert(params[0], 'self.birthDate', dateStr, { confidence: 0.9, source: 'user_record' })
      if (hour !== null) repos.fact.upsert(params[0], 'self.birthHour', hour, { confidence: 0.9, source: 'user_record' })
      if (place) repos.fact.upsert(params[0], 'self.birthPlace', place, { confidence: 0.9, source: 'user_record' })
      return chart
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/persons\/([\w-]+)\/bazi$/,
    handler: async ({ params }) => {
      requirePerson(params[0])
      const bf = repos.fact.get(params[0], 'self.birthDate')
      if (!bf || !/^\d{4}-\d{2}-\d{2}$/.test(String(bf.value))) return { configured: false }
      const [y, m, d] = String(bf.value).split('-').map(Number)
      const hf = repos.fact.get(params[0], 'self.birthHour')
      const hour = hf ? Number(hf.value) : null
      const pf = repos.fact.get(params[0], 'self.birthPlace')
      return { configured: true, ...gz.birthChart({ y, m, d, hour, place: pf ? String(pf.value) : '' }) }
    },
  },

  // ── 脱敏体检：先看这句话里有什么会被抹掉，再决定记不记 ──
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/redact\/preview$/,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const text = requireString(body.text, 'text', 2000)
      const r = redact(text)
      return { original: text, redacted: r.text, hits: r.hits, tokenCount: r.tokens.length }
    },
  },

  // ── 授权：签发 / 列表 / 撤销 / 审计 ──
  {
    method: 'GET',
    pattern: /^\/api\/persons\/([\w-]+)\/grants$/,
    handler: async ({ params }) => {
      requirePerson(params[0])
      return {
        scopes: grant.SCOPES,
        grants: grant.list(repos, params[0]),
        audits: grant.audits(repos, params[0], 20),
      }
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/grants$/,
    handler: async ({ params, body }) => {
      requirePerson(params[0])
      const result = grant.issue(repos, params[0], {
        scopes: body.scopes,
        purpose: body.purpose,
        ttlSec: body.ttlSec,
        maxUses: body.maxUses,
      })
      log.warn('已签发授权票据', { personId: params[0], scopes: result.grant.scopes, purpose: result.grant.purpose })
      return result
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/grants\/([\w-]+)\/revoke$/,
    handler: async ({ params }) => {
      requirePerson(params[0])
      return grant.revoke(repos, params[0], params[1])
    },
  },

  // ── 读取人格 prompt：必须持 grant(scope=prompt) ──
  {
    method: 'GET',
    pattern: /^\/api\/persons\/([\w-]+)\/prompt$/,
    handler: async ({ params, req, query }) => {
      requirePerson(params[0])
      requireGrant(req, params[0], 'prompt', { route: 'GET /prompt' })
      const silicon = compileSilicon(repos, params[0], { limit: 30 })
      const prompt = buildPersonaPrompt(silicon, { includeEpisodes: query.get('episodes') !== '0' })
      return {
        prompt,
        summary: summarizePrompt(prompt),
        generatedAt: new Date().toISOString(),
        note: 'prompt 里只含脱敏后的记录，原文不在其中。',
      }
    },
  },

  // ── 标准导出：必须持 grant(scope=export)，深度由票据 scope 决定 ──
  {
    method: 'POST',
    pattern: /^\/api\/persons\/([\w-]+)\/export$/,
    handler: async ({ params, body, req }) => {
      requirePerson(params[0])
      const want = Array.isArray(body.scopes) && body.scopes.length ? body.scopes : ['export']
      const needed = ['export', ...want.filter(s => s === 'prompt' || s === 'raw')]
      const g = requireGrant(req, params[0], 'export', { route: 'POST /export' })
      // 票据里没写到的深度，一律不给
      for (const s of needed) {
        if (s !== 'export' && !g.scopes.includes(s)) {
          throw new AppError('FORBIDDEN', `该票据不含「${grant.SCOPES[s].label}」权限`, 403)
        }
      }
      const archive = exportArchive(repos, params[0], {
        scopes: needed,
        includeName: !!body.includeName,
      })
      grant.audit(repos, { personId: params[0], action: 'export.create', depth: archive.depth, checksum: archive.checksum })
      return archive
    },
  },

  // ── 导入 / 恢复：不需要授权，因为是往「新档案」里写 ──
  {
    method: 'POST',
    pattern: /^\/api\/import$/,
    handler: async ({ body }) => {
      const archive = body.archive || body
      const check = verifyArchive(archive)
      if (!check.ok) throw new ValidationError(`导入失败：${check.error}`)
      return importArchive(repos, archive, { name: body.name })
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/archive\/verify$/,
    handler: async ({ body }) => verifyArchive(body.archive || body),
  },

  {
    method: 'POST',
    pattern: /^\/api\/dev\/reset$/,
    handler: async () => {
      if (config.env === 'production') throw new ValidationError('生产环境禁止重置')
      for (const name of ['persons', 'facts', 'episodes', 'traits', 'invocations', 'conflicts', 'grants', 'audits', 'experiences', 'criteria']) {
        const col = repos.store.collection(name)
        col.items.length = 0
        col._persist()
      }
      const seeded = seedDemo(repos, PERSON_DEFAULT)
      return { reset: true, seeded }
    },
  },
]

// ── 静态资源（H5 端）─────────────────────────────────────
const WEB_DIR = path.join(__dirname, '..', '..', 'web')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname)
  if (rel === '/' || rel === '') rel = '/index.html'

  const full = path.join(WEB_DIR, rel)
  // 目录穿越防护：解析后必须仍在 WEB_DIR 内
  if (!full.startsWith(WEB_DIR)) {
    res.writeHead(403).end('forbidden')
    return true
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return false

  const ext = path.extname(full).toLowerCase()
  const body = fs.readFileSync(full)
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': body.length,
    // HTML 不缓存（要能立刻看到新版本），静态资源短缓存
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
  return true
}

// ── 服务 ────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const requestId = crypto.randomBytes(6).toString('hex')
  const started = Date.now()
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname

  // CORS：只允许显式来源；小程序端不走 CORS
  const origin = req.headers.origin
  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Grant-Token')
    res.setHeader('Access-Control-Max-Age', '600')
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  // H5 静态资源：与 API 同源部署，省一次跨域与一个域名
  if (req.method === 'GET' && !pathname.startsWith('/api/')) {
    // 法律文本：服务端直出全文，审核员点开即见，不依赖前端 JS 与二次请求
    const legalMatch = pathname.match(/^\/legal\/(privacy|terms)$/)
    if (legalMatch) {
      const html = legalPage.render(legalMatch[1], { from: url.searchParams.get('from') || '/' })
      if (html) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(html),
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
        })
        return res.end(html)
      }
    }
    if (pathname === '/legal' || pathname === '/legal/') {
      res.writeHead(302, { Location: '/legal/privacy' })
      return res.end()
    }
    if (serveStatic(req, res, pathname)) return
  }

  try {
    const matched = routes
      .map(r => ({ r, m: pathname.match(r.pattern) }))
      .find(x => x.m && x.r.method === req.method)

    if (!matched) {
      // 允许 GET/POST 同路径的兜底提示
      const methodMismatch = routes.some(r => r.pattern.test(pathname))
      throw new AppError(
        methodMismatch ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND',
        methodMismatch ? '该路径不支持此方法' : `接口不存在：${pathname}`,
        methodMismatch ? 405 : 404
      )
    }

    // 路由可自带 bodyLimit：识图与转写要传图/音频，默认 100KB 不够
    const body = req.method === 'POST' ? await readBody(req, matched.r.bodyLimit || 100 * 1024) : {}
    const result = await matched.r.handler({ params: matched.m.slice(1), body, query: url.searchParams, req })
    json(res, 200, { ok: true, data: result, requestId }, requestId)
    log.info('request', {
      requestId,
      method: req.method,
      path: pathname,
      status: 200,
      ms: Date.now() - started,
    })
  } catch (err) {
    const isKnown = err instanceof AppError
    const status = isKnown ? err.status : 500
    const code = isKnown ? err.code : 'INTERNAL_ERROR'
    const message = isKnown && err.expose ? err.message : '服务异常，请稍后再试'

    if (!isKnown) {
      log.error('未处理异常', { requestId, path: pathname, error: err.message, stack: err.stack })
    } else {
      log.warn('业务异常', { requestId, path: pathname, code, message })
    }

    json(res, status, {
      ok: false,
      error: { code, message, details: isKnown ? err.details : null },
      requestId,
    }, requestId)
  }
})

// ── 启动 / 停机 ──────────────────────────────────────────
async function bootstrap() {
  // 保险箱必须在任何一条记录写入之前就绪，否则第一条记录会退化为「只存脱敏文本」
  const vaultState = vault.init(config.dataDir)
  log.info('保险箱已就绪', { source: vaultState.source })

  if (config.seedDemo && !repos.person.get(PERSON_DEFAULT)) {
    seedDemo(repos, PERSON_DEFAULT)
    log.info('已写入演示档案', { personId: PERSON_DEFAULT })
  }

  // 内核是可选的：探一下就好，连不上不算启动失败
  const coreState = await core.describe()
  log.info('计算内核状态', { engine: coreState.engine, alive: coreState.alive })

  server.listen(config.port, () => {
    log.info('服务已启动', {
      port: config.port,
      env: config.env,
      llm: llm.describe(),
      services: baseAgents.list().length,
      vault: vaultState.source,
    })
    console.log(`
  ${BRAND.name} · ${BRAND.slogan}
  http://127.0.0.1:${config.port}          H5 端
  http://127.0.0.1:${config.port}/api/meta 接口自述

  模型: ${llm.describe().enabled ? llm.describe().model : '规则引擎（零成本）'}
  能力: ${baseAgents.list().map(s => s.name).join(' / ')}
  保险箱: ${vaultState.source === 'env' ? '环境变量口令' : '本地密钥文件（生产请改 QJZ_PASSPHRASE）'}
  内核: ${coreState.alive ? `C++ 内核已连接（${config.core.host}:${config.core.port}）` : '未连接，经验打分走 JS 镜像实现（结果一致，稍慢）'}
`)
  })
}

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  log.info('收到停机信号，等待在途请求结束', { signal })
  server.close(async () => {
    await repos.store.flushAll()
    log.info('已安全停机')
    process.exit(0)
  })
  setTimeout(() => {
    log.error('停机超时，强制退出')
    process.exit(1)
  }, 5000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

bootstrap().catch(err => {
  log.error('启动失败', { error: err.message, stack: err.stack })
  process.exit(1)
})

module.exports = { server, repos }
