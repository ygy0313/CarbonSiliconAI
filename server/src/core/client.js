'use strict'

// C++ 内核的客户端。
//
// 原则：内核是可选的加速器，不是依赖。任何失败（没编译、没启动、超时、返回脏数据）
// 都静默回落到 JS 镜像实现，编排结果一致，只是慢一点。降级要留痕，但不打扰用户。

const http = require('http')
const { config } = require('../config')
const log = require('../logger')
const fallback = require('./fallback')

const STATE = {
  lastProbeAt: 0,
  healthy: null, // null=未探测 true/false
  lastWarnAt: 0,
  stats: { cppCalls: 0, cppFailures: 0, jsCalls: 0 },
}

function request(path, payload) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    const req = http.request(
      {
        host: config.core.host,
        port: config.core.port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': body.length,
        },
        timeout: config.core.timeoutMs,
      },
      res => {
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`内核返回 ${res.statusCode}`))
          }
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (!parsed || parsed.ok !== true) return reject(new Error(parsed?.error || '内核返回 ok=false'))
            resolve(parsed)
          } catch (err) {
            reject(new Error(`内核返回的不是 JSON：${err.message}`))
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('内核超时')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function warnOnce(err) {
  const now = Date.now()
  if (now - STATE.lastWarnAt < 60_000) return
  STATE.lastWarnAt = now
  log.warn('计算内核不可用，已回落 JS 实现', { error: err.message, port: config.core.port })
}

/**
 * 经验记录 → 内核输入。
 * 经验库里的标签/场景放在 trigger 下（那是触发条件，语义更准），
 * 内核只认扁平字段，在这里抹平一次，别让两处各自记一套。
 */
function toCore(e) {
  return {
    id: e.id,
    tags: (e.tags && e.tags.length ? e.tags : e.trigger?.tags) || [],
    scene: e.scene || e.trigger?.scene || '',
    intent: e.intent || e.trigger?.intent || '',
    text: e.text || e.situation?.text || '',
    rule: e.rule || '',
    status: e.status || 'active',
    effectiveness: e.effectiveness,
    applied: e.applied || 0,
    followed: e.followed || 0,
    evidence: e.evidence || [],
    updatedAt: new Date(e.updatedAt || e.createdAt || 0).getTime() || 0,
  }
}

/**
 * 经验排序：相关性闸门 × 加权质量分。
 * @returns {Promise<{source:'cpp'|'js', items:Array, ms:number}>}
 */
async function rank(experiences, query, criteria, nowMs = Date.now()) {
  const items = experiences.slice(0, config.core.maxItems)
  const t0 = Date.now()

  if (config.core.enabled) {
    try {
      const res = await request('/v1/experience/rank', {
        now: nowMs,
        query,
        criteria,
        experiences: items.map(e => ({ ...toCore(e), evidence: (e.evidence || []).length })),
      })
      STATE.healthy = true
      STATE.stats.cppCalls += 1
      return { source: 'cpp', items: res.items || [], ms: Date.now() - t0, considered: res.considered }
    } catch (err) {
      STATE.healthy = false
      STATE.stats.cppFailures += 1
      warnOnce(err)
    }
  }

  STATE.stats.jsCalls += 1
  const itemsOut = fallback.rank(
    items.map(e => ({ ...toCore(e), evidence: (e.evidence || []).length })),
    query,
    criteria,
    nowMs
  )
  return { source: 'js', items: itemsOut, ms: Date.now() - t0, considered: items.length }
}

/**
 * 反思挖掘：从「采纳/否决」事件流里找稳定的偏好规则。
 * 这是 CPU 密集活，正是放到内核里跑的原因 —— Node 只有一个线程，别拿它算批处理。
 */
async function mine(events, minSupport = 2) {
  const t0 = Date.now()
  if (config.core.enabled) {
    try {
      const res = await request('/v1/reflect/mine', { events, minSupport })
      STATE.healthy = true
      STATE.stats.cppCalls += 1
      return { source: 'cpp', candidates: res.candidates || [], ms: Date.now() - t0 }
    } catch (err) {
      STATE.healthy = false
      STATE.stats.cppFailures += 1
      warnOnce(err)
    }
  }
  STATE.stats.jsCalls += 1
  return { source: 'js', candidates: fallback.mine(events, minSupport), ms: Date.now() - t0 }
}

/** 给 /api/meta 和 /ready 用：说清现在是谁在算 */
async function describe() {
  let alive = false
  if (config.core.enabled) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.request(
          { host: config.core.host, port: config.core.port, path: '/health', method: 'GET', timeout: 300 },
          res => {
            res.resume()
            res.on('end', () => (res.statusCode === 200 ? resolve() : reject(new Error(String(res.statusCode)))))
          }
        )
        req.on('timeout', () => req.destroy(new Error('timeout')))
        req.on('error', reject)
        req.end()
      })
      alive = true
    } catch (_) {
      alive = false
    }
  }
  return {
    enabled: config.core.enabled,
    alive,
    engine: alive ? 'cpp' : 'js',
    endpoint: `${config.core.host}:${config.core.port}`,
    fallback: 'JS 镜像实现（算法一致，仅速度不同）',
    stats: { ...STATE.stats },
  }
}

module.exports = { rank, mine, describe, similarity: fallback.similarity }
