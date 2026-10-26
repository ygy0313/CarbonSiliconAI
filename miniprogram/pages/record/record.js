const app = getApp()
const api = require('../../utils/api')
const mock = require('../../utils/mock')

const TAGS = ['胃不舒服', '一个人', '和朋友', '和家人', '熬夜', '上火', '没胃口']

const ACTION_LABEL = {
  created: '新建',
  updated: '修正',
  confirmed: '确认',
  kept: '保留',
}

Page({
  data: {
    text: '',
    tagOptions: TAGS.map(t => ({ label: t, on: false, cls: 'chip' })),
    selectedTags: [],
    saving: false,
    result: null,
    recent: [],
    offline: false,
    // 拍照 / 语音
    busy: false,
    hint: '',
    dishes: [],
    recording: false,
    recLabel: '按住说话',
  },

  onLoad() {
    this._recorder = recorder
    if (recorder) {
      recorder.onStop(res => this.onRecordStop(res))
      recorder.onError(err => {
        this.clearRecordTimer()
        this.setData({
          recording: false,
          busy: false,
          recLabel: '按住说话',
          hint: '录音出错了：' + ((err && err.errMsg) || '未知原因'),
        })
      })
    }
  },

  onUnload() {
    this.clearRecordTimer()
  },

  onShow() {
    this.loadRecent()
  },

  async loadRecent() {
    return
  },

  onInput(e) {
    this.setData({ text: e.detail.value })
  },

  toggleTag(e) {
    const tag = e.currentTarget.dataset.tag
    const list = this.data.selectedTags.slice()
    const idx = list.indexOf(tag)
    if (idx >= 0) list.splice(idx, 1)
    else list.push(tag)
    const options = this.data.tagOptions.map(o => ({
      label: o.label,
      on: list.indexOf(o.label) >= 0,
      cls: list.indexOf(o.label) >= 0 ? 'chip chip-on' : 'chip',
    }))
    this.setData({ selectedTags: list, tagOptions: options })
  },

  async save() {
    const text = (this.data.text || '').trim()
    if (!text) {
      wx.showToast({ title: '写点什么再存', icon: 'none' })
      return
    }
    this.setData({ saving: true })

    let result
    try {
      result = await api.record(app.globalData.personId, text, this.data.selectedTags)
      this.setData({ offline: false })
    } catch (err) {
      result = mock.record(text)
      this.setData({ offline: true })
    }

    const changes = (result.factChanges || []).map(c => ({
      key: c.key,
      label: c.label || c.key,
      action: c.action,
      actionLabel: ACTION_LABEL[c.action] || c.action,
      arrow: c.before && c.after && c.before !== c.after,
      before: c.before === null || c.before === undefined ? '' : String(c.before),
      after: c.after === null || c.after === undefined ? '' : String(c.after),
    }))

    this.setData({
      saving: false,
      result: {
        summary: (result.extracted && result.extracted.summary) || text.slice(0, 20),
        tags: (result.extracted && result.extracted.tags) || [],
        changes,
        hints: (result.silicon && result.silicon.hints) || [],
        completeness: Math.round(((result.silicon && result.silicon.completeness) || 0) * 100),
        memoryCount: (result.silicon && result.silicon.memoryCount) || 0,
        conflicts: result.conflicts || [],
      },
      text: '',
      selectedTags: [],
      tagOptions: TAGS.map(t => ({ label: t, on: false, cls: 'chip' })),
    })

    app.loadSilicon(true)
    wx.showToast({ title: '记下了', icon: 'none' })
  },

  clearResult() {
    this.setData({ result: null })
  },

  // ── 拍一张 / 说一句 ──────────────────────────────
  // 两条都只做「把内容变成一句话填进上面那个框」，不直接存。
  // 用户看到填进来的字，改不改由他；这也意味着识错了也不会污染档案。

  pickPhoto() {
    if (this.data.busy) return
    const that = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success(res) {
        const file = res.tempFiles && res.tempFiles[0]
        if (file) that.recognize(file.tempFilePath)
      },
      fail(e) {
        // 用户自己取消不算错误，不弹提示
        if (e && /cancel/.test(e.errMsg || '')) return
        that.setData({ hint: '没打开相机，检查一下权限再试' })
      },
    })
  },

  async recognize(filePath) {
    this.setData({ busy: true, hint: '正在认这盘菜…', dishes: [] })
    const base64 = await readBase64(filePath)
    if (!base64) {
      this.setData({ busy: false, hint: '这张照片读不出来，换一张试试' })
      return
    }

    let r
    try {
      r = await api.recognizeMeal(app.globalData.personId, `data:image/jpeg;base64,${base64}`, mealLabel())
    } catch (err) {
      this.setData({ busy: false, hint: err.message || '识图没通，先自己写一句' })
      return
    }

    if (!r.ok) {
      this.setData({ busy: false, hint: r.reason || '这次没认出来', dishes: [] })
      return
    }

    // 已经写过的内容保留，识食结果接在后面，不覆盖用户自己打的字
    const prev = (this.data.text || '').trim()
    const text = prev ? `${prev}。${r.sentence}` : r.sentence
    this.setData({
      busy: false,
      text: text.slice(0, 300),
      dishes: r.dishes || [],
      hint: `认出了 ${r.dishes.length} 样，约 ${r.totalKcal} kcal。可以改，也可以删。`,
    })
  },

  // 按住说话：小程序录音要先有 scope.record 授权
  async startRecord() {
    if (this.data.busy || this.data.recording) return
    const granted = await ensureRecordAuth()
    if (!granted) {
      this.setData({ hint: '没拿到麦克风权限，也可以用打字' })
      return
    }
    if (!this._recorder) return

    this._recordStart = Date.now()
    this.setData({ recording: true, recLabel: '松手结束', hint: '正在录音…' })
    this._timer = setInterval(() => {
      const sec = Math.floor((Date.now() - this._recordStart) / 1000)
      // 60 秒封顶，与后端上限对齐
      if (sec >= 60) this.stopRecord()
      else this.setData({ recLabel: `松手结束 ${sec}"` })
    }, 500)

    this._recorder.start({
      duration: 60000,
      format: 'mp4',
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
    })
  },

  stopRecord() {
    if (!this.data.recording) return
    this.clearRecordTimer()
    this.setData({ recording: false, recLabel: '按住说话', busy: true, hint: '正在转成文字…' })
    if (this._recorder) this._recorder.stop()
  },

  cancelRecord() {
    if (!this.data.recording) return
    this.clearRecordTimer()
    this._discard = true
    this.setData({ recording: false, recLabel: '按住说话', hint: '' })
    if (this._recorder) this._recorder.stop()
  },

  clearRecordTimer() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  },

  async onRecordStop(res) {
    // 取消的那一次不处理，避免「按错了也往框里塞字」
    if (this._discard) {
      this._discard = false
      this.setData({ busy: false })
      return
    }
    const filePath = res && res.tempFilePath
    if (!filePath) {
      this.setData({ busy: false, hint: '没录到声音，再试一次' })
      return
    }
    // 用毫秒判断：Math.round 会把 400ms 抹成 0 秒，那样「太短」就永远拦不住
    const ms = Number(res && res.duration) || 0
    if (ms && ms < 1000) {
      this.setData({ busy: false, hint: '太短了，按住多说两句' })
      return
    }

    const base64 = await readBase64(filePath)
    if (!base64) {
      this.setData({ busy: false, hint: '这段录音读不出来，重录一次' })
      return
    }

    let r
    try {
      r = await api.transcribe(app.globalData.personId, base64, 'audio/mp4')
    } catch (err) {
      this.setData({ busy: false, hint: err.message || '语音没通，先打字' })
      return
    }

    if (!r.ok) {
      this.setData({ busy: false, hint: r.reason || '没听清，再说一遍' })
      return
    }

    const prev = (this.data.text || '').trim()
    this.setData({
      busy: false,
      text: (prev ? prev + '。' + r.text : r.text).slice(0, 300),
      hint: '转好了，有不对的地方直接改。',
    })
  },

  goProfile() {
    wx.switchTab({ url: '/pages/grant/grant' })
  },
})

// 录音器是全局单例，页面里只挂一次回调
const recorder = wx.getRecorderManager ? wx.getRecorderManager() : null

/** 读本地文件成 base64；失败返回空串，由调用方给一句人话 */
function readBase64(filePath) {
  return new Promise(resolve => {
    let fs = null
    try {
      fs = wx.getFileSystemManager ? wx.getFileSystemManager() : null
    } catch (_) {
      fs = null
    }
    if (!fs || !fs.readFile) return resolve('')
    fs.readFile({
      filePath,
      encoding: 'base64',
      success: res => resolve((res && res.data) || ''),
      fail: () => resolve(''),
    })
  })
}

/** 录音授权：未决定就弹一次，拒绝过就引导去设置页 */
function ensureRecordAuth() {
  return new Promise(resolve => {
    wx.getSetting({
      success(res) {
        const state = res.authSetting && res.authSetting['scope.record']
        if (state === true) return resolve(true)
        if (state === false) {
          wx.showModal({
            title: '需要麦克风',
            content: '用语音记一句需要麦克风权限。也可以直接用打字。',
            confirmText: '去设置',
            success(r) {
              if (r.confirm) wx.openSetting()
              resolve(false)
            },
          })
          return
        }
        wx.authorize({
          scope: 'scope.record',
          success: () => resolve(true),
          fail: () => resolve(false),
        })
      },
      fail: () => resolve(false),
    })
  })
}

/** 按当前时间猜一顿饭的叫法，让拼出来的句子更像人说的 */
function mealLabel() {
  const h = new Date().getHours()
  if (h < 10) return '早饭'
  if (h < 15) return '中午'
  if (h < 21) return '晚上'
  return '夜里'
}
