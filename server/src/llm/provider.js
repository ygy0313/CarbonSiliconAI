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
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
  },
  ollama: {
    baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    model: 'qwen2.5:3b',
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
  }
}

function isEnabled() {
  return resolveEndpoint() !== null
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

    // 模型有时会包 ```json 代码块，剥掉再解析。
    const cleaned = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(cleaned)
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

function describe() {
  const ep = resolveEndpoint()
  return ep
    ? { enabled: true, provider: config.llm.provider, model: ep.model }
    : { enabled: false, provider: 'none', note: '规则引擎模式（零成本）' }
}

module.exports = { isEnabled, completeJSON, describe }
