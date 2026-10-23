const app = getApp()
const api = require('../../utils/api')
const mock = require('../../utils/mock')

const GROUP_ORDER = ['饮食', '社交', '生活', '自我']

Page({
  data: {
    loading: true,
    offline: false,
    name: '',
    completeness: 0,
    completenessPct: '0',
    groups: [],
    conflicts: [],
    memories: [],
    apiBase: '',
    showSettings: false,
    editing: null,
  },

  onShow() {
    this.load()
  },

  async load() {
    this.setData({ loading: true, apiBase: api.getBase() })

    let silicon, profile, conflicts = []
    try {
      const res = await api.getSilicon(app.globalData.personId)
      silicon = res.silicon
      conflicts = res.pendingConflicts || []
      profile = await api.getProfile(app.globalData.personId)
      this.setData({ offline: false })
    } catch (err) {
      silicon = mock.silicon
      profile = { facts: mock.silicon.facts, episodes: mock.silicon.episodes }
      this.setData({ offline: true })
    }

    const dims = await this.dimensions()

    const byKey = {}
    for (const f of profile.facts || []) byKey[f.key] = f

    const groups = GROUP_ORDER.map(name => {
      const items = dims
        .filter(d => d.group === name)
        .map(d => {
          const f = byKey[d.key]
          const conf = f ? Number(f.confidence || 0) : 0
          return {
            key: d.key,
            label: d.label,
            value: f ? String(f.value) : '未填写',
            empty: !f,
            pct: Math.round(conf * 100) + '',
            weak: conf > 0 && conf < 0.5,
            note: (f && f.note) || '',
            options: d.options || [],
            type: d.type,
          }
        })
        .filter(Boolean)
      return items.length ? { name, items, count: items.filter(i => !i.empty).length } : null
    }).filter(Boolean)

    const memories = (profile.episodes || []).slice(0, 12).map(e => ({
      id: e.id,
      summary: e.summary || (e.text || '').slice(0, 26),
      when: relTime(e.ts),
      kind: e.kind || 'note',
    }))

    const cf = conflicts.map(c => ({
      id: c.id,
      label: c.label || c.key,
      question: c.question,
      options: c.options || [
        { id: 'keep_new', label: '用新说法' },
        { id: 'keep_old', label: '保留原来' },
        { id: 'both', label: '都算' },
      ],
    }))

    this.setData({
      loading: false,
      name: (silicon.person && silicon.person.name) || '我',
      completeness: silicon.completeness,
      completenessPct: Math.round((silicon.completeness || 0) * 100) + '',
      groups,
      conflicts: cf,
      memories,
    })
  },

  async dimensions() {
    const fallback = [
      { key: 'diet.spicy', label: '辣度耐受', group: '饮食', type: 'enum', options: ['不吃辣', '微辣', '中辣', '重辣'] },
      { key: 'diet.stomach', label: '肠胃', group: '饮食', type: 'enum', options: ['正常', '偏敏感', '易上火'] },
      { key: 'diet.taste', label: '口味倾向', group: '饮食', type: 'enum', options: ['清淡', '咸鲜', '重口', '偏甜'] },
      { key: 'diet.avoid', label: '忌口', group: '饮食', type: 'tags' },
      { key: 'social.groupSize', label: '常组局人数', group: '社交', type: 'number' },
      { key: 'social.experience', label: '剧本杀经验', group: '社交', type: 'enum', options: ['没玩过', '1-3 次', '3 次以上', '老玩家'] },
      { key: 'social.preference', label: '题材偏好', group: '社交', type: 'tags' },
      { key: 'social.role', label: '组局角色', group: '社交', type: 'enum', options: ['发起人', '跟随者', '都可'] },
      { key: 'life.city', label: '常驻城市', group: '生活', type: 'text' },
      { key: 'life.budget', label: '单次预算', group: '生活', type: 'number' },
      { key: 'life.rhythm', label: '作息节奏', group: '生活', type: 'enum', options: ['早睡早起', '正常', '夜猫子'] },
      { key: 'self.identity', label: '自我描述', group: '自我', type: 'text' },
    ]
    try {
      const meta = await api.getMeta()
      return meta.dimensions || fallback
    } catch (err) {
      return fallback
    }
  },

  editFact(e) {
    const key = e.currentTarget.dataset.key
    const item = findFact(this.data.groups, key)
    if (!item) return

    if (item.options && item.options.length) {
      const that = this
      wx.showActionSheet({
        itemList: item.options,
        success(res) {
          that.saveFact(key, item.options[res.tapIndex])
        },
      })
      return
    }

    const that = this
    wx.showModal({
      title: item.label,
      editable: true,
      placeholderText: item.empty ? '填一个值' : item.value,
      success(res) {
        if (res.confirm && res.content) that.saveFact(key, res.content.trim())
      },
    })
  },

  async saveFact(key, value) {
    if (this.data.offline) {
      wx.showToast({ title: '离线模式改不了', icon: 'none' })
      return
    }
    try {
      await api.saveFact(app.globalData.personId, key, value)
      wx.showToast({ title: '已更新', icon: 'none' })
      this.load()
      app.loadSilicon(true)
    } catch (err) {
      // api 上未导出时走通用请求兜底
      wx.showToast({ title: '更新失败', icon: 'none' })
    }
  },

  async resolve(e) {
    const cid = e.currentTarget.dataset.id
    const that = this
    const conflict = this.data.conflicts.find(c => c.id === cid)
    if (!conflict) return

    wx.showActionSheet({
      itemList: conflict.options.map(o => o.label),
      success(res) {
        const decision = conflict.options[res.tapIndex].id
        that.doResolve(cid, decision)
      },
    })
  },

  async doResolve(cid, decision) {
    if (this.data.offline) return
    try {
      await api.resolveConflict(app.globalData.personId, cid, decision)
      wx.showToast({ title: '已定', icon: 'none' })
      this.load()
      app.loadSilicon(true)
    } catch (err) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  toggleSettings() {
    this.setData({ showSettings: !this.data.showSettings })
  },

  openDoc(e) {
    const doc = e.currentTarget.dataset.doc || 'privacy'
    wx.navigateTo({ url: '/pages/legal/legal?doc=' + doc })
  },

  saveBase() {
    const that = this
    wx.showModal({
      title: '服务地址',
      editable: true,
      placeholderText: this.data.apiBase,
      success(res) {
        if (res.confirm && res.content) {
          app.setApiBase(res.content.trim())
          that.setData({ apiBase: res.content.trim() })
          wx.showToast({ title: '已切换', icon: 'none' })
          that.load()
        }
      },
    })
  },
})

function findFact(groups, key) {
  for (const g of groups) {
    const hit = g.items.find(i => i.key === key)
    if (hit) return hit
  }
  return null
}

function relTime(ts) {
  if (!ts) return ''
  const day = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  if (day <= 0) return '今天'
  if (day === 1) return '昨天'
  if (day < 7) return day + ' 天前'
  if (day < 30) return Math.floor(day / 7) + ' 周前'
  return Math.floor(day / 30) + ' 个月前'
}
