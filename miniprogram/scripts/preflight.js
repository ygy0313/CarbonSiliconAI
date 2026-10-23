#!/usr/bin/env node
'use strict'

// 提审自检：把「会被微信驳回」的原因在本地先扫一遍。
//
//   node miniprogram/scripts/preflight.js
//
// 它检查的是**审核口径**，不是代码能不能跑：
//   1) AppID 还是不是游客模式（touristappid 无法上传）
//   2) 后端地址还指着 127.0.0.1（上线后小程序访问不到）
//   3) 有没有占卜/运势类字眼（微信明确不接受，属违规内容）
//   4) 隐私政策 / 用户协议有没有入口（收集了档案就必须有）
//   5) 有没有启用 LLM（一旦启用，就要「深度合成」类目 + AI 生成标注）
//   6) 模板体检（复用 check-wxml.js）
//
// 退出码：有 ✗ 就 1；只有 ! 警告则 0 —— 警告是「上线前要处理」，不是「现在就不能提交」。

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const MP = path.join(__dirname, '..')
const ROOT = path.join(MP, '..')

const marks = { ok: '✓', bad: '✗', warn: '!' }
let bad = 0

function line(kind, title, detail) {
  if (kind === 'bad') bad += 1
  console.log(`  ${marks[kind]} ${title}${detail ? `\n      ${detail}` : ''}`)
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (_) { return null }
}

function walk(dir, exts, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) walk(full, exts, out)
    else if (exts.some(e => name.endsWith(e))) out.push(full)
  }
  return out
}

console.log('\n提审自检（审核口径，不看功能是否完整）\n')

// ── 1. AppID ──
const cfg = readJSON(path.join(MP, 'project.config.json')) || {}
const appid = cfg.appid || ''
console.log('【账号】')
if (appid === 'touristappid') line('bad', 'AppID 还是游客模式', '拿到正式 AppID 后：node miniprogram/scripts/set-appid.js wx…')
else if (/^wx[0-9a-f]{16}$/i.test(appid)) line('ok', `AppID 为正式形态：${appid}`)
else line('bad', `AppID 格式可疑：${appid}`, '应为 wx + 16 位十六进制')

// ── 2. 后端地址 ──
console.log('\n【服务端地址】')
const apiFile = path.join(MP, 'utils', 'api.js')
const apiSrc = fs.existsSync(apiFile) ? fs.readFileSync(apiFile, 'utf8') : ''
const baseMatch = apiSrc.match(/BASE\s*[:=]\s*['"]([^'"]+)['"]/) || apiSrc.match(/baseUrl\s*[:=]\s*['"]([^'"]+)['"]/)
const base = baseMatch ? baseMatch[1] : ''
if (!base) line('warn', '没在 utils/api.js 里找到 BASE', '确认请求地址从哪儿来')
else if (/127\.0\.0\.1|localhost/.test(base)) {
  line('bad', `BASE 还是本机地址：${base}`, '正式版要改成 https://你的域名，并在微信后台配 request 合法域名')
} else if (!base.startsWith('https://')) {
  line('bad', `BASE 不是 https：${base}`, '小程序正式版只允许 https')
} else line('ok', `BASE 指向 ${base}`)

// ── 3. 违规字眼 ──
console.log('\n【内容红线】')
const FORBIDDEN = ['运势', '算命', '占卜', '吉凶', '财运', '姻缘', '风水', '改运', '转运']
const uiFiles = [
  ...walk(path.join(MP, 'pages'), ['.js', '.wxml', '.json']),
  ...walk(path.join(ROOT, 'web'), ['.js', '.html']),
  // agent 的 description 会通过 /api/services 直接出现在「服务市场」页上，也算用户可见文案
  ...walk(path.join(ROOT, 'server', 'src', 'agents'), ['.js']),
]
const hits = []
for (const f of uiFiles) {
  // 先剥掉整行注释：代码注释里写「不做吉凶断言」是规矩，不是文案
  const src = fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '')
  for (const w of FORBIDDEN) {
    if (src.includes(w)) hits.push(`${path.relative(ROOT, f)} → 「${w}」`)
  }
}
if (hits.length) {
  line('bad', '出现占卜/运势类字眼', hits.slice(0, 6).join('\n      ') + '\n      改成「传统文化 / 节气 / 口味建议」，不碰吉凶')
} else {
  line('ok', `无占卜类字眼（扫 ${uiFiles.length} 个前端文件，禁词 ${FORBIDDEN.length} 个）`)
}

// ── 4. 隐私与协议 ──
console.log('\n【合规入口】')
const pageDirs = fs.existsSync(path.join(MP, 'pages'))
  ? fs.readdirSync(path.join(MP, 'pages'))
  : []
const hasPrivacyPage = pageDirs.some(d => /privacy|agreement|terms|about/i.test(d))
const mentionsPrivacy = uiFiles.some(f => {
  const src = fs.readFileSync(f, 'utf8')
  return src.includes('隐私政策') || src.includes('用户协议')
})
if (hasPrivacyPage && mentionsPrivacy) line('ok', '有隐私政策 / 用户协议页面与入口')
else if (mentionsPrivacy) line('warn', '文案提到了隐私政策，但没有独立页面', '审核通常要求可点开的完整文本')
else line('warn', '缺隐私政策 / 用户协议入口', '收集档案、手机号等信息必须有；先在网页端放，再补小程序页')

// ── 5. LLM 与深度合成 ──
console.log('\n【AI 能力】')
const providerFile = path.join(ROOT, 'server', 'src', 'llm', 'provider.js')
const providerSrc = fs.existsSync(providerFile) ? fs.readFileSync(providerFile, 'utf8') : ''
const llmWired = /LLM_API_KEY|QJZ_LLM|OPENAI|DASHSCOPE|DEEPSEEK|HUNYUAN/i.test(providerSrc)
if (llmWired) {
  line('warn', '后端已接 LLM（默认关闭，需配密钥才启用）', '一旦启用：需「深度合成-AI问答」类目（个人主体不可申请）+ 生成内容显著标注「AI 生成」')
} else {
  line('ok', '没有 LLM 接入代码，不触发深度合成类目')
}

// ── 6. 模板体检 ──
console.log('\n【模板】')
try {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'check-wxml.js')], { encoding: 'utf8' })
  const tail = out.trim().split('\n').filter(Boolean).pop() || '模板体检通过'
  line('ok', tail)
} catch (err) {
  line('bad', '模板体检未通过', (err.stdout || err.message || '').toString().trim().split('\n').slice(-3).join('\n      '))
}

console.log(`\n${bad ? `✗ ${bad} 项必须处理` : '✓ 没有必须处理的问题'}（! 为上线前提醒）\n`)
process.exitCode = bad ? 1 : 0
