// 我的：一个人的全部——档案、八字、健康、它怎么看你、数据归谁。
//
// 合并说明（2026-10-26）：原来的「档案」页和「我的」页各讲一半，都讲不全，
// 用户要在两个 tab 之间来回跳才能拼出「它到底知道我什么」。现在合成一页，
// 用三段切换避免一条到底的长滚动：
//   档案 = 我是谁（完整度 / 12 维事实 / 冲突裁决 / 八字）
//   身体 = 我现在怎么样（微信运动 / 用药睡眠体重）
//   数据 = 它怎么看我 + 数据归谁（理解你 / 记忆 / Prompt / 授权 / 账本 / 法律）
//
// 红线：明文票据只在内存里用一次，不写本地存储；命盘与健康只描述状态，不作吉凶与医学断言。

const app = getApp()
const api = require('../../utils/api')
const track = require('../../utils/track')

// 十二时辰选择器：value 为该时辰的起时（0-23），「不知道」不录时辰
const HOUR_OPTIONS = [
  { label: '不知道 / 不填', hour: null },
  { label: '子时 23-01', hour: 0 },
  { label: '丑时 01-03', hour: 2 },
  { label: '寅时 03-05', hour: 4 },
  { label: '卯时 05-07', hour: 6 },
  { label: '辰时 07-09', hour: 8 },
  { label: '巳时 09-11', hour: 10 },
  { label: '午时 11-13', hour: 12 },
  { label: '未时 13-15', hour: 14 },
  { label: '申时 15-17', hour: 16 },
  { label: '酉时 17-19', hour: 18 },
  { label: '戌时 19-21', hour: 20 },
  { label: '亥时 21-23', hour: 22 },
]

const HEALTH_TYPES = ['用药', '睡眠', '体重', '其他'] // 记录页的手工健康标签，与本页文案保持一致

// WXSS 不支持中文类名，五行条用英文类名（与首页同一套映射）
const ELEMENT_CLS = { 木: 'mu', 火: 'huo', 土: 'tu', 金: 'jin', 水: 'shui' }

// 拿不到 /api/meta 时的兜底维度，保证离线也能看到结构
const FALLBACK_DIMS = [
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
  { key: 'health.moveGoalKcal', label: '每日运动消耗目标', group: '健康', type: 'number' },
  { key: 'health.moveLike', label: '运动喜好', group: '健康', type: 'text' },
  { key: 'self.identity', label: '自我描述', group: '自我', type: 'text' },
]

const SEGS = [
  { key: 'file', label: '档案' },
  { key: 'auth', label: '授权' },
  { key: 'data', label: '数据' },
]

const GROUP_ORDER = ['饮食', '社交', '生活', '健康', '自我']

// 档案里的运动偏好候选：点一下就写进 health.moveLike，首页「动」模块按这个说话。
// kcal 按 30 分钟中等强度估，只作量级参考，不承诺精确消耗。
const MOVE_LIKES = [
  { name: '快走 30 分钟', kcal: 130 },
  { name: '慢跑 30 分钟', kcal: 300 },
  { name: '游泳 30 分钟', kcal: 280 },
  { name: '骑行 30 分钟', kcal: 240 },
  { name: '力量训练 30 分钟', kcal: 200 },
  { name: '拉伸 / 瑜伽 30 分钟', kcal: 100 },
  { name: '跳绳 15 分钟', kcal: 180 },
  { name: '爬楼 / 爬坡 20 分钟', kcal: 220 },
]

// 授权页的唯一数据源清单：一处看全「谁在拿我的数据、给没给」。
// kind: scope = 微信权限（可用 wx.authorize / openSetting 管）
//       api   = 没有 scope，靠调用时弹窗（微信运动）
//       server= 服务端能力，用户管不了，只能告知
//       none  = 平台不开放，明确说不接入
const AUTH_ITEMS = [
  {
    key: 'werun', name: '微信运动（步数）', kind: 'api', scope: null,
    desc: '读今天走了多少步。拿到即自动记入档案，不用再点按钮。',
  },
  {
    key: 'location', name: '位置', kind: 'scope', scope: 'scope.userLocation',
    desc: '按所在城市推荐吃什么、动什么。不给也能用，退回档案里的城市。',
  },
  {
    key: 'record', name: '麦克风', kind: 'scope', scope: 'scope.record',
    desc: '说一句话转成文字。录完即弃，音频不落盘、不进档案。',
  },
  {
    key: 'camera', name: '相机 / 相册', kind: 'scope', scope: 'scope.camera',
    desc: '拍一张照认识这盘菜。照片只在识别时用一下，不保存。',
  },
  {
    key: 'calendar', name: '写入手机日历', kind: 'api', scope: null,
    desc: '把一条日程写进系统日历。只能写，读不到你已有的日历（系统不开放）。',
  },
  {
    key: 'behavior', name: '站内行为痕迹', kind: 'local', scope: null,
    desc: '记你在小程序里点了什么、翻了哪些页，用来决定首页先给你看什么。只记动作，不记内容。',
  },
  {
    key: 'vault', name: 'Obsidian 仓库', kind: 'server', scope: null,
    desc: '服务端读你的笔记参与判断。笔记不在手机上，也不经过小程序。',
  },
  {
    key: 'llm', name: '大模型', kind: 'server', scope: null,
    desc: '没配模型时全部走规则，照常出结果，不报错。',
  },
  {
    key: 'health', name: 'iPhone「健康」库', kind: 'none', scope: null,
    desc: '不接入：小程序拿不到健康库的用药、睡眠、体重数据，这是系统限制。',
  },
]

Page({
  data: {
    segs: SEGS,
    seg: 'file',
    // ── 头卡 ──
    nickname: '',
    hasNickname: false,
    completenessPct: '',
    offline: false,
    // ── 档案 ──
    groups: [],
    conflicts: [],
    filledCount: 0,
    dimTotal: 12,
    // ── 八字 ──
    birthDate: '',
    hourOptions: HOUR_OPTIONS.map(o => o.label),
    hourIdx: 0,
    birthPlace: '',
    saving: false,
    chart: null,
    chartBars: [],
    // ── 健康（只留今日运动量摘要；手工记录统一在「记录」页）──
    weun: null,
    weunBusy: false,
    // ── 运动偏好（档案里选，首页按这个说）──
    moveLikes: MOVE_LIKES,
    moveLike: '',
    // ── 授权：一处看全所有数据来源 ──
    authItems: [],
    authBusy: false,
    authNote: '',
    // ── 行为痕迹画像 ──
    habit: null,
    habitLoading: false,
    // ── 理解你（带匹配度）/ 记忆 ──
    hints: [],
    hintNote: '',
    recent: [],
    // ── 经验资产摘要（后台数据，只看总数与方向）──
    assetsStats: null,
    // ── 成长条目：你在更新与提升的地方（来自 Obsidian，不是文件列表）──
    growth: null,
    growthLoaded: false,
    growthBusy: false,
    growthPicks: [],
    growthInfo: '',
    // ── 简历 ──
    resumeText: '',
    resumeBusy: false,
    resumeInfo: '',
    resumeHits: [],
    // ── 我的 Prompt / 授权 ──
    grants: [],
    audits: [],
    promptText: '',
    exportInfo: '',
    busy: false,
    // ── 开发设置 ──
    apiBase: '',
    showSettings: false,
  },

  onLoad() {
    this._inited = true
    this.refreshAll()
  },

  onShow() {
    track.pageIn('我的')
    // onLoad 已经全部拉过一次，这里只刷新会随记录变化的部分
    if (!this._inited) return
    this.loadMine()
    this.loadFacts()
    this.refreshAuth()
  },

  onHide() {
    track.pageOut()
    track.flush(true)
  },

  onPullDownRefresh() {
    this.refreshAll().finally(() => wx.stopPullDownRefresh())
  },

  async refreshAll() {
    await Promise.all([this.reload(), this.loadMine(), this.loadFacts(), this.refreshAuth()])
  },

  switchSeg(e) {
    const seg = e.currentTarget.dataset.seg
    if (!seg || seg === this.data.seg) return
    this.setData({ seg })
    // 切到哪段就刷哪段：授权状态会随系统设置变，成长条目会随笔记变
    if (seg === 'auth') {
      this.refreshAuth()
      this.loadHabit()
    }
    if (seg === 'data' && !this.data.growthLoaded) this.loadGrowth()
  },

  // ── 头卡 + 理解你 + 最近记忆 + 八字回填 ──
  async loadMine() {
    const nickname = wx.getStorageSync('nickname') || ''
    this.setData({ nickname, hasNickname: !!nickname, apiBase: api.getBase() })
    try {
      const silicon = await app.loadSilicon(false)
      const recent = (silicon.episodes || []).slice(0, 5).map(e => ({
        id: e.id,
        summary: e.summary || (e.text || '').slice(0, 26),
        when: this.relTime(e.ts),
        tags: (e.tags || []).slice(0, 2),
      }))
      this.setData({
        offline: !!app.globalData.offline,
        completenessPct: Math.round((silicon.completeness || 0) * 100) + '',
        // personaHints 现在是 {text, pct, label} 对象；旧服务端兜底为字符串
        hints: ((silicon.traits && silicon.traits.personaHints) || []).map(h =>
          typeof h === 'string' ? { text: h, pct: 0, label: '' } : h
        ),
        hintNote: (silicon.traits && silicon.traits.hintNote) || '',
        recent,
      })
    } catch (_) {}
    this.loadAssetsStats()
    try {
      const b = await api.getBazi(app.globalData.personId)
      if (b && b.configured) this.applyChart(b)
    } catch (_) {}
  },

  // 经验资产：后台数据只抽「总数 + 方向」，明细不再单独开页
  async loadAssetsStats() {
    try {
      const a = await api.getExperienceAssets(app.globalData.personId)
      this.setData({
        assetsStats: {
          total: a.total || 0,
          active: a.active || 0,
          solidified: a.solidified || 0,
          hitPct: a.hitRate != null ? Math.round(a.hitRate * 100) + '%' : '—',
          effPct: a.avgEffectiveness != null ? Math.round(a.avgEffectiveness * 100) + '%' : '—',
          nextText: (a.nextAction && a.nextAction.text) || '',
        },
      })
    } catch (_) {
      this.setData({ assetsStats: null })
    }
  },

  relTime(ts) {
    if (!ts) return ''
    const diff = Date.now() - new Date(ts).getTime()
    const min = Math.round(diff / 60000)
    if (min < 1) return '刚刚'
    if (min < 60) return `${min} 分钟前`
    const h = Math.round(min / 60)
    if (h < 24) return `${h} 小时前`
    return `${Math.round(h / 24)} 天前`
  },

  setNickname() {
    wx.showModal({
      title: '给自己起个昵称',
      editable: true,
      placeholderText: '最多 12 个字',
      content: this.data.nickname,
      success: res => {
        if (!res.confirm) return
        const v = (res.content || '').trim().slice(0, 12)
        wx.setStorageSync('nickname', v)
        this.setData({ nickname: v, hasNickname: !!v })
        wx.showToast({ title: v ? '昵称已保存' : '已清除昵称', icon: 'success' })
      },
    })
  },

  // ── 档案：12 维事实（原「档案」页的核心，合并进来后仍可点即改）──
  async loadFacts() {
    let silicon = null
    let profile = null
    let conflicts = []
    try {
      const res = await api.getSilicon(app.globalData.personId)
      silicon = res.silicon
      conflicts = res.pendingConflicts || []
      profile = await api.getProfile(app.globalData.personId)
      this.setData({ offline: false })
    } catch (_) {
      this.setData({ offline: true })
      return
    }

    const dims = await this.dimensions()
    const byKey = {}
    for (const f of (profile && profile.facts) || silicon.facts || []) byKey[f.key] = f

    let filledCount = 0
    const groups = GROUP_ORDER.map(name => {
      const items = dims
        .filter(d => d.group === name)
        .map(d => {
          const f = byKey[d.key]
          const conf = f ? Number(f.confidence || 0) : 0
          if (f) filledCount += 1
          return {
            key: d.key,
            label: d.label,
            value: f ? String(f.value) : '未填',
            empty: !f,
            pct: Math.round(conf * 100) + '',
            weak: conf > 0 && conf < 0.5,
            note: (f && f.note) || '',
            options: d.options || [],
            type: d.type,
          }
        })
      return items.length ? { name, items } : null
    }).filter(Boolean)

    this.setData({
      groups,
      conflicts: conflicts.map(c => ({
        id: c.id,
        label: c.label || c.key,
        question: c.question,
        options: c.options || [
          { id: 'keep_new', label: '用新说法' },
          { id: 'keep_old', label: '保留原来' },
          { id: 'both', label: '都算' },
        ],
      })),
      filledCount,
      dimTotal: dims.length,
      moveLike: byKey['health.moveLike'] ? String(byKey['health.moveLike'].value) : '',
      completenessPct: silicon ? Math.round((silicon.completeness || 0) * 100) + '' : this.data.completenessPct,
    })
  },

  // 运动偏好：点一下写进档案，首页「动」模块按这个说话（不再由首页硬推「快走 30 分钟」）
  async pickMoveLike(e) {
    const name = e.currentTarget.dataset.name
    if (!name) return
    const value = this.data.moveLike === name ? '' : name
    this.setData({ moveLike: value })
    track.tap('设置运动偏好', name)
    await this.saveFact('health.moveLike', value || '未设置')
  },

  async dimensions() {
    try {
      const meta = await api.getMeta()
      return (meta && meta.dimensions) || FALLBACK_DIMS
    } catch (_) {
      return FALLBACK_DIMS
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
      await this.loadFacts()
      app.loadSilicon(true)
    } catch (err) {
      wx.showToast({ title: '更新失败', icon: 'none' })
    }
  },

  resolve(e) {
    const cid = e.currentTarget.dataset.id
    const conflict = this.data.conflicts.find(c => c.id === cid)
    if (!conflict) return
    const that = this
    wx.showActionSheet({
      itemList: conflict.options.map(o => o.label),
      success(res) {
        that.doResolve(cid, conflict.options[res.tapIndex].id)
      },
    })
  },

  async doResolve(cid, decision) {
    if (this.data.offline) return
    try {
      await api.resolveConflict(app.globalData.personId, cid, decision)
      wx.showToast({ title: '已定', icon: 'none' })
      await this.loadFacts()
      app.loadSilicon(true)
    } catch (err) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  // ── 八字：改完档案自动生成命盘（没有「重新生成」按钮）──
  onBirthDate(e) {
    this.setData({ birthDate: e.detail.value })
    this.autoBazi()
  },

  onHourPick(e) {
    this.setData({ hourIdx: Number(e.detail.value) })
    this.autoBazi()
  },

  onPlace(e) {
    this.setData({ birthPlace: e.detail.value })
  },

  onPlaceDone() {
    this.autoBazi()
  },

  // 连续改动只在停下来 800ms 后算一次，避免选日期中途打四次接口
  autoBazi() {
    if (this._baziTimer) clearTimeout(this._baziTimer)
    this._baziTimer = setTimeout(() => this.saveBazi(true), 800)
  },

  async saveBazi(silent) {
    if (!this.data.birthDate) {
      if (!silent) wx.showToast({ title: '先选出生年月日', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      const hour = HOUR_OPTIONS[this.data.hourIdx].hour
      const r = await api.saveBazi(app.globalData.personId, {
        date: this.data.birthDate,
        hour,
        place: this.data.birthPlace.trim() || undefined,
      })
      this.applyChart(r)
      if (!silent) wx.showToast({ title: '命盘已生成', icon: 'success' })
      else app.loadSilicon(true)
    } catch (e) {
      if (!silent) wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  applyChart(r) {
    const bars = (r.elements && r.elements.ranked) || []
    const b = r.birth || {}
    const pad = n => (n < 10 ? '0' + n : '' + n)
    this.setData({
      chart: r,
      birthDate: b.y ? `${b.y}-${pad(b.m)}-${pad(b.d)}` : this.data.birthDate,
      hourIdx: Math.max(0, HOUR_OPTIONS.findIndex(o => o.hour === (b.hour === undefined ? null : b.hour))),
      birthPlace: b.place || '',
      chartBars: bars.map(x => ({
        el: x.element,
        cls: ELEMENT_CLS[x.element] || 'mu',
        pct: Math.round((x.share || 0) * 100) + '',
        w: Math.max(4, Math.round((x.share || 0) * 100)),
      })),
    })
  },

  // ── 健康：微信运动 ──
  // 本页只展示「授权情况 + 脱敏摘要」：步数取整到百位，不给逐日明细。
  readWeRun() {
    this.setData({ weunBusy: true })
    const login = () => new Promise((resolve, reject) => wx.login({ success: r => resolve(r.code), fail: reject }))
    const getRun = () => new Promise((resolve, reject) => wx.getWeRunData({ success: resolve, fail: reject }))
    Promise.all([login(), getRun()])
      // 不用 ([code, run]) 参数解构：SWC 会注入 @swc/runtime/_sliced_to_array，
      // 那个 runtime 不进包，页面一加载就 module not defined
      .then(pair => api.weRun({ code: pair[0], encryptedData: pair[1].encryptedData, iv: pair[1].iv }))
      .then(r => {
        if (!r || r.engine !== 'model') {
          wx.showToast({ title: (r && r.reason) || '拿不到步数', icon: 'none' })
          return
        }
        // 脱敏：只留今天的量级，近 7 天明细不出本页
        const step = Math.round((r.today && r.today.step || 0) / 100) * 100
        const kcal = Math.round((r.kcalEstimate || 0) / 10) * 10
        this.setData({ weun: { step, kcal, fastWalkMin: r.fastWalkMin || 0 } })
        this.autoRecordSteps(step, kcal)
      })
      .catch(e => {
        const msg = (e && e.errMsg && /auth|denied/i.test(e.errMsg)) ? '需要授权微信运动' : ((e && e.message) || '读取失败')
        wx.showToast({ title: msg, icon: 'none' })
      })
      .finally(() => this.setData({ weunBusy: false }))
  },

  // 自动记录：与首页共用同一个当日标记，一天只记一次
  autoRecordSteps(step, kcal) {
    if (!step) return
    const d = new Date()
    const p = n => (n < 10 ? '0' + n : '' + n)
    const key = `werunRec_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    if (wx.getStorageSync(key)) return
    wx.setStorageSync(key, 1)
    api
      .record(app.globalData.personId, `今天微信运动约 ${step} 步，约 ${kcal} 千卡`, ['健康', '运动'])
      .catch(() => wx.removeStorageSync(key))
  },

  goRecord() {
    wx.switchTab({ url: '/pages/record/record' })
  },

  // ══ 授权：一处看全所有数据来源，能开的开，能关的关 ══
  //
  // 三条诚实边界（页面上也写着）：
  //   1) 小程序不能主动撤销微信权限，只能引你去系统设置 —— 「关闭」= 打开设置页
  //   2) 微信运动没有 scope，状态只能靠「有没有成功读到过」判断
  //   3) 服务端能力（Obsidian / 大模型）用户管不了，这里只告知，不做假开关
  refreshAuth() {
    return new Promise(resolve => {
      if (typeof wx.getSetting !== 'function') {
        // 桩环境 / 极旧基础库：不假装知道状态，全部显示「去授权」
        this.setData({ authItems: AUTH_ITEMS.map(it => ({ ...it, state: 'none', actionText: '去授权', on: false })) })
        return resolve([])
      }
      wx.getSetting({
        success: res => {
          const setting = res.authSetting || {}
          const trackOn = !wx.getStorageSync('trackOff')
          const items = AUTH_ITEMS.map(it => {
            let state = 'none' // none / granted / denied / ask / on / off / unavailable / server
            let actionText = ''
            if (it.kind === 'scope') {
              if (setting[it.scope] === true) { state = 'granted'; actionText = '已授权' }
              else if (setting[it.scope] === false) { state = 'denied'; actionText = '已拒绝 · 去设置' }
              else { state = 'ask'; actionText = '去授权' }
            } else if (it.kind === 'api') {
              if (it.key === 'werun') {
                state = this.data.weun ? 'granted' : 'ask'
                actionText = this.data.weun ? '已读到' : '去授权'
              } else {
                state = 'ask'
                actionText = '用时会问'
              }
            } else if (it.kind === 'local') {
              state = trackOn ? 'on' : 'off'
              actionText = trackOn ? '开着 · 点此关闭' : '已关闭 · 点此打开'
            } else if (it.kind === 'server') {
              state = 'server'
              actionText = '服务端配置'
            } else {
              state = 'unavailable'
              actionText = '平台不开放'
            }
            return { ...it, state, actionText, on: state === 'granted' || state === 'on' }
          })
          this.setData({ authItems: items })
          resolve(items)
        },
        fail: () => {
          this.setData({ authItems: AUTH_ITEMS.map(it => ({ ...it, state: 'none', actionText: '', on: false })) })
          resolve([])
        },
      })
    })
  },

  // 点一行：按来源类型分别处理
  tapAuth(e) {
    const key = e.currentTarget.dataset.key
    const item = (this.data.authItems || []).find(x => x.key === key)
    if (!item) return
    track.auth(item.name, item.state !== 'granted')
    if (item.kind === 'local') return this.toggleBehavior()
    if (item.kind === 'server' || item.kind === 'none') {
      wx.showToast({ title: item.desc, icon: 'none', duration: 2600 })
      return
    }
    if (item.kind === 'scope') {
      if (item.state === 'granted' || item.state === 'denied') return this.openAuthSetting()
      return this.authorizeScope(item.scope)
    }
    // api：微信运动才能真的去要，日程写入是调用时弹窗
    if (key === 'werun') {
      this.setData({ seg: 'auth' })
      return this.readWeRun()
    }
    wx.showToast({ title: item.desc, icon: 'none' })
  },

  authorizeScope(scope) {
    wx.authorize({
      scope,
      success: () => {
        wx.showToast({ title: '已授权', icon: 'success' })
        this.refreshAuth()
      },
      fail: () => {
        wx.showModal({
          title: '没给权限',
          content: '可以在系统设置里改。不给也能用，只是对应功能会退化。',
          confirmText: '去设置',
          success: r => { if (r.confirm) this.openAuthSetting() },
        })
      },
    })
  },

  openAuthSetting() {
    wx.openSetting({ success: () => this.refreshAuth() })
  },

  // 一次把能要的都要了：逐个 scope 串行，用户看到的是连续几个系统弹窗
  authorizeAll() {
    const pending = (this.data.authItems || []).filter(x => x.kind === 'scope' && x.state === 'ask')
    if (!pending.length) {
      wx.showToast({ title: '能给的都给了，剩下的在系统设置里', icon: 'none' })
      return this.openAuthSetting()
    }
    this.setData({ authBusy: true, authNote: `正在请求 ${pending.length} 项权限…` })
    const next = i => {
      if (i >= pending.length) {
        this.setData({ authBusy: false, authNote: '请求完了。拒绝的可以随时去设置里改。' })
        return this.refreshAuth()
      }
      wx.authorize({
        scope: pending[i].scope,
        success: () => next(i + 1),
        fail: () => next(i + 1),
      })
    }
    next(0)
  },

  toggleBehavior() {
    const on = wx.getStorageSync('trackOff')
    track.setEnabled(!on)
    wx.showToast({ title: on ? '已打开行为记录' : '已关闭，不再记任何动作', icon: 'none' })
    this.refreshAuth()
  },

  async loadHabit() {
    this.setData({ habitLoading: true })
    try {
      const h = await api.behaviorSummary(app.globalData.personId, 30)
      this.setData({ habit: h, habitLoading: false })
    } catch (_) {
      this.setData({ habit: null, habitLoading: false })
    }
  },

  clearHabit() {
    wx.showModal({
      title: '清空行为痕迹',
      content: '会删掉这 30 天的翻页与点击记录，档案里的内容不受影响。',
      success: async r => {
        if (!r.confirm) return
        try {
          await api.clearBehaviors(app.globalData.personId)
          wx.showToast({ title: '已清空', icon: 'success' })
          this.loadHabit()
        } catch (e) {
          wx.showToast({ title: e.message || '清空失败', icon: 'none' })
        }
      },
    })
  },

  // ══ 成长：你在更新与提升的地方（来自 Obsidian，不是文件列表）══
  async loadGrowth() {
    this.setData({ growthBusy: true, growthInfo: '' })
    try {
      if (!this.tokenFor('vault')) await this.signTicket(['vault'], '查看我的成长条目')
      const r = await api.getGrowth(app.globalData.personId, this.tokenFor('vault'))
      this.setData({
        growthLoaded: true,
        growth: {
          configured: r.configured !== false,
          themes: (r.themes || []).map(t => ({
            ...t,
            whenText: t.lastAt ? this.fmt(t.lastAt) : '',
          })),
          recent: (r.recent || []).map(n => ({ ...n, whenText: n.when ? this.fmt(n.when) : '' })),
          note: r.note || '',
          scanned: r.scanned || 0,
        },
        growthPicks: r.picks || [],
      })
    } catch (e) {
      this.setData({ growthLoaded: false, growthInfo: e.message || '读不到成长条目' })
    } finally {
      this.setData({ growthBusy: false })
    }
  },

  // 导出：把整库拼成一份 Markdown 落剪贴板（小程序里零权限的可靠路径）
  async exportObsidian() {
    this.setData({ busy: true })
    try {
      if (!this.tokenFor('vault')) await this.signTicket(['vault'], '导出我的 Obsidian 笔记')
      const dump = await api.obsidianExport(app.globalData.personId, this.tokenFor('vault'))
      const text = (dump.notes || []).map(n => `# ${n.title}\n\n${n.content}`).join('\n\n---\n\n')
      wx.setClipboardData({
        data: text,
        success: () => this.setData({
          growthInfo: `已复制 ${dump.count} 篇笔记（${(text.length / 1024).toFixed(0)} KB）到剪贴板，可粘贴进任何笔记工具`,
        }),
      })
    } catch (e) {
      wx.showToast({ title: e.message || '导出失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  // ── 简历：选文件或粘贴，原文进保险箱，主库只留脱敏版 ──
  onResumeText(e) {
    this.setData({ resumeText: e.detail.value })
  },

  pickResumeFile() {
    const that = this
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['docx', 'pdf', 'txt', 'md'],
      success(res) {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        const name = (file.name || '').toLowerCase()
        const ext = name.split('.').pop()
        if (ext === 'doc') {
          wx.showToast({ title: '旧版 .doc 解析不了，另存为 .docx 再传', icon: 'none', duration: 2600 })
          return
        }
        if (file.size > 4 * 1024 * 1024) {
          wx.showToast({ title: '文件太大（上限 4MB）', icon: 'none' })
          return
        }
        const fs = wx.getFileSystemManager && wx.getFileSystemManager()
        if (!fs || !fs.readFile) {
          wx.showToast({ title: '这台设备读不了文件，直接粘贴吧', icon: 'none' })
          return
        }
        // txt / md 本地就能读，先读进输入框，让用户确认一眼
        if (ext === 'txt' || ext === 'md') {
          fs.readFile({
            filePath: file.path,
            encoding: 'utf8',
            success: r => that.setData({
              resumeText: String(r.data || '').slice(0, 20000),
              resumeInfo: '已读入，确认后再点「存这份简历」',
            }),
            fail: () => wx.showToast({ title: '文件读不出来，直接粘贴吧', icon: 'none' }),
          })
          return
        }
        // docx / pdf：读成 base64 交给服务端解析（文件不落盘，解析完即弃）
        that.setData({ resumeBusy: true, resumeInfo: '正在解析文件…' })
        fs.readFile({
          filePath: file.path,
          encoding: 'base64',
          success: async r => {
            try {
              const out = await api.resumeFile(app.globalData.personId, {
                name: file.name,
                base64: String(r.data || ''),
              })
              that.setData({
                resumeBusy: false,
                resumeHits: ((out.redaction && out.redaction.hits) || []).map(h => `${h.label} ×${h.count}`),
                resumeInfo: (out.file ? `${out.file.format} 解析出 ${out.file.chars} 字 · ` : '') + (out.notice || '已入库'),
              })
              wx.showToast({ title: '简历已记入', icon: 'success' })
              app.loadSilicon(true)
            } catch (e2) {
              that.setData({ resumeBusy: false, resumeInfo: e2.message || '解析失败' })
            }
          },
          fail: () => that.setData({ resumeBusy: false, resumeInfo: '文件读不出来' }),
        })
      },
      fail(e) {
        if (e && /cancel/.test(e.errMsg || '')) return
        wx.showToast({ title: '没选到文件，直接粘贴文本也行', icon: 'none' })
      },
    })
  },

  async submitResume() {
    const text = (this.data.resumeText || '').trim()
    if (text.length < 20) {
      wx.showToast({ title: '简历内容太短，粘贴全文更好', icon: 'none' })
      return
    }
    if (!app.guardLegal()) return
    this.setData({ resumeBusy: true, resumeInfo: '' })
    try {
      const r = await api.resume(app.globalData.personId, text)
      this.setData({
        resumeBusy: false,
        resumeText: '',
        resumeHits: ((r.redaction && r.redaction.hits) || []).map(h => `${h.label} ×${h.count}`),
        resumeInfo: r.notice || '已入库（已脱敏）',
      })
      wx.showToast({ title: '简历已记入', icon: 'success' })
      app.loadSilicon(true)
    } catch (e) {
      this.setData({ resumeBusy: false, resumeInfo: e.message || '上传失败，稍后再试' })
    }
  },

  // ── 我的 Prompt：自动签票 + 读取 ──
  async signTicket(scopes, purpose) {
    const r = await api.issueGrant(app.globalData.personId, { scopes, purpose, ttlSec: 900, maxUses: 3 })
    const held = { ...(app.globalData.tokens || {}) }
    scopes.forEach(k => { held[k] = r.token })
    app.globalData.tokens = held
    this.setData({ issuedToken: r.token })
    await this.reload()
    return r.token
  },

  async viewMyPrompt() {
    this.setData({ busy: true })
    try {
      if (!this.tokenFor('prompt')) await this.signTicket(['prompt'], '查看我的 Prompt')
      await this.readPrompt()
    } catch (e) {
      wx.showToast({ title: e.message || '签授权失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async exportMine() {
    this.setData({ busy: true })
    try {
      if (!this.tokenFor('export')) await this.signTicket(['export'], '导出我的档案')
      await this.doExport({ currentTarget: { dataset: { depth: 'safe' } } })
    } catch (e) {
      wx.showToast({ title: e.message || '导出失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  goLegal(e) {
    wx.navigateTo({ url: '/pages/legal/legal?doc=' + (e.currentTarget.dataset.doc || 'privacy') })
  },

  toggleSettings() {
    this.setData({ showSettings: !this.data.showSettings })
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
          that.refreshAll()
        }
      },
    })
  },

  // ── 授权与审计 ──
  async reload() {
    try {
      const r = await api.getGrants(app.globalData.personId)
      this.setData({
        grants: r.grants.map(g => ({
          ...g,
          scopeText: g.scopeLabels.join('、'),
          stateText: g.revoked ? '已撤销' : g.expired ? '已过期' : `剩 ${g.maxUses - g.used}/${g.maxUses} 次`,
          rowCls: g.revoked || g.expired ? 'grant-row is-dead' : 'grant-row',
        })),
        audits: r.audits.slice(0, 20).map(a => ({
          id: a.id,
          time: this.fmt(a.at),
          text: `${a.action}${a.scope ? ' · ' + a.scope : ''}${a.depth ? ' · ' + a.depth : ''}${a.reason ? ' · ' + a.reason : ''}`,
        })),
      })
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  fmt(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    const p = n => (n < 10 ? '0' + n : '' + n)
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  },

  async revoke(e) {
    try {
      await api.revokeGrant(app.globalData.personId, e.currentTarget.dataset.id)
      wx.showToast({ title: '已撤销', icon: 'success' })
      await this.reload()
    } catch (err) {
      wx.showToast({ title: err.message || '撤销失败', icon: 'none' })
    }
  },

  tokenFor(...scopes) {
    const held = app.globalData.tokens || {}
    for (const s of scopes) if (held[s]) return held[s]
    return null
  },

  async readPrompt() {
    const token = this.tokenFor('prompt')
    if (!token) {
      wx.showToast({ title: '先签一张授权', icon: 'none' })
      return
    }
    try {
      const r = await api.getPrompt(app.globalData.personId, token)
      this.setData({ promptText: r.prompt, exportInfo: '' })
    } catch (e) {
      wx.showToast({ title: e.message || '读取失败', icon: 'none' })
    }
  },

  copyPrompt() {
    if (this.data.promptText) wx.setClipboardData({ data: this.data.promptText })
  },

  async doExport(e) {
    const depth = e.currentTarget.dataset.depth
    const token = this.tokenFor('export')
    if (!token) {
      wx.showToast({ title: '先签一张授权', icon: 'none' })
      return
    }
    try {
      const scopes = depth === 'sealed' ? ['export', 'raw'] : ['export']
      const archive = await api.exportArchive(app.globalData.personId, token, scopes)
      const text = JSON.stringify(archive, null, 2)
      this.setData({
        promptText: '',
        exportInfo: `已生成 ${archive.depth} 导出 · ${(archive.payload.episodes || []).length} 条记忆 · ${(text.length / 1024).toFixed(1)} KB`,
      })
      // 小程序里没有通用的「另存为」，落剪贴板是零权限的可靠路径
      wx.setClipboardData({
        data: text,
        success: () => wx.showToast({ title: '导出内容已复制', icon: 'success' }),
      })
    } catch (err) {
      wx.showToast({ title: err.message || '导出失败', icon: 'none' })
    }
  },
})

function findFact(groups, key) {
  for (const g of groups) {
    const hit = g.items.find(i => i.key === key)
    if (hit) return hit
  }
  return null
}
