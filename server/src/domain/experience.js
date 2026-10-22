'use strict'

// 经验资产的数据形状与不变量。
//
// 一条「经验」= 情境 + 行动 + 结果 + 提炼出的规则 + 有效性评分。
// 它和「事实」的区别：事实是「你是谁」，经验是「你在什么情况下怎么做有效」。
// 事实错了一眼能看出来；经验必须靠「应用→观察结果→修正评分」才能变准。
//
// 单环 / 双环的分界就落在本文件：
//   - 评分怎么变（updateEffectiveness）= 单环，Agent 自动做；
//   - 什么算「有效」（criteria.thresholds / weights）= 双环，必须用户确认。

const DEFAULT_CRITERIA = {
  version: 1,
  // 排序权重：有效性最重要，其次新鲜度、样本量、命中率
  wEffective: 0.45,
  wRecent: 0.2,
  wSupport: 0.2,
  wPrecision: 0.15,
  halfLifeDays: 45,
  thresholds: {
    archive: 0.25, // 低于此值进入休眠（不删除）
    promote: 0.72, // 高于此值且样本够 → 固化为技能
    minSamples: 3, // 少于 3 次应用不做升降级判断
    minSupport: 2, // 反思至少需要几次同类事件才成规则
  },
  confirmedAt: null,
  confirmedBy: 'default',
}

const OUTCOMES = ['worked', 'failed', 'neutral']

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function round3(n) {
  return Math.round(n * 1000) / 1000
}

function normalizeCriteria(input = {}) {
  const base = JSON.parse(JSON.stringify(DEFAULT_CRITERIA))
  const merged = { ...base, ...input, thresholds: { ...base.thresholds, ...(input.thresholds || {}) } }

  const weights = ['wEffective', 'wRecent', 'wSupport', 'wPrecision']
  for (const k of weights) {
    merged[k] = typeof merged[k] === 'number' && merged[k] >= 0 ? merged[k] : base[k]
  }
  // 权重必须归一，否则用户把四项都填 1 会让分数冲破 1
  const sum = weights.reduce((s, k) => s + merged[k], 0)
  if (sum > 0) for (const k of weights) merged[k] = round3(merged[k] / sum)

  merged.halfLifeDays = clamp(Number(merged.halfLifeDays) || base.halfLifeDays, 7, 365)
  merged.thresholds.archive = clamp(Number(merged.thresholds.archive) || base.thresholds.archive, 0.05, 0.9)
  merged.thresholds.promote = clamp(Number(merged.thresholds.promote) || base.thresholds.promote, 0.3, 0.99)
  merged.thresholds.minSamples = clamp(Number(merged.thresholds.minSamples) || 3, 1, 50)
  merged.thresholds.minSupport = clamp(Number(merged.thresholds.minSupport) || 2, 2, 50)
  if (merged.thresholds.promote <= merged.thresholds.archive) {
    merged.thresholds.promote = merged.thresholds.archive + 0.1
  }
  return merged
}

/**
 * 有效性更新（单环，Agent 自己决定）。
 *
 * 刻意做成「渐进」的：
 *   - 奏效：向 1 靠近 18% 的剩余距离；
 *   - 失效：乘以 0.78；
 *   - 没感觉：几乎不动。
 * 这样一条用 10 次建立起来的规则，不会被一次意外打穿；反过来，
 * 一条一直奏效的规则也需要连续几次失效才会掉到休眠线以下。
 */
function updateEffectiveness(current, outcome) {
  const c = clamp(typeof current === 'number' ? current : 0.5, 0.02, 0.99)
  let next
  if (outcome === 'worked') next = c + (1 - c) * 0.18
  else if (outcome === 'failed') next = c * 0.78
  else next = c * 0.97 + 0.015
  return round3(clamp(next, 0.02, 0.99))
}

/**
 * 状态流转。只做「降权」和「固化」，不做「删除」——
 * 经验是用户的资产，删不删由用户决定，Agent 只能让它沉下去。
 */
function nextStatus(exp, criteria) {
  const t = (criteria || DEFAULT_CRITERIA).thresholds
  const applied = exp.applied || 0
  const eff = exp.effectiveness

  if (applied >= t.minSamples) {
    if (eff >= t.promote) return 'active'
    if (eff < t.archive) return 'dormant'
  }
  if (exp.status === 'archived') return 'archived'
  if (exp.status === 'proposed' && (exp.evidence || []).length >= t.minSupport && eff >= 0.5) return 'active'
  return exp.status || 'proposed'
}

function isSolidified(exp, criteria) {
  const t = (criteria || DEFAULT_CRITERIA).thresholds
  return (exp.applied || 0) >= t.minSamples && exp.effectiveness >= t.promote
}

/**
 * 新建一条经验。evidence 必须是真实 episode / invocation，否则拒收 ——
 * 不能溯源的规则在这个产品里等于编造。
 */
function createExperience({
  personId,
  situation,
  action,
  outcome,
  rule,
  trigger,
  evidence = [],
  source = 'reflect',
  status = 'proposed',
  effectiveness = 0.5,
}) {
  if (!rule || !rule.trim()) throw new Error('经验必须有可执行的规则文本')
  if (!Array.isArray(evidence) || evidence.length === 0) throw new Error('经验必须能溯源到具体事件')

  const now = new Date().toISOString()
  return {
    personId,
    situation: situation || {},
    action: action || {},
    outcome: outcome || {},
    rule: rule.trim(),
    trigger: {
      tags: (trigger?.tags || []).slice(0, 8),
      scene: trigger?.scene || '',
      intent: trigger?.intent || '',
      predicate: trigger?.predicate || '',
    },
    effectiveness: clamp(effectiveness, 0.02, 0.99),
    applied: 0,
    followed: 0,
    evidence: evidence.slice(0, 8),
    status,
    source,
    loop: 'single',
    createdAt: now,
    updatedAt: now,
    lastAppliedAt: null,
    applications: [],
    version: 1,
  }
}

/** 经验 → 一句话，给界面和 prompt 用 */
function describe(exp) {
  const tags = exp.trigger?.tags || []
  const where = tags.length ? `在「${tags.join('、')}」这类情境下` : '在类似情境下'
  return `${where}，${exp.rule.replace(/^在.*?下，/, '')}`
}

module.exports = {
  DEFAULT_CRITERIA,
  OUTCOMES,
  normalizeCriteria,
  updateEffectiveness,
  nextStatus,
  isSolidified,
  createExperience,
  describe,
  clamp,
}
