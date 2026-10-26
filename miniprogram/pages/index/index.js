const app = getApp()
const api = require('../../utils/api')

// 首页 = 一天里真正会碰到的六件事：历（今天什么日子）、食、动、程（要做什么）、饮、梦。
// 一条原则：每个模块都有内容，而不是一排空按钮 —— 点进去是「换个说法」，
// 不点也能直接看到今天的样子。所以首页是「结果 + 一个动作」，不是入口列表。

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

// 首页三类推荐的问法：和用户自己说出口的话一样，不用「指令语气」
const ASK = {
  meal: '今天中午吃什么，别太辣',
  move: '今天想运动一下，出出汗',
  wine: '今晚喝点什么好',
}

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
    completenessPct: '0',
    // 视角模式：new = 新人引导（可测试重走）；old = 老用户首页
    mode: 'new',
    ackDone: false,
    quizDone: false,
    quizDonePartially: false,
    quizDoneNum: 0,
    quizTotal: 12,
    // ① 今日五行
    gz: null,
    pillars: [],
    elementBars: [],
    elementNote: '',
    termText: '',
    // ② 今天吃什么
    meal: null,
    mealIdx: 1,
    mealCount: 0,
    // ③ 动一动
    move: null,
    moveIdx: 1,
    moveCount: 0,
    // ④ 日程
    agenda: { items: [], count: 0, headline: '', more: 0 },
    // ⑤ 喝点什么
    wine: null,
    // ⑥ 记个梦
    dreamText: '',
    dream: null,
    dreamBusy: false,
    // 定位
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
  },

  onLoad() {
    this._inited = true
  },

  onShow() {
    this.load()
    this.checkLegal()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  // ── 问候开场：按时间段说话 ──
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

  // ── 主加载：身份 → 六个模块并行 ──
  async load() {
    this.buildGreet()
    this.setData({ loading: true })
    const silicon = await app.loadSilicon(true)
    const offline = app.globalData.offline

    const factMap = {}
    for (const f of silicon.facts || []) factMap[f.key] = f

    const identityFact = factMap['self.identity']
    // 隐私：首页默认只显示昵称。档案里的真名不上首页，避免随手一瞥就泄露。
    const nickname = wx.getStorageSync('nickname') || ''
    const realName = (silicon.person && silicon.person.name) || '我'

    const meta = app.globalData.meta
    const serviceCount = (meta && meta.services && meta.services.length) || 9
    const completeness = silicon.completeness || 0

    this.setData({
      loading: false,
      offline,
      nickname,
      hasNickname: !!nickname,
      name: nickname || '给自己起个昵称',
      initial: nickname ? nickname.slice(0, 1) : (realName || '我').slice(0, 1),
      city: (silicon.person && silicon.person.city) || '',
      identity: nickname
        ? ((identityFact && identityFact.value) || '还没有写下你是谁')
        : '点名字给自己起个昵称，首页就不显示真名',
      completenessPct: Math.round(completeness * 100) + '',
      serviceCount,
      mode: this.resolveMode(completeness),
    })

    this.loadOnboard()

    const geo = await this.getUserLocation()
    this.setData({ geoState: geo ? 'ok' : 'denied' })

    // 六个模块各拉各的，互不阻塞；任一失败只影响自己那一格
    await Promise.all([
      this.loadGanzhi(),
      this.loadRec('meal', ASK.meal, geo),
      this.loadRec('move', ASK.move, geo),
      this.loadWine(),
      this.loadAgenda(),
    ])
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

  // ── ① 今日五行（公共历法信息，只谈节奏，不作预测）──
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

  // ── ②③ 吃 / 动：一次编排拿回 3 个候选，「换一个」在本地轮换，不重新算 ──
  async loadRec(kind, text, geo) {
    try {
      // 首页推荐是「算给你看的」，不是「你说的话」，所以 remember:false 不写进记忆
      const r = await api.orchestrate(app.globalData.personId, text, [], { geo, remember: false })
      const prefix = kind === 'meal' ? 'meal_' : 'move_'
      const cands = ((r && r.cards) || [])
        .filter(c => String(c.id || '').indexOf(prefix) === 0)
        .map(c => ({
          id: c.id,
          title: c.title,
          desc: c.desc,
          why: (c.why || []).slice(0, 2),
          kcal: (c.meta && (c.meta.kcal || c.meta.kcal30)) || null,
          keyword: (c.meta && c.meta.searchKeyword) || c.title,
        }))
      if (!cands.length) {
        this.setData({ [kind]: null, [kind + 'Count']: 0 })
        return
      }
      this['_' + kind + 's'] = cands
      this.setData({ [kind]: cands[0], [kind + 'Idx']: 1, [kind + 'Count']: cands.length })
      // 城市口径以服务端定位解析为准：定位成功显示城市名，失败才回退档案城市
      if (kind === 'meal') {
        this.setData({
          recCity: (r && r.geoCity) || (geo ? '当前位置' : this.data.city || ''),
          recNote: geo ? '按当前位置' : '按档案城市 · 允许定位会更准',
        })
      }
    } catch (_) {
      this.setData({ [kind]: null, [kind + 'Count']: 0 })
    }
  },

  nextRec(e) {
    const kind = e.currentTarget.dataset.kind
    const list = this['_' + kind + 's'] || []
    if (list.length < 2) {
      wx.showToast({ title: '就这一条合适，不用换', icon: 'none' })
      return
    }
    const idx = (this.data[kind + 'Idx'] % list.length)
    this.setData({ [kind]: list[idx], [kind + 'Idx']: idx + 1 })
  },

  // ── ④ 日程：今天要做的事，直接摊在首页 ──
  async loadAgenda() {
    try {
      const r = await api.getAgenda(app.globalData.personId, 7)
      const items = (r.todayItems || []).slice(0, 3).map(i => ({
        id: i.id,
        time: i.time || '待定',
        title: i.title,
        done: !!i.done,
        cls: i.done ? 'ag-line is-done' : 'ag-line',
      }))
      const today = (r.counts && r.counts.today) || 0
      const undone = items.filter(i => !i.done).length
      this.setData({
        agenda: {
          items,
          count: today,
          more: Math.max(0, today - items.length),
          headline: today
            ? `今天 ${today} 件事${undone ? ' · 还有 ' + undone + ' 件没做' : ' · 都做完了'}`
            : '今天空着',
        },
      })
    } catch (_) {
      this.setData({ agenda: { items: [], count: 0, more: 0, headline: '拿不到日程' } })
    }
  },

  // ── ⑤ 喝点什么（选酒不报价，只给价位带 + 以店铺为准）──
  async loadWine() {
    try {
      const r = await api.orchestrate(app.globalData.personId, ASK.wine, [], { geo: null, remember: false })
      const hit = ((r && r.cards) || []).find(c => String(c.id || '').indexOf('wine_') === 0)
      if (!hit) {
        this.setData({ wine: null })
        return
      }
      const m = hit.meta || {}
      this.setData({
        wine: {
          id: hit.id,
          title: hit.title,
          desc: hit.desc,
          why: (hit.why || []).slice(0, 2),
          tier: m.tierLabel || '',
          serve: m.serve || '',
          short: m.short || hit.title,
          shop: (m.shop && m.shop.name) || '九月葡园',
          priceNote: m.priceNote || '价格以店铺为准',
        },
      })
    } catch (_) {
      this.setData({ wine: null })
    }
  },

  // ── ⑥ 记个梦：只拆意象与情绪，不解梦 ──
  onDreamText(e) {
    this.setData({ dreamText: e.detail.value })
  },

  async submitDream() {
    const text = (this.data.dreamText || '').trim()
    if (!text) {
      wx.showToast({ title: '先写几句梦里的画面', icon: 'none' })
      return
    }
    if (!app.guardLegal()) return this.reopenLegal()
    this.setData({ dreamBusy: true })
    try {
      const r = await api.orchestrate(app.globalData.personId, text, ['梦'], { remember: true })
      const cards = (r && r.cards) || []
      const primary = cards.find(c => c.kind === 'primary') || cards[0] || null
      const m = (primary && primary.meta) || {}
      this.setData({
        dream: primary
          ? {
            motifs: (m.motifs || []).map(x => x.label).slice(0, 3),
            tone: m.tone || '',
            line: primary.desc || '',
            prior: m.priorCount || 0,
          }
          : null,
        dreamText: '',
      })
      app.loadSilicon(true)
    } catch (e) {
      wx.showToast({ title: e.message || '没记上，稍后再试', icon: 'none' })
    } finally {
      this.setData({ dreamBusy: false })
    }
  },

  // ── 定位 ──
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

  // 定位被拒时直接跳设置，比让人自己去翻「我的」页快
  openSetting() {
    wx.openSetting({
      success: res => {
        if (res.authSetting && res.authSetting['scope.userLocation']) this.load()
      },
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
      this.openSetting()
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

  // ── 跳转 ──
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

  goAgenda() {
    wx.switchTab({ url: '/pages/agenda/agenda' })
  },

  goMine() {
    wx.switchTab({ url: '/pages/grant/grant' })
  },

  goServices() {
    wx.navigateTo({ url: '/pages/services/services' })
  },
})
