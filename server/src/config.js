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
    // 视觉与语音各自可覆盖；不填则取 provider preset 的默认模型
    visionModel: process.env.LLM_VISION_MODEL || '',
    asrModel: process.env.LLM_ASR_MODEL || '',
    timeoutMs: int(process.env.LLM_TIMEOUT_MS, 8000),
    // 识图与转写都比纯文本慢，各给一条更宽的时间线
    visionTimeoutMs: int(process.env.LLM_VISION_TIMEOUT_MS, 20000),
    asrTimeoutMs: int(process.env.LLM_ASR_TIMEOUT_MS, 30000),
  },

  // 记忆衰减：置信度半衰期（天）。时间越久的事实越不可靠，需要重新核对。
  memory: {
    halfLifeDays: int(process.env.MEMORY_HALF_LIFE_DAYS, 90),
    minConfidence: 0.15,
  },

  // C++ 计算内核（core/）。没有它也能跑：JS 镜像实现会自动接管。
  // 关掉的场景：CI 只跑 Node、或内核在这台机器上编译不出来。
  core: {
    enabled: bool(process.env.CORE_ENABLED, true),
    host: process.env.CORE_HOST || '127.0.0.1',
    port: int(process.env.CORE_PORT, 8788),
    timeoutMs: int(process.env.CORE_TIMEOUT_MS, 500),
    // 单次送入内核的经验条数上限，防一次请求把内存打满
    maxItems: int(process.env.CORE_MAX_ITEMS, 20000),
  },

  // 经验资产：反思回路的节奏与阈值（双环约束点的默认值，用户可改）
  experience: {
    minSupport: int(process.env.EXPERIENCE_MIN_SUPPORT, 2),
    exposeLimit: int(process.env.EXPERIENCE_EXPOSE_LIMIT, 3),
  },

  // Obsidian 库：决策经验笔记的来源。空 = 功能未开（同步接口返回明确提示）。
  obsidian: {
    vaultPath: process.env.OBSIDIAN_VAULT_PATH || '',
  },

  // 微信凭据：code2Session / 微信运动解密用。secret 只进服务端 env，不进仓库。
  wx: {
    appid: process.env.WX_APPID || '',
    secret: process.env.WX_APPSECRET || '',
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
