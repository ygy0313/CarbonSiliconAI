'use strict'

// 核对服务：整个飞轮闭合的地方。
//
// 三种信号，按可靠性排序：
//   1) 显式修正（用户说「我不吃辣」）      —— 最高权重，直接改事实
//   2) 显式否决（点「不要这个」+ 原因）     —— 中权重，调整相关事实
//   3) 隐式采纳（点了「就这个」）           —— 低权重，强化置信度
// 所有修正都写回记忆，下一次编排立刻生效 —— 这就是「越用越像你」的机制。

const { FACT_DIMENSIONS } = require('../domain/taxonomy')
const experienceService = require('./experience.service')
const reflectService = require('./reflect.service')

const REASON_ACTIONS = {
  too_spicy: { key: 'diet.spicy', hint: '降低辣度耐受' },
  too_expensive: { key: 'life.budget', hint: '下调预算预期' },
  bad_for_stomach: { key: 'diet.stomach', hint: '标记肠胃敏感' },
  too_far: { key: null, hint: '距离偏好，暂不建事实' },
  not_interested: { key: null, hint: '仅记录，不改档案' },
}

const SPICY_LADDER = ['不吃辣', '微辣', '中辣', '重辣']

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

/**
 * 记录时检测事实冲突：新值与旧值不一致且都足够可信 → 进冲突队列，等人裁决。
 * 不直接覆盖，是因为「今天想吃辣」和「我平时吃辣」是两件事。
 */
function detectAndQueueConflict(repos, personId, factChanges, episodeId) {
  const queued = []
  for (const change of factChanges) {
    if (change.action !== 'updated') continue
    const dim = FACT_DIMENSIONS.find(d => d.key === change.key)
    if (!dim) continue

    const existing = repos.conflict.byPerson(personId).find(c => c.key === change.key)
    if (existing) continue

    queued.push(repos.conflict.insert({
      personId,
      key: change.key,
      label: dim.label,
      previous: change.before,
      incoming: change.after,
      episodeId,
      question: `你的档案里写的是「${change.before}」，这次记录是「${change.after}」，以哪个为准？`,
      options: [
        { id: 'keep_new', label: `改成「${change.after}」` },
        { id: 'keep_old', label: `保留「${change.before}」` },
        { id: 'both', label: '都算，看情况' },
      ],
    }))
  }
  return queued
}

/**
 * 处理一次用户反馈。
 * @param {'accept'|'reject'|'edit'} action
 */
async function applyFeedback(repos, personId, { invocationId, cardId, action, reason, patch }) {
  const invocation = repos.invocation.get(invocationId)
  if (!invocation) return { ok: false, error: 'INVOCATION_NOT_FOUND' }

  const now = new Date().toISOString()
  const changes = []

  repos.invocation.update(invocationId, {
    feedback: { cardId, action, reason: reason || null, patch: patch || null, at: now },
  })

  // 回写经验：这次推荐如果用了某条经验，结果就是那条经验的「应用效果」。
  // 不做这一步，经验的有效性评分永远是拍脑袋的 0.5。
  const experienceUpdates = recordExperienceOutcome(repos, personId, invocation, cardId, action)

  if (action === 'accept') {
    // 隐式强化：相关维度置信度 +0.06，让「被采纳过的偏好」更稳
    for (const f of repos.fact.byPerson(personId)) {
      if (f.confidence < 0.95 && f.key.startsWith('diet.')) {
        repos.fact.upsert(personId, f.key, f.value, {
          confidence: clamp((f.confidence || 0.6) + 0.02, 0, 0.98),
        })
      }
    }
    repos.episode.insert({
      personId,
      ts: now,
      kind: 'adoption',
      text: `采纳了推荐：${cardId}`,
      tags: ['采纳'],
      entities: {},
      summary: '采纳一条推荐',
      source: 'feedback',
      confidence: 0.8,
    })
    changes.push({ type: 'confidence_up', detail: '饮食类事实置信度 +0.02' })
  }

  if (action === 'reject') {
    const map = REASON_ACTIONS[reason]
    if (map?.key === 'diet.spicy') {
      const cur = repos.fact.get(personId, 'diet.spicy')?.value || '中辣'
      const idx = SPICY_LADDER.indexOf(cur)
      const next = SPICY_LADDER[clamp(idx - 1, 0, 3)]
      if (next !== cur) {
        repos.fact.upsert(personId, 'diet.spicy', next, {
          confidence: 0.7,
          source: 'user_correction',
          note: '因「太辣」被否决后下调',
        })
        changes.push({ type: 'fact_corrected', key: 'diet.spicy', before: cur, after: next })
      }
    }
    if (map?.key === 'life.budget') {
      const cur = Number(repos.fact.get(personId, 'life.budget')?.value) || null
      if (cur) {
        const next = Math.max(20, Math.round(cur * 0.85))
        repos.fact.upsert(personId, 'life.budget', next, {
          confidence: 0.65,
          source: 'user_correction',
          note: '因「太贵」被否决后下调',
        })
        changes.push({ type: 'fact_corrected', key: 'life.budget', before: cur, after: next })
      }
    }
    if (map?.key === 'diet.stomach') {
      repos.fact.upsert(personId, 'diet.stomach', '偏敏感', {
        confidence: 0.75,
        source: 'user_correction',
        note: '因「吃了不舒服」被否决',
      })
      changes.push({ type: 'fact_corrected', key: 'diet.stomach', after: '偏敏感' })
    }

    repos.episode.insert({
      personId,
      ts: now,
      kind: 'rejection',
      text: `否决了推荐：${cardId}${reason ? `（${map?.hint || reason}）` : ''}`,
      tags: ['否决'],
      entities: {},
      summary: '否决一条推荐',
      source: 'feedback',
      confidence: 0.85,
    })
  }

  if (action === 'edit' && patch) {
    // 「不对，我其实……」—— 最高权重，直接改事实并留痕
    for (const [key, value] of Object.entries(patch)) {
      if (!FACT_DIMENSIONS.some(d => d.key === key)) continue
      const before = repos.fact.get(personId, key)?.value ?? null
      if (before === value) continue
      repos.fact.upsert(personId, key, value, {
        confidence: 0.95,
        source: 'user_correction',
        note: '用户直接修正',
      })
      changes.push({ type: 'fact_corrected', key, before, after: value })
    }
    repos.episode.insert({
      personId,
      ts: now,
      kind: 'correction',
      text: `修正档案：${Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', ')}`,
      tags: ['修正'],
      entities: {},
      summary: '修正档案事实',
      source: 'feedback',
      confidence: 0.95,
    })
  }

  // 单环：攒够新反馈就自动反思一次。失败不影响反馈本身（反馈是用户的动作，不能被后台任务拖累）
  let reflection = { skipped: true, reason: 'not_attempted' }
  try {
    reflection = await reflectService.maybeReflect(repos, personId)
  } catch (err) {
    reflection = { skipped: true, reason: 'reflect_failed', error: err.message }
  }

  return { ok: true, changes, experienceUpdates, reflection }
}

/**
 * 一次反馈 → 若干条经验的评分更新。
 * accept 记 worked，reject 记 failed。edit 不改评分 —— 用户只是改了参数，
 * 不代表这条规则本身错了。
 */
function recordExperienceOutcome(repos, personId, invocation, cardId, action) {
  const cards = invocation.cards || []
  const target =
    cards.find(c => c.id === cardId) ||
    cards.find(c => c.kind === 'plan') ||
    cards.find(c => (c.experienceIds || []).length)
  if (!target || !(target.experienceIds || []).length) return []

  const outcome = action === 'accept' ? 'worked' : action === 'reject' ? 'failed' : 'neutral'
  const updates = []
  for (const id of target.experienceIds) {
    const res = experienceService.applyOutcome(repos, personId, id, outcome, {
      invocationId: invocation.id,
      cardId: target.id,
    })
    if (res) {
      updates.push({
        id,
        before: res.before,
        after: res.after,
        status: res.experience.status,
        statusChanged: res.statusChanged,
      })
    }
  }
  return updates
}

/**
 * 裁决一个冲突。
 * @param {'keep_new'|'keep_old'|'both'} decision
 */
function resolveConflict(repos, personId, conflictId, decision) {
  const conflict = repos.conflict.get(conflictId)
  if (!conflict || conflict.personId !== personId) return { ok: false, error: 'CONFLICT_NOT_FOUND' }

  let applied = null
  if (decision === 'keep_new') {
    applied = conflict.incoming
    repos.fact.upsert(personId, conflict.key, conflict.incoming, {
      confidence: 0.9,
      source: 'user_correction',
      note: '冲突裁决：以新记录为准',
    })
  } else if (decision === 'keep_old') {
    applied = conflict.previous
    repos.fact.upsert(personId, conflict.key, conflict.previous, {
      confidence: 0.9,
      source: 'user_correction',
      note: '冲突裁决：保留原值',
    })
  } else {
    applied = `${conflict.previous} / ${conflict.incoming}`
    repos.fact.upsert(personId, conflict.key, applied, {
      confidence: 0.6,
      source: 'user_correction',
      note: '冲突裁决：视情况而定',
    })
  }

  repos.conflict.update(conflictId, { status: 'resolved', decision, resolvedAt: new Date().toISOString() })
  repos.episode.insert({
    personId,
    ts: new Date().toISOString(),
    kind: 'correction',
    text: `裁决冲突 ${conflict.label}：${decision}`,
    tags: ['裁决'],
    entities: {},
    summary: '裁决一条冲突',
    source: 'feedback',
    confidence: 0.95,
  })

  return { ok: true, applied }
}

module.exports = { detectAndQueueConflict, applyFeedback, resolveConflict }
