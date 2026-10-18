// 契（授权）：签发票据、撤销、审计、导出。
// 红线：明文票据只在本页展示一次，不写本地存储。

const app = getApp()
const api = require('../../utils/api')

const SCOPE_DEFS = [
  { key: 'prompt', label: '读取人格 prompt', desc: '把档案编成驱动 agent 的提示词' },
  { key: 'export', label: '导出档案', desc: '生成可离线保存的标准文件' },
  { key: 'raw', label: '还原原文', desc: '解密被脱敏前的原始记录' },
  { key: 'pii', label: '读取身份信息', desc: '还原手机号/证件号等' },
]

Page({
  data: {
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
  },

  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh())
  },

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
