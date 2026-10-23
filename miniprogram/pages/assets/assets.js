// 经验资产页：与 H5 的「经验」tab 对齐。
// 小程序此前只有记录/档案/契，缺了这一页 —— 而它才是这个产品的主张所在：
// 经验是可被调用、可被评分、可被你改判的资产，不是聊天记录。

const app = getApp()
const api = require('../../utils/api')

const GROUPS = [
  { key: 'proposed', label: '待确认', hint: '反思挖出来的，还没被验证过。确认后才参与推荐。' },
  { key: 'active', label: '可用', hint: '已经在用；用对了会自动加分。' },
  { key: 'dormant', label: '休眠', hint: '用了几次都没成，已自动降权。可以归档，也可以重新启用。' },
]

// 状态机 → 可用操作。放在这里而不是模板里，模板只负责画。
const ACTS = {
  proposed: [{ label: '确认', act: 'status', value: 'active', cls: 'btn btn-primary btn-sm' }],
  active: [
    { label: '用上了', act: 'apply', value: 'worked', cls: 'btn btn-ghost btn-sm' },
    { label: '没成', act: 'apply', value: 'failed', cls: 'btn btn-ghost btn-sm' },
    { label: '搁置', act: 'status', value: 'dormant', cls: 'btn btn-ghost btn-sm' },
  ],
  dormant: [
    { label: '启用', act: 'status', value: 'active', cls: 'btn btn-ghost btn-sm' },
    { label: '归档', act: 'status', value: 'archived', cls: 'btn btn-ghost btn-sm' },
  ],
}

const SOURCE_LABEL = { reflect: '反思产出', manual: '手写', seed: '示例' }

Page({
  data: {
    loading: true,
    offline: false,
    busy: false,
    reflecting: false,
    assets: null,
    groups: [],
    hitPct: '—',
    effPct: '—',
    nextText: '',
    // 双环：标准只读展示 + 三个阈值由用户改
    criteria: null,
    critVersion: '',
    critConfirmed: '',
    critPromote: '',
    critArchive: '',
    critSamples: '',
    hint: '',
  },

  onShow() {
    this.load()
  },

  async load() {
    this.setData({ loading: true, hint: '' })
    const pid = app.globalData.personId
    try {
      const [a, e] = await Promise.all([api.getExperienceAssets(pid), api.getExperiences(pid)])
      this.render(a.assets, e.experiences || [])
      this.setData({ loading: false, offline: false })
    } catch (err) {
      this.setData({
        loading: false,
        offline: true,
        hint: err.message || '取不到经验资产，检查服务是否在跑',
        groups: [],
        assets: null,
      })
    }
  },

  render(assets, list) {
    const grouped = GROUPS.map(g => {
      const rows = list
        .filter(e => e.status === g.key)
        .map(e => {
          const pct = Math.round((e.effectiveness || 0) * 100)
          return {
            id: e.id,
            rule: e.rule,
            flow: e.flow,
            solidified: !!e.solidified,
            sourceLabel: SOURCE_LABEL[e.source] || e.source || '',
            pct,
            // 颜色分档在这里算：WXML 里不能写比较表达式再配样式表
            barCls: pct >= 65 ? 'hi' : pct >= 40 ? 'mid' : 'lo',
            acts: ACTS[e.status] || [],
          }
        })
      return { ...g, count: rows.length, items: rows }
    }).filter(g => g.count > 0)

    const c = (assets && assets.criteria) || {}
    const t = c.thresholds || {}

    this.setData({
      assets,
      groups: grouped,
      // 百分比在 JS 里算好：WXML 里写三元 + 四舍五入既难读也容易出错
      hitPct: assets && assets.hitRate != null ? Math.round(assets.hitRate * 100) + '%' : '—',
      effPct: assets && assets.avgEffectiveness != null ? Math.round(assets.avgEffectiveness * 100) + '%' : '—',
      nextText: (assets && assets.nextAction && assets.nextAction.text) || '继续记录',
      criteria: c,
      critVersion: c.version || 1,
      critConfirmed: c.confirmedBy === 'user' ? '你确认过' : '用的是默认口径',
      critPromote: String(Math.round((t.promote || 0.72) * 100)),
      critArchive: String(Math.round((t.archive || 0.25) * 100)),
      critSamples: String(t.minSamples || 3),
    })
  },

  // 一个入口处理所有经验动作：act = status | apply
  async onAct(e) {
    if (this.data.busy) return
    const { id, act, value } = e.currentTarget.dataset
    this.setData({ busy: true })
    const pid = app.globalData.personId
    try {
      if (act === 'status') await api.setExperienceStatus(pid, id, value)
      else await api.applyExperience(pid, id, value)
      wx.showToast({ title: act === 'apply' ? '记下了' : '改了', icon: 'none' })
      await this.load()
    } catch (err) {
      wx.showToast({ title: err.message || '没成功', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async reflect() {
    if (this.data.reflecting) return
    this.setData({ reflecting: true, hint: '正在从最近的记录里找规律…' })
    try {
      const r = await api.reflectExperiences(app.globalData.personId)
      const n = (r && r.created && r.created.length) || 0
      this.setData({ hint: n ? `新提炼出 ${n} 条，去下面确认` : '这次没挖出新的，多记几条再试' })
      await this.load()
    } catch (err) {
      this.setData({ hint: err.message || '提炼失败，稍后再试' })
    } finally {
      this.setData({ reflecting: false })
    }
  },

  onCritInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [key]: e.detail.value })
  },

  // 双环：改标准必须由人确认，所以这里再弹一次确认框，而不是点一下就存
  saveCriteria() {
    const p = Number(this.data.critPromote)
    const a = Number(this.data.critArchive)
    const n = Number(this.data.critSamples)
    if (!(p > 0 && p <= 100) || !(a >= 0 && a < 100)) {
      this.setData({ hint: '两个分数要在 0-100 之间' })
      return
    }
    if (p <= a) {
      this.setData({ hint: '固化线要高于休眠线，否则一条经验会同时满足两边' })
      return
    }
    if (!(n >= 1 && n <= 50)) {
      this.setData({ hint: '样本数要落在 1-50 之间' })
      return
    }

    const that = this
    wx.showModal({
      title: '改评估标准？',
      content: `高于 ${p}% 固化，低于 ${a}% 休眠，用够 ${n} 次才升降级。这条线由你定，Agent 不能自己改。`,
      confirmText: '就这样定',
      success(res) {
        if (res.confirm) that.commitCriteria({ promote: p / 100, archive: a / 100, minSamples: n })
      },
    })
  },

  async commitCriteria(thresholds) {
    this.setData({ busy: true })
    try {
      const r = await api.setCriteria(app.globalData.personId, thresholds)
      this.setData({ hint: `已按新标准生效（v${(r.criteria && r.criteria.version) || ''}）` })
      await this.load()
    } catch (err) {
      this.setData({ hint: err.message || '改标准失败了' })
    } finally {
      this.setData({ busy: false })
    }
  },

  goRecord() {
    wx.switchTab({ url: '/pages/record/record' })
  },
})
