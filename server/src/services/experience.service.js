'use strict'

// 经验资产服务：检索、应用、反馈、固化、资产盘点。
//
// 它对应三层架构里的「主 Agent 的能力」这一侧：
//   检索 = 遇到相似情境时把历史判断调出来；
//   应用 = 用了之后必须记录结果，否则评分永远是拍脑袋；
//   固化 = 反复奏效的规则升格成技能，供后续直接调用。
//
// CPU 密集的打分排序交给 core/（C++），本文件只做编排与业务判断。

const core = require('../core/client')
const { config } = require('../config')
const log = require('../logger')
const X = require('../domain/experience')

function getCriteria(repos, personId) {
  const stored = repos.criteria.get(personId)
  if (!stored) return X.normalizeCriteria({})
  return X.normalizeCriteria(stored)
}

/**
 * 双环约束点：评估标准只能由用户改。
 * 调用方必须显式传 confirm=true，否则拒绝 —— 这是防止 Agent 自己放宽标准的口子。
 */
function setCriteria(repos, personId, patch, { confirm = false } = {}) {
  if (confirm !== true) {
    const err = new Error('修改评估标准必须显式确认（confirm=true）')
    err.code = 'CONFIRM_REQUIRED'
    throw err
  }
  const before = getCriteria(repos, personId)
  const merged = X.normalizeCriteria({ ...before, ...patch, version: (before.version || 1) + 1 })
  merged.confirmedAt = new Date().toISOString()
  merged.confirmedBy = 'user'

  const doc = repos.criteria.upsert(personId, merged)
  repos.audit.insert({
    personId,
    action: 'criteria.update',
    before: { version: before.version, thresholds: before.thresholds, weights: pickWeights(before) },
    after: { version: merged.version, thresholds: merged.thresholds, weights: pickWeights(merged) },
    at: merged.confirmedAt,
  })
  return { criteria: merged, record: doc }
}

function pickWeights(c) {
  return { wEffective: c.wEffective, wRecent: c.wRecent, wSupport: c.wSupport, wPrecision: c.wPrecision, halfLifeDays: c.halfLifeDays }
}

function list(repos, personId, { status = null, limit = 200 } = {}) {
  const criteria = getCriteria(repos, personId)
  return repos.experience.byPerson(personId, { status, limit }).map(e => decorate(e, criteria))
}

function decorate(e, criteria) {
  return {
    ...e,
    solidified: X.isSolidified(e, criteria),
    flow: `${e.applied || 0} 次应用 / ${e.followed || 0} 次奏效`,
    readability: X.describe(e),
  }
}

function get(repos, personId, id) {
  const e = repos.experience.get(personId, id)
  return e ? decorate(e, getCriteria(repos, personId)) : null
}

/**
 * 检索：这个情境下，我以前总结过什么。
 * 返回的每一条都带 why 和 evidence —— 不能溯源的推荐不许出现在界面上。
 */
async function retrieve(repos, personId, { tags = [], scene = '', intent = '', text = '', limit = null } = {}) {
  const criteria = getCriteria(repos, personId)
  const pool = repos.experience.byPerson(personId, { limit: 800 }).filter(e => e.status !== 'archived' && e.status !== 'proposed')

  if (!pool.length) {
    return { source: 'none', items: [], considered: 0, ms: 0 }
  }

  const q = {
    tags: tags.slice(0, 8),
    scene,
    intent,
    text: (text || '').slice(0, 200),
    limit: limit || config.experience.exposeLimit,
  }

  const res = await core.rank(pool, q, criteria, Date.now())
  const byId = new Map(pool.map(e => [e.id, e]))
  const items = res.items
    .map(hit => {
      const exp = byId.get(hit.id)
      if (!exp) return null
      return {
        id: exp.id,
        rule: exp.rule,
        // 经验指向的具体选项（规则里被「」括住的那个），仲裁层据此判断是否与推荐一致
        title: exp.candidate?.title || pickQuoted(exp.rule),
        action: exp.candidate?.action || 'prefer',
        readability: X.describe(exp),
        score: hit.score,
        why: hit.why,
        matched: hit.matched,
        effectiveness: exp.effectiveness,
        applied: exp.applied || 0,
        followed: exp.followed || 0,
        status: exp.status,
        solidified: X.isSolidified(exp, criteria),
        evidence: (exp.evidence || []).slice(0, 3),
      }
    })
    .filter(Boolean)

  return { source: res.source, items, considered: res.considered, ms: res.ms }
}

/** 从规则文本里取出被引号括住的选项名（手写经验没有 candidate 字段） */
function pickQuoted(rule) {
  const matches = String(rule || '').match(/「([^」]+)」/g)
  if (!matches || !matches.length) return ''
  return matches[matches.length - 1].replace(/[「」]/g, '')
}

/**
 * 记录一次应用结果。这是单环学习的入口：Agent 自动改评分，不需要用户批准。
 * @param {'worked'|'failed'|'neutral'} outcome
 */
function applyOutcome(repos, personId, id, outcome, meta = {}) {
  const exp = repos.experience.get(personId, id)
  if (!exp) return null
  if (!X.OUTCOMES.includes(outcome)) throw new Error(`未知结果：${outcome}`)

  const criteria = getCriteria(repos, personId)
  const before = exp.effectiveness
  const after = X.updateEffectiveness(before, outcome)

  const applications = [
    ...(exp.applications || []),
    {
      at: new Date().toISOString(),
      outcome,
      invocationId: meta.invocationId || null,
      cardId: meta.cardId || null,
      note: meta.note || '',
      effectBefore: before,
      effectAfter: after,
    },
  ].slice(-20)

  const patch = {
    applied: (exp.applied || 0) + (outcome === 'neutral' ? 0 : 1),
    followed: (exp.followed || 0) + (outcome === 'worked' ? 1 : 0),
    effectiveness: after,
    applications,
    lastAppliedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const merged = { ...exp, ...patch }
  const status = X.nextStatus(merged, criteria)
  if (status !== exp.status) {
    patch.status = status
    if (status === 'active' && exp.status !== 'active') {
      patch.solidifiedAt = new Date().toISOString()
      log.info('经验已固化', { personId, experienceId: id, effectiveness: after })
    }
    if (status === 'dormant') {
      log.info('经验进入休眠', { personId, experienceId: id, effectiveness: after })
    }
  }

  repos.experience.update(id, patch)
  return { experience: get(repos, personId, id), before, after, statusChanged: !!patch.status }
}

/**
 * 写入一条候选经验（反思的产物）。
 * 去重键 = 动作 + 对象 + 触发标签：同一件事被反复挖出来，只累加证据，不重复建条目。
 */
function upsertCandidate(repos, personId, cand, { source = 'reflect' } = {}) {
  const criteria = getCriteria(repos, personId)
  const tags = (cand.tags || []).slice(0, 6)
  const signature = `${cand.action}|${cand.title}|${tags.slice().sort().join(',')}`

  const existing = repos.experience
    .byPerson(personId, { limit: 2000 })
    .find(e => e.signature === signature)

  if (existing) {
    // 已存在：补证据、刷新规则里的计数，但不重置评分 ——
    // 否则每反思一次就把「用了几次、几次奏效」的历史抹掉，经验永远长不大。
    const evidence = mergeEvidence(existing.evidence, cand.evidenceIds)
    const patch = { evidence, updatedAt: new Date().toISOString(), lastReflectAt: new Date().toISOString() }
    if (existing.source === 'reflect') {
      patch.rule = cand.rule
      patch.candidate = { action: cand.action, title: cand.title, precision: cand.precision, support: cand.support }
      patch.outcome = { ...(existing.outcome || {}), support: cand.support, precision: cand.precision }
    }
    const status = X.nextStatus({ ...existing, evidence }, criteria)
    if (status !== existing.status) patch.status = status
    repos.experience.update(existing.id, patch)
    return { created: false, experience: get(repos, personId, existing.id) }
  }

  const support = cand.support || (cand.evidenceIds || []).length
  const doc = X.createExperience({
    personId,
    situation: { text: cand.rule, scene: cand.scene || '', tags },
    action: { kind: cand.action === 'avoid' ? 'avoid' : 'rule', text: cand.action === 'avoid' ? `避开 ${cand.title}` : `优先 ${cand.title}` },
    outcome: { verdict: cand.action === 'avoid' ? 'bad' : 'good', support, precision: cand.precision },
    rule: cand.rule,
    trigger: { tags, scene: cand.scene || '', intent: cand.intent || '' },
    evidence: (cand.evidenceIds || []).map(id => ({ refId: id, kind: 'invocation' })),
    source,
    status: 'proposed',
    effectiveness: 0.5,
  })
  doc.signature = signature
  doc.candidate = { action: cand.action, title: cand.title, precision: cand.precision, support }
  // 证据够（>= minSupport 且倾向明显）就先挂为可用；不够就留在待确认区
  doc.status = X.nextStatus(doc, criteria)

  const record = repos.experience.insert(doc)
  return { created: true, experience: get(repos, personId, record.id) }
}

function mergeEvidence(oldList = [], newIds = []) {
  const out = oldList.slice()
  for (const id of newIds) {
    if (!out.some(x => (x.refId || x) === id)) out.push({ refId: id, kind: 'invocation' })
  }
  return out.slice(-8)
}

/** 手动新增：用户自己写一条经验，权重直接给高 —— 这是最贵的输入 */
function createManual(repos, personId, { rule, tags = [], scene = '', outcome = 'good' }) {
  if (!rule || !rule.trim()) throw new Error('规则不能为空')
  const criteria = getCriteria(repos, personId)
  const doc = X.createExperience({
    personId,
    situation: { text: rollSituation(tags, scene), scene, tags },
    action: { kind: 'rule', text: rule.trim() },
    outcome: { verdict: outcome, note: '用户手写' },
    rule: rule.trim(),
    trigger: { tags: tags.slice(0, 6), scene },
    evidence: [{ refId: 'manual', kind: 'user' }],
    source: 'manual',
    status: 'active',
    effectiveness: 0.7,
  })
  doc.signature = `manual|${rule.trim().slice(0, 40)}`
  doc.status = X.nextStatus(doc, criteria)
  return get(repos, personId, repos.experience.insert(doc).id)
}

function rollSituation(tags, scene) {
  const where = tags.length ? `「${tags.join('、')}」这类情境` : '类似情境'
  return `${scene ? `${scene}，` : ''}${where}`
}

function setStatus(repos, personId, id, status) {
  const exp = repos.experience.get(personId, id)
  if (!exp) return null
  if (!['active', 'dormant', 'archived', 'proposed'].includes(status)) throw new Error(`未知状态：${status}`)
  repos.experience.update(id, { status, updatedAt: new Date().toISOString() })
  return get(repos, personId, id)
}

/**
 * 资产盘点：用户真正会看的一页。
 * 「我这两周攒下了什么」比「你有 37 条记忆」有意义得多。
 */
async function assets(repos, personId) {
  const criteria = getCriteria(repos, personId)
  const all = repos.experience.byPerson(personId, { limit: 2000 })
  const now = Date.now()
  const DAY = 86400000

  const active = all.filter(e => e.status === 'active')
  const dormant = all.filter(e => e.status === 'dormant')
  const proposed = all.filter(e => e.status === 'proposed')
  const archived = all.filter(e => e.status === 'archived')
  const solidified = all.filter(e => X.isSolidified(e, criteria))

  const appliedTotal = all.reduce((s, e) => s + (e.applied || 0), 0)
  const followedTotal = all.reduce((s, e) => s + (e.followed || 0), 0)
  const avgEffect = active.length
    ? Math.round((active.reduce((s, e) => s + e.effectiveness, 0) / active.length) * 100) / 100
    : null

  const growth7 = all.filter(e => now - new Date(e.createdAt).getTime() < 7 * DAY).length
  const growth30 = all.filter(e => now - new Date(e.createdAt).getTime() < 30 * DAY).length

  // 资产不是数量，是「可复用的判断」。按有效性排前几，让用户看到硬货。
  const ranked = active.length ? (await core.rank(active, {}, criteria, now)).items.slice(0, 3) : []
  const top = ranked
    .map(hit => active.find(e => e.id === hit.id))
    .filter(Boolean)
    .map(e => ({ id: e.id, rule: e.rule, readability: X.describe(e), effectiveness: e.effectiveness, applied: e.applied || 0 }))

  return {
    total: all.length,
    active: active.length,
    dormant: dormant.length,
    proposed: proposed.length,
    archived: archived.length,
    solidified: solidified.length,
    appliedTotal,
    followedTotal,
    hitRate: appliedTotal ? Math.round((followedTotal / appliedTotal) * 100) / 100 : null,
    avgEffectiveness: avgEffect,
    growth: { last7: growth7, last30: growth30 },
    top,
    criteria: {
      version: criteria.version,
      confirmedAt: criteria.confirmedAt,
      confirmedBy: criteria.confirmedBy,
      thresholds: criteria.thresholds,
      weights: pickWeights(criteria),
    },
    // 下一步做什么 —— 资产页最该给的不是数字，是一个动作
    nextAction: suggestNext({ active, dormant, proposed, appliedTotal }),
  }
}

function suggestNext({ active, dormant, proposed, appliedTotal }) {
  if (proposed.length >= 2) {
    return { kind: 'confirm', text: `有 ${proposed.length} 条经验等你确认，确认后才会参与推荐`, cta: '去确认' }
  }
  if (active.length && appliedTotal < 3) {
    return { kind: 'apply', text: '攒下的经验还没被真正用过，下次遇到相似场景让它出来', cta: '试一次' }
  }
  if (dormant.length) {
    return { kind: 'review', text: `${dormant.length} 条经验一直没奏效，可以归档了`, cta: '清理' }
  }
  if (!active.length) {
    return { kind: 'collect', text: '还没有成型的经验，先记几条做过的事，攒够两次同类事件就会自动提炼', cta: '去记录' }
  }
  return { kind: 'keep', text: '继续记录，同类事件攒够两次就会自动提炼新经验', cta: '知道了' }
}

module.exports = {
  getCriteria,
  setCriteria,
  list,
  get,
  retrieve,
  applyOutcome,
  upsertCandidate,
  createManual,
  setStatus,
  assets,
  decorate,
}
