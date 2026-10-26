const app = getApp()
const api = require('../../utils/api')

// 前端只做展示，不在 wxml 里做计算（小程序模板不支持数组方法）
const DIM_ORDER = [
  'diet.spicy', 'diet.stomach', 'diet.taste', 'diet.avoid',
  'social.groupSize', 'social.experience', 'social.preference', 'social.role',
  'life.city', 'life.budget', 'life.rhythm', 'self.identity',
]

Page({
  data: {
    loading: true,
    offline: false,
    name: '',
    initial: '',
    city: '',
    identity: '',
    completeness: 0,
    completenessPct: '0',
    hints: [],
    dims: [],
    filled: 0,
    total: 12,
    recent: [],
    conflicts: 0,
    // 视角模式：new = 新人引导（可测试重走）；old = 老用户首页。
    // 自动判断（档案薄就当新人），storage 里的手动切换优先。
    mode: 'new',
    // 新人三步状态
    ackDone: false,
    quizDone: false,
    quizDonePartially: false,
    quizDoneNum: 0,
    quizTotal: 12,
    // 问候开场
    greetDate: '',
    greetHello: '',
    // 同意门：版本号对齐才放行写入，弹层可暂时关闭但写入仍然拦住
    needAck: false,
    declined: false,
    legalVersion: '',
    serviceCount: 9,
    quick: [
      { key: 'eat', label: '今天吃什么', text: '今天中午吃什么，别太辣' },
      { key: 'gather', label: '组个局', text: '周六想和朋友组个局，6个人' },
      { key: 'drink', label: '喝点什么', text: '今晚喝点什么好' },
      { key: 'gift', label: '送点什么', text: '过节给长辈送瓶酒，预算 300' },
      { key: 'dream', label: '记个梦', text: '昨晚梦见水一直涨，一直在找一扇门' },
    ],
  },

  onShow() {
    this.load()
    this.checkLegal()
  },

  // ── 问候开场：按时间段说话，日期每天翻新 ──
  buildGreet() {
    const d = new Date()
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
    const h = d.getHours()
    let hello = '晚上好'
    if (h < 5) hello = '夜深了'
    else if (h < 11) hello = '早上好'
    else if (h < 14) hello = '中午好'
    else if (h < 18) hello = '下午好'
    this.setData({
      greetDate: `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${week}`,
      greetHello: hello + '，今天过成了什么样？',
    })
  },

  // ── 视角模式：手动切换存 storage，优先于自动判断 ──
  resolveMode(completeness) {
    const manual = wx.getStorageSync('homeMode')
    if (manual === 'new' || manual === 'old') return manual
    return completeness < 0.3 ? 'new' : 'old'
  },

  toggleMode() {
    const next = this.data.mode === 'new' ? 'old' : 'new'
    wx.setStorageSync('homeMode', next)
    this.setData({ mode: next })
    this.loadOnboard()
    wx.showToast({ title: next === 'new' ? '已切到新人视角' : '已切到老用户视角', icon: 'none' })
  },

  async checkLegal() {
    const r = await app.ensureLegal()
    this.setData({ needAck: r.needAck, legalVersion: r.version, ackDone: !r.needAck })
  },

  ackLegal() {
    app.ackLegal(this.data.legalVersion)
    this.setData({ needAck: false, declined: false, ackDone: true })
    wx.showToast({ title: '记下了', icon: 'none' })
  },

  // 不同意就只是不写：浏览照常，写入入口全部拦住
  declineLegal() {
    this.setData({ needAck: false, declined: true })
    wx.showToast({ title: '那就不记。随时可以改主意', icon: 'none' })
  },

  reopenLegal() {
    this.setData({ needAck: true, declined: false })
  },

  openDoc(e) {
    const doc = e.currentTarget.dataset.doc || 'privacy'
    wx.navigateTo({ url: '/pages/legal/legal?doc=' + doc })
  },

  async load() {
    this.buildGreet()
    this.setData({ loading: true })
    const silicon = await app.loadSilicon(true)
    const offline = app.globalData.offline

    const factMap = {}
    for (const f of silicon.facts || []) factMap[f.key] = f

    const dims = DIM_ORDER.map(key => {
      const f = factMap[key]
      const on = !!f && f.confidence >= 0.4
      const weak = !!f && f.confidence >= 0.25 && f.confidence < 0.4
      return { key, on, weak, cls: on ? 'on' : weak ? 'weak' : 'off' }
    })
    const filled = dims.filter(d => d.on).length

    const recent = (silicon.episodes || []).slice(0, 3).map(e => ({
      id: e.id,
      summary: e.summary || (e.text || '').slice(0, 22),
      when: relTime(e.ts),
      tags: (e.tags || []).slice(0, 2),
    }))

    const identityFact = factMap['self.identity']
    const name = (silicon.person && silicon.person.name) || '我'

    // 服务条数以服务端注册表为准，避免文案写死之后跟实现脱节
    const meta = app.globalData.meta
    const serviceCount = (meta && meta.services && meta.services.length) || 9

    const completeness = silicon.completeness || 0
    this.setData({
      loading: false,
      offline,
      name,
      initial: name.slice(0, 1),
      city: (silicon.person && silicon.person.city) || '',
      identity: (identityFact && identityFact.value) || '还没有写下你是谁',
      completeness,
      completenessPct: Math.round(completeness * 100) + '',
      hints: (silicon.traits && silicon.traits.personaHints) || [],
      dims,
      filled,
      recent,
      serviceCount,
      mode: this.resolveMode(completeness),
    })
    this.loadOnboard()
  },

  // 新人三步进度：同意状态 + 问答进度（拿不到就按 0 处理，不挡页面）
  async loadOnboard() {
    if (this.data.mode !== 'new') return
    try {
      const r = await api.getQuiz(app.globalData.personId)
      const p = r.progress || {}
      const done = p.done || 0
      const total = p.total || 12
      this.setData({
        quizDoneNum: done,
        quizTotal: total,
        quizDone: done >= total,
        quizDonePartially: done > 0 && done < total,
      })
    } catch (_) {
      // 离线或接口失败：进度保持未知，不打断新人流程
      this.setData({ quizDoneNum: 0, quizTotal: 12, quizDone: false, quizDonePartially: false })
    }
  },

  goQuiz() {
    if (!app.guardLegal()) return this.reopenLegal()
    wx.navigateTo({ url: '/pages/quiz/quiz' })
  },

  goChat(e) {
    if (!app.guardLegal()) return this.reopenLegal()
    const text = e.currentTarget.dataset.text || ''
    wx.navigateTo({ url: '/pages/chat/chat?text=' + encodeURIComponent(text) })
  },

  goChatEmpty() {
    if (!app.guardLegal()) return this.reopenLegal()
    wx.navigateTo({ url: '/pages/chat/chat' })
  },

  goRecord() {
    if (!app.guardLegal()) return this.reopenLegal()
    wx.switchTab({ url: '/pages/record/record' })
  },

  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  goServices() {
    wx.navigateTo({ url: '/pages/services/services' })
  },
})

function relTime(ts) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  const day = Math.floor(diff / 86400000)
  if (day <= 0) return '今天'
  if (day === 1) return '昨天'
  if (day < 7) return day + ' 天前'
  if (day < 30) return Math.floor(day / 7) + ' 周前'
  return Math.floor(day / 30) + ' 个月前'
}
