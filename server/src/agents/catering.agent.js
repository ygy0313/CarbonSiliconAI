'use strict'

// 能力：茶歇/餐饮配套
// 组局最容易漏的一环。这里做的是「按人均预算和口味给一个组合」，
// 并主动避开档案里记着的忌口与肠胃问题。

const registry = require('./registry')
const { CATERING_LIBRARY } = require('../domain/taxonomy')

async function run(ctx) {
  const { facts, entities } = ctx
  const headcount = entities.headcount || Number(facts['social.groupSize']) || 6
  const budget = entities.budget || null
  const spicy = facts['diet.spicy'] || null
  const stomach = facts['diet.stomach'] || null

  // 人均场地+本钱已占掉一部分，茶歇预算按剩余估算
  const perPersonLeft = budget ? Math.max(10, Math.round(budget * 0.25)) : null

  const scored = CATERING_LIBRARY.map(c => {
    let score = 0.5
    const why = []

    if (perPersonLeft && c.perPerson > perPersonLeft) {
      score -= Math.min(0.5, ((c.perPerson - perPersonLeft) / perPersonLeft) * 0.5)
      why.push(`人均 ${c.perPerson} 元，略超剩余预算`)
    } else {
      score += 0.1
    }

    if (headcount >= 6) { score += 0.06 }
    if (c.tags.includes('不脏手')) { score += 0.1; why.push('不脏手，不影响翻本') }
    if (c.tags.includes('管饱') && /晚|夜/.test(entities.time?.label || '')) { score += 0.1 }

    // 有胃敏感史的人在场，酒局降权
    if (c.tags.includes('成人局') && stomach === '偏敏感') {
      score -= 0.2
      why.push('你肠胃偏敏感，酒局要留量')
    }
    if (spicy === '不吃辣' && c.tags.includes('成人局')) score -= 0.05

    return { c, score: Number(Math.max(0, Math.min(1, score)).toFixed(3)), why }
  }).sort((a, b) => b.score - a.score)

  const items = scored.slice(0, 2).map(({ c, score, why }, i) => ({
    id: `catering_${c.id}`,
    kind: i === 0 ? 'primary' : 'option',
    title: c.name,
    desc: `人均 ${c.perPerson} 元 · ${headcount} 人合计约 ${c.perPerson * headcount} 元`,
    why: why.length ? why.slice(0, 3) : ['预算内最稳的组合'],
    evidence: [],
    score,
    source: '本地生活 · 茶歇',
    meta: { perPerson: c.perPerson, total: c.perPerson * headcount, tags: c.tags },
  }))

  return { items, meta: { headcount, perPersonLeft } }
}

registry.register({
  id: 'catering.suggest',
  service: '本地生活',
  name: '茶歇配套',
  icon: '🍵',
  description: '按预算与忌口给茶歇组合，避开酒与辣',
  intents: ['gather'],
  needs: ['profile.diet'],
  provides: ['context.catering'],
  cost: 'free',
  run,
})

module.exports = { run }
