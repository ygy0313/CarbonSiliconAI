// 起居注 · 小程序入口
const api = require('./utils/api')

App({
  globalData: {
    personId: 'p_owner',
    // 默认连线上 ECS；本地开发在「档案 → 开发设置 → 服务地址」填 http://127.0.0.1:8787
    apiBase: 'http://8.136.205.105:8787',
    silicon: null,
    offline: false,
    // 授权票据：只在内存里，退出小程序即失效（明文票据绝不落 storage）
    tokens: {},
  },

  onLaunch() {
    const saved = wx.getStorageSync('apiBase')
    if (saved) this.globalData.apiBase = saved
    api.setBase(this.globalData.apiBase)

    // 记录用户最近一次意图，用于首页「继续上次」
    this.globalData.lastIntent = wx.getStorageSync('lastIntent') || ''
  },

  setApiBase(base) {
    this.globalData.apiBase = base
    wx.setStorageSync('apiBase', base)
    api.setBase(base)
  },

  // 同意状态：本地只存版本号，不存任何身份信息。
  // 版本跟着服务端的法律文本走 —— 文本一改，版本号变，就要重新同意。
  getAckVersion() {
    return wx.getStorageSync('legalAck') || ''
  },

  async ensureLegal() {
    const local = this.getAckVersion()
    let remote = this.globalData.legalVersion
    if (!remote) {
      try {
        const meta = await api.getMeta()
        this.globalData.meta = meta
        remote = (meta && meta.legal && meta.legal.version) || ''
        this.globalData.legalVersion = remote
      } catch (_) {
        // 取不到就不弹：没网时不该拦着人看页面
        remote = ''
      }
    }
    if (!remote) return { needAck: false, version: '' }
    return { needAck: local !== remote, version: remote }
  },

  ackLegal(version) {
    wx.setStorageSync('legalAck', version || this.globalData.legalVersion || '')
  },

  // 同意之后才允许写入。没同意就引导回首页那层。
  guardLegal() {
    const v = this.globalData.legalVersion
    if (!v) return true
    if (this.getAckVersion() === v) return true
    wx.showToast({ title: '先看一眼隐私政策', icon: 'none' })
    return false
  },

  async loadSilicon(force) {
    if (this.globalData.silicon && !force) return this.globalData.silicon
    try {
      const data = await api.getSilicon(this.globalData.personId)
      this.globalData.silicon = data.silicon
      this.globalData.offline = false
      return data.silicon
    } catch (err) {
      this.globalData.offline = true
      const mock = require('./utils/mock')
      this.globalData.silicon = mock.silicon
      return mock.silicon
    }
  },
})
