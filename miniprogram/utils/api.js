// API 客户端：统一封装 wx.request，统一错误映射。
// 红线：令牌不落 storage、不进 URL；错误必须变成人话。

const TIMEOUT = 8000

let BASE = 'http://127.0.0.1:8787'

function setBase(base) {
  BASE = String(base || '').replace(/\/$/, '')
}

function request(path, { method = 'GET', data = null } = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE + path,
      method,
      data: data || undefined,
      timeout: TIMEOUT,
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.ok) {
          resolve(res.data.data)
          return
        }
        const err = (res.data && res.data.error) || {}
        reject({
          code: err.code || 'HTTP_' + res.statusCode,
          message: mapError(err.code, err.message),
          raw: res.data,
        })
      },
      fail(e) {
        reject({
          code: 'NETWORK',
          message: '连不上本地服务。确认后端已启动（node src/index.js），或在「档案」页改服务地址。',
          raw: e,
        })
      },
    })
  })
}

function mapError(code, message) {
  const dict = {
    NOT_FOUND: '找不到数据，可能档案还没建立',
    VALIDATION_ERROR: message || '输入不合法',
    NETWORK: '网络不通',
    INTERNAL_ERROR: '服务出了点问题，稍后再试',
  }
  return dict[code] || message || '请求失败'
}

module.exports = {
  setBase,
  getBase: () => BASE,
  getMeta: () => request('/api/meta'),
  getSilicon: personId => request(`/api/persons/${personId}/silicon`),
  getProfile: personId => request(`/api/persons/${personId}/profile`),
  getConflicts: personId => request(`/api/persons/${personId}/conflicts`),
  getInvocations: personId => request(`/api/persons/${personId}/invocations`),
  orchestrate: (personId, text, tags) =>
    request(`/api/persons/${personId}/orchestrate`, { method: 'POST', data: { text, tags } }),
  record: (personId, text, tags) =>
    request(`/api/persons/${personId}/records`, { method: 'POST', data: { text, tags } }),
  saveFact: (personId, key, value) =>
    request(`/api/persons/${personId}/facts`, { method: 'POST', data: { key, value } }),
  feedback: (personId, payload) =>
    request(`/api/persons/${personId}/feedback`, { method: 'POST', data: payload }),
  resolveConflict: (personId, conflictId, decision) =>
    request(`/api/persons/${personId}/conflicts/${conflictId}/resolve`, {
      method: 'POST',
      data: { decision },
    }),
}
