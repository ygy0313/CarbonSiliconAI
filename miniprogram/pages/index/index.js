const app = getApp()
const api = require('../../utils/api')

// 首页 = 一天里真正会碰到的四件事：运（五行 + 日程展示）、味（吃+饮 揉在一卡）、
// 动（今天消耗了多少 + 离目标还差多少）、灵光一现（梦 / idea / 金句 / link）。
// 两条原则：每个模块都有内容；能自动记的不让用户再点一次按钮。

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

// 当前时段：早 / 午 / 茶歇 / 晚 / 宵（与服务端 SLOT_WHITELIST 一致）
function currentSlot(d = new Date()) {
  const h = d.getHours()
  if (h >= 5 && h < 10) return 'breakfast'
  if (h < 14) return 'lunch'
  if (h < 17) return 'tea'
  if (h < 21) return 'dinner'
  return 'late'
}
const SLOT_TEXT = { breakfast: '早餐', lunch: '午餐', tea: '茶歇', dinner: '晚餐', late: '夜宵' }

// 与服务端同一套问法口径；时段由 slot 显式传给后端，不靠猜关键词
const ASK = {
  meal: '按我的口味推荐一下',
  move: '今天想运动一下，出出汗',
  wine: '今晚喝点什么好',
}

function todayKey(d = new Date()) {
  const p = n => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
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
    // ① 运：今日五行（紧凑版）
    gz: null,
    pillars: [],
    elementBars: [],
    elementNote: '',
    termText: '',
    // ① 运：今日日程（只展示；「加到手机日历」是唯一动作）
    agenda: { items: [], count: 0, headline: '' },
    // ② 味：吃 + 饮 揉在一卡
    slotText: '',
    meal: null,
    mealIdx: 1,
    mealCount: 0,
    brew: null,
    brewIdx: 1,
    brewCount: 0,
    wine: null,
    // ③ 动
    move: null,
    moveIdx: 1,
    moveCount: 0,
    // ③ 动：微信运动（脱敏）+ 目标缺口
    werun: null,
    werunNote: '',
    moveGoal: 0,
    moveGapText: '',
    moveGapDone: false,
    // ④ 灵光一现
    dreamText: '',
    dream: null,
    dreamBusy: false,
    // 底部：按日翻记录
    recDate: '',
    recDateLabel: '今天',
    dayRecords: [],
    dayCount: 0,
    dayLoading: false,
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

  // ── 主加载：身份 → 四个模块并行 ──
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

    // 运动目标：档案里的「每日运动消耗目标」，没设就提示去档案
    const goalKcal = Number(factMap['health.moveGoalKcal'] && factMap['health.moveGoalKcal'].value) || 0

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
        : '点名字去「我的」页完善档案',
      completenessPct: Math.round(completeness * 100) + '',
      serviceCount,
      mode: this.resolveMode(completeness),
      moveGoal: goalKcal,
      slotText: SLOT_TEXT[currentSlot()],
    })

    this.loadOnboard()

    const geo = await this.getUserLocation()
    this.setData({ geoState: geo ? 'ok' : 'denied' })

    // 各模块各拉各的，互不阻塞；任一失败只影响自己那一格
    await Promise.all([
      this.loadGanzhi(),
      this.loadAgenda(),
      this.loadFood(geo),
      this.loadRec('move', ASK.move, geo),
      this.loadWeRun(),
      this.loadDayRecords(''),
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

  // ── ① 运：今日五行（公共历法信息，只谈节奏，不作预测）──
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

  // ── ① 运：今天要做的事（展示为主；要带走就加进手机日历）──
  async loadAgenda() {
    try {
      const r = await api.getAgenda(app.globalData.personId, 7)
      const items = (r.todayItems || []).slice(0, 3).map(i => ({
        id: i.id,
        time: i.time || '待定',
        title: i.title,
      }))
      const today = (r.counts && r.counts.today) || 0
      this.setData({
        agenda: {
          items,
          count: today,
          headline: today ? `今天 ${today} 件事` : '今天空着',
        },
      })
    } catch (_) {
      this.setData({ agenda: { items: [], count: 0, headline: '拿不到日程' } })
    }
  },

  // 日程与手机日历打通：小程序读不到系统日历，能做的是把这件事写进去
  addToCalendar(e) {
    const item = this.data.agenda.items.find(i => i.id === e.currentTarget.dataset.id)
    if (!item || !wx.addPhoneCalendar) {
      wx.showToast({ title: '这台微信不支持写日历', icon: 'none' })
      return
    }
    const [y, m, d] = todayKey().split('-').map(Number)
    const [hh, mm] = (item.time && /^\d{2}:\d{2}$/.test(item.time) ? item.time : '09:00').split(':').map(Number)
    wx.addPhoneCalendar({
      title: item.title,
      startTime: Math.floor(new Date(y, m - 1, d, hh, mm).getTime() / 1000),
      allDay: !(item.time && /^\d{2}:\d{2}$/.test(item.time)),
      success: () => wx.showToast({ title: '已加到手机日历', icon: 'success' }),
      fail: () => wx.showToast({ title: '没加上，看看日历权限', icon: 'none' }),
    })
  },

  // ── ② 味：吃 + 饮 一次编排拿回来，「换一个」在本地轮换 ──
  async loadFood(geo) {
    const slot = currentSlot()
    try {
      const r = await api.orchestrate(app.globalData.personId, ASK.meal, [], { geo, remember: false, slot })
      const cands = ((r && r.cards) || []).filter(c => String(c.id || '').indexOf('meal_') === 0)
        .map(c => ({
          id: c.id,
          title: c.title,
          desc: c.desc,
          why: (c.why || []).slice(0, 2),
          kcal: (c.meta && c.meta.kcal) || null,
          keyword: (c.meta && c.meta.searchKeyword) || c.title,
        }))
      const brews = ((r && r.cards) || []).filter(c => String(c.id || '').indexOf('brew_') === 0)
        .map(c => ({
          id: c.id,
          title: c.title,
          desc: c.desc,
          why: (c.why || []).slice(0, 2),
        }))
      this._meals = cands
      this._brews = brews
      this.setData({
        meal: cands[0] || null,
        mealIdx: 1,
        mealCount: cands.length,
        brew: brews[0] || null,
        brewIdx: 1,
        brewCount: brews.length,
        recCity: (r && r.geoCity) || (geo ? '当前位置' : this.data.city || ''),
        recNote: geo ? '按当前位置' : '按档案城市 · 允许定位会更准',
      })
      // 晚 / 宵时段补一杯酒（选酒能力单独出卡；其余时段茶咖汤饮已够）
      if (slot === 'dinner' || slot === 'late') await this.loadWine()
      else this.setData({ wine: null })
    } catch (_) {
      this.setData({ meal: null, brew: null, wine: null, mealCount: 0, brewCount: 0 })
    }
  },

  // ── ③ 动：一次编排拿回 3 个候选，「换一项」本地轮换 ──
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

  // ── ② 味：晚 / 宵的酒（选酒不报价）──
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
          serve: m.serve || '',
          short: m.short || hit.title,
        },
      })
    } catch (_) {
      this.setData({ wine: null })
    }
  },

  // ── ③ 动：微信运动（只取今天，展示做了脱敏：步数取整到百位）──
  // 拿到就自动记入档案（每天最多一次）—— 不再让用户点「记入档案」按钮
  loadWeRun() {
    this.setData({ werunNote: '' })
    return new Promise(resolve => {
      wx.login({
        success: lg => {
          wx.getWeRunData({
            success: run => {
              api
                .weRun({ code: lg.code, encryptedData: run.encryptedData, iv: run.iv })
                .then(r => {
                  if (!r || r.engine !== 'model' || !r.today) {
                    this.setData({ werun: null })
                    return resolve()
                  }
                  // 脱敏：步数取整到百位，卡路里取整到十位 —— 给量级，不给精确数字
                  const step = Math.round((r.today.step || 0) / 100) * 100
                  const kcal = Math.round((r.kcalEstimate || 0) / 10) * 10
                  this.setData({ werun: { step, kcal }, werunNote: '步数取整展示，原文不入库' })
                  this.autoRecordSteps(step, kcal)
                  resolve()
                })
                .catch(() => {
                  this.setData({ werun: null })
                  resolve()
                })
            },
            fail: () => {
              // 未授权 / 模拟器没数据：静默降级，不打扰
              this.setData({ werun: null })
              resolve()
            },
          })
        },
        fail: () => {
          this.setData({ werun: null })
          resolve()
        },
      })
    })
  },

  // 自动记录：当天第一次拿到步数就落档案，之后不再重复
  autoRecordSteps(step, kcal) {
    if (!step) return this.applyGap(kcal)
    const key = 'werunRec_' + todayKey()
    const done = wx.getStorageSync(key)
    this.applyGap(kcal)
    if (done) return
    wx.setStorageSync(key, 1)
    api
      .record(app.globalData.personId, `今天微信运动约 ${step} 步，约 ${kcal} 千卡`, ['健康', '运动'])
      .then(() => {
        this.setData({ werunNote: '今天的运动量已自动记入档案' })
        app.loadSilicon(true)
      })
      .catch(() => wx.removeStorageSync(key))
  },

  // 缺口 = 目标 − 今日消耗；没设目标就提示去档案
  applyGap(kcal) {
    const goal = this.data.moveGoal
    if (!goal) {
      this.setData({ moveGapText: '', moveGapDone: false })
      return
    }
    if (kcal >= goal) {
      this.setData({ moveGapText: `目标 ${goal} kcal · 已达标，多动的是赚的`, moveGapDone: true })
    } else {
      this.setData({ moveGapText: `目标 ${goal} kcal · 还差 ${goal - kcal} kcal，约 ${(goal - kcal) * 25} 步`, moveGapDone: false })
    }
  },

  // ── ④ 灵光一现：梦 / idea / 金句 / 单词 / link ──
  onDreamText(e) {
    this.setData({ dreamText: e.detail.value })
  },

  // 「探索&创造」：像战友一样把这条想法接住 —— 自动记入档案，再带去跟执笔聊
  async exploreCreate() {
    const text = (this.data.dreamText || '').trim()
    if (!text) {
      wx.showToast({ title: '先写点什么', icon: 'none' })
      return
    }
    if (!app.guardLegal()) return this.reopenLegal()
    this.setData({ dreamBusy: true })
    try {
      await api.record(app.globalData.personId, text, ['灵光一现'])
      app.loadSilicon(true)
      wx.navigateTo({ url: '/pages/chat/chat?text=' + encodeURIComponent(`帮我一起琢磨这个想法：${text}`) })
      this.setData({ dreamText: '', dreamBusy: false })
    } catch (e) {
      this.setData({ dreamBusy: false })
      wx.showToast({ title: e.message || '没记上，稍后再试', icon: 'none' })
    }
  },

  // 「破个局」：拆一拆 —— 梦拆意象，idea 拆下一步怎么走。只给方向，不作吉凶预示
  async breakThrough() {
    const text = (this.data.dreamText || '').trim()
    if (!text) {
      wx.showToast({ title: '先写点什么', icon: 'none' })
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

  // ── 底部：按日翻记录（默认今天，日历可选任意一天）──
  onRecDate(e) {
    this.loadDayRecords(e.detail.value)
  },

  async loadDayRecords(date) {
    const key = date || todayKey()
    const today = todayKey()
    this.setData({ dayLoading: true, recDate: key, recDateLabel: key === today ? '今天' : key })
    try {
      const r = await api.getRecordsByDate(app.globalData.personId, key)
      this.setData({
        dayRecords: (r.episodes || []).map(e => ({
          id: e.id,
          time: new Date(e.ts).toTimeString().slice(0, 5),
          summary: e.summary,
          tags: e.tags || [],
        })),
        dayCount: (r.episodes || []).length,
        dayLoading: false,
      })
    } catch (_) {
      this.setData({ dayRecords: [], dayCount: 0, dayLoading: false })
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

  // 点昵称 / 头像 → 直接去「我的」页改档案
  goMine() {
    wx.switchTab({ url: '/pages/grant/grant' })
  },

  goServices() {
    wx.navigateTo({ url: '/pages/services/services' })
  },
})
