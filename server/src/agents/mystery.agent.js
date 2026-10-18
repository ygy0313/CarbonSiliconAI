'use strict'

// 能力：开一局（原「剧本杀工坊」的推荐内核）
//
// 组局是个多约束问题：人数必须匹配、经验要匹配、时长要能接受、预算要兜住。
// 但「局」不只有一种形态 —— 这是本次改造的重点：
//
//   group  一群人凑一个本：人数是硬约束
//   solo   一个人开一局：不凑人，买的是「有结构的独处」
//   npc    缺人找 AI 补位：NPC 必须有立场、会隐瞒、能顶嘴，否则就是跟客服玩
//
// 三档共用一套评分骨架，但约束项不同：solo 不看人数，npc 把人数缺口交给 NPC 填。

const registry = require('./registry')
const { SCRIPT_LIBRARY, SOLO_LIBRARY, NPC_TEMPLATES } = require('../domain/taxonomy')

const LEVEL_ORDER = { 没玩过: 0, '1-3 次': 1, '3 次以上': 2, 老玩家: 3 }
const SCRIPT_LEVEL = { 新手: 0, 进阶: 1, 硬核: 2 }

function fmtDuration(min) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
}

// 稳定伪随机：同一个日期 + 同一个人，永远得到同一批 NPC（不会每次刷新都换人）
function seededPick(list, seed, count) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const pool = [...list]
  const out = []
  while (out.length < count && pool.length) {
    h = (h * 1103515245 + 12345) >>> 0
    out.push(pool.splice(h % pool.length, 1)[0])
  }
  return out
}

function resolveMode(ctx) {
  const mode = ctx.entities?.gatherMode
  if (mode) return mode
  if (ctx.entities?.headcount === 1 || ctx.entities?.scene === 'alone') return 'solo'
  return 'group'
}

// ── 单人局 ───────────────────────────────────────────────
function pickSolo(ctx) {
  const { facts, entities, tags } = ctx
  const budget = entities.budget || Number(facts['life.budget']) || 150
  const tone = ctx.outputs['fortune.today']?.meta?.tone?.level || 'steady'
  const rhythm = facts['life.rhythm'] || '正常'
  const wantsQuiet = /安静|放空|一个人待会|不想说话|静静/.test(ctx.rawText || '') || tone === 'draining' || tone === 'pressed'

  const scored = SOLO_LIBRARY.map(p => {
    let score = 0.55
    const why = []

    if (p.price === 0) {
      score += 0.1
      why.push('零成本，今晚就能开始')
    } else if (p.price > budget) {
      score -= 0.35
      why.push(`要 ${p.price} 元，超出你一个人的预算`)
    } else {
      score += 0.08
    }

    // 状态与强度匹配：今天偏耗就别推 110 分钟的单人本
    const heavy = p.minutes >= 100
    if (wantsQuiet && heavy) {
      score -= 0.22
      why.push(`${p.minutes} 分钟偏长，今天你未必坐得住`)
    } else if (wantsQuiet && p.minutes <= 80) {
      score += 0.18
      why.push(`今天偏耗，${p.minutes} 分钟刚好收个尾`)
    } else if (!wantsQuiet && heavy) {
      score += 0.1
      why.push(`${p.minutes} 分钟，够沉浸进去`)
    }

    // 夜猫子更适合音频/纸上推演这类不需要出门的
    if (rhythm === '夜猫子' && (p.kind === '音频' || p.kind === '零成本')) score += 0.06

    // 标签偏好
    if (tags.includes('新手局') && p.kind === '单人本') score -= 0.05

    return { play: p, score: Number(Math.max(0, Math.min(0.97, score)).toFixed(3)), why }
  }).sort((a, b) => b.score - a.score)

  const items = scored.slice(0, 3).map(({ play, score, why }, i) => ({
    id: `solo_${play.id}`,
    kind: i === 0 ? 'primary' : 'option',
    title: play.title,
    desc: `${play.kind} · ${fmtDuration(play.minutes)} · ${play.price ? `约 ${play.price} 元` : '零成本'} · 需要${play.needs.join('、')}`,
    why: why.slice(0, 3),
    evidence: [],
    score,
    source: '起居注 · 一个人的局',
    meta: {
      mode: 'solo',
      kind: play.kind,
      hook: play.hook,
      minutes: play.minutes,
      price: play.price,
      needs: play.needs,
      mood: play.mood,
    },
  }))

  return {
    items,
    meta: {
      mode: 'solo',
      headcount: 1,
      minutes: scored[0]?.play.minutes || 80,
      title: scored[0]?.play.title || '',
      price: scored[0]?.play.price || 0,
      needDM: false,
      tone,
    },
  }
}

// ── AI NPC 局 ─────────────────────────────────────────────
function pickNpc(ctx) {
  const { facts, entities, tags } = ctx
  const humans = Math.max(1, Number(entities.headcount) || 1)
  const npcCount = Math.min(4, Math.max(2, 5 - humans)) // 总人数凑到 4-5 人最舒服
  const total = humans + npcCount

  const experience = tags.includes('新手局') ? '没玩过' : facts['social.experience'] || '没玩过'
  const playerLevel = LEVEL_ORDER[experience] ?? 0
  const budget = entities.budget || Number(facts['life.budget']) || 150

  const fit = SCRIPT_LIBRARY
    .map(s => {
      let score = 0.5
      const why = []
      if (s.players.includes(total)) {
        score += 0.22
        why.push(`${total} 人（你 + ${npcCount} 个 NPC）正好`)
      } else if (s.players.some(p => Math.abs(p - total) === 1)) {
        score -= 0.12
        why.push(`${s.players.join('/')} 人本，${total} 人也能开`)
      } else {
        score -= 0.45
      }
      const gap = SCRIPT_LEVEL[s.level] - playerLevel
      if (gap > 1) score -= 0.3
      else if (gap <= 0) { score += 0.08; why.push(`${s.level}本，跟 AI 玩不丢人`) }
      if (s.price > budget) {
        score -= 0.2
        why.push(`人均 ${s.price} 超预算`)
      }
      // 没有 DM 的本更适合 NPC 自走
      if (!s.dm) { score += 0.08; why.push('不需要真人 DM，AI 能自己带') }
      return { script: s, score: Number(Math.max(0, Math.min(0.97, score)).toFixed(3)), why }
    })
    .filter(x => x.score > 0.2)
    .sort((a, b) => b.score - a.score)

  const top = fit[0]
  if (!top) return pickSolo(ctx)

  const seed = `${ctx.personId}|${new Date(ctx.now || Date.now()).toISOString().slice(0, 10)}`
  const cast = seededPick(NPC_TEMPLATES, seed, npcCount).map((n, i) => ({
    ...n,
    seat: i + 1,
    // 今天的节奏会影响 NPC 的态度：你被推着走的那天，NPC 也更难缠
    temperNow: ctx.outputs['fortune.today']?.meta?.tone?.level === 'pressed'
      ? `${n.temper}（今天他会更不耐烦）`
      : n.temper,
  }))

  const items = fit.slice(0, 2).map(({ script, score, why }, i) => ({
    id: `script_${script.id}`,
    kind: i === 0 ? 'primary' : 'option',
    title: `《${script.title}》`,
    desc: `${total} 人（含 ${npcCount} 个 AI）· ${script.level} · ${fmtDuration(script.minutes)} · 人均 ${script.price} 元`,
    why: why.slice(0, 3),
    evidence: [],
    score,
    source: '起居注 · AI 陪局',
    meta: {
      mode: 'npc',
      headcount: total,
      humans,
      npcCount,
      cast,
      genres: script.genres,
      hook: script.hook,
      needDM: false,
      headcountFit: script.players,
      minutes: script.minutes,
      price: script.price,
      level: script.level,
    },
  }))

  return {
    items,
    meta: {
      mode: 'npc',
      headcount: total,
      humans,
      npcCount,
      cast,
      minutes: top.script.minutes,
      title: `《${top.script.title}》`,
      price: top.script.price,
      needDM: false,
      playerLevel: experience,
    },
  }
}

// ── 一群人凑本（原有逻辑）─────────────────────────────────
function pickGroup(ctx) {
  const { facts, entities, tags } = ctx
  const calendar = ctx.outputs['calendar.check']?.meta || {}

  const headcount = entities.headcount || Number(facts['social.groupSize']) || 6

  // 本次说法优先于历史档案：说了「没玩过的多」，就按新手局算
  const experience = tags.includes('新手局')
    ? '没玩过'
    : tags.includes('老手局')
      ? '3 次以上'
      : facts['social.experience'] || null
  const playerLevel = LEVEL_ORDER[experience] ?? 1

  const prefs = []
  if (facts['social.preference']) {
    prefs.push(...String(facts['social.preference']).split(/[,，、\s]+/).filter(Boolean))
  }
  for (const g of entities.genres || []) if (!prefs.includes(g)) prefs.push(g)

  const budget = entities.budget || Number(facts['life.budget']) || null
  const isBirthday = tags.includes('生日局')

  const scored = SCRIPT_LIBRARY.map(s => {
    let score = 0.45
    const why = []
    const blockers = []

    // ① 人数：硬约束
    if (!s.players.includes(headcount)) {
      const near = s.players.some(p => Math.abs(p - headcount) === 1)
      if (near) {
        score -= 0.18
        why.push(`标准 ${s.players.join('/')} 人，${headcount} 人也能开，但要去掉一个边缘角色`)
      } else {
        score -= 0.8
        blockers.push(`需要 ${s.players.join('/')} 人`)
      }
    } else {
      score += 0.2
      why.push(`正好 ${headcount} 人开`)
    }

    // ② 经验：新手别推硬核，老玩家别推太浅的
    const gap = SCRIPT_LEVEL[s.level] - playerLevel
    if (gap > 1) {
      score -= 0.4
      why.push(`${s.level}本，对你这次的人来说太难`)
    } else if (gap === 1) {
      score -= 0.1
      why.push(`${s.level}本，有点挑战但能玩`)
    } else if (gap <= 0) {
      score += 0.1
      if (s.level === '新手' && playerLevel >= 2) why.push('新手本，老玩家会觉得轻松')
    }
    if (playerLevel === 0 && s.level === '新手') score += 0.08

    // ③ 题材：命中加分，不命中要扣分（否则「欢乐本」会靠预算优势冲上来）
    const hit = s.genres.filter(g => prefs.includes(g))
    if (hit.length) {
      score += 0.15 * Math.min(2, hit.length)
      why.push(`你偏好${hit.join('、')}题材`)
    } else if (prefs.length) {
      score -= 0.1
      why.push(`题材是${s.genres.join('、')}，和你平时的偏好不同`)
    }

    // ④ 时长
    if (s.minutes >= 280) {
      score -= 0.1
      why.push(`要 ${fmtDuration(s.minutes)}，${calendar.dateStr || '当天'}得早点开`)
    }
    if (s.minutes <= 160) score += 0.05

    // ⑤ 预算
    if (budget && s.price > budget) {
      score -= Math.min(0.4, ((s.price - budget) / budget) * 0.5)
      why.push(`人均 ${s.price} 超了预算`)
    } else if (budget) {
      score += 0.05
    }

    // ⑥ 场景修正
    if (isBirthday && s.genres.includes('欢乐')) {
      score += 0.14
      why.push('生日局，欢乐本不容易冷场')
    }
    if (headcount >= 7 && s.dm) {
      score += 0.04
      why.push('人多有 DM 控场更稳')
    }

    return { script: s, score: Number(Math.max(0, Math.min(0.98, score)).toFixed(3)), why, blockers }
  }).sort((a, b) => b.score - a.score || a.script.id.localeCompare(b.script.id))

  const playable = scored.filter(s => s.blockers.length === 0)
  const pool = (playable.length ? playable : scored).slice(0, 2)

  const top = pool[0]
  function contrast(script) {
    if (!top || top.script.id === script.id) return ''
    const bits = []
    if (script.minutes < top.script.minutes) {
      bits.push(`比《${top.script.title}》短 ${top.script.minutes - script.minutes} 分钟`)
    } else if (script.minutes > top.script.minutes) {
      bits.push(`比《${top.script.title}》多 ${script.minutes - top.script.minutes} 分钟`)
    }
    const dPrice = script.price - top.script.price
    if (dPrice < 0) bits.push(`人均便宜 ${-dPrice} 元`)
    else if (dPrice > 0) bits.push(`人均贵 ${dPrice} 元`)
    if (!bits.length) bits.push('难度和第一名接近，可以按题材挑')
    return bits.join('，')
  }

  const items = pool.map(({ script, score, why }, i) => {
    const c = contrast(script)
    return {
      id: `script_${script.id}`,
      kind: i === 0 ? 'primary' : 'option',
      title: `《${script.title}》`,
      desc: `${script.players.join('/')} 人 · ${script.level} · ${fmtDuration(script.minutes)} · 人均 ${script.price} 元`,
      why: (c ? [c, ...why] : why).slice(0, 3),
      evidence: [],
      score,
      source: '剧本杀工坊 · 开本',
      meta: {
        mode: 'group',
        genres: script.genres,
        hook: script.hook,
        needDM: script.dm,
        headcountFit: script.players,
        minutes: script.minutes,
        price: script.price,
        level: script.level,
      },
    }
  })

  const blocked = scored.find(s => s.blockers.length && s.score > 0.2)
  const excludeNote = blocked ? `没推《${blocked.script.title}》：${blocked.blockers[0]}` : ''

  return {
    items,
    meta: {
      mode: 'group',
      headcount,
      playerLevel: experience || '未知',
      prefs,
      excludeNote,
      totalCandidates: SCRIPT_LIBRARY.length,
      minutes: pool[0]?.script.minutes || 180,
      title: pool[0] ? `《${pool[0].script.title}》` : '',
      price: pool[0]?.script.price || 0,
      needDM: pool[0]?.script.dm ?? false,
    },
  }
}

async function run(ctx) {
  const mode = resolveMode(ctx)
  if (mode === 'solo') return pickSolo(ctx)
  if (mode === 'npc') return pickNpc(ctx)
  return pickGroup(ctx)
}

registry.register({
  id: 'mystery.pick',
  service: '起居注 · 开一局',
  name: '组局选本',
  icon: '🎭',
  description: '按人数、经验、题材、时长、预算挑本；支持一个人玩、跟 AI 玩、一群人玩',
  intents: ['gather'],
  needs: ['context.calendar', 'context.fortune', 'profile.social'],
  provides: ['scripts'],
  cost: 'free',
  run,
})

module.exports = { run, resolveMode }
