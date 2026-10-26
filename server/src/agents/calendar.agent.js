'use strict'

// 能力：时间与日程核对
// 把「周六」「明天」这类模糊表述落到具体日期，并检查这天是不是已经有别的事。
//
// 两个数据源，主次分明：
//   · 主：真实日程（agenda）—— 结构化，能算出「这天几件、几点」；
//   · 备：档案里 life.busy 那句自由文本 —— 早期没有日程功能时的兜底，
//         只在这天没有日程记录时才拿来比对。
//
// 日期一律按北京时间算：服务器跑在 UTC 的 ECS 上，用本地 Date 方法会把
// 「明天」算错一天（凌晨 0-8 点尤其明显），所以日期只用 'YYYY-MM-DD' 字符串传递。

const registry = require('./registry')
const agendaService = require('../services/agenda.service')

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function keyDow(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return 0
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
}

/** 「11月1日 周六」—— 与档案里自由文本的写法保持一致，方便兜底比对 */
function keyLabel(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return key
  return `${Number(m[2])}月${Number(m[3])}日 ${WEEK[keyDow(key)]}`
}

/** 「周六」在周六当天说，通常指下一个周六 —— 往前推 7 天而不是当天 */
function nextWeekdayKey(todayKey, targetDow) {
  const diff = ((targetDow - keyDow(todayKey)) + 7) % 7 || 7
  return agendaService.addDays(todayKey, diff)
}

/** 把时间词落到北京时间的某一天，返回 'YYYY-MM-DD' */
function resolveDateKey(timeKey, now = new Date()) {
  const today = agendaService.todayKey(now)
  switch (timeKey) {
    case 'tomorrow': return agendaService.addDays(today, 1)
    case 'day_after': return agendaService.addDays(today, 2)
    case 'saturday': return nextWeekdayKey(today, 6)
    case 'sunday': return nextWeekdayKey(today, 0)
    case 'weekend': return nextWeekdayKey(today, 6)
    case 'today':
    case 'today_evening':
    default: return today
  }
}

async function run(ctx) {
  const timeKey = ctx.entities?.time?.key || 'today'
  const now = ctx.now || new Date()
  const key = resolveDateKey(timeKey, now)
  const dateStr = keyLabel(key)

  // 真实日程优先；没拿到仓储（单测直接调 run）就退到档案里的那句话
  const booked = ctx.repos && ctx.personId
    ? agendaService.onDate(ctx.repos, ctx.personId, key, now)
    : []
  const busyText = booked.length ? null : (ctx.facts['life.busy'] || null)
  const textConflict = !!busyText && String(busyText).includes(dateStr)
  const conflict = booked.length > 0 || textConflict

  const desc = booked.length
    ? booked.map(b => `${b.time ? b.time + ' ' : ''}${b.title}`).join(' · ')
    : textConflict
      ? `档案里记着：${busyText}`
      : '可以直接定这个时间'

  const why = [`你说的是「${ctx.entities?.time?.label || '今天'}」`]
  if (booked.length) why.push(`日程里这天有 ${booked.length} 件，先看会不会撞`)

  return {
    items: [{
      id: 'calendar_check',
      kind: 'context',
      title: conflict
        ? (booked.length ? `${dateStr} 已有 ${booked.length} 件事` : `${dateStr} 你有安排`)
        : `${dateStr} 目前空着`,
      desc,
      why,
      score: 0.4,
      source: '日程服务',
      meta: { date: key, count: booked.length, ids: booked.map(b => b.id) },
    }],
    meta: {
      date: key,
      dateStr,
      dayOfWeek: WEEK[keyDow(key)],
      conflict,
      count: booked.length,
      items: booked.map(b => ({ id: b.id, time: b.time, title: b.title })),
    },
  }
}

registry.register({
  id: 'calendar.check',
  service: '公共数据',
  name: '日程核对',
  icon: '◷',
  description: '把模糊时间落到具体日期，并检查这天有没有别的事',
  intents: [],
  needs: [],
  provides: ['context.calendar'],
  cost: 'free',
  run,
})

module.exports = { run, resolveDateKey }
