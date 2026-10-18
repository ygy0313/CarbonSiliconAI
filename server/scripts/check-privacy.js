'use strict'

// 隐私链路回归：脱敏 → 授权 → 取 prompt → 导出 → 恢复 → 审计。
// 跑法：node scripts/check-privacy.js（需先启动服务）

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787'
const PERSON = 'p_owner'

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['X-Grant-Token'] = token
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch (_) {}
  return { status: res.status, body: json }
}

const SAMPLE = '明天下午去民生花园3号楼2单元501找老王，电话13800001234，身份证640102199001011234，邮箱 laowang@example.com，微信 laowang_888'

async function main() {
  console.log('\n【1】脱敏：原文不进主库')
  const preview = await call(`/api/persons/${PERSON}/redact/preview`, { method: 'POST', body: { text: SAMPLE } })
  ok('体检接口可用', preview.status === 200)
  const hits = preview.body?.data?.hits || []
  const redactedText = preview.body?.data?.redacted || ''
  ok('识别出手机号', hits.some(h => h.type === 'PHONE'))
  ok('识别出身份证', hits.some(h => h.type === 'ID_CARD'))
  ok('识别出邮箱', hits.some(h => h.type === 'EMAIL'))
  ok('识别出社交账号', hits.some(h => h.type === 'IM_ACCOUNT'))
  ok('脱敏结果不含手机号原文', !redactedText.includes('13800001234'), redactedText.slice(0, 80))
  ok('脱敏结果保留占位符', /<手机号\d>/.test(redactedText), redactedText.slice(0, 80))

  console.log('\n【2】落库记录只存脱敏文本 + 密文')
  const rec = await call(`/api/persons/${PERSON}/records`, { method: 'POST', body: { text: SAMPLE } })
  ok('记录写入成功', rec.status === 200)
  const ep = rec.body?.data?.episode
  ok('episode.text 已脱敏', ep && !String(ep.text).includes('13800001234'))
  ok('episode 标记 redacted', ep?.redacted === true)
  ok('原文已进保险箱', typeof ep?.rawCipher === 'string' && ep.rawCipher.startsWith('qjz1.'))
  ok('接口不回传 rawCipher', ep && Object.prototype.hasOwnProperty.call(ep, 'rawCipher'))
  ok('redaction.hits 有记录', Array.isArray(ep?.redaction?.hits) && ep.redaction.hits.length > 0)

  console.log('\n【3】没有票据就什么都拿不到')
  const noToken = await call(`/api/persons/${PERSON}/prompt`)
  ok('读 prompt 无票据被拒', noToken.status === 401, `status=${noToken.status}`)
  const noExport = await call(`/api/persons/${PERSON}/export`, { method: 'POST', body: { scopes: ['export'] } })
  ok('导出无票据被拒', noExport.status === 401, `status=${noExport.status}`)
  const badToken = await call(`/api/persons/${PERSON}/prompt`, { token: 'not-a-real-token' })
  ok('伪造票据被拒', badToken.status === 401)

  console.log('\n【4】scope 隔离：有导出权不等于有读 prompt 权')
  const gExport = await call(`/api/persons/${PERSON}/grants`, {
    method: 'POST', body: { scopes: ['export'], purpose: '回归测试-导出', ttlSec: 300, maxUses: 2 },
  })
  ok('签发导出票据', gExport.status === 200 && !!gExport.body?.data?.token)
  const exportToken = gExport.body?.data?.token
  const wrongScope = await call(`/api/persons/${PERSON}/prompt`, { token: exportToken })
  ok('导出票读不了 prompt', wrongScope.status === 403, `status=${wrongScope.status}`)

  console.log('\n【5】持票读 prompt')
  const gPrompt = await call(`/api/persons/${PERSON}/grants`, {
    method: 'POST', body: { scopes: ['prompt'], purpose: '回归测试-读 prompt', ttlSec: 300, maxUses: 2 },
  })
  const promptToken = gPrompt.body?.data?.token
  const p = await call(`/api/persons/${PERSON}/prompt`, { token: promptToken })
  ok('读取成功', p.status === 200)
  const promptText = p.body?.data?.prompt || ''
  ok('prompt 有内容', promptText.length > 100, `${promptText.length} 字`)
  ok('prompt 含硬性约束', promptText.includes('硬性约束'))
  ok('prompt 不含手机号原文', !promptText.includes('13800001234'))
  ok('prompt 不含身份证原文', !promptText.includes('640102199001011234'))

  console.log('\n【6】导出：格式、校验和、深度')
  const exp1 = await call(`/api/persons/${PERSON}/export`, {
    method: 'POST', token: exportToken, body: { scopes: ['export'] },
  })
  ok('导出成功', exp1.status === 200, `status=${exp1.status}`)
  const archive = exp1.body?.data
  ok('格式标识正确', archive?.format === 'qijuzhu/v1')
  ok('深度为 safe', archive?.depth === 'safe')
  ok('含 checksum', typeof archive?.checksum === 'string' && archive.checksum.length === 64)
  ok('不含 prompt（未授权）', archive && !('prompt' in archive.payload))
  ok('不含密文（未授权）', archive && !('sealed' in archive.payload))
  const serialized = JSON.stringify(archive)
  ok('导出文件不含手机号明文', !serialized.includes('13800001234'))

  const verify1 = await call('/api/archive/verify', { method: 'POST', body: { archive } })
  ok('自校验通过', verify1.body?.data?.ok === true)

  const tampered = JSON.parse(serialized)
  tampered.payload.facts[0].value = '被人改过的值'
  const verify2 = await call('/api/archive/verify', { method: 'POST', body: { archive: tampered } })
  ok('篡改后校验失败', verify2.body?.data?.ok === false, verify2.body?.data?.error || '')

  console.log('\n【7】从导出文件恢复成新档案')
  const imp = await call('/api/import', { method: 'POST', body: { archive, name: '恢复测试档案' } })
  ok('恢复成功', imp.status === 200, `status=${imp.status}`)
  ok('恢复出事实', (imp.body?.data?.factCount || 0) > 0, `facts=${imp.body?.data?.factCount}`)
  ok('恢复出记忆', (imp.body?.data?.episodeCount || 0) > 0, `episodes=${imp.body?.data?.episodeCount}`)
  const newId = imp.body?.data?.person?.id
  if (newId) {
    const check = await call(`/api/persons/${newId}/silicon`)
    ok('新档案可被读取', check.status === 200)
  }

  console.log('\n【8】审计留痕')
  const audits = await call(`/api/persons/${PERSON}/grants`)
  const actions = (audits.body?.data?.audits || []).map(a => a.action)
  ok('记录了签发', actions.includes('grant.issue'))
  ok('记录了使用', actions.includes('grant.use'))
  ok('记录了拒绝', actions.includes('grant.deny'))
  ok('记录了导出', actions.includes('export.create'))

  console.log('\n【9】票据次数与撤销')
  const g1 = await call(`/api/persons/${PERSON}/grants`, {
    method: 'POST', body: { scopes: ['prompt'], purpose: '次数测试', ttlSec: 300, maxUses: 1 },
  })
  const t1 = g1.body?.data?.token
  const use1 = await call(`/api/persons/${PERSON}/prompt`, { token: t1 })
  const use2 = await call(`/api/persons/${PERSON}/prompt`, { token: t1 })
  ok('第一次可用', use1.status === 200)
  ok('次数用尽后被拒', use2.status === 401, `status=${use2.status}`)

  const g2 = await call(`/api/persons/${PERSON}/grants`, {
    method: 'POST', body: { scopes: ['prompt'], purpose: '撤销测试', ttlSec: 300, maxUses: 5 },
  })
  const t2 = g2.body?.data?.token
  const gid = g2.body?.data?.grant?.id
  await call(`/api/persons/${PERSON}/grants/${gid}/revoke`, { method: 'POST' })
  const revoked = await call(`/api/persons/${PERSON}/prompt`, { token: t2 })
  ok('撤销后不可用', revoked.status === 401, `status=${revoked.status}`)

  console.log('\n【10】入局问答写入档案')
  const q = await call(`/api/persons/${PERSON}/quiz`)
  ok('能取到题目', (q.body?.data?.questions || []).length === 12)
  const ans = await call(`/api/persons/${PERSON}/quiz`, { method: 'POST', body: { questionId: 'q02', optionKey: 'a' } })
  ok('答题成功', ans.status === 200)
  ok('答题有回音', typeof ans.body?.data?.quip === 'string' && ans.body.data.quip.length > 0)
  ok('答题写入了事实', (ans.body?.data?.factChanges || []).length > 0)
  ok('非法选项被拒', (await call(`/api/persons/${PERSON}/quiz`, { method: 'POST', body: { questionId: 'q02', optionKey: 'zz' } })).status === 400)

  console.log('\n【11】历算接口')
  const gz1 = await call('/api/ganzhi?date=2026-10-18')
  ok('历算可用', gz1.status === 200)
  ok('返回三层干支', gz1.body?.data?.year && gz1.body?.data?.month && gz1.body?.data?.day)
  ok('流年为丙午', gz1.body?.data?.year?.text === '丙午')
  ok('返回五行分布', Array.isArray(gz1.body?.data?.elements?.ranked) && gz1.body.data.elements.ranked.length === 5)

  console.log(`\n通过 ${pass} / 失败 ${fail}`)
  if (fail) {
    console.log('\n失败明细：')
    failures.forEach(f => console.log('  - ' + f))
    process.exit(1)
  }
}

main().catch(err => {
  console.error('回归脚本异常：', err.message)
  process.exit(1)
})
