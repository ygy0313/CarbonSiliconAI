'use strict'

// 能力：动一动（运动建议 + 卡路里量级）
//
// 三条克制：
//   ① 只给「做多久、大约消耗多少」的量级，不给训练计划、不谈减重承诺；
//   ② 天气不好就只推室内，不硬劝人出门；
//   ③ 卡路里按 70kg 成人 30 分钟估算，是参照值不是仪表读数。

const registry = require('./registry')
const { EXERCISE_LIBRARY } = require('../domain/taxonomy')

const SYMPTOM_TAGS = ['久坐', '腰背酸', '失眠', '焦虑', '犯困', '饭后', '解压']

async function run(ctx) {
  const { facts, tags, entities } = ctx
  const weather = ctx.outputs['weather.now']?.meta || {}
  const fortune = ctx.outputs['fortune.today']?.meta || {}
  const rhythm = facts['life.rhythm'] || null

  const wantSweat = tags.some(t => ['减脂', '消耗', '出汗', '想动'].includes(t))
  const myTags = new Set(tags.filter(t => SYMPTOM_TAGS.includes(t)))
  if (rhythm === '夜猫子') myTags.add('失眠')

  const feels = weather.feels || null
  const badWeather = ['冷', '热', '雨', '雪'].some(w => String(weather.condition || '').includes(w)) || feels === '冷'

  const scored = EXERCISE_LIBRARY.map(ex => {
    let score = 0.5
    const why = []

    // ① 天气：冷了只推室内，舒适时室外加分
    if (ex.scene === 'outdoor') {
      if (badWeather) { score -= 0.3; why.push('外面这天出门不舒服') }
      else if (feels === '舒适' || feels === '凉') { score += 0.12; why.push(`外面 ${weather.temp}°C，正适合出门`) }
    } else {
      score += badWeather ? 0.16 : 0.04
      if (badWeather) why.push('不用出门，屋里就能做')
    }

    // ② 身体状态对得上
    for (const s of myTags) {
      if ((ex.helps || []).includes(s)) { score += 0.15; why.push(`${s}的时候，这个最对症`) }
    }

    // ③ 想出汗 / 减脂：优先有氧
    if (wantSweat && ex.kind === '有氧') { score += 0.18; why.push('你要的是消耗量，有氧最直接') }
    if (!wantSweat && ex.kind === '舒展' && myTags.has('久坐')) { score += 0.1 }

    // ⑤ 时间：早上推提神的，晚上推舒展的（不做医学断言，只谈适配）
    const hour = (ctx.now || new Date()).getHours()
    if (hour >= 21 && ex.kind === '舒展') { score += 0.14; why.push('这个点做舒展比剧烈运动更合适') }
    if (hour < 10 && ex.kind === '有氧') { score += 0.06 }

    return { ex, score: Number(Math.max(0, Math.min(1, score)).toFixed(3)), why }
  }).sort((a, b) => b.score - a.score)

  const items = scored.slice(0, 2).map(({ ex, score, why }, i) => ({
    id: `move_${ex.id}`,
    kind: i === 0 ? 'primary' : 'option',
    title: ex.name,
    desc: `${ex.kcal30} kcal / 30 分钟 · ${ex.kind} · ${ex.scene === 'indoor' ? '室内' : '室外'}`,
    why: why.length ? why.slice(0, 3) : ['当下最稳妥的选择'],
    evidence: [],
    score,
    source: '本地生活 · 运动',
    meta: {
      kcal30: ex.kcal30,
      kind: ex.kind,
      scene: ex.scene,
      searchKeyword: `${ex.name} 跟练`,
      note: ex.note,
    },
  }))

  return { items, meta: { wantSweat, badWeather, feels } }
}

registry.register({
  id: 'move.suggest',
  service: '本地生活',
  name: '运动建议',
  icon: '🏃',
  description: '按天气、身体状态和目标推荐一项运动，给出卡路里量级',
  intents: ['move'],
  needs: ['context.weather'],
  provides: ['context.move'],
  cost: 'free',
  run,
})

module.exports = { run }
