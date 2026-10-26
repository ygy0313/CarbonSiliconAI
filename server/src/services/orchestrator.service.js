'use strict'

// 编排器：整个产品的调度中枢。
//
// 一次编排 = 意图识别 → 能力召回 → 依赖解析 → 分层并行执行 → 仲裁合并 → 落库
// 每次编排都留完整 trace，前端可以逐帧播放「执笔在怎么想」。

const registry = require('../agents/registry')
const experienceService = require('./experience.service')
const { INTENTS } = require('../domain/taxonomy')
const { compileSilicon, recall } = require('./profile.service')
const log = require('../logger')

const AGENT_TIMEOUT_MS = 4000

const MODE_LABEL = {
  solo: '一个人开一局',
  npc: '跟 AI 凑一局',
  group: '一群人玩',
}

// 确保所有能力被加载并注册（副作用 import）
require('../agents/fortune.agent')
require('../agents/weather.agent')
require('../agents/calendar.agent')
require('../agents/meal.agent')
require('../agents/mystery.agent')
require('../agents/venue.agent')
require('../agents/catering.agent')
require('../agents/wine.agent')
require('../agents/dream.agent')

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

/**
 * 判断「局」的形态。
 * 用户不必学会选模式 —— 从这句话里读出来：
 *   「一个人」「自己待会」→ solo
 *   「和 AI」「找 NPC 陪我」→ npc
 *   其余 → group
 */
function detectGatherMode(text, entities = {}) {
  const t = String(text || '')
  if (/和\s*(?:AI|ai|机器人|NPC|npc|虚拟人)|找\s*(?:AI|NPC)|AI\s*陪|陪玩|人不够/.test(t)) return 'npc'
  if (entities.headcount === 1 || entities.scene === 'alone') return 'solo'
  if (/一个人|自己玩|独自|不想叫人|没人陪/.test(t)) return 'solo'
  return 'group'
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
  let intent = detectIntent(text)
  // 前端显式给了时段（早/午/茶歇/晚/宵），那就是在问吃的 —— 时段本身就是强信号，
  // 不能因为文案里没写「吃」字就判成「还没听懂」，首页会因此空白。
  const hasSlot = !!(opts.entities && opts.entities.mealType)
  if (hasSlot && intent.type !== 'eat' && intent.type !== 'gather' && intent.type !== 'drink') {
    intent = {
      type: 'eat',
      label: '今天吃什么',
      service: '给您请安',
      confidence: Math.max(intent.confidence, 0.7),
      matched: intent.matched.concat(['时段']),
      secondary: null,
      bySlot: true,
    }
  }
  push('intent', `识别意图：${intent.label}`, { detail: intent.matched.join('、'), confidence: intent.confidence })

  // ── 2. 编译人格包──
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

  // 局的形态（solo / npc / group）必须在执行前定下来，
  // 因为选本、场地、茶歇三个能力的行为都取决于它。
  const entities = { ...(opts.entities || {}) }
  if (intent.type === 'gather') {
    entities.gatherMode = detectGatherMode(text, entities)
    push('mode', `局的形态：${MODE_LABEL[entities.gatherMode]}`, { detail: entities.gatherMode })
  }

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
    entities,
    tags: opts.tags || [],
    rawText: text,
    now,
    // 定位（可选）：由接口层用 domain/geo.normalizeGeo 归一化后传入，
    // 城市优先于档案里的 life.city —— 人在哪就按哪推荐。
    geo: opts.geo || null,
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

  // ── 6. 经验：这个情境下，你以前是怎么判断的 ──
  // 必须放在仲裁之前。经验如果只在结果出来后贴一张标签，那它对结果毫无影响，
  // 「经验资产」就是装饰品。先取经验，再让它参与排序，才叫调用。
  let experience = { source: 'none', items: [], considered: 0, ms: 0 }
  try {
    experience = await experienceService.retrieve(repos, personId, {
      tags: ctx.tags,
      scene: ctx.entities.gatherMode || sceneOfIntent(intent),
      intent: intent.type,
      text,
    })
  } catch (err) {
    log.warn('经验检索失败，本次不注入', { error: err.message })
  }
  if (experience.items.length) {
    push('experience', `调出 ${experience.items.length} 条经验`, {
      detail: experience.items.map(i => i.readability).join(' / ').slice(0, 70),
    })
  }

  // ── 7. 合并仲裁（经验在这里生效）──
  const cards = compose({ outputs, intent, silicon, facts, entities: ctx.entities, experience: experience.items })
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
    // 卡片快照：反思要靠它还原「当时给了什么、用户选了哪个」。
    // 只存轻量字段，不存整张卡的 meta（时间线/待办那种展示数据反思用不上）。
    cards: cards.map(c => ({
      id: c.id,
      title: c.title,
      kind: c.kind,
      source: c.source,
      experienceIds: c.experienceIds || [],
    })),
    experienceIds: cards.flatMap(c => c.experienceIds || []),
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
    experience: {
      source: experience.source,
      ms: experience.ms,
      count: experience.items.length,
      items: experience.items,
    },
    trace,
    totalMs: Date.now() - startedAt,
  }
}

/**
 * 经验加权：命中的选项提到第一位，并标上「你以前选过」。
 *
 * 只动顺序和 kind，不动内容 —— 推荐的事实依据（评分、理由、溯源）保持原样，
 * 用户看到的仍然是 agent 的判断，只是被自己的历史偏好修正了顺序。
 */
function applyExperienceBoost(cards, items) {
  if (!items.length || !cards.length) return cards

  const norm = s => String(s || '').replace(/[《》（）()\s·]/g, '')
  const out = cards.slice()

  for (const item of items) {
    if (item.action === 'avoid') continue
    const target = norm(item.title)
    if (!target) continue

    const idx = out.findIndex(c => {
      const t = norm(c.title)
      return t === target || t.includes(target) || target.includes(t)
    })
    if (idx < 0) continue

    const hit = out.splice(idx, 1)[0]
    hit.kind = 'primary'
    hit.experienceIds = [item.id]
    hit.experience = [{ id: item.id, rule: item.rule, readability: item.readability, effectiveness: item.effectiveness, why: item.why }]
    hit.why = [`你以前在这类情境下选过它，${item.why || '效果不错'}`, ...(hit.why || [])].slice(0, 4)
    out.unshift(hit)
    break // 只提升一条，多了会变成「经验说了算」，agent 的判断就没意义了
  }

  return out
}

/** 意图 → 场景码，让经验的触发条件和组的局用同一套词 */
function sceneOfIntent(intent) {
  if (intent.type === 'gather') return 'group'
  if (intent.type === 'eat') return 'solo'
  return 'daily'
}

/** 把经验挂到主方案上：只挂前两条，多了会把卡片挤爆 */
function attachExperience(cards, items) {
  const host = cards.find(c => c.kind === 'plan') || cards.find(c => c.kind === 'primary') || cards[0]
  if (!host) return
  const top = items.slice(0, 2)
  host.experienceIds = top.map(i => i.id)
  host.experience = top.map(i => ({
    id: i.id,
    rule: i.rule,
    readability: i.readability,
    effectiveness: i.effectiveness,
    why: i.why,
  }))
  host.why = [...(host.why || []), ...top.map(i => `你以前总结过：${i.readability}`)].slice(0, 4)
}

/**
 * 仲裁合并：
 *   1) context 类沉底（作为「为什么这么选」的附属信息）
 *   2) primary 优先，option 依次
 *   3) 跨 agent 同类去重（按标题归一）
 *   4) gather 场景拼总预算
 */
function compose({ outputs, intent, silicon, facts, entities, experience = [] }) {
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

  // 经验参与仲裁：把「你以前在这类情境下选过的」提到最前。
  // 只提升已经存在的候选，不凭空造卡片 —— 经验是判据，不是商品。
  deduped.splice(0, deduped.length, ...applyExperienceBoost(deduped, experience))

  // gather 场景：把三条独立推荐「组装成一个局」。
  // 这是多 agent 协同真正的产出物 —— 用户要的不是三个选项，是一份能照着做的安排。
  if (intent.type === 'gather') {
    const mode = entities.gatherMode || 'group'
    // 一个人的局里，包间和多人本毫无意义。先剔除，再组装 ——
    // 否则会给出「一个人去订 6 人包间」这种荒唐建议。
    const pool = mode === 'solo'
      ? deduped.filter(c => !['venue_', 'catering_', 'script_'].some(p => c.id.startsWith(p)))
      : deduped

    const bundle = buildGatherBundle({ cards: pool, outputs, entities, facts, mode })
    if (bundle) return [bundle, ...pool]
    return pool
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
 * 组装「一个完整的局」。三种形态共用同一个出口，但拼的东西不同：
 *   group —— 本 + 场地 + 茶歇 + 时间线 + 待办
 *   solo  —— 玩法 + 前置条件 + 时间线（不含场地、不含凑人）
 *   npc   —— 本 + NPC 班底（姓名/身份/性格/台词/秘密）+ 互动节奏
 * 任何一部分缺失都能降级，不会因为某个 agent 挂了就拼不出来。
 */
function buildGatherBundle({ cards, outputs, entities, facts, mode }) {
  const play = cards.find(c => c.id.startsWith('script_') || c.id.startsWith('solo_'))
  if (!play) return null

  if (mode === 'solo') return buildSoloBundle({ play, outputs, facts, entities })
  if (mode === 'npc') return buildNpcBundle({ play, outputs, facts, entities })
  return buildGroupBundle({ play, cards, outputs, facts, entities })
}

// ── 一个人的局 ──
function buildSoloBundle({ play, outputs, facts, entities }) {
  const cal = outputs['calendar.check']?.meta
  const fortune = outputs['fortune.today']?.meta
  const minutes = Number(play.meta.minutes) || 80
  const price = Number(play.meta.price) || 0
  const needs = play.meta.needs || []

  // 一个人玩不必赶早，夜猫子再往后挪
  const startAt = facts['life.rhythm'] === '夜猫子' ? '21:30' : '20:30'
  const prepAt = addMinutes(startAt, -15)
  const endAt = addMinutes(startAt, minutes)
  const doneAt = addMinutes(endAt, 10)

  const timeline = [
    { time: prepAt, text: `${needs.length ? `备好${needs.join('、')}，` : ''}手机调静音，别开着群消息` },
    { time: startAt, text: `开始：${play.meta.hook || play.title}` },
    { time: endAt, text: '停下来，写三句话：哪一刻你觉得不对劲' },
    { time: doneAt, text: '收工。今天到这儿就够，不用一次玩完' },
  ]

  const todos = [
    `${needs.length ? `准备：${needs.join('、')}` : '找个安静角落'}`,
    '跟家里人说一声这半小时别叫你',
    '中途不刷手机 —— 这是唯一一条硬规矩',
  ]

  const why = [...(play.why || [])]
  if (fortune?.tone) why.push(`今天整体${fortune.tone.label}，${fortune.tone.advice}`)

  return {
    id: 'plan_solo',
    kind: 'plan',
    title: `一个人的局 · ${cal?.dayOfWeek || '今晚'}`,
    desc: `${play.title} · ${fmtDur(minutes)} · ${price ? `约 ${price} 元` : '零成本'}${needs.length ? ` · 需要${needs.join('、')}` : ''}`,
    why: why.slice(0, 3),
    evidence: [],
    score: play.score,
    source: '起居注 · 一个人也能开一局',
    meta: {
      mode: 'solo',
      date: cal?.date,
      dateStr: cal?.dateStr,
      conflict: !!cal?.conflict,
      booked: cal?.count || 0,
      headcount: 1,
      totalPerPerson: price,
      parts: [play.id],
      timeline,
      todos,
      tone: fortune?.tone || null,
      missing: [],
    },
  }
}

// ── 跟 AI 凑一局 ──
function buildNpcBundle({ play, outputs, facts, entities }) {
  const cal = outputs['calendar.check']?.meta
  const fortune = outputs['fortune.today']?.meta
  const minutes = Number(play.meta.minutes) || 180
  const price = Number(play.meta.price) || 0
  const cast = play.meta.cast || []
  const humans = play.meta.humans || 1

  const startAt = facts['life.rhythm'] === '夜猫子' ? '20:30' : '20:00'
  const readAt = addMinutes(startAt, -30)
  const midAt = addMinutes(startAt, Math.round(minutes * 0.45))
  const endAt = addMinutes(startAt, minutes)

  const timeline = [
    { time: readAt, text: `读本，顺手给每个 NPC 记一句「他可能在瞒什么」` },
    { time: startAt, text: `开局，${cast.map(c => c.name).join('、')} 依次开口` },
    { time: midAt, text: '挑一个最可疑的单独问话，别一次问完' },
    { time: addMinutes(endAt, -10), text: '指认。NPC 会狡辩，这是设计好的' },
    { time: endAt, text: '看复盘，对一下你漏了哪条线' },
  ]

  const todos = [
    `定规矩：NPC 不许替你做决定，只能回答和演戏`,
    cast.length ? `先认人：${cast.map(c => `${c.name}（${c.role}）`).join(' / ')}` : '先认人',
    '准备纸笔，记时间线 —— 跟 AI 玩也逃不掉做笔记',
    '关掉群消息，NPC 会抢你的注意力',
  ]

  const why = []
  if (fortune?.tone) why.push(`今天${fortune.tone.label}，${fortune.tone.advice}`)
  why.push(`${humans} 个人 + ${cast.length} 个 NPC，凑齐 ${play.meta.headcount} 人，不用等人凑局`)
  why.push('不需要真人 DM，规则由 AI 自己守')

  return {
    id: 'plan_npc',
    kind: 'plan',
    title: `你 + ${cast.length} 个 AI · ${cal?.dayOfWeek || '今晚'}`,
    desc: `${play.title.replace(/[《》]/g, '')} · ${play.meta.headcount} 人（含 ${cast.length} 个 NPC）· ${fmtDur(minutes)} · 人均 ${price} 元`,
    why: why.slice(0, 3),
    evidence: [],
    score: play.score,
    source: '起居注 · AI 陪局',
    meta: {
      mode: 'npc',
      date: cal?.date,
      dateStr: cal?.dateStr,
      conflict: !!cal?.conflict,
      booked: cal?.count || 0,
      headcount: play.meta.headcount,
      humans,
      totalPerPerson: price,
      cast,
      parts: [play.id],
      timeline,
      todos,
      tone: fortune?.tone || null,
      missing: [],
    },
  }
}

// ── 一群人凑本 ──
function buildGroupBundle({ play: script, cards, outputs, facts, entities }) {
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
  else if (venue) why.push(`${venue.title.replace(/（.*?）/g, '')}离你近，散场不折腾`)
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
      mode: 'group',
      date: cal?.date,
      dateStr: cal?.dateStr,
      conflict: !!cal?.conflict,
      booked: cal?.count || 0,
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
    if (bundle) {
      const when = bundle.meta.dateStr || '今晚'
      if (bundle.meta.mode === 'solo') return `${when} · 一个人 · ${bundle.desc}`
      if (bundle.meta.mode === 'npc') {
        const n = (bundle.meta.cast || []).length
        return `${when} · 你 + ${n} 个 AI · ${bundle.desc}`
      }
      return `${when} · ${bundle.meta.headcount} 人 · ${bundle.desc}`
    }
    const script = cards.find(c => c.id.startsWith('script_'))
    return script ? script.title : primary.title
  }

  if (intent.type === 'eat') {
    const dishes = cards.filter(c => c.id.startsWith('meal_')).map(c => c.title)
    return dishes.length ? `今天推荐：${dishes.join(' / ')}` : primary.title
  }

  if (intent.type === 'gift' || intent.type === 'drink') {
    // 酒和菜可能同时被召回（「喝点什么」两个能力都命中），但摘要只能有一句人话：
    // 有酒就说酒，没酒才退回菜 —— 「干白配疙瘩汤」这种拼接宁可不要。
    const wineCard = cards.find(c => c.id.startsWith('wine_'))
    if (wineCard) return `${intent.type === 'gift' ? '送这瓶' : '这瓶'}：${wineCard.title}`
    const dishes = cards.filter(c => c.id.startsWith('meal_')).map(c => c.title)
    return dishes.length ? `今天推荐：${dishes.join(' / ')}` : primary.title
  }

  if (intent.type === 'dream') {
    const motif = cards.find(c => c.id.startsWith('dream_') && c.id !== 'dream_story')
    return motif ? motif.title : primary.title
  }

  return primary.title
}

module.exports = { orchestrate, detectIntent, detectGatherMode }
