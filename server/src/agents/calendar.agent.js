'use strict'

// 能力：时间与日程核对
// 把「周六」「明天」这类模糊表述落到具体日期，并检查是否与已有安排冲突。

const registry = require('./registry')

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function nextWeekday(from, targetDow) {
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)
  let diff = (targetDow - d.getDay() + 7) % 7
  if (diff === 0) diff = 7 // 「周六」在周六当天说，通常指下一个周六
  d.setDate(d.getDate() + diff)
  return d
}

function resolveDate(timeKey, now = new Date()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  switch (timeKey) {
    case 'tomorrow': d.setDate(d.getDate() + 1); return d
    case 'day_after': d.setDate(d.getDate() + 2); return d
    case 'saturday': return nextWeekday(now, 6)
    case 'sunday': return nextWeekday(now, 0)
    case 'weekend': return nextWeekday(now, 6)
    case 'today':
    case 'today_evening':
    default: return d
  }
}

async function run(ctx) {
  const timeKey = ctx.entities?.time?.key || 'today'
  const date = resolveDate(timeKey, ctx.now || new Date())
  const dateStr = `${date.getMonth() + 1}月${date.getDate()}日 ${WEEK[date.getDay()]}`

  // MVP：日程冲突用档案里的固定安排模拟；接真实日历只需换这里的数据源
  const busy = ctx.facts['life.busy'] || null
  const conflict = busy && String(busy).includes(dateStr)

  return {
    items: [{
      id: 'calendar_check',
      kind: 'context',
      title: conflict ? `${dateStr} 你有安排` : `${dateStr} 目前空着`,
      desc: conflict ? `档案里记着：${busy}` : '可以直接定这个时间',
      why: [`你说的是「${ctx.entities?.time?.label || '今天'}」`],
      score: 0.4,
      source: '日程服务',
    }],
    meta: { date: date.toISOString().slice(0, 10), dateStr, dayOfWeek: WEEK[date.getDay()], conflict },
  }
}

registry.register({
  id: 'calendar.check',
  service: '公共数据',
  name: '日程核对',
  icon: '◷',
  description: '把模糊时间落到具体日期，并检查冲突',
  intents: [],
  needs: [],
  provides: ['context.calendar'],
  cost: 'free',
  run,
})

module.exports = { run, resolveDate }
