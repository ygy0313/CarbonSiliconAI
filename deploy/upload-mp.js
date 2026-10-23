#!/usr/bin/env node
// 起居注 · 小程序代码自动上传（miniprogram-ci）
//
//   node deploy/upload-mp.js            # 上传并生成开发版
//   node deploy/upload-mp.js --check    # 只检查前置条件
//
// 为什么不能像后端那样“部署完就生效”：
//   微信的代码上传走官方 SDK（miniprogram-ci），前提是三样东西齐备 ——
//   ① 正式 AppID（现在还是 touristappid）② 后台下载的「代码上传密钥」
//   ③ 后台把调用方 IP 加进白名单。缺一样都传不上去。
//   上传成功后还要在后台点「提交审核」，审核通过才轮到用户。这一步没有 API。
//
// 所以本脚本只做「上传」这一段，剩下的人工点两下。AppID 一到位即可跑。

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const CONFIG = path.join(MP, 'project.config.json')
const KEY_PATH = path.join(ROOT, 'deploy', 'mp-private.key')

const CHECK_ONLY = process.argv.includes('--check')

function fail(msg, hint) {
  console.error(`✗ ${msg}`)
  if (hint) console.error(`  → ${hint}`)
  process.exit(1)
}

// ── 1. AppID ──────────────────────────────────────
if (!fs.existsSync(CONFIG)) fail('找不到 miniprogram/project.config.json')

let cfg = {}
try { cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } catch (e) {
  fail('project.config.json 不是合法 JSON', e.message)
}

const appid = String(cfg.appid || '')
if (!appid || appid === 'touristappid') {
  fail('AppID 还是游客模式（touristappid），无法上传',
    '先注册主体拿到正式 AppID，再执行 node miniprogram/scripts/set-appid.js wx...')
}
if (!/^wx[0-9a-f]{16}$/i.test(appid)) {
  fail(`AppID 格式不对：${appid}`, '应为 wx + 16 位十六进制')
}

// ── 2. 上传密钥 ───────────────────────────────────
if (!fs.existsSync(KEY_PATH)) {
  fail('缺代码上传密钥 deploy/mp-private.key',
    '小程序后台 → 开发 → 开发管理 → 开发设置 → 小程序代码上传 → 生成并下载密钥，存到上述路径')
}
if (!fs.statSync(KEY_PATH).size) fail('上传密钥是空文件')

// ── 3. SDK ────────────────────────────────────────
let ci = null
try {
  ci = require('miniprogram-ci')
} catch (_) {
  // 项目本身零依赖，不往根目录塞 node_modules
  const local = path.join(ROOT, 'deploy', 'node_modules', 'miniprogram-ci')
  if (fs.existsSync(local)) ci = require(local)
}

if (CHECK_ONLY) {
  console.log('✓ AppID:', appid)
  console.log('✓ 上传密钥:', KEY_PATH)
  console.log(ci ? '✓ miniprogram-ci 已就绪' : '! miniprogram-ci 未安装（上传时才需要）')
  console.log('\n前置条件满足，可以执行 node deploy/upload-mp.js')
  process.exit(0)
}

if (!ci) {
  fail('未安装 miniprogram-ci',
    'cd deploy && npm install miniprogram-ci   （装在 deploy/ 下，不污染项目根目录）')
}

// ── 4. 上传 ───────────────────────────────────────
const version = (() => {
  try {
    const { execSync } = require('child_process')
    const count = execSync('git rev-list --count HEAD', { cwd: ROOT }).toString().trim()
    return `1.0.${count}`
  } catch (_) { return '1.0.0' }
})()

;(async () => {
  const project = new ci.Project({
    appid,
    type: 'miniProgram',
    projectPath: MP,
    privateKeyPath: KEY_PATH,
    ignores: ['node_modules/**/*', 'scripts/**/*'],
  })

  console.log(`上传中：${version} …`)
  const result = await ci.upload({
    project,
    version,
    desc: `起居注 ${version} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    setting: { es6: true, minify: true, autoPrefixWXSS: true },
    onProgressUpdate: info => {
      if (info && info._msg) process.stdout.write(`\r  ${info._msg}          `)
    },
  })

  console.log('\n✓ 上传成功')
  console.log('  版本:', version)
  if (result && result.subPackageInfo) {
    console.log('  分包:', result.subPackageInfo.map(s => `${s.name || '主包'} ${(s.size / 1024).toFixed(0)}KB`).join(' / '))
  }
  console.log('\n下一步（必须手动，微信没有 API）：')
  console.log('  1. mp.weixin.qq.com → 管理 → 版本管理 → 开发版本 → 选为体验版')
  console.log('  2. 真机扫码验收后 → 提交审核 → 通过后发布')
})().catch(err => {
  console.error('\n✗ 上传失败：', err && err.message ? err.message : err)
  if (String(err && err.message).includes('ip')) {
    console.error('  → 多半是 IP 白名单：后台「开发设置 → 小程序代码上传」把本机出口 IP 加进去')
  }
  process.exit(1)
})
