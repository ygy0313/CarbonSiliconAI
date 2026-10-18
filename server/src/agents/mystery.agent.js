'use strict'

// 能力：剧本杀选本（原「剧本杀工坊」的推荐内核）
//
// 组局是个多约束问题：人数必须匹配、经验要匹配、时长要能接受、预算要兜住。
// 给 2-3 个本 + 一句「为什么不是别的」，比堆 8 个结果有用。

const registry = require('./registry')
const { SCRIPT_LIBRARY } = require('../domain/taxonomy')

const LEVEL_ORDER = { 没玩过: 0, '1-3 次': 1, '3 次以上': 2, 老玩家: 3 }
const SCRIPT_LEVEL = { 新手: 0, 进阶: 1, 硬核: 2 }

function fmtDuration(min) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
}

async function run(ctx) {
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

    // 同类理由只留最强一条
    return { script: s, score: Number(Math.max(0, Math.min(0.98, score)).toFixed(3)), why, blockers }
  }).sort((a, b) => b.score - a.score || a.script.id.localeCompare(b.script.id))

  const playable = scored.filter(s => s.blockers.length === 0)
  const pool = (playable.length ? playable : scored).slice(0, 2)

  // 备选给「跟第一名比差在哪」，而不是复述同一套话
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

registry.register({
  id: 'mystery.pick',
  service: '剧本杀工坊',
  name: '剧本杀选本',
  icon: '🎭',
  description: '按人数、经验、题材、时长、预算挑本，并说明为什么不是别的',
  intents: ['gather'],
  needs: ['context.calendar', 'profile.social'],
  provides: ['scripts'],
  cost: 'free',
  run,
})

module.exports = { run }
