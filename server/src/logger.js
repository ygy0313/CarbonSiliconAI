'use strict'

// 结构化 JSON 日志：每行一条，带 requestId / traceId，便于后续接采集。
// 红线：不记录密码、令牌、隐私原文（episode 文本只记长度与标签）。

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
let currentLevel = LEVELS.info

function setLevel(level) {
  currentLevel = LEVELS[level] || LEVELS.info
}

const REDACT_KEYS = /^(authorization|token|apiKey|api_key|password|secret|cookie)$/i

function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value
  if (depth > 4) return '[depth-limit]'
  if (Array.isArray(value)) return value.slice(0, 20).map(v => sanitize(v, depth + 1))
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (REDACT_KEYS.test(k)) out[k] = '[redacted]'
      else out[k] = sanitize(v, depth + 1)
    }
    return out
  }
  if (typeof value === 'string' && value.length > 500) return value.slice(0, 500) + '…'
  return value
}

function emit(level, msg, fields = {}) {
  if (LEVELS[level] < currentLevel) return
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...sanitize(fields),
  }
  const target = level === 'error' ? console.error : console.log
  target(JSON.stringify(line))
}

module.exports = {
  setLevel,
  debug: (msg, f) => emit('debug', msg, f),
  info: (msg, f) => emit('info', msg, f),
  warn: (msg, f) => emit('warn', msg, f),
  error: (msg, f) => emit('error', msg, f),
  child: base => ({
    debug: (m, f) => emit('debug', m, { ...base, ...f }),
    info: (m, f) => emit('info', m, { ...base, ...f }),
    warn: (m, f) => emit('warn', m, { ...base, ...f }),
    error: (m, f) => emit('error', m, { ...base, ...f }),
  }),
}
