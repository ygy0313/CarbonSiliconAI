'use strict'

// 保险箱：明文原文与 PII 映射表的加密存放处。
//
// 密钥来源（按优先级）：
//   1) 环境变量 QJZ_PASSPHRASE —— 生产必须走这条，口令不进代码库；
//   2) 本地密钥文件 data/.vault.key（权限 0600，自动生成）—— 仅限本地开发，
//      启动时会打印警告：换机器/删目录就解不开了，这是特性不是 bug。
//
// 关键约束：
//   - 密钥派生后只在进程内存里，进程退出即消失；
//   - 每个 person 有自己的盐，同一口令在不同人身上派生出的密钥不同；
//   - 落盘的只有「校验块」，无法从校验块反推密钥。

const fs = require('fs')
const path = require('path')
const crypto = require('./crypto')
const log = require('../logger')

const CHECK_PLAINTEXT = 'qjz-vault-check-v1'

const state = {
  passphrase: null,
  passphraseSource: null,
  keys: new Map(), // personId -> Buffer
}

function loadOrCreateKeyFile(dataDir) {
  const file = path.join(dataDir, '.vault.key')
  if (fs.existsSync(file)) {
    return fs.readFileSync(file, 'utf8').trim()
  }
  const generated = crypto.randomToken(32)
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(file, generated, { mode: 0o600 })
  try { fs.chmodSync(file, 0o600) } catch (_) {}
  return generated
}

/**
 * 初始化：确定口令来源。不抛错，失败时给出 canSeal=false，上层降级为「只存脱敏文本」。
 */
function init(dataDir) {
  if (state.passphrase) return describe()

  const fromEnv = process.env.QJZ_PASSPHRASE
  if (fromEnv && fromEnv.length >= 6) {
    state.passphrase = fromEnv
    state.passphraseSource = 'env'
  } else {
    state.passphrase = loadOrCreateKeyFile(dataDir)
    state.passphraseSource = 'keyfile'
    log.warn('未设置 QJZ_PASSPHRASE，已使用本地密钥文件。生产环境请改用环境变量，否则迁移/重装后历史明文不可恢复。', {
      file: path.join(dataDir, '.vault.key'),
    })
  }
  return describe()
}

function describe() {
  return {
    ready: !!state.passphrase,
    source: state.passphraseSource,
    // 不暴露任何密钥信息，只告诉调用方「能不能加密」
    canSeal: !!state.passphrase,
  }
}

function saltOf(repos, personId) {
  const person = repos.person.get(personId)
  if (!person) throw new Error(`找不到这个人：${personId}`)
  if (person.vaultSalt) return person.vaultSalt

  const salt = crypto.newSalt()
  const key = crypto.deriveKey(state.passphrase, salt)
  repos.person.update(personId, {
    vaultSalt: salt,
    vaultCheck: crypto.encrypt(CHECK_PLAINTEXT, key),
    vaultCreatedAt: new Date().toISOString(),
  })
  return salt
}

/**
 * 取（或懒派生）某个人的密钥。
 * 如果 person 上已有校验块，会先验证口令是否还匹配 —— 换过口令就立刻报错，而不是静默损坏数据。
 */
function keyOf(repos, personId) {
  if (state.keys.has(personId)) return state.keys.get(personId)
  if (!state.passphrase) throw new Error('保险箱未初始化')

  const salt = saltOf(repos, personId)
  const key = crypto.deriveKey(state.passphrase, salt)

  const person = repos.person.get(personId)
  if (person.vaultCheck) {
    try {
      const probe = crypto.decrypt(person.vaultCheck, key)
      if (probe !== CHECK_PLAINTEXT) throw new Error('校验值不符')
    } catch (_) {
      throw new Error('口令与已有档案不匹配：无法解密历史数据。请使用当初建档时的口令。')
    }
  }

  state.keys.set(personId, key)
  return key
}

function isUnlocked(personId) {
  return state.keys.has(personId)
}

function seal(repos, personId, plaintext) {
  return crypto.encrypt(plaintext, keyOf(repos, personId))
}

function open(repos, personId, cipherText) {
  return crypto.decrypt(cipherText, keyOf(repos, personId))
}

// PII 映射表（占位符 ↔ 原值）整体加密成一个字段，避免逐条管理
function sealTokens(repos, personId, tokens) {
  if (!tokens || !tokens.length) return null
  return seal(repos, personId, JSON.stringify(tokens))
}

function openTokens(repos, personId, blob) {
  if (!blob) return []
  try {
    return JSON.parse(open(repos, personId, blob))
  } catch (err) {
    log.warn('PII 映射表解密失败', { personId, error: err.message })
    return []
  }
}

// 仅用于测试：清空内存中的密钥
function lockAll() {
  state.keys.clear()
}

module.exports = { init, describe, keyOf, isUnlocked, seal, open, sealTokens, openTokens, lockAll }
