// 输入端共享能力：拍照识食 / 按住说话。
// 红线：照片与录音只在内存里过一遍就丢，不落盘、不上传原件；
// 转出来的文字先填给用户看，改不改由他，确认后才走 records 入库。
//
// 录音器是微信全局单例：回调在「按下那一刻」再注册，避免两个页面互相覆盖。

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

// 录音授权：未决定就弹一次，拒绝过就引导去设置页
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

// 按当前时间猜一顿饭的叫法，让拼出来的句子更像人说的
function mealLabel() {
  const h = new Date().getHours()
  if (h < 10) return '早饭'
  if (h < 15) return '中午'
  if (h < 21) return '晚上'
  return '夜里'
}

/**
 * 在页面里挂一个「按住说话」。
 * 页面需要实现：onCaptureStop(res) / onCaptureError(err)，以及
 * data 里的 recording / recLabel / busy / hint（由页面自己 setData）。
 * 返回录音器实例（可能为 null，调用方自行降级为打字）。
 */
function attachRecorder(page) {
  const recorder = wx.getRecorderManager ? wx.getRecorderManager() : null
  if (recorder) {
    recorder.onStop(res => page.onCaptureStop(res))
    recorder.onError(err => page.onCaptureError(err))
  }
  return recorder
}

module.exports = { readBase64, ensureRecordAuth, mealLabel, attachRecorder }
