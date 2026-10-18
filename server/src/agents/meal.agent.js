'use strict'

// 能力：今日膳食（原「给您请安 · 御膳坊」的推荐内核）
//
// 打分全部可解释：每一条推荐都必须能回答「为什么是它」，
// 且理由要能引用到具体记忆 —— 否则推荐就是个黑箱。
//
// 理由生成策略：每条理由带 category 与 strength，同类只取最强的一条，
// 最后按 strength 排序取前 3。这样三道菜的理由不会长得一模一样。

const registry = require('./registry')
const { DISH_LIBRARY } = require('../domain/taxonomy')

const SPICY_TARGET = { 不吃辣: 0, 微辣: 1, 中辣: 2, 重辣: 3 }
const SPICY_LABEL = ['不辣', '微辣', '中辣', '重辣']
const BODY_TAGS = ['胃敏感', '上火', '没胃口', '乏力', '失眠', '宿醉']

function recentEpisodes(repos, personId, days) {
  const since = Date.now() - days * 86400000
  return repos.episode.byPerson(personId, 100).filter(e => new Date(e.ts).getTime() >= since)
}

function wasEatenRecently(text, dishName) {
  if (!text) return false
  return text.includes(dishName) || text.includes(dishName.slice(0, 4)) || text.includes(dishName.slice(-3))
}

async function run(ctx) {
  const { facts, entities, tags, repos, personId } = ctx
  const fortune = ctx.outputs['fortune.today']?.meta || {}
  const weather = ctx.outputs['weather.now']?.meta || {}

  const spicyPref = facts['diet.spicy'] || null
  const targetSpicy = SPICY_TARGET[spicyPref] ?? null
  const stomach = facts['diet.stomach'] || null
  const tastePref = facts['diet.taste'] || null
  const avoid = String(facts['diet.avoid'] || '').split(/[,，、\s]+/).filter(Boolean)
  const budget = entities.budget || Number(facts['life.budget']) || null
  const headcount = entities.headcount || 1
  const scene = entities.scene || (headcount === 1 ? 'alone' : null)

  // 身体状态：本次记录优先，其次近 3 天记忆
  const recent3 = recentEpisodes(repos, personId, 3)
  const week = recentEpisodes(repos, personId, 7)
  const symptoms = new Set(tags.filter(t => BODY_TAGS.includes(t)))
  for (const e of recent3) for (const t of e.tags || []) if (BODY_TAGS.includes(t)) symptoms.add(t)

  const scored = DISH_LIBRARY.map(dish => {
    let score = 0.5
    const reasons = []
    const evidence = []
    const add = (category, strength, text) => reasons.push({ category, strength, text })

    // ① 辣度：超耐受是硬伤，胃不好时更狠
    if (targetSpicy !== null) {
      const gap = dish.spicy - targetSpicy
      if (gap <= 0) {
        score += 0.06
        add('spicy', 0.06, `${SPICY_LABEL[dish.spicy]}，在你「${spicyPref}」的耐受里`)
      } else if (gap === 1) {
        score -= stomach === '偏敏感' ? 0.3 : 0.12
        add('spicy', 0.3, `微辣偏上，你平时只到${spicyPref}`)
      } else {
        score -= stomach === '偏敏感' ? 0.55 : 0.35
        add('spicy', 0.55, `${SPICY_LABEL[dish.spicy]}，明显超出你的耐受`)
      }
    }

    // ② 身体状态
    for (const s of symptoms) {
      if ((dish.helps || []).includes(s)) {
        score += 0.16
        add('body', 0.16, `${s === '胃敏感' ? '胃不舒服' : s}的时候，这道最稳妥`)
      }
      if ((dish.pains || []).includes(s)) {
        score -= 0.4
        add('body', 0.4, `${s === '胃敏感' ? '辣和油会刺激胃' : `不适合${s}的状态`}`)
      }
    }

    // ③ 口味倾向
    if (tastePref && dish.taste) {
      const tasteMap = { 清淡: '甘', 咸鲜: '咸', 重口: '辛', 偏甜: '甘' }
      if (tasteMap[tastePref] === dish.taste) {
        score += 0.1
        add('taste', 0.1, `你偏好${tastePref}，这是${dish.taste}味`)
      }
    }

    // ④ 今日宜味
    if (fortune.favorableTaste && dish.taste === fortune.favorableTaste) {
      score += 0.08
      add('fortune', 0.08, `今日宜${fortune.favorableTaste}味，正好对上`)
    }
    if (fortune.avoidTaste && dish.taste === fortune.avoidTaste) {
      score -= 0.06
    }

    // ⑤ 天气
    if (weather.feels === '冷' && dish.element === '土' && dish.load !== 'light') {
      score += 0.08
      add('weather', 0.08, `外面 ${weather.temp}°C，热汤热食顶得住`)
    }
    if (weather.feels === '热' && ['木', '水'].includes(dish.element)) {
      score += 0.07
      add('weather', 0.07, `天热，清爽的更下口`)
    }

    // ⑥ 场景
    if (scene === 'alone') {
      if (dish.price <= 30) {
        score += 0.09
        add('scene', 0.09, `一个人吃，${dish.price} 元的份量刚好`)
      }
      if (dish.min <= 25) {
        score += 0.05
        add('speed', 0.05, `${dish.min} 分钟能上桌`)
      }
      if (dish.load === 'heavy') score -= 0.1
    } else if (['friends', 'family', 'colleagues'].includes(scene)) {
      if (dish.price >= 40) {
        score += 0.08
        add('scene', 0.08, `${headcount} 个人，这道能摆上桌`)
      }
      if ((dish.helps || []).includes('待客')) {
        score += 0.08
        add('scene', 0.08, '待客拿得出手')
      }
    }

    // ⑦ 预算
    if (budget && dish.price > budget) {
      const over = (dish.price - budget) / budget
      score -= Math.min(0.45, over * 0.4)
      if (over > 0.3) add('budget', 0.3, `人均 ${dish.price}，超了你 ${budget} 的预算`)
    } else if (budget) {
      add('budget', 0.04, `人均 ${dish.price}，在 ${budget} 预算内`)
    }

    // ⑧ 时间
    if (entities.mealType === 'late' && dish.load !== 'light') {
      score -= 0.15
      add('time', 0.15, '夜宵吃这个，睡不好')
    }
    if (entities.mealType === 'breakfast' && dish.price > 30) score -= 0.2

    // ⑨ 记忆：近 7 天吃过的降权
    const eaten = week.find(e => wasEatenRecently(e.text, dish.name))
    if (eaten) {
      score -= 0.28
      const days = Math.max(1, Math.round((Date.now() - new Date(eaten.ts).getTime()) / 86400000))
      add('memory', 0.28, `${days} 天前刚吃过，换一个`)
      evidence.push({ episodeId: eaten.id, ts: eaten.ts, text: brief(eaten) })
    }

    // ⑩ 忌口：直接出局
    if (avoid.some(a => dish.name.includes(a))) {
      score -= 1
      add('avoid', 1, `含忌口「${avoid.join('、')}」`)
    }

    // 同类只取最强一条 → 自然去重
    const byCat = new Map()
    for (const r of reasons) {
      const prev = byCat.get(r.category)
      if (!prev || r.strength > prev.strength) byCat.set(r.category, r)
    }
    const why = [...byCat.values()]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 3)
      .map(r => r.text)

    return { dish, score: Number(Math.max(0, Math.min(1, score)).toFixed(3)), why, evidence }
  }).sort((a, b) => b.score - a.score || a.dish.id.localeCompare(b.dish.id))

  // 备选要有备选的理由：跟第一名比「省多少 / 快多少」，而不是复述同一套话
  const top = scored[0]
  function contrast(dish) {
    if (!top || top.dish.id === dish.id) return ''
    const bits = []
    const dPrice = dish.price - top.dish.price
    const dMin = dish.min - top.dish.min
    if (dPrice < 0) bits.push(`比「${top.dish.name}」省 ${-dPrice} 元`)
    if (dMin < 0) bits.push(`快 ${-dMin} 分钟`)
    else if (dMin > 0) bits.push(`要多等 ${dMin} 分钟`)
    if (!bits.length) bits.push(`口味上跟「${top.dish.name}」一个路子，换着吃`)
    return bits.join('，')
  }

  // 补一条「因为你说过…」的溯源
  const citedPool = recentEpisodes(repos, personId, 30)
  const items = scored.slice(0, 3).map(({ dish, score, why, evidence }, i) => {
    const cited = [...evidence]
    if (!cited.length) {
      const related = citedPool.find(e => (e.tags || []).some(t => symptoms.has(t)))
      if (related) {
        cited.push({ episodeId: related.id, ts: related.ts, text: related.summary || related.text.slice(0, 24) })
      }
    }
    const contrastText = contrast(dish)
    const finalWhy = contrastText ? [contrastText, ...why].slice(0, 3) : why
    return {
      id: `meal_${dish.id}`,
      kind: i === 0 ? 'primary' : 'option',
      title: dish.name,
      desc: `${dish.note} · 人均 ${dish.price} 元 · 约 ${dish.min} 分钟`,
      why: finalWhy.length ? finalWhy : ['和你档案里的口味基本一致'],
      evidence: cited.slice(0, 2),
      score,
      source: '给您请安 · 膳食坊',
      meta: { element: dish.element, taste: dish.taste, spicy: dish.spicy, price: dish.price, min: dish.min },
    }
  })

  // 明确说清「排除了什么」，比只给推荐更可信
  const excluded = scored
    .filter(s => s.score < 0.3 && s.dish.spicy > (targetSpicy ?? 3) && stomach === '偏敏感')
    .slice(0, 2)
  const excludeNote = excluded.length
    ? `已避开：${excluded.map(s => s.dish.name).join('、')}（辣 + 肠胃敏感）`
    : ''

  return {
    items,
    meta: { symptoms: [...symptoms], targetSpicy, excludeNote, candidates: DISH_LIBRARY.length },
  }
}

// 记忆摘要：给前端展示「基于哪句话」
function brief(e) {
  return e.summary || (e.text || '').slice(0, 24)
}

registry.register({
  id: 'meal.prepare',
  service: '给您请安',
  name: '今日膳食',
  icon: '🍲',
  description: '按口味、身体状态、天气、今日宜味和预算推荐三道菜，并说明理由',
  intents: ['eat', 'drink'],
  needs: ['context.fortune', 'context.weather', 'profile.diet'],
  provides: ['dishes'],
  cost: 'free',
  run,
})

module.exports = { run }
