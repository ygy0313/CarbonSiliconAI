const app = getApp()
const api = require('../../utils/api')
const mock = require('../../utils/mock')

const TAGS = ['胃不舒服', '一个人', '和朋友', '和家人', '熬夜', '上火', '没胃口']

const ACTION_LABEL = {
  created: '新建',
  updated: '修正',
  confirmed: '确认',
  kept: '保留',
}

Page({
  data: {
    text: '',
    tagOptions: TAGS.map(t => ({ label: t, on: false, cls: 'chip' })),
    selectedTags: [],
    saving: false,
    result: null,
    recent: [],
    offline: false,
  },

  onShow() {
    this.loadRecent()
  },

  async loadRecent() {
    return
  },

  onInput(e) {
    this.setData({ text: e.detail.value })
  },

  toggleTag(e) {
    const tag = e.currentTarget.dataset.tag
    const list = this.data.selectedTags.slice()
    const idx = list.indexOf(tag)
    if (idx >= 0) list.splice(idx, 1)
    else list.push(tag)
    const options = this.data.tagOptions.map(o => ({
      label: o.label,
      on: list.indexOf(o.label) >= 0,
      cls: list.indexOf(o.label) >= 0 ? 'chip chip-on' : 'chip',
    }))
    this.setData({ selectedTags: list, tagOptions: options })
  },

  async save() {
    const text = (this.data.text || '').trim()
    if (!text) {
      wx.showToast({ title: '写点什么再存', icon: 'none' })
      return
    }
    this.setData({ saving: true })

    let result
    try {
      result = await api.record(app.globalData.personId, text, this.data.selectedTags)
      this.setData({ offline: false })
    } catch (err) {
      result = mock.record(text)
      this.setData({ offline: true })
    }

    const changes = (result.factChanges || []).map(c => ({
      key: c.key,
      label: c.label || c.key,
      action: c.action,
      actionLabel: ACTION_LABEL[c.action] || c.action,
      arrow: c.before && c.after && c.before !== c.after,
      before: c.before === null || c.before === undefined ? '' : String(c.before),
      after: c.after === null || c.after === undefined ? '' : String(c.after),
    }))

    this.setData({
      saving: false,
      result: {
        summary: (result.extracted && result.extracted.summary) || text.slice(0, 20),
        tags: (result.extracted && result.extracted.tags) || [],
        changes,
        hints: (result.silicon && result.silicon.hints) || [],
        completeness: Math.round(((result.silicon && result.silicon.completeness) || 0) * 100),
        memoryCount: (result.silicon && result.silicon.memoryCount) || 0,
        conflicts: result.conflicts || [],
      },
      text: '',
      selectedTags: [],
      tagOptions: TAGS.map(t => ({ label: t, on: false, cls: 'chip' })),
    })

    app.loadSilicon(true)
    wx.showToast({ title: '记下了', icon: 'none' })
  },

  clearResult() {
    this.setData({ result: null })
  },

  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' })
  },
})
