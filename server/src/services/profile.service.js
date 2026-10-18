'use strict'

// 画像服务：把「一堆记录」编译成「一个可执行的人格包」。
//
// 这是整个产品的核心转换：
//   episodes（行为事实） + facts（声明事实） + traits（推断倾向）
//   → silicon context（人格包：我是谁、我记得什么、我偏好什么、我能调用什么）

const { FACT_DIMENSIONS, DISH_LIBRARY } = require('../domain/taxonomy')
const { config } = require('../config')
const { redactDeep } = require('../security/redact')
const vault = require('../security/vault')
const log = require('../logger')

const DAY = 86400000

// 记忆衰减：越久的事实越不可靠。半衰期 90 天，下限 0.15。
function decay(confidence, updatedAt, now = Date.now()) {
  const ts = new Date(updatedAt || now).getTime()
  const days = Math.max(0, (now - ts) / DAY)
  const factor = Math.pow(0.5, days / config.memory.halfLifeDays)
  return Math.max(config.memory.minConfidence, Number((confidence * factor).toFixed(3)))
}

function labelOf(key) {
  const dim = FACT_DIMENSIONS.find(d => d.key === key)
  return dim ? dim.label : key
}

/**
 * 写入一条记录：脱敏 → 加密原文 → 落记忆 + 事实 → 回写画像。
 *
 * 铁律：`episodes[].text` 永远是脱敏后的文本，原文只存在于 `rawCipher`（AES-256-GCM）。
 * 保险箱不可用时（未配置口令）降级为「只存脱敏文本」，宁可丢原文，不可留明文。
 */
function recordEpisode(repos, personId, extracted, source = 'manual') {
  const now = new Date().toISOString()

  // ── 1. 脱敏：文本、摘要、实体一起处理（实体里常有「地址」「联系人」）──
  const safe = redactDeep({
    text: extracted.text,
    summary: extracted.summary || '',
    entities: extracted.entities || {},
  })

  // ── 2. 原文与 PII 映射表进保险箱 ──
  let rawCipher = null
  let piiCipher = null
  try {
    rawCipher = vault.seal(repos, personId, JSON.stringify({
      text: extracted.text,
      summary: extracted.summary || '',
      entities: extracted.entities || {},
    }))
    piiCipher = vault.sealTokens(repos, personId, safe.tokens)
  } catch (err) {
    log.warn('保险箱不可用，本条记录只保留脱敏文本', { personId, error: err.message })
  }

  const episode = repos.episode.insert({
    personId,
    ts: now,
    kind: 'note',
    text: safe.value.text,
    tags: extracted.tags,
    entities: safe.value.entities,
    summary: safe.value.summary,
    source,
    extractor: extracted.extractor,
    confidence: 0.9,
    // 脱敏审计：这条记录被抹掉了什么，用户随时可查
    redacted: true,
    redaction: { hits: safe.hits, sealed: !!rawCipher },
    rawCipher,
    piiCipher,
  })

  const factChanges = []
  for (const f of extracted.facts) {
    const before = repos.fact.get(personId, f.key)
    // 用户明确表述 > 系统推断；同类来源取更高置信度
    if (before && before.confidence > f.confidence && before.source === 'user_record') {
      factChanges.push({ key: f.key, action: 'kept', before: before.value, after: before.value })
      continue
    }
    // 事实值同样是用户写的，一样要脱敏
    const value = typeof f.value === 'string' ? redactDeep(f.value).value : f.value
    repos.fact.upsert(personId, f.key, value, {
      confidence: Math.max(f.confidence, before ? before.confidence * 0.9 : 0),
      source: 'user_record',
      dim: f.key,
      note: f.reason,
      evidenceEpisodeIds: [...(before?.evidenceEpisodeIds || []), episode.id].slice(-10),
      updatedAt: now,
    })
    factChanges.push({
      key: f.key,
      label: labelOf(f.key),
      action: before ? (before.value === value ? 'confirmed' : 'updated') : 'created',
      before: before?.value ?? null,
      after: value,
    })
  }

  return { episode, factChanges }
}

/**
 * 行为统计型画像：从记忆里算出来的倾向，不是用户自己填的。
 * 这类信息最容易「用户没意识到但确实如此」，也最需要被核对。
 */
function computeTraits(repos, personId) {
  const eps = repos.episode.byPerson(personId, 500)
  const now = Date.now()

  const tagCount = {}
  for (const e of eps) for (const t of e.tags || []) tagCount[t] = (tagCount[t] || 0) + 1
  const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 6)

  const last7 = eps.filter(e => now - new Date(e.ts).getTime() < 7 * DAY).length
  const last30 = eps.filter(e => now - new Date(e.ts).getTime() < 30 * DAY).length

  const gatherCount = eps.filter(e => (e.tags || []).includes('生日局') || e.entities?.scene === 'friends').length

  const invocations = repos.invocation.byPerson(personId, 50)
  const decided = invocations.filter(i => i.feedback && i.feedback.action)
  const accepted = decided.filter(i => i.feedback.action === 'accept').length
  const acceptRate = decided.length ? Number((accepted / decided.length).toFixed(2)) : null

  return {
    recordCount: eps.length,
    last7,
    last30,
    topTags,
    gatherCount,
    acceptRate,
    // 人格描述：给前端展示「执笔现在有多像你」
    personaHints: buildPersonaHints({ eps, topTags, acceptRate, gatherCount }),
  }
}

function buildPersonaHints({ eps, topTags, acceptRate, gatherCount }) {
  const hints = []
  if (eps.length === 0) return ['还没有记录，执笔对你还一无所知']

  const tags = topTags.map(t => t[0])
  if (tags.includes('胃敏感') && (tags.includes('重辣') || tags.includes('微辣'))) {
    hints.push('你能吃辣但胃不太扛得住 —— 这是个需要你自己确认的矛盾点')
  }
  if (tags.includes('胃敏感')) hints.push('点菜时会自动帮你避开重油重辣')
  if (gatherCount >= 3) hints.push('你是熟人局的常客，组局偏好已经比较稳定')
  if (gatherCount === 0 && eps.length > 5) hints.push('你记录了很多一个人吃的饭，社交场景的记录偏少')
  if (acceptRate !== null && acceptRate < 0.4) hints.push('你对推荐挑得比较细，说明现在的推荐还不够准')
  if (acceptRate !== null && acceptRate > 0.8) hints.push('你采纳率很高，执笔已经开始摸到你的口味了')
  if (eps.length >= 10) hints.push(`已经积累 ${eps.length} 条记忆，可以开始做跨场景推荐`)

  return hints.slice(0, 4)
}

/**
 * 编译人格包上下文。
 * @param {object} repos
 * @param {string} personId
 * @param {{intentType?: string, limit?: number}} opts
 */
function compileSilicon(repos, personId, opts = {}) {
  const person = repos.person.get(personId)
  if (!person) return null

  const facts = repos.fact.byPerson(personId).map(f => {
    const confidence = decay(f.confidence, f.updatedAt || f.createdAt)
    return {
      key: f.key,
      label: labelOf(f.key),
      value: f.value,
      confidence,
      source: f.source,
      note: f.note || '',
      stale: confidence < 0.4,
      evidenceCount: (f.evidenceEpisodeIds || []).length,
    }
  }).sort((a, b) => a.key.localeCompare(b.key))

  const episodes = repos.episode.byPerson(personId, opts.limit || 30).map(e => ({
    id: e.id,
    ts: e.ts,
    text: e.text,
    tags: e.tags || [],
    summary: e.summary,
    entities: e.entities || {},
  }))

  const traits = computeTraits(repos, personId)
  const dims = FACT_DIMENSIONS.length
  const filled = facts.filter(f => f.confidence >= 0.4)
  const completeness = Number(
    (filled.reduce((sum, f) => sum + Math.min(1, f.confidence), 0) / dims).toFixed(2)
  )

  return {
    person: { id: person.id, name: person.name, city: person.city || '' },
    completeness: Math.min(1, completeness),
    facts,
    episodes,
    traits,
    voice: describeVoice(facts, traits),
  }
}

// 说话风格也属于人格的一部分：同一个建议，不同的人说法不同。
function describeVoice(facts, traits) {
  const get = key => facts.find(f => f.key === key && f.confidence >= 0.4)?.value
  const rhythm = get('life.rhythm')
  const role = get('social.role')

  const style = []
  if (rhythm === '夜猫子') style.push('晚上更活跃，可以晚一点提醒')
  if (role === '发起人') style.push('直接给结论和待办，不用铺垫')
  if (role === '跟随者') style.push('给两三个选项让人挑，别直接替他决定')
  if (traits.recordCount > 20) style.push('已经认识很久了，说话可以省掉客套')
  if (!style.length) style.push('语气简短克制，先给结论再给理由')
  return style
}

/**
 * 检索相关记忆：标签命中 + 时间衰减 + 场景匹配。
 * MVP 不引入向量库：用标签倒排即可，成本 0、可解释性强（能说清「因为哪条记忆」）。
 */
function recall(repos, personId, { tags = [], scene = null, limit = 5 } = {}) {
  const eps = repos.episode.byPerson(personId, 300)
  const now = Date.now()
  return eps
    .map(e => {
      let score = 0
      const overlap = (e.tags || []).filter(t => tags.includes(t))
      score += overlap.length * 0.35
      if (scene && e.entities?.scene === scene) score += 0.2
      const days = (now - new Date(e.ts).getTime()) / DAY
      score += Math.max(0, 0.3 - days / 60) // 近 60 天内的记忆有加分
      return { episode: e, score, overlap }
    })
    .filter(x => x.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => ({ ...x.episode, relevance: Number(x.score.toFixed(2)), matchedTags: x.overlap }))
}

module.exports = { recordEpisode, computeTraits, compileSilicon, recall, decay, labelOf }
