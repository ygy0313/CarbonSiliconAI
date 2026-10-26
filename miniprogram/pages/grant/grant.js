// 我的：个人属性聚合页 —— 昵称、个人八字、它现在这样理解你、票据授权、法律文本。
// 红线：明文票据只在本页展示一次，不写本地存储；命盘只描述构成，不作吉凶断言。

const app = getApp()
const api = require('../../utils/api')

const SCOPE_DEFS = [
  { key: 'prompt', label: '读取人格 prompt', desc: '把档案编成驱动 agent 的提示词' },
  { key: 'export', label: '导出档案', desc: '生成可离线保存的标准文件' },
  { key: 'raw', label: '还原原文', desc: '解密被脱敏前的原始记录' },
  { key: 'pii', label: '读取身份信息', desc: '还原手机号/证件号等' },
]

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
    // ── 理解你 ──
    hints: [],
    // ── 票据 ──
    scopes: SCOPE_DEFS.map(s => ({ ...s, on: false, cls: 'chip' })),
    purpose: '',
    issuing: false,
    issuedToken: '',
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

  // ── 个人属性：昵称 / 完整度 / 理解你 ──
  async loadMine() {
    const nickname = wx.getStorageSync('nickname') || ''
    this.setData({ nickname, hasNickname: !!nickname })
    try {
      const silicon = await app.loadSilicon(false)
      this.setData({
        completenessPct: Math.round((silicon.completeness || 0) * 100) + '',
        hints: (silicon.traits && silicon.traits.personaHints) || [],
      })
    } catch (_) {}
    try {
      const b = await api.getBazi(app.globalData.personId)
      if (b && b.configured) this.applyChart(b)
    } catch (_) {}
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
      hourIdx: Math.max(0, HOUR_OPTIONS.findIndex(o => o.hour === (r.birth && r.birth.hour))),
      birthPlace: (r.birth && r.birth.place) || '',
      chartBars: bars.map(x => ({
        el: x.element,
        cls: ELEMENT_CLS[x.element] || 'mu',
        pct: Math.round((x.share || 0) * 100) + '',
        w: Math.max(4, Math.round((x.share || 0) * 100)),
      })),
    })
  },

  goLegal(e) {
    wx.navigateTo({ url: '/pages/legal/legal?doc=' + (e.currentTarget.dataset.doc || 'privacy') })
  },

  // ── 票据（原「契」的全部能力）──
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

  toggleScope(e) {
    const key = e.currentTarget.dataset.key
    const scopes = this.data.scopes.map(s => {
      if (s.key !== key) return s
      const on = !s.on
      return { ...s, on, cls: on ? 'chip chip-on' : 'chip' }
    })
    this.setData({ scopes })
  },

  onPurpose(e) {
    this.setData({ purpose: e.detail.value })
  },

  async issue() {
    const picked = this.data.scopes.filter(s => s.on).map(s => s.key)
    if (!picked.length) {
      wx.showToast({ title: '至少选一项权限', icon: 'none' })
      return
    }
    this.setData({ issuing: true })
    try {
      const r = await api.issueGrant(app.globalData.personId, {
        scopes: picked,
        purpose: this.data.purpose || '未说明用途',
        ttlSec: 900,
        maxUses: 3,
      })
      // 明文票据只此一次；按 scope 存在内存里，退出页面即失效
      const held = { ...(app.globalData.tokens || {}) }
      picked.forEach(k => { held[k] = r.token })
      app.globalData.tokens = held

      this.setData({ issuedToken: r.token })
      wx.showToast({ title: '票据已签发', icon: 'success' })
      await this.reload()
    } catch (e) {
      wx.showToast({ title: e.message || '签发失败', icon: 'none' })
    } finally {
      this.setData({ issuing: false })
    }
  },

  copyToken() {
    if (!this.data.issuedToken) return
    wx.setClipboardData({ data: this.data.issuedToken })
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
      wx.showToast({ title: '先签一张含「读 prompt」的票', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    try {
      const r = await api.getPrompt(app.globalData.personId, token)
      this.setData({ promptText: r.prompt, exportInfo: '' })
    } catch (e) {
      wx.showToast({ title: e.message || '读取失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  copyPrompt() {
    if (this.data.promptText) wx.setClipboardData({ data: this.data.promptText })
  },

  async doExport(e) {
    const depth = e.currentTarget.dataset.depth
    const token = this.tokenFor('export')
    if (!token) {
      wx.showToast({ title: '先签一张含「导出」的票', icon: 'none' })
      return
    }
    this.setData({ busy: true })
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
    } finally {
      this.setData({ busy: false })
    }
  },
})
