'use strict'

// HTTP 入口：路由 → 校验 → 服务调用 → 响应。
// 控制器层不写业务逻辑，只做「解析请求 / 调用服务 / 格式化响应」三件事。

const http = require('http')
const crypto = require('crypto')
const { config, validate } = require('./config')
const log = require('./logger')
const { AppError, ValidationError, NotFoundError, InternalError } = require('./errors')
const { createRepos } = require('./store/repos')
const { FACT_DIMENSIONS, INTENTS } = require('./domain/taxonomy')
const registry = require('./agents/registry')
const baseAgents = require('./agents/registry') // 触发注册
require('./agents/fortune.agent')
require('./agents/weather.agent')
require('./agents/calendar.agent')
require('./agents/meal.agent')
require('./agents/mystery.agent')
require('./agents/venue.agent')
require('./agents/catering.agent')
const { extract } = require('./services/extract.service')
const { recordEpisode, compileSilicon } = require('./services/profile.service')
const { orchestrate } = require('./services/orchestrator.service')
const { applyFeedback, resolveConflict, detectAndQueueConflict } = require('./services/verify.service')
const llm = require('./llm/provider')
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
    handler: async () => ({ ready: true, dataDir: config.dataDir, llm: llm.describe() }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/meta$/,
    handler: async () => ({
      product: '硅基记忆体',
      version: '0.1.0',
      llm: llm.describe(),
      dimensions: FACT_DIMENSIONS,
      intents: INTENTS.map(i => ({ type: i.type, label: i.label, service: i.service })),
      services: baseAgents.list(),
      memory: { halfLifeDays: config.memory.halfLifeDays },
    }),
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

      const result = await orchestrate(repos, params[0], text, {
        tags: extracted.tags,
        entities: extracted.entities,
      })
      return result
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
  {
    method: 'POST',
    pattern: /^\/api\/dev\/reset$/,
    handler: async () => {
      if (config.env === 'production') throw new ValidationError('生产环境禁止重置')
      for (const name of ['persons', 'facts', 'episodes', 'traits', 'invocations', 'conflicts']) {
        const col = repos.store.collection(name)
        col.items.length = 0
        col._persist()
      }
      const seeded = seedDemo(repos, PERSON_DEFAULT)
      return { reset: true, seeded }
    },
  },
]

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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Max-Age', '600')
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
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

    const body = req.method === 'POST' ? await readBody(req) : {}
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
  if (config.seedDemo && !repos.person.get(PERSON_DEFAULT)) {
    seedDemo(repos, PERSON_DEFAULT)
    log.info('已写入演示档案', { personId: PERSON_DEFAULT })
  }

  server.listen(config.port, () => {
    log.info('服务已启动', {
      port: config.port,
      env: config.env,
      llm: llm.describe(),
      services: baseAgents.list().length,
    })
    console.log(`\n  硅基记忆体 · 编排服务\n  http://127.0.0.1:${config.port}\n  LLM: ${llm.describe().enabled ? llm.describe().model : '规则引擎（零成本）'}\n  能力: ${baseAgents.list().map(s => s.name).join(' / ')}\n`)
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
