const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    loaded: false,
    plan: null,
    parts: [],
    todos: [],
    doneCount: 0,
    altTitle: '',
    offline: false,
  },

  onLoad() {
    const card = app.globalData.planCard
    const result = app.globalData.planResult

    if (!card) {
      // 直接进来没有上下文：给一份可看的样例，不白屏
      const mock = require('../../utils/mock')
      const fallback = mock.orchestrate('周六组个局')
      this.render(fallback.cards[0], fallback)
      return
    }
    this.render(card, result)
  },

  render(card, result) {
    const all = (result && result.cards) || []
    const partIds = (card.meta && card.meta.parts) || []
    const parts = all
      .filter(c => partIds.indexOf(c.id) >= 0)
      .map(c => ({
        id: c.id,
        title: c.title,
        desc: c.desc,
        source: c.source,
        why: (c.why || []).slice(0, 2),
        meta: c.meta || {},
      }))

    const todos = ((card.meta && card.meta.todos) || []).map((text, i) => ({
      key: 't' + i,
      text,
      done: false,
      cls: 'todo',
    }))

    const alt = all.find(c => c.kind === 'option' && String(c.id).indexOf('script_') === 0)

    this.setData({
      loaded: true,
      plan: {
        title: card.title,
        desc: card.desc,
        why: card.why || [],
        dateStr: (card.meta && card.meta.dateStr) || '',
        headcount: (card.meta && card.meta.headcount) || 0,
        totalPerPerson: (card.meta && card.meta.totalPerPerson) || 0,
        timeline: (card.meta && card.meta.timeline) || [],
      },
      parts,
      todos,
      altTitle: alt ? alt.title : '',
      offline: app.globalData.offline,
    })
  },

  toggleTodo(e) {
    const idx = e.currentTarget.dataset.index
    const todos = this.data.todos.slice()
    if (!todos[idx]) return
    const done = !todos[idx].done
    todos[idx] = Object.assign({}, todos[idx], { done, cls: done ? 'todo todo-done' : 'todo' })
    this.setData({ todos, doneCount: todos.filter(t => t.done).length })
  },

  async acceptPlan() {
    if (this.data.offline) {
      wx.showToast({ title: '离线模式不落库', icon: 'none' })
      return
    }
    try {
      const inv = (app.globalData.planResult || {}).invocationId
      const card = app.globalData.planCard
      await api.feedback(app.globalData.personId, {
        invocationId: inv,
        cardId: card ? card.id : 'plan_gather',
        action: 'accept',
      })
      wx.showToast({ title: '已加入你的计划', icon: 'none' })
      app.loadSilicon(true)
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    }
  },

  replacePart(e) {
    const id = e.currentTarget.dataset.id
    wx.showToast({ title: '换一个：' + (this.data.altTitle || '暂时没有更合适的'), icon: 'none' })
  },

  back() {
    wx.navigateBack()
  },
})
