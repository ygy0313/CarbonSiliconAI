#!/usr/bin/env node
'use strict'

// 换 AppID：拿到正式 AppID 之后，一条命令改掉 project.config.json。
//
//   node miniprogram/scripts/set-appid.js wx1234567890abcdef
//   node miniprogram/scripts/set-appid.js --check      # 只看当前状态
//
// 为什么值得写个脚本而不是手改：
//   1) AppID 格式固定 18 位（wx + 16 位十六进制），手改容易多一个空格或漏一位，
//      微信开发者工具不会告诉你哪个字符错了，只会说「AppID 不合法」；
//   2) 改完要顺手提醒域名/AppSecret 两件事，手改没人提醒；
//   3) 顺手把「还是游客模式」这件事变成一个能查、能看的状态。

const fs = require('fs')
const path = require('path')

const CONFIG = path.join(__dirname, '..', 'project.config.json')
const APPID_RE = /^wx[0-9a-f]{16}$/i
const TOURIST = 'touristappid'

function readConfig() {
  const raw = fs.readFileSync(CONFIG, 'utf8')
  return { raw, json: JSON.parse(raw) }
}

function status() {
  const { json } = readConfig()
  const id = json.appid || ''
  const tourist = id === TOURIST
  console.log(`\n当前 AppID：${id || '(空)'}`)
  console.log(tourist
    ? '状态：⚠️ 游客模式（touristappid）—— 只能本机调试，无法上传、无法提审'
    : `状态：${APPID_RE.test(id) ? '✅ 正式 AppID' : '⚠️ 格式不像正式 AppID（应为 wx + 16 位十六进制）'}`)
  console.log(`配置文件：${path.relative(process.cwd(), CONFIG)}`)
  if (tourist) {
    console.log('\n下一步：拿到营业执照主体 + 微信认证后，跑')
    console.log('  node miniprogram/scripts/set-appid.js <你的 AppID>\n')
  }
  return tourist ? 1 : 0
}

function set(id) {
  if (!id) {
    console.error('用法：node miniprogram/scripts/set-appid.js <AppID>')
    console.error('      node miniprogram/scripts/set-appid.js --check')
    process.exit(2)
  }
  if (id === TOURIST) {
    console.error('拒绝：touristappid 是游客模式占位符，不是正式 AppID。')
    process.exit(1)
  }
  if (!APPID_RE.test(id)) {
    console.error(`AppID 格式不对：${id}`)
    console.error('应为 wx + 16 位十六进制，例如 wx1a2b3c4d5e6f7a8b（共 18 位）。')
    console.error('去这里抄：小程序后台 → 开发 → 开发管理 → 开发设置 → AppID(小程序ID)')
    process.exit(1)
  }

  const { raw, json } = readConfig()
  const before = json.appid
  if (before === id) {
    console.log(`AppID 已经是 ${id}，无需修改。`)
    return status()
  }
  json.appid = id
  // 保留原有 2 空格缩进与结尾换行，避免整个文件 diff 变成一行
  const next = JSON.stringify(json, null, 2) + (raw.endsWith('\n') ? '\n' : '')
  fs.writeFileSync(CONFIG, next)
  console.log(`AppID 已更新：${before} → ${id}`)
  console.log('\n别忘这两件事（AppID 本身还不够）：')
  console.log('  1. miniprogram/utils/api.js 的 BASE 改成 https://你的域名')
  console.log('  2. 微信后台 → 开发 → 开发设置 → 服务器域名 → request 合法域名填同一个域名')
  console.log('  （AppSecret 只放服务端环境变量，不要写进小程序代码，更不要提交到 git）')
}

const arg = process.argv[2]
if (!arg || arg === '--check' || arg === '-c') {
  // 游客模式返回非 0，方便挂到提审前的自检脚本里当门禁
  process.exitCode = status()
} else {
  set(arg.trim())
}
