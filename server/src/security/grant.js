'use strict'

// 授权：档案是用户的，不是平台的。
//
// 规则：
//   1) 默认什么都不给。读取 prompt、导出、还原原文，各需单独授权；
//   2) 票据一次性可见 —— 明文 token 只在签发时返回一次，库里只存 sha256 指纹；
//   3) 票据有用途、有期限、有次数，用完即失效；
//   4) 每次签发 / 使用 / 拒绝都写审计日志，用户可回看「谁在什么时候要过什么」。

const crypto = require('./crypto')
const { AppError, NotFoundError } = require('../errors')

const SCOPES = {
  prompt: { label: '读取人格 prompt', desc: '把档案编译成驱动 agent 的系统提示词' },
  export: { label: '导出档案', desc: '生成可离线保存、可在别处恢复的标准导出文件' },
  raw: { label: '还原原文', desc: '解密被脱敏前的原始记录文本' },
  pii: { label: '读取身份信息', desc: '还原手机号/证件号等被剥离的身份字段' },
}

const DEFAULT_TTL = 15 * 60 // 15 分钟
const MAX_TTL = 24 * 3600

function normalizeScopes(input) {
  const list = Array.isArray(input) ? input : [input]
  const valid = [...new Set(list.filter(s => SCOPES[s]))]
  if (!valid.length) {
    throw new AppError('VALIDATION_ERROR', `scope 必须是 ${Object.keys(SCOPES).join(' / ')} 中的一个`, 400)
  }
  return valid
}

function audit(repos, entry) {
  repos.audit.insert({
    at: new Date().toISOString(),
    ...entry,
  })
}

/**
 * 签发授权票据。
 * @returns {{grant:object, token:string}} token 只此一次，务必当场交给调用方
 */
function issue(repos, personId, { scopes, purpose, ttlSec, maxUses } = {}) {
  if (!repos.person.get(personId)) throw new NotFoundError(`找不到这个人：${personId}`)

  const normalized = normalizeScopes(scopes)
  const ttl = Math.min(Math.max(Number(ttlSec) || DEFAULT_TTL, 30), MAX_TTL)
  const now = Date.now()
  const token = crypto.randomToken(32)

  const grant = repos.grant.insert({
    id: crypto.shortId('g'),
    personId,
    scopes: normalized,
    purpose: String(purpose || '未说明用途').slice(0, 120),
    tokenHash: crypto.fingerprint(token),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl * 1000).toISOString(),
    maxUses: Math.min(Math.max(Number(maxUses) || 1, 1), 50),
    used: 0,
    revoked: false,
  })

  audit(repos, { personId, action: 'grant.issue', grantId: grant.id, scopes: normalized, purpose: grant.purpose })

  // 返回值里绝不带 tokenHash
  const { tokenHash, ...safeGrant } = grant
  return { grant: safeGrant, token }
}

function deny(repos, personId, reason, meta = {}) {
  audit(repos, { personId, action: 'grant.deny', reason, ...meta })
}

/**
 * 校验并消费票据。任何一项不满足都拒绝，且拒绝原因写审计。
 */
function consume(repos, personId, token, scope, meta = {}) {
  if (!token) {
    deny(repos, personId, 'missing_token', meta)
    throw new AppError('UNAUTHORIZED', '缺少授权票据。请先在「授权」页签发票据。', 401)
  }

  const hash = crypto.fingerprint(token)
  const grant = repos.grant.findOne(g => g.personId === personId && crypto.safeEqual(g.tokenHash, hash))

  if (!grant) {
    deny(repos, personId, 'invalid_token', meta)
    throw new AppError('UNAUTHORIZED', '授权票据无效', 401)
  }
  if (grant.revoked) {
    deny(repos, personId, 'revoked', { grantId: grant.id, ...meta })
    throw new AppError('UNAUTHORIZED', '授权已被撤销', 401)
  }
  if (new Date(grant.expiresAt).getTime() < Date.now()) {
    deny(repos, personId, 'expired', { grantId: grant.id, ...meta })
    throw new AppError('UNAUTHORIZED', '授权已过期', 401)
  }
  if (grant.used >= grant.maxUses) {
    deny(repos, personId, 'exhausted', { grantId: grant.id, ...meta })
    throw new AppError('UNAUTHORIZED', '授权使用次数已用完', 401)
  }
  if (!grant.scopes.includes(scope)) {
    deny(repos, personId, 'scope_mismatch', { grantId: grant.id, need: scope, have: grant.scopes, ...meta })
    throw new AppError('FORBIDDEN', `该票据不含「${SCOPES[scope]?.label || scope}」权限`, 403)
  }

  repos.grant.update(grant.id, { used: grant.used + 1, lastUsedAt: new Date().toISOString() })
  audit(repos, { personId, action: 'grant.use', grantId: grant.id, scope, purpose: grant.purpose, ...meta })

  const { tokenHash, ...safeGrant } = grant
  return safeGrant
}

function list(repos, personId) {
  return repos.grant
    .byPerson(personId)
    .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1))
    .map(({ tokenHash, ...rest }) => ({
      ...rest,
      expired: new Date(rest.expiresAt).getTime() < Date.now(),
      exhausted: rest.used >= rest.maxUses,
      scopeLabels: rest.scopes.map(s => SCOPES[s]?.label || s),
    }))
}

function revoke(repos, personId, grantId) {
  const grant = repos.grant.get(grantId)
  if (!grant || grant.personId !== personId) throw new NotFoundError('授权不存在')
  repos.grant.update(grantId, { revoked: true, revokedAt: new Date().toISOString() })
  audit(repos, { personId, action: 'grant.revoke', grantId })
  return { revoked: true, id: grantId }
}

function audits(repos, personId, limit = 30) {
  return repos.audit
    .byPerson(personId)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit)
}

module.exports = { SCOPES, issue, consume, list, revoke, audits, deny, audit }
