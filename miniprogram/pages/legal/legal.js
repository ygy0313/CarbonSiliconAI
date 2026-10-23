// 隐私政策 / 用户协议：正文来自服务端同一份源文件，小程序不另存一份，
// 免得改了一端忘了另一端。失败时给一句人话提示，不展示半截内容。

const api = require('../../utils/api')

Page({
  data: {
    docId: 'privacy',
    doc: null,
    sections: [],
    digest: [],
    operator: {},
    loading: true,
    error: '',
  },

  onLoad(options) {
    const docId = options && options.doc === 'terms' ? 'terms' : 'privacy'
    this.setData({ docId })
    wx.setNavigationBarTitle({ title: docId === 'terms' ? '用户协议' : '隐私政策' })
    this.load(docId)
  },

  load(docId) {
    this.setData({ loading: true, error: '' })
    api
      .getLegal(docId)
      .then(doc => {
        this.setData({
          doc,
          sections: doc.sections || [],
          digest: doc.digest || [],
          operator: doc.operator || null,
          loading: false,
        })
      })
      .catch(err => {
        this.setData({ loading: false, error: err.message || '取不到正文' })
      })
  },

  // 两份文本互为入口，省得退回上一页再点
  switchDoc() {
    const next = this.data.docId === 'terms' ? 'privacy' : 'terms'
    wx.redirectTo({ url: `/pages/legal/legal?doc=${next}` })
  },

  copyMail() {
    const mail = (this.data.operator && this.data.operator.contact) || ''
    if (!mail) return
    wx.setClipboardData({ data: mail })
  },

  retry() {
    this.load(this.data.docId)
  },
})
