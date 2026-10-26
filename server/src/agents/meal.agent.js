'use strict'

// 能力：今日膳食（原「给您请安 · 御膳坊」的推荐内核）
//
// 打分全部可解释：每一条推荐都必须能回答「为什么是它」，
// 且理由要能引用到具体记忆 —— 否则推荐就是个黑箱。
//
// 理由生成策略：每条理由带 category 与 strength，同类只取最强的一条，
// 最后按 strength 排序取前 3。这样三道菜的理由不会长得一模一样。
//
// 2026-10-26：按「早 / 午 / 茶歇 / 晚 / 宵」时段出推荐；定位城市命中招牌加分；
// 附带饮品候选（茶 / 咖啡 / 汤饮，酒走选酒能力）；对外文案不再出现价格。

const registry = require('./registry')
const { DISH_LIBRARY, DRINK_LIBRARY } = require('../domain/taxonomy')

const SPICY_TARGET = { 不吃辣: 0, 微辣: 1, 中辣: 2, 重辣: 3 }
const SPICY_LABEL = ['不辣', '微辣', '中辣', '重辣']
const BODY_TAGS = ['胃敏感', '上火', '没胃口', '乏力', '失眠', '宿醉']

const SLOT_LABEL = { breakfast: '早餐', lunch: '午餐', tea: '茶歇', dinner: '晚餐', late: '夜宵' }

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
  const headcount = entities.headcount || 1
  const scene = entities.scene || (headcount === 1 ? 'alone' : null)
  const slot = SLOT_LABEL[entities.mealType] ? entities.mealType : pickSlot(new Date())
  const city = (ctx.geo && ctx.geo.city) || facts['life.city'] || ''

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

    // ② 时段：这个点适不适合吃它
    const slots = dish.slots || ['lunch', 'dinner']
    if (slots.includes(slot)) {
      score += 0.14
      add('slot', 0.14, `${SLOT_LABEL[slot]}正合适`)
    } else {
      score -= 0.18
      add('slot', 0.18, `更适合当${SLOT_LABEL[slots[slots.length - 1]]}，这个点略重`)
    }
    if (slot === 'late' && dish.load !== 'light') {
      score -= 0.15
      add('time', 0.15, '夜宵吃这个，睡不好')
    }

    // ③ 位置：本地招牌优先 —— 人在哪就先看哪的牌子
    if (city && dish.city === city) {
      score += 0.12
      add('geo', 0.12, `${city}的招牌，到了本地值得一试`)
    }

    // ④ 身体状态
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

    // ⑤ 口味倾向
    if (tastePref && dish.taste) {
      const tasteMap = { 清淡: '甘', 咸鲜: '咸', 重口: '辛', 偏甜: '甘' }
      if (tasteMap[tastePref] === dish.taste) {
        score += 0.1
        add('taste', 0.1, `你偏好${tastePref}，这是${dish.taste}味`)
      }
    }

    // ⑥ 今日宜味
    if (fortune.favorableTaste && dish.taste === fortune.favorableTaste) {
      score += 0.08
      add('fortune', 0.08, `今日宜${fortune.favorableTaste}味，正好对上`)
    }
    if (fortune.avoidTaste && dish.taste === fortune.avoidTaste) {
      score -= 0.06
    }

    // ⑦ 天气
    if (weather.feels === '冷' && dish.element === '土' && dish.load !== 'light') {
      score += 0.08
      add('weather', 0.08, `外面 ${weather.temp}°C，热汤热食顶得住`)
    }
    if (weather.feels === '热' && ['木', '水'].includes(dish.element)) {
      score += 0.07
      add('weather', 0.07, `天热，清爽的更下口`)
    }

    // ⑧ 场景：只谈份量与节奏，不谈价格
    if (scene === 'alone') {
      if (dish.load !== 'heavy') add('scene', 0.05, '一个人吃，份量正好不浪费')
      else score -= 0.1
      if (dish.min <= 25) {
        score += 0.05
        add('speed', 0.05, `${dish.min} 分钟能上桌`)
      }
    } else if (['friends', 'family', 'colleagues'].includes(scene)) {
      if ((dish.helps || []).includes('待客')) {
        score += 0.08
        add('scene', 0.08, '待客拿得出手')
      }
    }

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

  // 备选要有备选的理由：跟第一名比「快多少 / 清淡多少」，而不是复述同一套话
  const top = scored[0]
  function contrast(dish) {
    if (!top || top.dish.id === dish.id) return ''
    const bits = []
    const dMin = dish.min - top.dish.min
    if (dMin < 0) bits.push(`比「${top.dish.name}」快 ${-dMin} 分钟`)
    else if (dMin > 0) bits.push(`要比「${top.dish.name}」多等 ${dMin} 分钟`)
    if (dish.load === 'light' && top.dish.load !== 'light') bits.push('更清爽')
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
      desc: `${dish.note} · 约 ${dish.kcal || 0} kcal${dish.city ? ` · ${dish.city}招牌` : ''}`,
      why: finalWhy.length ? finalWhy : ['和你档案里的口味基本一致'],
      evidence: cited.slice(0, 2),
      score,
      source: '给您请安 · 膳食坊',
      meta: {
        element: dish.element, taste: dish.taste, spicy: dish.spicy,
        slot, min: dish.min,
        kcal: dish.kcal || null,
        searchKeyword: `${dish.name} ${city}`.trim(),
      },
    }
  })

  // ── 饮品候选：茶 / 咖啡 / 汤饮（酒走选酒能力，不混在这里）──
  const brews = DRINK_LIBRARY.map(b => {
    let score = 0.5
    const why = []
    const slots = b.slots || []
    if (slots.includes(slot)) {
      score += 0.15
      why.push(`${SLOT_LABEL[slot]}喝正合适`)
    } else {
      score -= 0.2
    }
    for (const s of symptoms) {
      if ((b.helps || []).includes(s)) {
        score += 0.18
        why.push(`${s === '胃敏感' ? '胃不舒服' : s}的时候它是稳妥选项`)
      }
    }
    if (fortune.favorableTaste && b.taste === fortune.favorableTaste) {
      score += 0.08
      why.push(`今日宜${fortune.favorableTaste}味，对上`)
    }
    if (weather.feels === '冷' && /热|姜|牛奶|大麦/.test(b.note)) {
      score += 0.06
      why.push('天冷，热饮先安排上')
    }
    if (slot === 'late' && b.kind === '咖啡') {
      score -= 0.35
      why.push('夜里别碰咖啡因')
    }
    if (slot === 'tea' && b.kind === '咖啡') {
      score -= 0.1
      why.push('下午茶点，咖啡因过了这村就影响晚上')
    }
    return { b, score: Number(score.toFixed(3)), why: why.slice(0, 2) }
  }).sort((a, b) => b.score - a.score || a.b.id.localeCompare(b.b.id))

  for (const { b, score, why } of brews.slice(0, 2)) {
    items.push({
      id: `brew_${b.id}`,
      kind: 'option',
      title: b.name,
      desc: `${b.kind} · ${b.note} · 约 ${b.kcal} kcal`,
      why: why.length ? why : ['跟今天的状态搭'],
      evidence: [],
      score,
      source: '给您请安 · 膳食坊',
      meta: { kind: b.kind, slot, kcal: b.kcal, searchKeyword: `${b.name} ${city}`.trim() },
    })
  }

  // 明确说清「排除了什么」，比只给推荐更可信
  const excluded = scored
    .filter(s => s.score < 0.3 && s.dish.spicy > (targetSpicy ?? 3) && stomach === '偏敏感')
    .slice(0, 2)
  const excludeNote = excluded.length
    ? `已避开：${excluded.map(s => s.dish.name).join('、')}（辣 + 肠胃敏感）`
    : ''

  return {
    items,
    meta: { symptoms: [...symptoms], targetSpicy, slot, slotLabel: SLOT_LABEL[slot], excludeNote, candidates: DISH_LIBRARY.length + DRINK_LIBRARY.length },
  }
}

// 没显式给时段时按钟点估：5-10 早、10-14 午、14-17 茶歇、17-21 晚、其余宵
function pickSlot(d) {
  const h = d.getHours()
  if (h >= 5 && h < 10) return 'breakfast'
  if (h < 14) return 'lunch'
  if (h < 17) return 'tea'
  if (h < 21) return 'dinner'
  return 'late'
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
  description: '按时段、口味、身体状态、天气、今日宜味和所在城市推荐三道菜与两款饮品，并说明理由',
  intents: ['eat', 'drink'],
  needs: ['context.fortune', 'context.weather', 'profile.diet'],
  provides: ['dishes'],
  cost: 'free',
  run,
})

module.exports = { run }
