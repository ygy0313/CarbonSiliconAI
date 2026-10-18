'use strict'

// 能力：场地推荐（组局落地的那一半）
// 只做「就近 + 装得下人 + 预算内」的判断，不假装知道实时空房。

const registry = require('./registry')
const { VENUE_LIBRARY } = require('../domain/taxonomy')

async function run(ctx) {
  const { facts, entities, tags } = ctx
  const headcount = entities.headcount || Number(facts['social.groupSize']) || 6
  const city = facts['life.city'] || '银川'
  const budget = entities.budget || null
  const isBirthday = tags.includes('生日局')

  const pool = VENUE_LIBRARY.filter(v => v.city === city || v.price === 0)
  const scored = pool.map(v => {
    let score = 0.5
    const why = []

    if (v.capacity < headcount) { score -= 0.7; why.push(`最多 ${v.capacity} 人，坐不下`) }
    else if (v.capacity === headcount) { score += 0.1 }
    else { score += 0.12; why.push(`能容纳 ${v.capacity} 人，${headcount} 人不挤`) }

    // 距离：3km 内加分，5km 以上减分
    if (v.distanceKm <= 2) { score += 0.15; why.push(`离你 ${v.distanceKm}km，走过去就行`) }
    else if (v.distanceKm <= 4) score += 0.08
    else if (v.distanceKm > 5) score -= 0.08

    score += (v.rating - 4.5) * 0.15
    if (v.rating >= 4.7) why.push(`评分 ${v.rating.toFixed(1)}`)

    if (budget && v.price > budget * 0.6) { score -= 0.12; why.push('场地费占预算比例偏高') }
    if (isBirthday && v.tags.includes('包间')) { score += 0.1; why.push('有包间，生日局不被打扰') }
    if (v.price === 0) why.push('零成本，熟人局最省')

    return { v, score: Number(Math.max(0, Math.min(1, score)).toFixed(3)), why }
  }).sort((a, b) => b.score - a.score)

  const items = scored.slice(0, 2).map(({ v, score, why }, i) => ({
    id: `venue_${v.id}`,
    kind: i === 0 ? 'primary' : 'option',
    title: v.name,
    desc: `${v.capacity} 人 · ${v.price ? `人均 ${v.price} 元` : '免费'} · ${v.distanceKm ? `${v.distanceKm}km` : '自己家'}`,
    why: why.length ? why.slice(0, 3) : ['综合评价最稳'],
    evidence: [],
    score,
    source: '本地生活 · 场地',
    meta: { tags: v.tags, rating: v.rating, price: v.price },
  }))

  return { items, meta: { headcount, city } }
}

registry.register({
  id: 'venue.suggest',
  service: '本地生活',
  name: '场地推荐',
  icon: '📍',
  description: '按人数、距离、预算、场景推荐可开本的场地',
  intents: ['gather'],
  needs: ['context.calendar'],
  provides: ['context.venue'],
  cost: 'free',
  run,
})

module.exports = { run }
