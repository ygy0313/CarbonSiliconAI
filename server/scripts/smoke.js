#!/usr/bin/env node
'use strict'

// 端到端冒烟：跑通「记录 → 编排 → 反馈 → 档案变化」的完整闭环。
// 任何一步不符合预期就退出码 1，可直接挂到 CI 或提交前钩子。

const BASE = process.env.BASE || 'http://127.0.0.1:8787'
const PERSON = 'p_smoke_' + Date.now().toString(36)

let pass = 0
let fail = 0

// 等服务就绪：CI 里服务器刚拉起时，首个请求可能撞上种子数据写入
async function waitReady(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) return true
    } catch (_) {}
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error(`服务 ${BASE} 在 ${timeoutMs}ms 内未就绪`)
}

function ok(name, detail = '') {
  pass += 1
  console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`)
}
function bad(name, detail = '') {
  fail += 1
  console.log(`  × ${name}${detail ? '  ' + detail : ''}`)
}
function assert(cond, name, detail) {
  if (cond) ok(name, detail)
  else bad(name, detail)
}

async function call(path, method = 'GET', body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  return { status: res.status, body: json }
}

async function main() {
  console.log(`\n冒烟测试 → ${BASE}\n`)

  // CI 里服务器刚拉起时，首个请求可能撞上种子写入，先等就绪再开跑
  await waitReady()

  // ── 基础设施 ──
  const health = await call('/health')
  assert(health.status === 200 && health.body.data.status === 'ok', '健康检查')

  const ready = await call('/ready')
  assert(ready.status === 200 && ready.body.data.ready, '就绪检查')

  const meta = await call('/api/meta')
  assert(meta.body.data.services.length >= 7, '能力清单', `${meta.body.data.services.length} 个服务`)

  // ── 建档 ──
  const created = await call('/api/persons', 'POST', { id: PERSON, name: '冒烟测试', city: '银川' })
  assert(created.status === 200, '创建人物')

  const empty = await call(`/api/persons/${PERSON}/silicon`)
  assert(empty.body.data.silicon.completeness === 0, '新档案完整度为 0')

  // ── 记录：一句话应该同时产出记忆 + 事实 ──
  const rec1 = await call(`/api/persons/${PERSON}/records`, 'POST', {
    text: '中午一个人吃了辣糊糊，晚上胃不舒服，特别辣',
  })
  const r1 = rec1.body.data
  assert(!!r1.episode.id, '写入记忆')
  assert(r1.extracted.tags.includes('胃敏感'), '抽取到身体信号', r1.extracted.tags.join(','))
  assert(r1.factChanges.some(c => c.key === 'diet.stomach'), '生成事实变更', R(r1.factChanges))

  const rec2 = await call(`/api/persons/${PERSON}/records`, 'POST', {
    text: '周六想和朋友组个局，6个人，预算150，没玩过的多',
  })
  const r2 = rec2.body.data
  assert(r2.extracted.entities.headcount === 6, '抽取人数', String(r2.extracted.entities.headcount))
  assert(r2.extracted.entities.budget === 150, '抽取预算')

  // ── 编排 A：吃什么 ──
  const eat = await call(`/api/persons/${PERSON}/orchestrate`, 'POST', {
    text: '今天中午吃什么，一个人，别太辣，预算30',
  })
  const e = eat.body.data
  assert(e.intent.type === 'eat', '意图识别为「吃什么」', String(e.intent.confidence))
  assert(e.cards.length >= 3, '产出多条建议', `${e.cards.length} 条`)
  const primary = e.cards.find(c => c.kind === 'primary')
  assert(!!primary, '有主推')
  assert(primary.why.length >= 2, '主推带理由', primary.why[0])
  assert(e.trace.some(t => t.stage === 'run'), '留编排轨迹', `${e.trace.length} 步`)
  const withEvidence = e.cards.find(c => (c.evidence || []).length > 0)
  assert(!!withEvidence, '建议可溯源到记忆', withEvidence ? withEvidence.evidence[0].text : '')

  // 胃敏感 + 别太辣 → 不该推重辣菜
  assert(primary.meta.spicy === 0, '不推辣菜', `辣度 ${primary.meta.spicy}`)

  // ── 编排 B：组局 ──
  const gather = await call(`/api/persons/${PERSON}/orchestrate`, 'POST', {
    text: '周六想和朋友组个局，6个人，预算150',
  })
  const g = gather.body.data
  assert(g.intent.type === 'gather', '意图识别为「组局」')
  const plan = g.cards.find(c => c.kind === 'plan')
  assert(!!plan, '产出一个完整方案')
  assert(plan.meta.timeline.length >= 3, '方案含时间线', `${plan.meta.timeline.length} 个节点`)
  assert(plan.meta.todos.length >= 2, '方案含待办', `${plan.meta.todos.length} 项`)
  assert(plan.meta.totalPerPerson > 0, '方案含人均', `${plan.meta.totalPerPerson} 元`)
  assert(plan.meta.parts.length >= 2, '方案由多个服务拼成', `${plan.meta.parts.length} 个`)

  const scriptCard = g.cards.find(c => c.id.startsWith('script_'))
  assert(scriptCard.meta.headcountFit.includes(6), '选本人数匹配', scriptCard.title)

  // ── 反馈：否决要能改档案 ──
  const beforeFact = await call(`/api/persons/${PERSON}/silicon`)
  const spicyBefore = (beforeFact.body.data.silicon.facts.find(f => f.key === 'diet.spicy') || {}).value

  await call(`/api/persons/${PERSON}/records`, 'POST', { text: '我能吃重辣，无辣不欢' })
  const midFact = await call(`/api/persons/${PERSON}/silicon`)
  const spicyMid = (midFact.body.data.silicon.facts.find(f => f.key === 'diet.spicy') || {}).value
  assert(spicyMid === '重辣', '新记录能改事实', `${spicyBefore} → ${spicyMid}`)

  const fb = await call(`/api/persons/${PERSON}/feedback`, 'POST', {
    invocationId: e.invocationId,
    cardId: primary.id,
    action: 'reject',
    reason: 'too_spicy',
  })
  assert(fb.status === 200 && fb.body.data.ok, '否决被接受')
  assert(fb.body.data.changes.length > 0, '否决触发了档案修正', JSON.stringify(fb.body.data.changes[0] || {}))

  const afterFact = await call(`/api/persons/${PERSON}/silicon`)
  const spicyAfter = (afterFact.body.data.silicon.facts.find(f => f.key === 'diet.spicy') || {}).value
  assert(spicyAfter !== '重辣', '「太辣」否决后耐受度下调', `${spicyMid} → ${spicyAfter}`)

  // ── 手动改档案 ──
  const edit = await call(`/api/persons/${PERSON}/facts`, 'POST', { key: 'diet.taste', value: '清淡' })
  assert(edit.status === 200 && edit.body.data.fact.value === '清淡', '手动修正事实')

  const badKey = await call(`/api/persons/${PERSON}/facts`, 'POST', { key: 'hack.key', value: 'x' })
  assert(badKey.status === 400, '非法维度被拒绝', badKey.body.error.code)

  // ── 错误处理 ──
  const notFound = await call(`/api/persons/${PERSON}/orchestrate`, 'POST', { text: '' })
  assert(notFound.status === 400, '空输入被拒绝')

  const missing = await call('/api/persons/not_exist/silicon')
  assert(missing.status === 404, '不存在的人返回 404')

  const badPath = await call('/api/nope')
  assert(badPath.status === 404, '未知路径返回 404')

  // ── 清理 ──
  await call('/api/dev/reset', 'POST', {})

  console.log(`\n通过 ${pass} / 失败 ${fail}\n`)
  process.exit(fail ? 1 : 0)
}

function R(changes) {
  return changes.map(c => `${c.key}=${c.after}`).join(', ').slice(0, 60)
}

main().catch(err => {
  console.error('冒烟中断：', err.message)
  process.exit(1)
})
