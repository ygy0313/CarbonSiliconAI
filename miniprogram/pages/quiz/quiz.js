// 入局问答：12 道选择题，选完档案就有骨架。
// 一次只出一题（progress.next），答完服务端直接落事实，前端不做任何计算。
const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    loading: true,
    // 进度
    done: 0,
    total: 12,
    // 当前题（来自 progress.next）
    q: null,
    // 答完的状态
    finished: false,
    quip: '',
    error: '',
    submitting: false,
  },

  onLoad() {
    if (!app.guardLegal()) {
      wx.switchTab({ url: '/pages/index/index' })
      return
    }
    this.load()
  },

  onShow() {
    // 从别页回来刷新进度
    if (this.data.finished) return
  },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const r = await api.getQuiz(app.globalData.personId)
      const p = r.progress || {}
      const next = p.next || null
      this.setData({
        loading: false,
        done: p.done || 0,
        total: p.total || 12,
        q: next,
        finished: !next,
      })
    } catch (err) {
      this.setData({ loading: false, error: err.message || '拿不到题目' })
    }
  },

  async pick(e) {
    if (this.data.submitting) return
    const key = e.currentTarget.dataset.key
    const q = this.data.q
    if (!q || !key) return
    this.setData({ submitting: true })
    try {
      const r = await api.answerQuiz(app.globalData.personId, q.id, key)
      const quip = (r && r.quip) || (r && r.answer && r.answer.quip) || ''
      if (quip) wx.showToast({ title: quip, icon: 'none' })
      this.setData({ submitting: false })
      this.load()
    } catch (err) {
      this.setData({ submitting: false, error: err.message || '没答上，再试一次' })
    }
  },

  goRecord() {
    wx.switchTab({ url: '/pages/record/record' })
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  },
})
