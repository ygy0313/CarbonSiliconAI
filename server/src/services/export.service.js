'use strict'

// 标准导出：让「档案」成为能带走的资产，而不是锁在某个 App 里的租约。
//
// 三种导出深度，对应三种授权：
//   safe    —— 仅脱敏内容（事实 + 记忆摘要）。任何人拿到都不含身份信息，可直接分享给第三方 agent；
//   sealed  —— safe + 加密原文与 PII 映射表。文件本身仍是密文，只有持口令的人能还原；
//   prompt  —— safe + 人格 prompt（需 scope=prompt）。
//
// 文件结构固定，带 format 版本号与 checksum，导入时逐项校验 ——
// 这是「以后可通过档案恢复个体信息」的落点：格式不变，二十年后也能读。

const crypto = require('../security/crypto')
const vault = require('../security/vault')
const { buildPersonaPrompt } = require('./prompt.service')
const { compileSilicon } = require('./profile.service')
const { BRAND } = require('../domain/brand')
const { ValidationError } = require('../errors')

const FORMAT = BRAND.exportFormat

// 稳定序列化：键排序，保证同一份数据每次算出的 checksum 一致
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
}

function checksumOf(payload) {
  return crypto.sha256(canonical(payload))
}

/**
 * 生成导出文件。
 * @param {object} repos
 * @param {string} personId
 * @param {{scopes?:string[], purpose?:string}} opts scopes 决定深度
 */
function exportArchive(repos, personId, opts = {}) {
  const scopes = Array.isArray(opts.scopes) ? opts.scopes : ['export']
  const person = repos.person.get(personId)
  if (!person) throw new ValidationError('找不到这个人')

  const silicon = compileSilicon(repos, personId, { limit: 500 })
  const episodes = repos.episode.byPerson(personId, 2000)

  const payload = {
    // 身份信息默认不导出真名，只留一个可对照的内部 id
    person: {
      id: person.id,
      name: opts.includeName ? person.name : `（${BRAND.name}用户）`,
      city: person.city || '',
      createdAt: person.createdAt,
    },
    completeness: silicon.completeness,
    facts: silicon.facts.map(f => ({
      key: f.key,
      label: f.label,
      value: f.value,
      confidence: f.confidence,
      source: f.source,
      evidenceCount: f.evidenceCount,
    })),
    traits: {
      recordCount: silicon.traits.recordCount,
      last7: silicon.traits.last7,
      last30: silicon.traits.last30,
      topTags: silicon.traits.topTags,
      acceptRate: silicon.traits.acceptRate,
    },
    voice: silicon.voice,
    // 经验层：事实是「你是谁」，经验是「你怎么办事」。后者才是真正带得走的资产。
    experiences: repos.experience.byPerson(personId, { limit: 2000 }).map(e => ({
      id: e.id,
      rule: e.rule,
      trigger: e.trigger || {},
      situation: e.situation || {},
      action: e.action || {},
      outcome: e.outcome || {},
      effectiveness: e.effectiveness,
      applied: e.applied || 0,
      followed: e.followed || 0,
      status: e.status,
      evidence: e.evidence || [],
      source: e.source,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    })),
    // 评估标准一并带走：换一个 App 继续用，判「什么算有效」的口径不能变
    criteria: repos.criteria.get(personId) || null,
    episodes: episodes.map(e => ({
      id: e.id,
      ts: e.ts,
      text: e.text,          // 已脱敏
      summary: e.summary,
      tags: e.tags || [],
      entities: e.entities || {},
      redaction: e.redaction || null,
    })),
  }

  // prompt 深度
  if (scopes.includes('prompt')) {
    payload.prompt = buildPersonaPrompt(silicon, { includeEpisodes: true })
  }

  // 加密原文深度：只带密文，不带密钥
  if (scopes.includes('raw')) {
    payload.sealed = {
      note: '以下为 AES-256-GCM 密文，需原始口令才能解开；丢失口令等同永久无法还原。',
      algorithm: 'aes-256-gcm + scrypt(N=32768,r=8,p=1)',
      items: episodes
        .filter(e => e.rawCipher)
        .map(e => ({ id: e.id, rawCipher: e.rawCipher, piiCipher: e.piiCipher || null })),
    }
  }

  const checksum = checksumOf(payload)
  // 用保险箱密钥签名：只有同一口令持有者能验证这份文件确实出自本档案
  let signature = null
  try {
    signature = crypto.hmacHex(vault.keyOf(repos, personId).toString('hex'), checksum)
  } catch (_) {
    signature = null // 保险箱未解锁时退化为无签名，checksum 仍可校验完整性
  }

  return {
    format: FORMAT,
    version: BRAND.version,
    app: BRAND.name,
    exportedAt: new Date().toISOString(),
    depth: scopes.includes('raw') ? 'sealed' : scopes.includes('prompt') ? 'prompt' : 'safe',
    scopes,
    schema: {
      note: '本文件的 payload 为「事实 + 记忆」的脱敏快照。facts 是可核对声明，episodes 是不可变行为记录。',
      fields: {
        'facts[].key': '维度键，见 app meta 的 dimensions',
        'facts[].confidence': '0-1，随时间半衰期衰减',
        'episodes[].text': '已脱敏文本，PII 已替换为 <手机号1> 这类占位符',
        'episodes[].redaction.hits': '本条记录被抹掉的 PII 类型与数量',
        'experiences[].rule': '可执行规则（自然语言指令），由反思产出或用户手写',
        'experiences[].trigger': '触发条件：tags / scene / intent',
        'experiences[].effectiveness': '0-1，每次应用结果更新一次（单环）',
        'experiences[].evidence': '溯源，指向具体 invocation/user 事件',
        'criteria': '评估标准（双环约束点），带版本号与确认时间',
      },
    },
    checksum,
    signature,
    payload,
  }
}

/**
 * 校验导出文件：格式、版本、checksum。不验签名（签名需要口令，可选）。
 * @returns {{ok:boolean, error?:string, archive?:object}}
 */
function verifyArchive(archive) {
  if (!archive || typeof archive !== 'object') return { ok: false, error: '不是合法的 JSON 对象' }
  if (archive.format !== FORMAT) {
    return { ok: false, error: `格式不符：期望 ${FORMAT}，实际 ${archive.format || '(缺失)'}` }
  }
  if (!archive.payload) return { ok: false, error: '缺少 payload' }

  const actual = checksumOf(archive.payload)
  if (archive.checksum && actual !== archive.checksum) {
    return { ok: false, error: '校验和不符：文件可能被修改过' }
  }
  return { ok: true, archive, recomputedChecksum: actual }
}

/**
 * 从导出文件恢复：新建一个人，把事实与记忆写回去。
 * 这是「二十年后换一个 App 也能接着用」的保证。
 */
function importArchive(repos, archive, opts = {}) {
  const checked = verifyArchive(archive)
  if (!checked.ok) throw new ValidationError(`导入失败：${checked.error}`)

  const p = archive.payload
  const personId = opts.personId || crypto.shortId('p')

  const person = repos.person.create({
    id: personId,
    name: opts.name || `${BRAND.name}恢复的档案`,
    city: p.person?.city || '',
    restoredFrom: { format: archive.format, exportedAt: archive.exportedAt, checksum: archive.checksum },
  })

  let factCount = 0
  for (const f of p.facts || []) {
    repos.fact.upsert(personId, f.key, f.value, {
      confidence: Number(f.confidence) || 0.5,
      source: 'restored',
      note: `从 ${archive.exportedAt} 的导出文件恢复`,
      updatedAt: new Date().toISOString(),
    })
    factCount++
  }

  let episodeCount = 0
  for (const e of p.episodes || []) {
    repos.episode.insert({
      personId,
      ts: e.ts,
      kind: 'note',
      text: e.text,
      summary: e.summary,
      tags: e.tags || [],
      entities: e.entities || {},
      source: 'restored',
      confidence: 0.9,
      redacted: true,
      redaction: e.redaction || { hits: [], sealed: false },
      rawCipher: null, // 原文需另行用 sealed 区块 + 口令还原，恢复时不自动带入
      piiCipher: null,
    })
    episodeCount++
  }

  // 经验层恢复：id 重新生成，避免与源档案撞车；证据链保留引用关系
  let experienceCount = 0
  for (const x of p.experiences || []) {
    const doc = {
      personId,
      rule: x.rule,
      trigger: x.trigger || {},
      situation: x.situation || {},
      action: x.action || {},
      outcome: x.outcome || {},
      effectiveness: Number(x.effectiveness) || 0.5,
      applied: Number(x.applied) || 0,
      followed: Number(x.followed) || 0,
      evidence: Array.isArray(x.evidence) ? x.evidence : [],
      status: x.status === 'archived' ? 'dormant' : x.status || 'proposed',
      source: 'restored',
      loop: 'single',
      createdAt: x.createdAt || new Date().toISOString(),
      updatedAt: x.updatedAt || new Date().toISOString(),
      signature: `restored|${String(x.rule || '').slice(0, 40)}`,
      applications: [],
      version: 1,
    }
    repos.experience.insert(doc)
    experienceCount++
  }

  // 评估标准：只在文件里明确带了「用户已确认」的版本时才恢复，否则用默认值
  if (p.criteria && p.criteria.confirmedAt) {
    repos.criteria.upsert(personId, {
      ...p.criteria,
      personId,
      restoredFrom: { exportedAt: archive.exportedAt },
    })
  }

  return {
    person: { id: person.id, name: person.name },
    factCount,
    episodeCount,
    experienceCount,
    hadPrompt: typeof p.prompt === 'string',
    hadSealed: !!p.sealed,
  }
}

module.exports = { FORMAT, exportArchive, verifyArchive, importArchive, checksumOf, canonical }
