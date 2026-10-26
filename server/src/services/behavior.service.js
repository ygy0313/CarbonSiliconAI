'use strict'

// 行为采集：小程序里的用法痕迹 → 习惯画像。
//
// 能力边界（对用户必须说清，不做「偷偷读手机」的暗示）：
//   ✅ 能采：在小程序里翻过哪些页、点了什么、换了几次推荐、采纳/跳过、授权开关的开关动作
//   ❌ 采不到：你在抖音/小红书/淘宝/微信读书里的使用记录 —— 那是别的 App 的数据，
//              小程序没有权限，微信也不提供。要这类信息只能你自己主动导入（截图/粘贴清单）。
//
// 红线：只记「哪个功能、什么动作、多久」，不记正文；不跨人；用户可一键清空。

const KINDS = ['page', 'tap', 'skip', 'accept', 'auth', 'import']
const MAX_ITEMS = 50
const MAX_NAME = 40
const MAX_DETAIL = 80
const RETENTION_DAYS = 90

function normalize(items) {
  if (!Array.isArray(items)) return []
  return items
    .slice(0, MAX_ITEMS)
    .map(raw => {
      const kind = String(raw.kind || 'tap')
      if (!KINDS.includes(kind)) return null
      const name = String(raw.name || '').slice(0, MAX_NAME).trim()
      if (!name) return null
      const durationMs = Math.max(0, Math.min(3600 * 1000, Number(raw.durationMs) || 0))
      return {
        kind,
        name,
        detail: String(raw.detail || '').slice(0, MAX_DETAIL),
        durationMs,
        at: raw.at ? new Date(raw.at).toISOString() : new Date().toISOString(),
      }
    })
    .filter(Boolean)
}

function record(repos, personId, items) {
  const rows = normalize(items)
  const now = Date.now()
  for (const r of rows) repos.behavior.insert({ personId, ...r })
  // 顺手做一次保留期清理：只清这个人的，超过 90 天的丢掉
  const cutoff = now - RETENTION_DAYS * 24 * 3600 * 1000
  const all = repos.behavior.byPerson(personId)
  let dropped = 0
  for (const r of all) {
    if (new Date(r.at).getTime() < cutoff) {
      repos.behavior.remove(r.id)
      dropped++
    }
  }
  return { accepted: rows.length, dropped }
}

function summary(repos, personId, { days = 30 } = {}) {
  const since = Date.now() - Math.max(1, Math.min(365, days)) * 24 * 3600 * 1000
  const rows = repos.behavior.byPerson(personId).filter(r => new Date(r.at).getTime() >= since)

  const byKind = new Map()
  const byName = new Map()
  let activeMs = 0
  for (const r of rows) {
    byKind.set(r.kind, (byKind.get(r.kind) || 0) + 1)
    const cur = byName.get(r.name) || { name: r.name, count: 0, lastAt: 0, ms: 0, kinds: new Set() }
    cur.count++
    cur.ms += r.durationMs || 0
    cur.kinds.add(r.kind)
    const t = new Date(r.at).getTime()
    if (t > cur.lastAt) cur.lastAt = t
    byName.set(r.name, cur)
    activeMs += r.durationMs || 0
  }

  const top = [...byName.values()]
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, 8)
    .map(x => ({
      name: x.name,
      count: x.count,
      minutes: Math.round(x.ms / 60000),
      kinds: [...x.kinds],
      lastAt: x.lastAt ? new Date(x.lastAt).toISOString() : null,
    }))

  // 一句人话结论：挑最常用的那个功能说，不评判
  const habit = top.length
    ? `这 ${Math.min(days, 30)} 天你用得最多的是「${top[0].name}」，${top[0].count} 次` +
      (top[1] ? `；其次是「${top[1].name}」` : '') +
      '。这部分只用来决定首页先给你看什么。'
    : '还没有足够的使用痕迹。用几天之后，这里会显示你习惯从哪个功能开始。'

  return {
    days,
    total: rows.length,
    byKind: [...byKind.entries()].map(([kind, count]) => ({ kind, count })),
    top,
    activeMinutes: Math.round(activeMs / 60000),
    habit,
    boundary:
      '只统计你在小程序里的动作。你在其他 App 里看什么、买什么，小程序读不到 —— 需要的话只能你自己导入。',
  }
}

function clear(repos, personId) {
  return { removed: repos.behavior.clear(personId) }
}

module.exports = { record, summary, clear, KINDS, RETENTION_DAYS }
