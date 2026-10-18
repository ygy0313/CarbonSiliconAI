// 硅基记忆体 · 小程序入口
const api = require('./utils/api')

App({
  globalData: {
    personId: 'p_owner',
    apiBase: 'http://127.0.0.1:8787',
    silicon: null,
    offline: false,
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
