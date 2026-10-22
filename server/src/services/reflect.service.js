'use strict'

// 反思服务：把「一堆做过的事」压成「几条以后能用的判断」。
//
// 经验学习循环在这里落地：观察（invocation + feedback）→ 行动（当时给的方案）
// → 结果（采纳/否决）→ 经验（重复出现的模式）→ 教训（规则文本）→ 记忆（经验层）。
//
// 关键约束：反思只能产出「候选」，不能改评估标准（双环在 experience.service 里锁着）。
// 挖掘本身是 CPU 密集活，丢给 core/ 跑；Node 只负责把结果落库和去重。

const core = require('../core/client')
const { config } = require('../config')
const log = require('../logger')
const X = require('../domain/experience')
const experienceService = require('./experience.service')

const DAY = 86400000

/** 从调用记录里还原「情境-行动-结果」三元组 */
function collectEvents(repos, personId, { days = 120, limit = 400 } = {}) {
  const since = Date.now() - days * DAY
  const invocations = repos.invocation.byPerson(personId, limit)
  const events = []

  for (const inv of invocations) {
    const fb = inv.feedback
    if (!fb || (fb.action !== 'accept' && fb.action !== 'reject')) continue
    const at = new Date(fb.at || inv.createdAt).getTime()
    if (!Number.isFinite(at) || at < since) continue

    const cards = inv.cards || []
    const card =
      cards.find(c => c.id === fb.cardId) ||
      cards.find(c => c.kind === 'plan') ||
      cards[0]
    if (!card || !card.title) continue

    // 同一句话里的标签就是「情境」；没有标签时退到意图本身
    const tags = (inv.tags || []).slice(0, 6)
    events.push({
      id: inv.id,
      ts: at,
      tags: tags.length ? tags : [inv.intent?.label || inv.intent?.type || '日常'],
      scene: sceneOf(inv),
      title: cleanTitle(card.title),
      verdict: fb.action,
    })
  }

  return events
}

// 卡片标题常带副标题（「拌汤（洋芋疙瘩汤）」）。规则里只留主名 ——
// 「优先「拌汤」」比「优先「拌汤洋芋疙瘩汤」」更像人话，也更容易和下次的候选对上。
function cleanTitle(title) {
  return String(title)
    .split(/[（(]/)[0]
    .replace(/[《》]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
}

function sceneOf(inv) {
  const mode = inv.entities?.mode || inv.cards?.find(c => c.kind === 'plan')?.meta?.mode
  if (mode) return mode
  const headcount = Number(inv.entities?.headcount)
  if (inv.intent?.type === 'gather') return headcount > 1 ? 'group' : 'solo'
  if (inv.intent?.type === 'eat') return headcount > 1 ? 'group' : 'solo'
  return 'daily'
}

/**
 * 跑一次反思。
 * @returns 本次挖到什么、新增几条、合并了几条
 */
async function reflect(repos, personId, { minSupport = null, days = 120 } = {}) {
  const criteria = experienceService.getCriteria(repos, personId)
  const floor = minSupport || criteria.thresholds.minSupport

  const events = collectEvents(repos, personId, { days })
  if (events.length < floor) {
    return {
      events: events.length,
      source: 'none',
      candidates: [],
      created: 0,
      updated: 0,
      note: events.length ? `还需要至少 ${floor} 次同类事件` : '还没有带反馈的调用记录',
    }
  }

  const mined = await core.mine(events, floor)
  const created = []
  const updated = []

  for (const cand of mined.candidates) {
    // 证据必须能落到具体调用记录上，否则这条规则是编的
    if (!cand.evidenceIds?.length) continue
    const res = experienceService.upsertCandidate(repos, personId, cand, { source: 'reflect' })
    if (!res.experience) continue
    if (res.created) created.push(res.experience)
    else updated.push(res.experience)
  }

  repos.person.update(personId, { lastReflectAt: new Date().toISOString() })
  log.info('反思完成', {
    personId,
    events: events.length,
    mined: mined.candidates.length,
    created: created.length,
    engine: mined.source,
  })

  return {
    events: events.length,
    source: mined.source,
    ms: mined.ms,
    candidates: mined.candidates.map(c => ({
      rule: c.rule,
      action: c.action,
      title: c.title,
      support: c.support,
      precision: c.precision,
    })),
    created: created.length,
    updated: updated.length,
    items: [...created, ...updated].slice(0, 6),
  }
}

/**
 * 自动反思：每攒够 minSupport 条新反馈就自动跑一次。
 * 这是单环（不改标准、不改目标），所以不需要用户点头；
 * 但它写出来的经验是「候选」，要经过一次真实应用才会升到 active。
 */
async function maybeReflect(repos, personId) {
  const person = repos.person.get(personId)
  if (!person) return { skipped: true, reason: 'person_not_found' }

  const criteria = experienceService.getCriteria(repos, personId)
  const last = person.lastReflectAt ? new Date(person.lastReflectAt).getTime() : 0
  const events = collectEvents(repos, personId, { days: 120 })
  const fresh = events.filter(e => e.ts > last).length

  if (fresh < criteria.thresholds.minSupport) {
    return { skipped: true, reason: 'not_enough_new_events', fresh, need: criteria.thresholds.minSupport }
  }
  return reflect(repos, personId)
}

module.exports = { reflect, maybeReflect, collectEvents }
