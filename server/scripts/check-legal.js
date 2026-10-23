'use strict'

// 法律文本回归：隐私政策与用户协议必须「有、全、能对上、不踩线」。
// 跑法：node scripts/check-legal.js（需先启动服务 8787）
//
// 守四件事：
//   ① 两份文本存在且节数稳定 —— 提审时审核员找不到条款是硬伤；
//   ② 条款覆盖到实现 —— 写了「加密」就得真加密，写了「票据」就得真有四种 scope；
//   ③ 全文不出现禁词与技术隐喻 —— 机器审看到「吉凶」「硅基」会直接判违规；
//   ④ H5 页面能直出 —— 不依赖前端 JS，也不依赖第二次请求。

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787'

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

async function call(path) {
  const res = await fetch(`${BASE}${path}`)
  let json = null
  try { json = await res.json() } catch (_) {}
  return { status: res.status, data: json?.data }
}

async function html(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' })
  const text = await res.text()
  return { status: res.status, text, location: res.headers.get('location') }
}

// 整份文档摊平成一段文字，用来扫词
function flatten(doc) {
  const parts = [doc.title, doc.subtitle]
  for (const s of doc.sections || []) {
    parts.push(s.title)
    parts.push(...(s.paragraphs || []))
    parts.push(...(s.items || []))
    parts.push(...(s.paragraphs_after || []))
  }
  return parts.join('\n')
}

const FORBIDDEN = ['吉凶', '算命', '占卜', '风水', '改运', '转运', '财运', '姻缘', '前世', '命中注定']
const TECH_METAPHOR = ['硅基', '碳基', '意识上传', '数字永生']

async function main() {
  console.log('\n【1】两份文本都在')
  const all = await call('/api/legal')
  ok('GET /api/legal 通', all.status === 200, `status=${all.status}`)
  const docs = all.data?.docs || []
  ok('返回两份', docs.length === 2, `docs=${docs.length}`)
  const privacy = docs.find(d => d.id === 'privacy')
  const terms = docs.find(d => d.id === 'terms')
  ok('有隐私政策', !!privacy)
  ok('有用户协议', !!terms)
  ok('两份版本号一致', privacy?.version === terms?.version, `${privacy?.version} vs ${terms?.version}`)

  const meta = await call('/api/meta')
  ok('/api/meta 里的版本与文本一致', meta.data?.legal?.version === privacy?.version,
    `${meta.data?.legal?.version} vs ${privacy?.version}`)

  console.log('\n【2】隐私政策：条款得覆盖到实现')
  ok('节数不少于 14', (privacy?.sections || []).length >= 14, `节数=${privacy?.sections?.length}`)
  const pText = flatten(privacy)
  const mustHave = [
    ['脱敏', '写清原文先脱敏'],
    ['加密', '写清密文存储'],
    ['AES-256-GCM', '写清具体算法'],
    ['票据', '写清授权票据机制'],
    ['导出', '写清数据可带走'],
    ['删除', '写清可删除'],
    ['第三方', '写清不与第三方共享'],
    ['openid', '写清未来登录标识的范围'],
    ['未成年人', '写清未成年人条款'],
    ['联系', '写清联系方式'],
  ]
  for (const [word, why] of mustHave) ok(`含「${word}」—— ${why}`, pText.includes(word))

  ok('四种 scope 都提到', ['人格提示词', '导出档案', '还原原文', '身份信息'].every(w => pText.includes(w)))
  ok('写清票据只存指纹', pText.includes('SHA-256'))
  ok('写清票据不进 URL', pText.includes('请求头'))
  ok('写清审计可自查', pText.includes('审计'))
  ok('写清唯一外部请求', pText.includes('open-meteo'))
  ok('写清 LLM 当前未接入', pText.includes('未接入'))

  console.log('\n【3】用户协议：边界得说明白')
  ok('节数不少于 12', (terms?.sections || []).length >= 12, `节数=${terms?.sections?.length}`)
  const tText = flatten(terms)
  for (const [word, why] of [
    ['建议', '写清输出是建议不是指令'],
    ['不构成', '写清不构成专业意见'],
    ['争议', '写清争议解决'],
    ['知识产权', '写清权属'],
    ['免费', '写清当前免费'],
    ['终止', '写清终止条件'],
  ]) {
    ok(`含「${word}」—— ${why}`, tText.includes(word))
  }
  ok('写明数据归用户', tText.includes('归你'))

  console.log('\n【4】禁词与技术隐喻：机器审会直接判')
  for (const w of FORBIDDEN) {
    ok(`隐私政策无「${w}」`, !pText.includes(w))
    ok(`用户协议无「${w}」`, !tText.includes(w))
  }
  for (const w of TECH_METAPHOR) {
    ok(`两份都不出现「${w}」`, !pText.includes(w) && !tText.includes(w))
  }

  console.log('\n【5】运营者与联系方式：不能是空的')
  const op = all.data?.operator || {}
  ok('有运营者名称', !!op.name && op.name.length > 2, op.name)
  ok('有联系邮箱', /.+@.+\..+/.test(op.contact || ''), op.contact)
  ok('有答复时限', Number(op.replyDays) > 0, String(op.replyDays))

  console.log('\n【6】纯文本渲染：小程序与复制场景共用')
  const one = await call('/api/legal/privacy')
  ok('GET /api/legal/privacy 通', one.status === 200, `status=${one.status}`)
  ok('带 plain 纯文本', typeof one.data?.plain === 'string' && one.data.plain.length > 800, `len=${one.data?.plain?.length}`)
  const missing = (privacy?.sections || []).filter(s => !one.data?.plain?.includes(s.title))
  ok('每节标题都进了纯文本', missing.length === 0, missing.map(m => m.title).join(' / '))

  console.log('\n【7】H5 直出：审核员点开就得看到全文')
  const page = await html('/legal/privacy')
  ok('/legal/privacy 返回 200', page.status === 200, `status=${page.status}`)
  ok('是 HTML', page.text.startsWith('<!DOCTYPE html>'))
  ok('标题在页面上', page.text.includes('隐私政策'))
  const htmlMissing = (privacy?.sections || []).filter(s => !page.text.includes(s.title))
  ok('所有节标题都渲染出来了', htmlMissing.length === 0, htmlMissing.map(m => m.title).join(' / '))
  ok('带版本与生效日期', page.text.includes(privacy?.version || '') && page.text.includes(privacy?.effectiveAt || ''))
  ok('页面上有联系邮箱', page.text.includes(op.contact || 'x@x.x'))

  const termsPage = await html('/legal/terms')
  ok('/legal/terms 返回 200', termsPage.status === 200, `status=${termsPage.status}`)
  ok('用户协议页含争议条款', termsPage.text.includes('争议解决'))

  const redirect = await html('/legal')
  ok('/legal 跳到隐私政策', redirect.status === 302 && (redirect.location || '').includes('/legal/privacy'),
    `${redirect.status} → ${redirect.location}`)

  const bad = await call('/api/legal/nope')
  ok('不存在的文本返回 404', bad.status === 404, `status=${bad.status}`)

  console.log('\n【8】XSS：运营者名从环境变量来，必须转义')
  const legalPath = require.resolve('../src/domain/legal')
  const pagePath = require.resolve('../src/services/legal.page')
  const original = process.env.QJZ_OPERATOR_NAME
  process.env.QJZ_OPERATOR_NAME = '<img src=x onerror=alert(1)>'
  // 先清页面模块，再清 domain —— 否则页面模块会抱着旧的 OPERATOR 不放
  delete require.cache[pagePath]
  delete require.cache[legalPath]
  const evilPage = require(pagePath)
  const evil = evilPage.render('privacy')
  ok('尖括号被转义', evil.includes('&lt;img') && !evil.includes('<img src=x'))

  console.log('\n【9】不存在的文档不渲染')
  ok('render("x") 返回 null', evilPage.render('x') === null)

  if (original === undefined) delete process.env.QJZ_OPERATOR_NAME
  else process.env.QJZ_OPERATOR_NAME = original

  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
  if (fail) {
    console.log('失败项：')
    failures.forEach(f => console.log('  - ' + f))
    process.exit(1)
  }
}

main().catch(err => {
  console.error('脚本异常：', err)
  process.exit(1)
})
