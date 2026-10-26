// 日程：用户认下的事。
//
// 和首页其它模块的区别：吃、动、喝是执笔算出来的建议，日程是你自己点头的承诺。
// 所以这一页只有一件事要做 —— 让「记一件事」比「想起来要做什么」更省力：
// 默认落在今天、时刻可以不填、勾一下就完。
//
// 数据源：GET /api/persons/:id/agenda（服务端已按北京时间分好组、算好人话标签），
// 前端不重复做日期计算，只渲染。

const app = getApp()
const api = require('../../utils/api')

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

/** 北京时间的今天，YYYY-MM-DD（与服务端 agenda.service.todayKey 同一套算法） */
function bjToday() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function shiftDay(key, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return key
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() + n)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function labelOf(key, today) {
  if (key === today) return '今天'
  if (key === shiftDay(today, 1)) return '明天'
  if (key === shiftDay(today, 2)) return '后天'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return key
  return DAY_NAMES[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()]
}

Page({
  data: {
    loading: true,
    offline: false,
    todayKey: '',
    dateChips: [],
    date: '',
    time: '',
    title: '',
    saving: false,
    groups: [],
    counts: { today: 0, undone: 0, overdue: 0 },
    // 头部一句人话：今天几件事
    headline: '',
  },

  onShow() {
    this.buildChips()
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  buildChips() {
    const today = bjToday()
    const date = this.data.date || today
    this.setData({
      todayKey: today,
      date,
      dateChips: [
        { date: today, label: '今天', on: date === today },
        { date: shiftDay(today, 1), label: '明天', on: date === shiftDay(today, 1) },
        { date: shiftDay(today, 2), label: '后天', on: date === shiftDay(today, 2) },
      ],
    })
  },

  pickDate(e) {
    const date = e.currentTarget.dataset.date
    this.buildChipsFor(date)
  },

  pickOtherDate(e) {
    this.buildChipsFor(e.detail.value)
  },

  buildChipsFor(date) {
    const today = this.data.todayKey || bjToday()
    this.setData({
      date,
      dateChips: [
        { date: today, label: '今天', on: date === today },
        { date: shiftDay(today, 1), label: '明天', on: date === shiftDay(today, 1) },
        { date: shiftDay(today, 2), label: '后天', on: date === shiftDay(today, 2) },
      ],
    })
  },

  pickTime(e) {
    this.setData({ time: e.detail.value })
  },

  clearTime() {
    this.setData({ time: '' })
  },

  onTitle(e) {
    this.setData({ title: e.detail.value })
  },

  async load() {
    this.setData({ loading: true })
    try {
      const r = await api.getAgenda(app.globalData.personId, 7)
      const c = r.counts || {}
      this.setData({
        loading: false,
        offline: false,
        groups: (r.groups || []).map(g => ({
          ...g,
          label: labelOf(g.date, r.today),
          items: g.items.map(it => ({ ...it, checkCls: it.done ? 'ag-check on' : 'ag-check', rowCls: it.done ? 'ag-row is-done' : 'ag-row' })),
        })),
        counts: c,
        headline: c.today ? `今天 ${c.today} 件事` : '今天空着',
      })
    } catch (_) {
      this.setData({ loading: false, offline: true, groups: [], headline: '拿不到日程' })
    }
  },

  async save() {
    const title = (this.data.title || '').trim()
    if (!title) {
      wx.showToast({ title: '先写要做什么', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      await api.addAgenda(app.globalData.personId, {
        title,
        date: this.data.date,
        time: this.data.time || undefined,
      })
      this.setData({ title: '', time: '' })
      wx.showToast({ title: '记下了', icon: 'success' })
      await this.load()
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  async toggle(e) {
    const { id, done } = e.currentTarget.dataset
    // 先就地翻状态，网络失败再回滚 —— 勾选是高频动作，不该等一个来回
    const groups = this.data.groups.map(g => ({
      ...g,
      items: g.items.map(it => (it.id === id
        ? { ...it, done: !done, checkCls: !done ? 'ag-check on' : 'ag-check', rowCls: !done ? 'ag-row is-done' : 'ag-row' }
        : it)),
    }))
    this.setData({ groups })
    try {
      await api.setAgendaDone(app.globalData.personId, id, !done)
    } catch (err) {
      wx.showToast({ title: err.message || '没存上', icon: 'none' })
      await this.load()
    }
  },

  remove(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删掉这件事',
      content: '删了就找不回来了。',
      confirmText: '删掉',
      success: async res => {
        if (!res.confirm) return
        try {
          await api.removeAgenda(app.globalData.personId, id)
          await this.load()
        } catch (err) {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' })
        }
      },
    })
  },

  goRecord() {
    wx.switchTab({ url: '/pages/record/record' })
  },
})
