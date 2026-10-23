'use strict'

// 语音转写。
//
// 「给您请安」没有这块能力（它只有识图），这里是新写的，但沿用同一条规矩：
// 转写只是「省一次打字」，失败就退回手写，绝不让它挡住记录。
//
// 三条约束：
//   ① 音频只在内存里转一圈，不落盘、不进 data 目录 —— 隐私政策才敢写「录音不留存」；
//   ② 只认电话号码格式的 base64，MIME 走白名单，长度设上限（60 秒够说一段话）；
//   ③ 转写出来的文本同样不写日志：它是用户原话，属于要脱敏的那一类。

const llm = require('../llm/provider')

const MAX_B64_CHARS = 3 * 1024 * 1024 // 约 2.2MB，60 秒 m4a 足够
const MIN_B64_CHARS = 512
const ALLOWED_MIME = ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/mpeg', 'audio/aac', 'audio/wav']
const MAX_TEXT_LEN = 300

const MIME_EXT = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
}

function parseAudio(input, mime) {
  const raw = String(input || '').trim()
  if (!raw) return { ok: false, reason: '没有收到录音' }

  // 兼容两种写法：裸 base64，或 data URL
  let base64 = raw
  let type = String(mime || '').toLowerCase()
  const m = raw.match(/^data:([a-z0-9/+.-]+);base64,(.+)$/i)
  if (m) {
    type = type || m[1].toLowerCase()
    base64 = m[2]
  }
  base64 = base64.replace(/\s/g, '')

  if (!type) type = 'audio/mp4'
  if (!ALLOWED_MIME.includes(type)) {
    return { ok: false, reason: `不支持的录音格式 ${type}` }
  }
  if (base64.length > MAX_B64_CHARS) {
    return { ok: false, reason: '这段录音太长了，说短一点（60 秒内）' }
  }
  if (base64.length < MIN_B64_CHARS) {
    return { ok: false, reason: '录音太短，按住多说两句' }
  }

  let buffer
  try {
    buffer = Buffer.from(base64, 'base64')
  } catch (_) {
    return { ok: false, reason: '录音数据坏了，重录一次' }
  }
  if (!buffer.length) return { ok: false, reason: '录音是空的' }

  return { ok: true, buffer, mime: type, filename: `voice.${MIME_EXT[type] || 'm4a'}` }
}

/**
 * 主入口：{ audio, mime } → { ok, text, engine }
 * engine: 'model' / 'none'（没转成，前端退回手写）
 */
async function transcribe({ audio, mime } = {}) {
  const parsed = parseAudio(audio, mime)
  if (!parsed.ok) return { ok: false, reason: parsed.reason, engine: 'none' }

  // 与识图同理：没配模型是配置问题，不是「没听清」。
  const cap = llm.describe()
  if (!cap.enabled || !cap.asr) {
    return {
      ok: false,
      engine: 'disabled',
      reason: '语音转写还没接通（配好转写模型即可用），先打字也一样记',
    }
  }

  const result = await llm.transcribe({
    buffer: parsed.buffer,
    mime: parsed.mime,
    filename: parsed.filename,
  })

  if (!result) {
    return {
      ok: false,
      engine: 'none',
      reason: '语音转写没接通，先把要说的话打出来（配好模型后这里就通了）',
    }
  }

  const text = String(result.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LEN)
  if (!text) return { ok: false, engine: 'model', reason: '没听清，再说一遍或直接写' }

  return { ok: true, engine: 'model', text }
}

module.exports = { transcribe, parseAudio, MAX_B64_CHARS, ALLOWED_MIME }
