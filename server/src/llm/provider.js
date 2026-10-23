'use strict'

// LLM 适配层：可插拔、可降级。
//
// 设计红线：LLM 是「增强」不是「依赖」。
// 任何一次调用失败 / 超时 / 返回非法 JSON，都必须返回 null 让上层走确定性规则。
// 这样 MVP 在 0 密钥、0 费用的情况下也能 100% 跑通。

const { config } = require('../config')
const log = require('../logger')

const PRESETS = {
  zhipu: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash', // 长期免费档
    visionModel: 'glm-4v-flash', // 免费视觉档，识菜足够
    asrModel: '',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    visionModel: '', // 当前无视觉输入
    asrModel: '',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    visionModel: 'gpt-4o-mini',
    asrModel: 'whisper-1',
  },
  ollama: {
    baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    model: 'qwen2.5:3b',
    visionModel: 'qwen2.5vl:3b',
    asrModel: '',
  },
}

function resolveEndpoint() {
  const p = config.llm.provider
  if (p === 'none') return null
  const preset = PRESETS[p]
  if (!preset) return null
  return {
    url: config.llm.baseUrl || preset.baseUrl,
    model: config.llm.model || preset.model,
    apiKey: config.llm.apiKey,
    // 视觉与语音各自有默认模型：同一家 provider 不一定三样都全。
    // 显式配了就以配置为准，没配就取 preset 的默认值，都没有则该能力视为未启用。
    visionModel: config.llm.visionModel || preset.visionModel || '',
    asrModel: config.llm.asrModel || preset.asrModel || '',
  }
}

function isEnabled() {
  return resolveEndpoint() !== null
}

// 模型偶尔会包 ```json 代码块，或在 JSON 前后多写一句话。
// 先剥代码块，再退一步只取第一个大括号块 —— 都失败才返回 null。
function extractJSON(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch (_) {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    try {
      return JSON.parse(cleaned.slice(start, end + 1))
    } catch (_) {
      return null
    }
  }
}

function withTimeout(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

/**
 * 请求模型返回 JSON。
 * @returns {Promise<object|null>} 失败一律 null，绝不抛错。
 */
async function completeJSON({ system, user, temperature = 0.3, maxTokens = 1200 }) {
  const ep = resolveEndpoint()
  if (!ep) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs)
  const started = Date.now()

  try {
    const res = await fetch(ep.url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: ep.model,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })

    if (!res.ok) {
      log.warn('LLM 返回非 2xx，降级为规则引擎', {
        provider: config.llm.provider,
        status: res.status,
        ms: Date.now() - started,
      })
      return null
    }

    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content
    if (!text) return null

    const parsed = extractJSON(text)
    if (!parsed) {
      log.warn('LLM 返回的不是合法 JSON，降级为规则引擎', { provider: config.llm.provider })
      return null
    }
    log.debug('LLM 调用成功', {
      provider: config.llm.provider,
      model: ep.model,
      ms: Date.now() - started,
      tokens: data?.usage?.total_tokens,
    })
    return parsed
  } catch (err) {
    log.warn('LLM 调用异常，降级为规则引擎', {
      provider: config.llm.provider,
      error: err.name === 'AbortError' ? 'timeout' : err.message,
      ms: Date.now() - started,
    })
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 视觉：给一张图 + 一段指令，要一份 JSON。
 *
 * 单列一个函数而不是复用 completeJSON，因为两处不同：
 *   ① messages 的 content 是数组（text + image_url），不是字符串；
 *   ② 不传 response_format —— 部分视觉模型不支持该参数，带了整个请求会被拒。
 * 红线不变：任何失败都返回 null，调用方据此降级，绝不抛错。
 */
async function completeVisionJSON({ system, user, imageDataUrl, temperature = 0.2, maxTokens = 900 }) {
  const ep = resolveEndpoint()
  if (!ep || !ep.visionModel || !imageDataUrl) return null

  const t = withTimeout(config.llm.visionTimeoutMs)
  const started = Date.now()
  try {
    const res = await fetch(ep.url, {
      method: 'POST',
      signal: t.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: ep.visionModel,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              { type: 'text', text: user },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      log.warn('视觉模型返回非 2xx，降级为只存文字', {
        provider: config.llm.provider,
        status: res.status,
        ms: Date.now() - started,
      })
      return null
    }

    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content
    if (!text) return null
    const parsed = extractJSON(text)
    if (!parsed) {
      log.warn('视觉模型没给出合法 JSON，降级为只存文字', { provider: config.llm.provider })
      return null
    }
    log.debug('视觉调用成功', { model: ep.visionModel, ms: Date.now() - started })
    return parsed
  } catch (err) {
    log.warn('视觉调用异常，降级为只存文字', {
      error: err.name === 'AbortError' ? 'timeout' : err.message,
      ms: Date.now() - started,
    })
    return null
  } finally {
    t.done()
  }
}

/**
 * 语音转写：一段音频 → 一句话。
 * 走 OpenAI 兼容的 /audio/transcriptions（multipart），baseUrl 从 chat 端点推导。
 * 同样失败返回 null —— 前端退化成「自己打字」。
 */
async function transcribe({ buffer, mime = 'audio/mp4', filename = 'voice.m4a' }) {
  const ep = resolveEndpoint()
  if (!ep || !ep.asrModel || !buffer || !buffer.length) return null

  // chat 端点 → 转写端点。推导不出来（自定义 baseUrl 形态特殊）就不猜，直接降级。
  const url = ep.url.replace(/\/chat\/completions\/?$/, '/audio/transcriptions')
  if (url === ep.url) return null

  const t = withTimeout(config.llm.asrTimeoutMs)
  const started = Date.now()
  try {
    const form = new FormData()
    form.append('model', ep.asrModel)
    form.append('file', new Blob([buffer], { type: mime }), filename)

    const res = await fetch(url, {
      method: 'POST',
      signal: t.signal,
      // 不要手写 Content-Type：boundary 由 FormData 自己带
      headers: ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {},
      body: form,
    })

    if (!res.ok) {
      log.warn('转写接口返回非 2xx，降级为手打', { status: res.status, ms: Date.now() - started })
      return null
    }

    const data = await res.json()
    const text = String(data?.text || '').trim()
    if (!text) return null
    log.debug('转写成功', { model: ep.asrModel, ms: Date.now() - started })
    return { text }
  } catch (err) {
    log.warn('转写调用异常，降级为手打', {
      error: err.name === 'AbortError' ? 'timeout' : err.message,
      ms: Date.now() - started,
    })
    return null
  } finally {
    t.done()
  }
}

function describe() {
  const ep = resolveEndpoint()
  if (!ep) return { enabled: false, provider: 'none', note: '规则引擎模式（零成本）' }
  return {
    enabled: true,
    provider: config.llm.provider,
    model: ep.model,
    vision: ep.visionModel ? { model: ep.visionModel } : null,
    asr: ep.asrModel ? { model: ep.asrModel } : null,
  }
}

module.exports = { isEnabled, completeJSON, completeVisionJSON, transcribe, describe, extractJSON }
