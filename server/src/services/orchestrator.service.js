'use strict'

// 编排器：整个产品的调度中枢。
//
// 一次编排 = 意图识别 → 能力召回 → 依赖解析 → 分层并行执行 → 仲裁合并 → 落库
// 每次编排都留完整 trace，前端可以逐帧播放「你的硅基体在思考」。

const registry = require('../agents/registry')
const { INTENTS } = require('../domain/taxonomy')
const { compileSilicon, recall } = require('./profile.service')
const log = require('../logger')

const AGENT_TIMEOUT_MS = 4000

// 确保所有能力被加载并注册（副作用 import）
require('../agents/fortune.agent')
require('../agents/weather.agent')
require('../agents/calendar.agent')
require('../agents/meal.agent')
require('../agents/mystery.agent')
require('../agents/venue.agent')
require('../agents/catering.agent')

/**
 * 意图识别：关键词加权打分。
 * 规则清晰、可解释、零成本；接 LLM 时也保留它作为「下限保障」。
 */
function detectIntent(text) {
  const t = String(text || '')
  const hits = INTENTS.map(intent => {
    const matched = intent.keywords.filter(k => t.includes(k))
    const score = matched.length * intent.weight
    return { intent, matched, score }
  }).filter(h => h.score > 0).sort((a, b) => b.score - a.score)

  if (!hits.length) {
    return { type: 'unknown', label: '还没听懂', confidence: 0.2, service: null, matched: [] }
  }

  const top = hits[0]
  const second = hits[1]
  // 置信度：命中词越多越确定，但两个意图分数接近时要降低把握
  let confidence = Math.min(0.96, 0.45 + top.score * 0.18)
  if (second && second.score / top.score > 0.75) confidence -= 0.12

  return {
    type: top.intent.type,
    label: top.intent.label,
    service: top.intent.service,
    confidence: Number(confidence.toFixed(2)),
    matched: top.matched,
    secondary: second && second.score / top.score > 0.6
      ? { type: second.intent.type, label: second.intent.label }
      : null,
  }
}

function withTimeout(promise, ms, id) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`agent ${id} 超时 ${ms}ms`)), ms)),
  ])
}

/**
 * 主流程。
 * @param {object} repos
 * @param {string} personId
 * @param {string} text 用户这句话
 * @param {object} opts { tags, entities, now, persist }
 */
async function orchestrate(repos, personId, text, opts = {}) {
  const startedAt = Date.now()
  const now = opts.now || new Date()
  const trace = []
  let step = 0
  const push = (stage, label, extra = {}) => {
    step += 1
    trace.push({ step, stage, label, at: Date.now() - startedAt, ...extra })
  }

  // ── 1. 意图 ──
  const intent = detectIntent(text)
  push('intent', `识别意图：${intent.label}`, { detail: intent.matched.join('、'), confidence: intent.confidence })

  // ── 2. 编译硅基体（人格包）──
  const silicon = compileSilicon(repos, personId, { limit: 30 })
  if (!silicon) {
    return { error: 'PERSON_NOT_FOUND', intent, trace }
  }
  push('profile', `载入档案：${silicon.person.name}（完整度 ${(silicon.completeness * 100).toFixed(0)}%）`, {
    detail: `${silicon.facts.filter(f => f.confidence >= 0.4).length} 条事实 / ${silicon.episodes.length} 条记忆`,
  })

  const facts = Object.fromEntries(
    silicon.facts.filter(f => f.confidence >= 0.3).map(f => [f.key, f.value])
  )

  // ── 3. 召回 ──
  const seeds = registry.candidatesFor(intent.type)
  if (!seeds.length) {
    push('recall', '没有匹配的服务', { status: 'empty' })
    return {
      intent,
      silicon,
      trace,
      cards: [],
      summary: '这个需求还没有对应的服务。你可以先在「服务市场」里开启，或者换种说法。',
      suggestion: `目前可用意图：${INTENTS.map(i => i.label).join(' / ')}`,
    }
  }
  push('recall', `召回 ${seeds.length} 个服务`, { detail: seeds.map(s => `${s.service}·${s.name}`).join(' + ') })

  // ── 4. 依赖解析 ──
  const plan = registry.resolvePlan(seeds.map(s => s.id))
  push('plan', `解析出 ${plan.total} 个执行节点 / ${plan.layers.length} 层`, {
    graph: plan.layers.map(layer => layer.map(id => registry.get(id)?.name || id)),
  })

  // ── 5. 分层执行 ──
  const outputs = {}
  const ctx = {
    personId,
    repos,
    profile: silicon,
    facts,
    intent,
    entities: opts.entities || {},
    tags: opts.tags || [],
    now,
    outputs,
  }

  for (let i = 0; i < plan.layers.length; i++) {
    const layer = plan.layers[i]
    const t0 = Date.now()
    const results = await Promise.allSettled(
      layer.map(async id => {
        const agent = registry.get(id)
        if (!agent) throw new Error(`能力 ${id} 不存在`)
        const r = await withTimeout(agent.run(ctx), AGENT_TIMEOUT_MS, id)
        return { id, r }
      })
    )

    results.forEach((res, idx) => {
      const id = layer[idx]
      const agent = registry.get(id)
      if (res.status === 'fulfilled') {
        outputs[id] = res.value.r
        push('run', `${agent.name} 完成`, {
          agentId: id,
          service: agent.service,
          ms: Date.now() - t0,
          status: 'ok',
          itemCount: res.value.r.items?.length || 0,
        })
      } else {
        const msg = res.reason?.message || '未知错误'
        push('run', `${agent?.name || id} 失败，已跳过`, { agentId: id, status: 'failed', error: msg })
        log.warn('agent 执行失败', { agentId: id, error: msg })
      }
    })
  }

  // ── 6. 合并仲裁 ──
  const cards = compose({ outputs, intent, silicon, facts, entities: ctx.entities })
  push('compose', `合并出 ${cards.length} 条建议`, {
    detail: cards.map(c => c.title).join(' / ').slice(0, 80),
  })

  const summary = buildSummary({ intent, cards, outputs, entities: ctx.entities })

  // ── 7. 落库 ──
  const invocation = repos.invocation.insert({
    personId,
    input: text,
    intent,
    tags: ctx.tags,
    entities: ctx.entities,
    cardIds: cards.map(c => c.id),
    cardCount: cards.length,
    agents: plan.layers.flat(),
    summary,
    trace,
    totalMs: Date.now() - startedAt,
  })

  push('done', `完成，用时 ${Date.now() - startedAt}ms`, { totalMs: Date.now() - startedAt })

  return {
    invocationId: invocation.id,
    intent,
    silicon: {
      id: silicon.person.id,
      name: silicon.person.name,
      completeness: silicon.completeness,
      factCount: silicon.facts.length,
      memoryCount: silicon.traits.recordCount,
    },
    cards,
    summary,
    trace,
    totalMs: Date.now() - startedAt,
  }
}

/**
 * 仲裁合并：
 *   1) context 类沉底（作为「为什么这么选」的附属信息）
 *   2) primary 优先，option 依次
 *   3) 跨 agent 同类去重（按标题归一）
 *   4) gather 场景拼总预算
 */
function compose({ outputs, intent, silicon, facts, entities }) {
  const all = []
  for (const [agentId, out] of Object.entries(outputs)) {
    for (const item of out.items || []) {
      all.push({ ...item, agentId })
    }
  }

  const weight = { primary: 3, option: 2, note: 1, context: 0 }
  const seen = new Set()
  const deduped = []
  for (const item of all.sort((a, b) => (weight[b.kind] ?? 0) - (weight[a.kind] ?? 0) || b.score - a.score)) {
    const key = item.title.replace(/[《》\s]/g, '')
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }

  // gather 场景：把三条独立推荐「组装成一个局」。
  // 这是多 agent 协同真正的产出物 —— 用户要的不是三个选项，是一份能照着做的安排。
  if (intent.type === 'gather') {
    const bundle = buildGatherBundle({ cards: deduped, outputs, entities, facts })
    if (bundle) return [bundle, ...deduped]
  }

  return deduped
}

function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m + minutes
  const nh = Math.floor(total / 60) % 24
  const nm = total % 60
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`
}

function fmtDur(min) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
}

/**
 * 组装「一个完整的局」：本 + 场地 + 茶歇 + 时间线 + 待办。
 * 任何一部分缺失都能降级，不会因为某个 agent 挂了就拼不出来。
 */
function buildGatherBundle({ cards, outputs, entities, facts }) {
  const script = cards.find(c => c.id.startsWith('script_'))
  if (!script) return null

  const venue = cards.find(c => c.id.startsWith('venue_'))
  const catering = cards.find(c => c.id.startsWith('catering_'))
  const cal = outputs['calendar.check']?.meta
  const headcount = entities.headcount || Number(facts['social.groupSize']) || script.meta.headcountFit?.[0] || 6

  const minutes = script.meta.minutes || 180
  const price = Number(script.meta.price) || 0
  const venuePrice = Number(venue?.meta?.price) || 0
  const cateringPer = Number(catering?.meta?.perPerson) || 0
  const totalPerPerson = price + venuePrice + cateringPer

  // 默认晚场：档案里是夜猫子就往 19:30 排，否则 19:00
  const startAt = facts['life.rhythm'] === '夜猫子' ? '19:30' : '19:00'
  const arriveAt = addMinutes(startAt, -30)
  const endAt = addMinutes(startAt, minutes)
  const wrapAt = addMinutes(startAt, minutes + 20)

  const timeline = [
    { time: arriveAt, text: `${venue && venuePrice === 0 ? '在家' : `到${venue ? venue.title.replace(/（.*?）/g, '') : '场地'}`}集合，${catering ? `把${catering.title.split('（')[0]}摆上` : '先把水烧上'}` },
    { time: startAt, text: `开《${script.title.replace(/[《》]/g, '')}》，${fmtDur(minutes)}` },
    { time: endAt, text: '收尾，留 20 分钟复盘' },
    { time: wrapAt, text: '散场' },
  ]

  const todos = [`确认 ${headcount} 人能到（现在定了几个？）`]
  if (venue && venuePrice > 0) todos.push(`订${venue.title.replace(/（.*?）/g, '')}，${headcount} 人包间`)
  if (catering) todos.push(`备${catering.title.split('（')[0]}，${headcount} 人份约 ${cateringPer * headcount} 元`)
  if (script.meta.needDM) todos.push('确认 DM 档期')
  todos.push('提前一天把本过一遍，别到现场现翻')

  const why = []
  if (script.meta.headcountFit?.includes(headcount)) why.push(`${headcount} 人正好，不用临时凑人`)
  if (script.meta.level === '新手') why.push('新手本，没玩过的人不会有压力')
  if (venuePrice === 0) why.push('场地零成本，预算全留给茶歇')
  else if (venue) why.push(`${venue.title.replace(/（.*?）/g, '')}离你 ${venue.meta?.price ? '' : ''}近，散场不折腾`)
  if (totalPerPerson && entities.budget) {
    why.push(totalPerPerson <= entities.budget
      ? `人均 ${totalPerPerson} 元，在你 ${entities.budget} 的预算内`
      : `人均 ${totalPerPerson} 元，比你 ${entities.budget} 的预算高一点`)
  }

  return {
    id: 'plan_gather',
    kind: 'plan',
    title: `${cal?.dayOfWeek || '周末'} ${headcount} 人局`,
    desc: `《${script.title.replace(/[《》]/g, '')}》· ${venue ? venue.title.split('（')[0] : '待定场地'} · ${catering ? catering.title.split('（')[0] : '无茶歇'} · 人均约 ${totalPerPerson} 元`,
    why: why.slice(0, 3),
    evidence: [],
    score: script.score,
    source: '多服务协同',
    meta: {
      date: cal?.date,
      dateStr: cal?.dateStr,
      headcount,
      totalPerPerson,
      parts: [script.id, venue?.id, catering?.id].filter(Boolean),
      timeline,
      todos,
      missing: [!venue && 'venue', !catering && 'catering'].filter(Boolean),
    },
  }
}

function buildSummary({ intent, cards, outputs, entities }) {
  const primary = cards.find(c => c.kind === 'primary')
  if (!primary) return '这次没凑出合适的建议，换个说法试试。'

  if (intent.type === 'gather') {
    const bundle = cards.find(c => c.kind === 'plan')
    if (bundle) return `${bundle.meta.dateStr || '待定'} · ${bundle.meta.headcount} 人 · ${bundle.desc}`
    const script = cards.find(c => c.id.startsWith('script_'))
    return script ? script.title : primary.title
  }

  if (intent.type === 'eat') {
    const dishes = cards.filter(c => c.id.startsWith('meal_')).map(c => c.title)
    return dishes.length ? `今天推荐：${dishes.join(' / ')}` : primary.title
  }

  return primary.title
}

module.exports = { orchestrate, detectIntent }
