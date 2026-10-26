'use strict'

// 日程：用户真正要做的事。
//
// 它跟「推荐」的区别是：推荐是执笔算给你看的，日程是你自己认下的承诺。
// 三条边界：
//   ① 只存「某天某一刻、一件事」，不存参与人的隐私细节（谁去、聊什么不进这里）；
//   ② 完成状态由用户点，系统不替用户判定「这件事办完了」；
//   ③ 组局方案被采纳后由前端写一条进来 —— 否则「就这么定」只是句空话。
//
// 时区：一律按北京时间（UTC+8）算日期边界，服务器在 ECS 上跑 UTC 也不会错位。

const { ValidationError } = require('../errors')

const MAX_TITLE = 60
const MAX_PLACE = 24
const MAX_DAYS = 30

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

/** 北京时间的「今天」，形如 2026-10-26 */
function todayKey(now = new Date()) {
  const d = new Date(now.getTime() + 8 * 3600 * 1000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function parseKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''))
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (isNaN(d.getTime())) return null
  // 反向校验，拦掉 2026-02-31 这类「格式对但日子不存在」的输入
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null
  return d
}

function keyOf(dateObj) {
  return `${dateObj.getUTCFullYear()}-${pad(dateObj.getUTCMonth() + 1)}-${pad(dateObj.getUTCDate())}`
}

function addDays(key, n) {
  const d = parseKey(key)
  if (!d) return key
  d.setUTCDate(d.getUTCDate() + n)
  return keyOf(d)
}

function diffDays(fromKey, toKey) {
  const a = parseKey(fromKey)
  const b = parseKey(toKey)
  if (!a || !b) return 0
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

/** 人话标签：今天 / 明天 / 后天 / 周X（前后都用同一套，避免「10月28日」和「后天」混着出现） */
function dayLabel(key, today) {
  const n = diffDays(today, key)
  if (n === 0) return '今天'
  if (n === 1) return '明天'
  if (n === 2) return '后天'
  if (n === -1) return '昨天'
  const d = parseKey(key)
  return d ? WEEK[d.getUTCDay()] : ''
}

function dateLabel(key) {
  const d = parseKey(key)
  if (!d) return key
  return `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`
}

/** 时间校验：HH:MM，缺省视为「没定具体时刻」 */
function normalizeTime(v) {
  if (v === undefined || v === null || v === '') return ''
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim())
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  return `${pad(h)}:${pad(mi)}`
}

function shape(item, today) {
  return {
    id: item.id,
    date: item.date,
    time: item.time || '',
    title: item.title,
    place: item.place || '',
    done: !!item.done,
    source: item.source || 'user',
    dayLabel: dayLabel(item.date, today),
    dateLabel: dateLabel(item.date),
    when: `${dayLabel(item.date, today)}${item.time ? ' ' + item.time : ''}`,
    overdue: !item.done && diffDays(today, item.date) < 0,
  }
}

function sortItems(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  const at = a.time || '99:99' // 没定时刻的排在当天最后，不抢有时刻的事
  const bt = b.time || '99:99'
  if (at !== bt) return at < bt ? 1 : -1
  return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1
}

/**
 * 取一段日程，并按天分组。
 * @param {number} opts.days 往后看几天（含今天），未完成的过期项也会带上
 */
function list(repos, personId, { days = 7, now = new Date() } = {}) {
  const today = todayKey(now)
  const span = Math.max(1, Math.min(MAX_DAYS, Number(days) || 7))
  const until = addDays(today, span - 1)

  const rows = repos.agenda.byPerson(personId)
    .filter(a => a.date <= until)
    // 过去的未完成项仍然要看得到（不然会「消失」），但只带 3 天内的
    .filter(a => a.date >= addDays(today, -3))
    .sort(sortItems)

  const items = rows.map(a => shape(a, today))

  const groups = []
  const index = {}
  for (const it of items) {
    if (!index[it.date]) {
      const g = { date: it.date, dayLabel: it.dayLabel, dateLabel: it.dateLabel, items: [] }
      index[it.date] = g
      groups.push(g)
    }
    index[it.date].items.push(it)
  }

  return {
    today,
    until,
    days: span,
    items,
    groups,
    todayItems: items.filter(i => i.date === today),
    counts: {
      total: items.length,
      today: items.filter(i => i.date === today).length,
      undone: items.filter(i => !i.done).length,
      overdue: items.filter(i => i.overdue).length,
    },
  }
}

function create(repos, personId, input = {}, now = new Date()) {
  const title = String(input.title || '').trim()
  if (!title) throw new ValidationError('title 不能为空')
  if (title.length > MAX_TITLE) throw new ValidationError(`title 超长（上限 ${MAX_TITLE} 字）`)

  const today = todayKey(now)
  const date = input.date ? String(input.date) : today
  if (!parseKey(date)) throw new ValidationError('date 必须是 YYYY-MM-DD 且是真实存在的日子')

  const time = normalizeTime(input.time)
  if (time === null) throw new ValidationError('time 必须是 HH:MM')

  const place = String(input.place || '').trim().slice(0, MAX_PLACE)

  const doc = repos.agenda.insert({
    personId,
    date,
    time,
    title,
    place,
    done: false,
    source: input.source === 'plan' ? 'plan' : 'user',
  })
  return shape(doc, today)
}

function setDone(repos, personId, id, done, now = new Date()) {
  const item = repos.agenda.get(personId, id)
  if (!item) return null
  const next = repos.agenda.update(id, { done: !!done, doneAt: done ? new Date().toISOString() : null })
  return shape(next, todayKey(now))
}

function remove(repos, personId, id) {
  const item = repos.agenda.get(personId, id)
  if (!item) return false
  return repos.agenda.remove(id)
}

/** 给 calendar.agent 用：某天到底有几件事 */
function onDate(repos, personId, key, now = new Date()) {
  const today = todayKey(now)
  const rows = repos.agenda.byPerson(personId).filter(a => a.date === key).sort(sortItems)
  return rows.map(a => shape(a, today))
}

module.exports = {
  MAX_TITLE,
  MAX_PLACE,
  MAX_DAYS,
  todayKey,
  parseKey,
  addDays,
  diffDays,
  dayLabel,
  dateLabel,
  normalizeTime,
  list,
  create,
  setDone,
  remove,
  onDate,
}
