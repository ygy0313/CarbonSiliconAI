// 我的：个人属性聚合页 —— 昵称、个人八字、健康（微信运动+手动）、理解你、最近记忆、我的 Prompt、授权与法律。
// 红线：明文票据只在内存里用一次，不写本地存储；命盘/健康只描述状态，不作吉凶与医学断言。

const app = getApp()
const api = require('../../utils/api')

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

const HEALTH_TYPES = ['用药', '睡眠', '体重', '其他']

// WXSS 不支持中文类名，五行条用英文类名（与首页同一套映射）
const ELEMENT_CLS = { 木: 'mu', 火: 'huo', 土: 'tu', 金: 'jin', 水: 'shui' }

Page({
  data: {
    // ── 头卡 ──
    nickname: '',
    hasNickname: false,
    completenessPct: '',
    // ── 八字 ──
    birthDate: '',
    hourOptions: HOUR_OPTIONS.map(o => o.label),
    hourIdx: 0,
    birthPlace: '',
    saving: false,
    chart: null,
    chartBars: [],
    // ── 健康 ──
    weun: null,
    weunBusy: false,
    weunRecorded: false,
    healthTypes: HEALTH_TYPES,
    healthTypeIdx: 0,
    healthText: '',
    healthSaving: false,
    // ── 理解你 / 最近记忆 ──
    hints: [],
    recent: [],
    // ── 我的 Prompt / 授权 ──
    grants: [],
    audits: [],
    promptText: '',
    exportInfo: '',
    busy: false,
  },

  onLoad() {
    this.reload()
    this.loadMine()
  },

  onShow() {
    this.loadMine()
  },

  onPullDownRefresh() {
    Promise.all([this.reload(), this.loadMine()]).finally(() => wx.stopPullDownRefresh())
  },

  // ── 个人属性：昵称 / 完整度 / 理解你 / 最近记忆 / 八字回填 ──
  async loadMine() {
    const nickname = wx.getStorageSync('nickname') || ''
    this.setData({ nickname, hasNickname: !!nickname })
    try {
      const silicon = await app.loadSilicon(false)
      const recent = (silicon.episodes || []).slice(0, 5).map(e => ({
        id: e.id,
        summary: e.summary || (e.text || '').slice(0, 26),
        when: this.relTime(e.ts),
        tags: (e.tags || []).slice(0, 2),
      }))
      this.setData({
        completenessPct: Math.round((silicon.completeness || 0) * 100) + '',
        hints: (silicon.traits && silicon.traits.personaHints) || [],
        recent,
      })
    } catch (_) {}
    try {
      const b = await api.getBazi(app.globalData.personId)
      if (b && b.configured) this.applyChart(b)
    } catch (_) {}
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

  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  // ── 八字录入 ──
  onBirthDate(e) {
    this.setData({ birthDate: e.detail.value })
  },

  onHourPick(e) {
    this.setData({ hourIdx: Number(e.detail.value) })
  },

  onPlace(e) {
    this.setData({ birthPlace: e.detail.value })
  },

  async saveBazi() {
    if (!this.data.birthDate) {
      wx.showToast({ title: '先选出生年月日', icon: 'none' })
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
      wx.showToast({ title: '命盘已生成', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
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
  readWeRun() {
    this.setData({ weunBusy: true })
    const login = () => new Promise((resolve, reject) => wx.login({ success: r => resolve(r.code), fail: reject }))
    const getRun = () => new Promise((resolve, reject) => wx.getWeRunData({ success: resolve, fail: reject }))
    Promise.all([login(), getRun()])
      .then(([code, run]) => api.weRun({ code, encryptedData: run.encryptedData, iv: run.iv }))
      .then(r => {
        if (!r || r.engine !== 'model') {
          wx.showToast({ title: (r && r.reason) || '拿不到步数', icon: 'none' })
          return
        }
        const week = (r.week || []).map(x => ({ ...x, label: x.date.slice(5) }))
        const maxStep = Math.max(1, ...week.map(x => x.step))
        week.forEach(x => { x.pct = Math.max(8, Math.round((x.step / maxStep) * 100)) })
        this.setData({ weun: { ...r, week } })
      })
      .catch(e => {
        const msg = (e && e.errMsg && /auth|denied/i.test(e.errMsg)) ? '需要授权微信运动' : ((e && e.message) || '读取失败')
        wx.showToast({ title: msg, icon: 'none' })
      })
      .finally(() => this.setData({ weunBusy: false }))
  },

  // 步数落档案：走同一条 records 流水线（脱敏 + 入库），记的是量级不是原文
  saveSteps() {
    const w = this.data.weun
    if (!w || !w.today) return
    this.setData({ busy: true })
    api
      .record(app.globalData.personId, `今天微信运动 ${w.today.step} 步，约 ${w.kcalEstimate} 千卡，相当于快走 ${w.fastWalkMin} 分钟`, ['健康', '运动'])
      .then(() => {
        this.setData({ weunRecorded: true })
        wx.showToast({ title: '已记入档案', icon: 'success' })
      })
      .catch(e => wx.showToast({ title: e.message || '记录失败', icon: 'none' }))
      .finally(() => this.setData({ busy: false }))
  },

  // ── 健康：手动记（用药 / 睡眠 / 体重 / 其他）──
  pickHealthType(e) {
    this.setData({ healthTypeIdx: Number(e.currentTarget.dataset.idx) })
  },

  onHealthText(e) {
    this.setData({ healthText: e.detail.value })
  },

  saveHealth() {
    const text = (this.data.healthText || '').trim()
    if (!text) {
      wx.showToast({ title: '先写点内容', icon: 'none' })
      return
    }
    const type = this.data.healthTypes[this.data.healthTypeIdx]
    this.setData({ healthSaving: true })
    api
      .record(app.globalData.personId, `${type}：${text}`, ['健康', type])
      .then(() => {
        this.setData({ healthText: '' })
        wx.showToast({ title: '已记入档案', icon: 'success' })
        this.loadMine()
      })
      .catch(e => wx.showToast({ title: e.message || '记录失败', icon: 'none' }))
      .finally(() => this.setData({ healthSaving: false }))
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
