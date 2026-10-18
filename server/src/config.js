'use strict'

// 集中配置：全部来自环境变量，启动时校验，缺失即失败（fail fast）。
// MVP 阶段默认值即可跑通，不需要任何密钥。

const path = require('path')

function bool(value, fallback) {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function int(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const LLM_PROVIDERS = ['none', 'zhipu', 'deepseek', 'openai', 'ollama']

const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 8787),
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),

  // 无密钥时自动降级为确定性规则引擎，MVP 全流程仍可跑通。
  llm: {
    provider: (process.env.LLM_PROVIDER || 'none').toLowerCase(),
    apiKey: process.env.LLM_API_KEY || '',
    baseUrl: process.env.LLM_BASE_URL || '',
    model: process.env.LLM_MODEL || '',
    timeoutMs: int(process.env.LLM_TIMEOUT_MS, 8000),
  },

  // 记忆衰减：置信度半衰期（天）。时间越久的事实越不可靠，需要重新核对。
  memory: {
    halfLifeDays: int(process.env.MEMORY_HALF_LIFE_DAYS, 90),
    minConfidence: 0.15,
  },

  // CORS：显式来源，禁止通配符。小程序不受 CORS 限制，这里只服务本地预览页。
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  logLevel: process.env.LOG_LEVEL || 'info',
  seedDemo: bool(process.env.SEED_DEMO, true),
}

function validate() {
  const errors = []
  if (!LLM_PROVIDERS.includes(config.llm.provider)) {
    errors.push(`LLM_PROVIDER 必须是 ${LLM_PROVIDERS.join(' | ')}，当前为 "${config.llm.provider}"`)
  }
  if (config.llm.provider !== 'none' && config.llm.provider !== 'ollama' && !config.llm.apiKey) {
    // 不阻断启动：编排器会自动降级，但要明确告知。
    console.warn(
      `[config] LLM_PROVIDER=${config.llm.provider} 但缺少 LLM_API_KEY，已自动降级为规则引擎（provider=none）`
    )
    config.llm.provider = 'none'
  }
  if (config.port <= 0 || config.port > 65535) errors.push(`PORT 非法：${config.port}`)
  if (errors.length) {
    const err = new Error(`配置校验失败：\n- ${errors.join('\n- ')}`)
    err.name = 'ConfigError'
    throw err
  }
  return config
}

module.exports = { config, validate }
