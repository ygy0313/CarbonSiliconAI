const app = getApp()
const api = require('../../utils/api')

// 前端只做展示，不在 wxml 里做计算（小程序模板不支持数组方法）
const DIM_ORDER = [
  'diet.spicy', 'diet.stomach', 'diet.taste', 'diet.avoid',
  'social.groupSize', 'social.experience', 'social.preference', 'social.role',
  'life.city', 'life.budget', 'life.rhythm', 'self.identity',
]

// 五行只谈节奏方向，不谈吉凶 —— 与 fortune.agent 是同一条红线
// WXSS 不支持中文类名，五行用英文类名上色（el → cls 预计算映射）
const ELEMENT_CLS = { 木: 'mu', 火: 'huo', 土: 'tu', 金: 'jin', 水: 'shui' }
const ELEMENT_NOTE = {
  木: '生发的一行，适合把搁置的事往前推一步',
  火: '外放的一行，适合见人、表达、把话说开',
  土: '偏稳的一行，适合收尾、整理、把底子打牢',
  金: '收敛的一行，适合做减法、砍掉不必要的',
  水: '偏藏的一行，适合休息、回顾、少做决定',
}

const ELEMENT_LIST = ['木', '火', '土', '金', '水']

Page({
  data: {
    loading: true,
    offline: false,
    name: '',
    nickname: '',
    hasNickname: false,
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
    mode: 'new',
    ackDone: false,
    quizDone: false,
    quizDonePartially: false,
    quizDoneNum: 0,
    quizTotal: 12,
    // 今日五行
    gz: null,
    pillars: [],
    elementBars: [],
    elementNote: '',
    termText: '',
    // 今日推荐
    recFood: null,
    recMove: null,
    recCity: '',
    recNote: '',
    geoState: 'pending',
    // 问候开场
    greetDate: '',
    greetHello: '',
    // 同意门
    needAck: false,
    declined: false,
    legalVersion: '',
    serviceCount: 9,
    quick: [
      { key: 'eat', label: '今天吃什么', text: '今天中午吃什么，别太辣' },
      { key: 'move', label: '动一动', text: '今天想运动一下，出出汗' },
      { key: 'gather', label: '组个局', text: '周六想和朋友组个局，6个人' },
      { key: 'drink', label: '喝点什么', text: '今晚喝点什么好' },
      { key: 'dream', label: '记个梦', text: '昨晚梦见水一直涨，一直在找一扇门' },
    ],
  },

  onShow() {
    this.load()
    this.checkLegal()
  },

  // ── 问候开场：按时间段说话 + 今日安排一句话 ──
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
      greetHello: `${hello}，您的今日安排`,
    })
  },

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

  // ── 昵称：只存本机，不上传，不替代档案里的真名 ──
  setNickname() {
    wx.showModal({
      title: '起个昵称',
      editable: true,
      placeholderText: this.data.nickname || '别人怎么叫你',
      content: this.data.nickname || '',
      success: res => {
        if (!res.confirm) return
        const v = String(res.content || '').trim().slice(0, 12)
        if (!v) return
        wx.setStorageSync('nickname', v)
        this.setData({ nickname: v, hasNickname: true, name: v, initial: v.slice(0, 1) })
        wx.showToast({ title: '昵称只存在这台手机上', icon: 'none' })
      },
    })
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
    // 隐私：首页默认只显示昵称。档案里的真名不上首页，避免随手一瞥就泄露。
    const nickname = wx.getStorageSync('nickname') || ''
    const realName = (silicon.person && silicon.person.name) || '我'
    const shownName = nickname || '给自己起个昵称'

    const meta = app.globalData.meta
    const serviceCount = (meta && meta.services && meta.services.length) || 9

    const completeness = silicon.completeness || 0
    this.setData({
      loading: false,
      offline,
      nickname,
      hasNickname: !!nickname,
      name: shownName,
      initial: nickname ? nickname.slice(0, 1) : (realName || '我').slice(0, 1),
      city: (silicon.person && silicon.person.city) || '',
      identity: nickname
        ? ((identityFact && identityFact.value) || '还没有写下你是谁')
        : '点名字给自己起个昵称，首页就不显示真名',
      completeness,
      completenessPct: Math.round(completeness * 100) + '',
      dims,
      filled,
      recent,
      serviceCount,
      mode: this.resolveMode(completeness),
    })
    this.loadOnboard()
    this.loadGanzhi()
    this.loadRecs()
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
      this.setData({ quizDoneNum: 0, quizTotal: 12, quizDone: false, quizDonePartially: false })
    }
  },

  // ── 今日五行（公共历法信息，只谈节奏，不作预测）──
  async loadGanzhi() {
    try {
      const g = await api.getGanzhi(app.globalData.personId)
      const ranked = (g.elements && g.elements.ranked) || []
      const byEl = {}
      for (const r of ranked) byEl[r.element] = r
      const bars = ELEMENT_LIST.map(el => {
        const r = byEl[el]
        const share = r ? r.share : 0
        return {
          el,
          cls: ELEMENT_CLS[el] || 'mu',
          share,
          pct: Math.round(share * 100) + '',
          w: Math.max(4, Math.round(share * 100)),
        }
      })
      const top = ranked[0]
      const pillars = [
        { label: '年', text: g.pillars.year, el: g.year.ganElement + g.year.zhiElement },
        { label: '月', text: g.pillars.month, el: g.month.ganElement + g.month.zhiElement },
        { label: '日', text: g.pillars.day, el: g.day.ganElement + g.day.zhiElement },
      ]
      this.setData({
        gz: g,
        pillars,
        elementBars: bars,
        elementNote: top ? `${top.element} 最旺 · ${ELEMENT_NOTE[top.element] || ''}` : '',
        termText: g.term && g.term.current ? `${g.term.current.name} · 距${g.term.next.name} ${Math.round(g.term.next.daysAway)} 天` : '',
      })
    } catch (_) {
      this.setData({ gz: null })
    }
  },

  // ── 今日安排：定位 → 餐饮 + 运动各一条，卡路里与搜索词都带上 ──
  getUserLocation() {
    return new Promise(resolve => {
      const cached = app.globalData.geo
      if (cached) return resolve(cached)
      wx.getLocation({
        type: 'gcj02',
        success: res => {
          const geo = { lat: res.latitude, lon: res.longitude }
          app.globalData.geo = geo
          resolve(geo)
        },
        fail: () => resolve(null),
      })
    })
  },

  async loadRecs() {
    const geo = await this.getUserLocation()
    this.setData({ geoState: geo ? 'ok' : 'denied' })

    // 首页推荐是「算给你看的」，不是「你说的话」，所以 remember:false 不写进记忆
    const ask = async text => {
      try {
        const r = await api.orchestrate(app.globalData.personId, text, [], { geo, remember: false })
        return r
      } catch (_) {
        return null
      }
    }

    const [eat, move] = await Promise.all([
      ask('今天中午吃什么，别太辣'),
      ask('今天想运动一下，出出汗'),
    ])

    const pick = (res, prefix) => {
      const cards = (res && res.cards) || []
      const hit = cards.find(c => String(c.id || '').indexOf(prefix) === 0)
      if (!hit) return null
      return {
        id: hit.id,
        title: hit.title,
        desc: hit.desc,
        why: (hit.why || []).slice(0, 2),
        kcal: (hit.meta && hit.meta.kcal) || (hit.meta && hit.meta.kcal30) || null,
        keyword: (hit.meta && hit.meta.searchKeyword) || hit.title,
        note: (hit.meta && hit.meta.note) || '',
      }
    }

    this.setData({
      recFood: pick(eat, 'meal_'),
      recMove: pick(move, 'move_'),
      recCity: (geo && geo.city) || this.data.city || '',
      recNote: geo ? '按当前位置推荐' : '按档案里的城市推荐 · 允许定位会更准',
    })
  },

  copyKeyword(e) {
    const kw = e.currentTarget.dataset.kw || ''
    const appName = e.currentTarget.dataset.app || '点评'
    if (!kw) return
    wx.setClipboardData({
      data: kw,
      success: () => wx.showToast({ title: `已复制，去${appName}粘贴搜索`, icon: 'none' }),
    })
  },

  openMyMap() {
    const geo = app.globalData.geo
    if (!geo) {
      wx.showToast({ title: '先允许定位才能看位置', icon: 'none' })
      return
    }
    wx.openLocation({
      latitude: geo.lat,
      longitude: geo.lon,
      name: '我的位置',
      address: this.data.recCity || '',
      scale: 14,
    })
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
