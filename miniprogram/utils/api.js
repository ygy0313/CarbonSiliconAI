// API 客户端：统一封装 wx.request，统一错误映射。
// 红线：令牌不落 storage、不进 URL；错误必须变成人话。

const TIMEOUT = 8000

let BASE = 'http://127.0.0.1:8787'

function setBase(base) {
  BASE = String(base || '').replace(/\/$/, '')
}

function request(path, { method = 'GET', data = null, token = null, timeout = TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    const header = { 'Content-Type': 'application/json' }
    // 令牌只放请求头，绝不进 URL（URL 会进访问日志）
    if (token) header['X-Grant-Token'] = token
    wx.request({
      url: BASE + path,
      method,
      data: data || undefined,
      timeout,
      header,
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

  // ── 脱敏与授权 ──
  redactPreview: (personId, text) =>
    request(`/api/persons/${personId}/redact/preview`, { method: 'POST', data: { text } }),
  getGrants: personId => request(`/api/persons/${personId}/grants`),
  issueGrant: (personId, payload) =>
    request(`/api/persons/${personId}/grants`, { method: 'POST', data: payload }),
  revokeGrant: (personId, grantId) =>
    request(`/api/persons/${personId}/grants/${grantId}/revoke`, { method: 'POST' }),
  getPrompt: (personId, token) => request(`/api/persons/${personId}/prompt`, { token }),
  exportArchive: (personId, token, scopes) =>
    request(`/api/persons/${personId}/export`, { method: 'POST', token, data: { scopes } }),

  // ── 入局问答与历算 ──
  getQuiz: personId => request(`/api/persons/${personId}/quiz`),
  answerQuiz: (personId, questionId, optionKey) =>
    request(`/api/persons/${personId}/quiz`, { method: 'POST', data: { questionId, optionKey } }),
  getGanzhi: (personId, date) =>
    request(`/api/persons/${personId}/ganzhi${date ? `?date=${date}` : ''}`),

  // ── 法律文本（隐私政策 / 用户协议）──
  getLegal: id => request(`/api/legal/${id}`),

  // ── 输入端：拍照识食 / 语音转写（都只转换，不落库）──
  // 这两条比普通请求慢：识图 20s、转写 30s，按后端的时间线留出余量。
  recognizeMeal: (personId, image, label) =>
    request(`/api/persons/${personId}/vision/meal`, { method: 'POST', data: { image, label }, timeout: 25000 }),
  transcribe: (personId, audio, mime) =>
    request(`/api/persons/${personId}/voice/transcribe`, { method: 'POST', data: { audio, mime }, timeout: 35000 }),

  // ── 经验资产 ──
  getExperiences: (personId, status) =>
    request(`/api/persons/${personId}/experiences${status ? `?status=${status}` : ''}`),
  getExperienceAssets: personId => request(`/api/persons/${personId}/experiences/assets`),
  reflectExperiences: personId =>
    request(`/api/persons/${personId}/experiences/reflect`, { method: 'POST', data: {}, timeout: 20000 }),
  applyExperience: (personId, id, outcome) =>
    request(`/api/persons/${personId}/experiences/${id}/apply`, { method: 'POST', data: { outcome } }),
  setExperienceStatus: (personId, id, status) =>
    request(`/api/persons/${personId}/experiences/${id}/status`, { method: 'POST', data: { status } }),
  setCriteria: (personId, thresholds) =>
    request(`/api/persons/${personId}/criteria`, {
      method: 'POST',
      data: { thresholds, confirm: true },
    }),
}
