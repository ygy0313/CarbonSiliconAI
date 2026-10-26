// 行为采集（站内）：只在内存里攒，攒够或切后台时批量上报。
//
// 采什么：翻了哪个页、停留多久、点了什么、换了几次推荐、采纳/跳过、授权开关。
// 不采什么：任何正文内容、任何其他 App 的使用记录 —— 小程序没有那个权限。
//
// 开关：wx.getStorageSync('trackOff') 为真时完全不采（「我的 → 授权」里能关）。
// 失败静默：采集是旁路，不能因为上报失败影响任何主流程。

const api = require('./api')

const MAX_QUEUE = 40
const FLUSH_AT = 8

let queue = []
let pageName = ''
let pageAt = 0

function enabled() {
  try {
    return !wx.getStorageSync('trackOff')
  } catch (_) {
    return true
  }
}

function setEnabled(on) {
  wx.setStorageSync('trackOff', on ? '' : '1')
}

function push(kind, name, detail, durationMs) {
  if (!enabled()) return
  if (!name) return
  queue.push({ kind, name, detail: detail || '', durationMs: durationMs || 0 })
  if (queue.length >= FLUSH_AT) flush()
}

function flush(force) {
  if (!queue.length) return
  if (!enabled()) {
    queue = []
    return
  }
  const app = getApp()
  const personId = app && app.globalData && app.globalData.personId
  if (!personId) return
  const items = queue.splice(0, MAX_QUEUE)
  api.behaviors(personId, items).catch(() => {
    // 上报失败不重试、不排队 —— 行为数据不值得占用户的流量和电量
  })
  if (force) queue = []
}

// ── 页面停留 ──
function pageIn(name) {
  pageOut()
  pageName = name
  pageAt = Date.now()
}

function pageOut() {
  if (pageName && pageAt) {
    const ms = Date.now() - pageAt
    // 停留不足 1.2 秒的多半是误触或一闪而过，不记
    if (ms > 1200) push('page', pageName, '', ms)
  }
  pageName = ''
  pageAt = 0
}

// ── 动作 ──
function tap(name, detail) { push('tap', name, detail) }
function skip(name, detail) { push('skip', name, detail) }
function accept(name, detail) { push('accept', name, detail) }
function imported(name, detail) { push('import', name, detail) }
function auth(name, on) { push('auth', name, on ? 'on' : 'off') }

module.exports = {
  enabled,
  setEnabled,
  flush,
  pageIn,
  pageOut,
  tap,
  skip,
  accept,
  imported,
  auth,
}
