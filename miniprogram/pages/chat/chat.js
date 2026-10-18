const app = getApp()
const api = require('../../utils/api')
const mock = require('../../utils/mock')

const TAG_OPTIONS = ['胃不舒服', '一个人吃', '和朋友', '预算紧', '上火', '没胃口', '想喝点']

const KIND_LABEL = {
  plan: '一个完整的局',
  primary: '主推',
  option: '备选',
  note: '今日节律',
  context: '参考',
}

const KIND_CLASS = {
  plan: 'card card-plan',
  primary: 'card card-primary',
  option: 'card',
  note: 'card card-soft',
  context: 'card card-soft',
}

Page({
  data: {
    input: '',
    selectedTags: [],
    tagOptions: TAG_OPTIONS.map(label => ({ label, on: false, cls: 'chip' })),
    phase: 'idle', // idle | thinking | done
    visibleTrace: [],
    cards: [],
    aux: [],
    summary: '',
    totalMs: 0,
    offline: false,
    errorMsg: '',
    feedbackSent: {},
  },

  onLoad(query) {
    if (query && query.text) {
      this.setData({ input: decodeURIComponent(query.text) })
      this.send()
    }
  },

  onInput(e) {
    this.setData({ input: e.detail.value })
  },

  toggleTag(e) {
    const tag = e.currentTarget.dataset.tag
    const list = this.data.selectedTags.slice()
    const idx = list.indexOf(tag)
    if (idx >= 0) list.splice(idx, 1)
    else list.push(tag)
    // 小程序模板不支持 indexOf，选中态必须预计算
    const options = this.data.tagOptions.map(o => ({
      label: o.label,
      on: list.indexOf(o.label) >= 0,
      cls: list.indexOf(o.label) >= 0 ? 'chip chip-on' : 'chip',
    }))
    this.setData({ selectedTags: list, tagOptions: options })
  },

  sendExample(e) {
    this.setData({ input: e.currentTarget.dataset.text || '' })
    this.send()
  },

  async send() {
    const text = (this.data.input || '').trim()
    if (!text) {
      wx.showToast({ title: '先说一句', icon: 'none' })
      return
    }

    this.setData({
      phase: 'thinking',
      visibleTrace: [],
      cards: [],
      aux: [],
      summary: '',
      errorMsg: '',
      feedbackSent: {},
    })

    let result
    try {
      result = await api.orchestrate(app.globalData.personId, text, this.data.selectedTags)
      this.setData({ offline: false })
    } catch (err) {
      // 降级：后端没起也能把产品流程演完
      result = mock.orchestrate(text)
      this.setData({ offline: true, errorMsg: err.message || '' })
    }

    app.globalData.lastResult = result
    wx.setStorageSync('lastIntent', text)
    this.playTrace(result)
  },

  // 逐条播放编排过程：让「多 agent 协作」这件事被看见
  playTrace(result) {
    const trace = result.trace || []
    const shown = []
    let i = 0
    const step = () => {
      if (i >= trace.length) {
        this.finish(result)
        return
      }
      shown.push(decorateTrace(trace[i]))
      this.setData({ visibleTrace: shown.slice() })
      i += 1
      setTimeout(step, 140)
    }
    if (!trace.length) this.finish(result)
    else step()
  },

  finish(result) {
    const all = result.cards || []
    const cards = []
    const aux = []
    for (const c of all) {
      const item = {
        id: c.id,
        kind: c.kind,
        kindLabel: KIND_LABEL[c.kind] || '建议',
        cls: KIND_CLASS[c.kind] || 'card',
        tagCls: c.kind === 'plan' ? 'tag tag-amber' : 'tag tag-green',
        fbState: '',
        title: c.title,
        desc: c.desc,
        why: c.why || [],
        evidence: c.evidence || [],
        source: c.source,
        scorePct: Math.round((c.score || 0) * 100) + '',
        meta: c.meta || {},
        timeline: (c.meta && c.meta.timeline) || [],
        todos: (c.meta && c.meta.todos) || [],
        parts: (c.meta && c.meta.parts) || [],
        totalPerPerson: (c.meta && c.meta.totalPerPerson) || 0,
        dateStr: (c.meta && c.meta.dateStr) || '',
        headcount: (c.meta && c.meta.headcount) || 0,
      }
      if (c.kind === 'note' || c.kind === 'context') aux.push(item)
      else cards.push(item)
    }

    this.setData({
      phase: 'done',
      cards,
      aux,
      summary: result.summary || '',
      totalMs: result.totalMs || 0,
    })
  },

  openPlan(e) {
    const idx = e.currentTarget.dataset.index
    const card = this.data.cards[idx]
    if (!card) return
    app.globalData.planCard = card
    app.globalData.planResult = app.globalData.lastResult
    wx.navigateTo({ url: '/pages/plan/plan?index=' + idx })
  },

  async accept(e) {
    const idx = e.currentTarget.dataset.index
    const card = this.data.cards[idx]
    if (!card) return
    await this.feedback(card.id, 'accept')
    wx.showToast({ title: '记下了', icon: 'none' })
  },

  async reject(e) {
    const idx = e.currentTarget.dataset.index
    const card = this.data.cards[idx]
    if (!card) return

    const that = this
    wx.showActionSheet({
      itemList: ['太辣了', '太贵了', '吃了不舒服', '太远', '就是不想'],
      success(res) {
        const reasons = ['too_spicy', 'too_expensive', 'bad_for_stomach', 'too_far', 'not_interested']
        that.feedback(card.id, 'reject', reasons[res.tapIndex])
        wx.showToast({ title: '已修正', icon: 'none' })
      },
    })
  },

  async feedback(cardId, action, reason) {
    const cards = this.data.cards.map(c => (c.id === cardId ? Object.assign({}, c, { fbState: action }) : c))
    this.setData({ cards })
    if (this.data.offline) return
    try {
      await api.feedback(app.globalData.personId, {
        invocationId: (app.globalData.lastResult || {}).invocationId,
        cardId,
        action,
        reason: reason || null,
      })
      app.loadSilicon(true)
    } catch (err) {
      // 反馈失败不打断用户
      console.warn('feedback failed', err)
    }
  },

  reset() {
    this.setData({
      phase: 'idle',
      input: '',
      selectedTags: [],
      visibleTrace: [],
      cards: [],
      aux: [],
      summary: '',
    })
  },
})

function decorateTrace(t) {
  const badges = { intent: '意图', profile: '档案', recall: '召回', plan: '编排', run: '执行', compose: '合并', done: '完成' }
  return {
    step: t.step,
    stage: t.stage,
    badge: badges[t.stage] || t.stage,
    label: t.label,
    detail: t.detail || '',
    ms: t.ms || 0,
    status: t.status || '',
    failed: t.status === 'failed',
  }
}
