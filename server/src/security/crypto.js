'use strict'

// 密码学原语：口令派生、对称加密、摘要、随机票据。
//
// 设计取舍：
//   - 用 scrypt 而不是 PBKDF2：抗 GPU 暴力破解更强，Node 内置无需依赖；
//   - 用 AES-256-GCM 而不是 CBC：自带完整性校验，密文被篡改会直接解密失败；
//   - 密钥只存在于进程内存，**不落盘、不进日志、不进导出文件**。

const crypto = require('crypto')

// scrypt 参数：N=2^15 约 100ms/次，对交互可接受，对离线爆破足够贵。
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }
const KEY_LEN = 32
const CIPHER_VERSION = 'qjz1'

function newSalt() {
  return crypto.randomBytes(16).toString('base64')
}

/**
 * 由口令派生 32 字节密钥。同样的口令 + 同样的盐 = 同样的密钥（可复现、可跨设备恢复）。
 */
function deriveKey(passphrase, saltB64) {
  if (typeof passphrase !== 'string' || passphrase.length < 6) {
    throw new Error('口令至少 6 位')
  }
  const salt = Buffer.from(saltB64, 'base64')
  return crypto.scryptSync(passphrase, salt, KEY_LEN, SCRYPT)
}

/**
 * 加密：返回自描述密文串 `qjz1.<iv>.<tag>.<ciphertext>`（base64url）。
 * 版本前缀让未来换算法时能平滑迁移。
 */
function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    CIPHER_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    body.toString('base64url'),
  ].join('.')
}

function decrypt(payload, key) {
  const parts = String(payload || '').split('.')
  if (parts.length !== 4 || parts[0] !== CIPHER_VERSION) {
    throw new Error('密文格式不支持')
  }
  const [, ivB, tagB, bodyB] = parts
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'))
  const out = Buffer.concat([decipher.update(Buffer.from(bodyB, 'base64url')), decipher.final()])
  return out.toString('utf8')
}

function isCipher(value) {
  return typeof value === 'string' && value.startsWith(`${CIPHER_VERSION}.`)
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex')
}

function hmacHex(secret, text) {
  return crypto.createHmac('sha256', secret).update(String(text)).digest('hex')
}

// 用于「存储侧只留指纹、不留票据本身」
function fingerprint(token) {
  return sha256(`qjz-grant:${token}`)
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

function shortId(prefix, bytes = 8) {
  return `${prefix}_${crypto.randomBytes(bytes).toString('hex')}`
}

// 恒定时间比较，避免时序侧信道
function safeEqual(a, b) {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

module.exports = {
  newSalt,
  deriveKey,
  encrypt,
  decrypt,
  isCipher,
  sha256,
  hmacHex,
  fingerprint,
  randomToken,
  shortId,
  safeEqual,
}
