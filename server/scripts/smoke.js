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

async function call(path, method = 'GET', body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
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

  // ── 日程：认下的事要能落库、能勾完、能被日历核对到 ──
  const todayKey = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const tomorrowKey = new Date(Date.now() + 8 * 3600 * 1000 + 86400000).toISOString().slice(0, 10)

  const ag1 = await call(`/api/persons/${PERSON}/agenda`, 'POST', { title: '和小林吃面', time: '12:30' })
  assert(ag1.status === 200 && !!ag1.body.data.item.id, '记一条日程')
  assert(ag1.body.data.item.date === todayKey, '不填日期默认落在今天', ag1.body.data.item.date)
  assert(ag1.body.data.item.dayLabel === '今天', '日程带人话标签', ag1.body.data.item.dayLabel)

  const agNoTitle = await call(`/api/persons/${PERSON}/agenda`, 'POST', { title: '   ' })
  assert(agNoTitle.status === 400, '空标题被拒绝', agNoTitle.body.error.code)
  const agBadDate = await call(`/api/persons/${PERSON}/agenda`, 'POST', { title: '假日子', date: '2026-02-31' })
  assert(agBadDate.status === 400, '不存在的日期被拒绝', agBadDate.body.error.code)
  const agBadTime = await call(`/api/persons/${PERSON}/agenda`, 'POST', { title: '错时间', time: '25:90' })
  assert(agBadTime.status === 400, '非法时刻被拒绝', agBadTime.body.error.code)

  const agTomorrow = await call(`/api/persons/${PERSON}/agenda`, 'POST', { title: '牙医', date: tomorrowKey, time: '09:00' })
  const agList = await call(`/api/persons/${PERSON}/agenda?days=7`)
  assert(agList.body.data.counts.today === 1, '今天 1 件事', String(agList.body.data.counts.today))
  assert(agList.body.data.groups.length === 2, '按天分成两组', String(agList.body.data.groups.length))
  assert(agList.body.data.groups[1].dayLabel === '明天', '第二组是明天', agList.body.data.groups[1].dayLabel)

  // 组局要看得出「这天已经有别的事」—— 日程是结构化数据，不再靠文本里碰巧出现的日期
  const clash = await call(`/api/persons/${PERSON}/orchestrate`, 'POST', { text: '明天想和朋友组个局，5个人' })
  const cplan = clash.body.data.cards.find(c => c.kind === 'plan')
  assert(!!cplan && cplan.meta.conflict === true, '组局能看出这天已有安排', String(cplan && cplan.meta.booked))
  assert(cplan.meta.date === tomorrowKey, '组局落在明天', String(cplan.meta.date))

  const agDone = await call(`/api/persons/${PERSON}/agenda/${ag1.body.data.item.id}/done`, 'POST', { done: true })
  assert(agDone.body.data.item.done === true, '勾掉一条日程')
  const agGone = await call(`/api/persons/${PERSON}/agenda/${ag1.body.data.item.id}/remove`, 'POST', {})
  assert(agGone.body.data.removed === true, '删掉一条日程')
  // 隔离：换个人来动同一条日程，一律当作不存在（不是「无权限」—— 连存在都不承认）
  const P2 = PERSON + '_b'
  await call('/api/persons', 'POST', { id: P2, name: '另一个人' })
  const agCross = await call(`/api/persons/${P2}/agenda/${agTomorrow.body.data.item.id}/done`, 'POST', { done: false })
  assert(agCross.status === 404, '跨人改日程一律 404', String(agCross.status))

  // ── 按日翻记录 / 时段推荐 / Obsidian 查看 ──
  const dayRec = await call(`/api/persons/${PERSON}/records`)
  assert(dayRec.status === 200 && dayRec.body.data.count >= 1, '按日翻记录：今天有账', String(dayRec.body.data.count))
  const emptyDay = await call(`/api/persons/${PERSON}/records?date=2000-01-01`)
  assert(emptyDay.body.data.count === 0, '按日翻记录：空日子是 0 笔')
  const badDay = await call(`/api/persons/${PERSON}/records?date=2026-02-31`)
  assert(badDay.status === 400, '不存在的日期被拒绝', badDay.body.error.code)

  const slotRes = await call(`/api/persons/${PERSON}/orchestrate`, 'POST', { text: '来点吃的', slot: 'tea', remember: false })
  const brewCards = (slotRes.body.data.cards || []).filter(c => String(c.id || '').startsWith('brew_'))
  assert(brewCards.length >= 1, '时段透传：茶歇出饮品候选（茶/咖啡，不含酒）', brewCards.map(c => c.title).join('、'))
  const mealDesc = (slotRes.body.data.cards || []).map(c => c.desc || '').join(' ')
  assert(!/[0-9]+ ?元/.test(mealDesc), '食饮文案不带价格')

  const vaultNoToken = await call(`/api/persons/${PERSON}/obsidian/notes`)
  assert(vaultNoToken.status === 401, 'Obsidian 列表无票据被拦', String(vaultNoToken.status))
  const grantRes = await call(`/api/persons/${PERSON}/grants`, 'POST', { scopes: ['vault'], purpose: '冒烟：读 Obsidian', ttlSec: 300, maxUses: 3 })
  assert(grantRes.status === 200 && grantRes.body.data.token, '签 vault 票据')
  const vaultList = await call(`/api/persons/${PERSON}/obsidian/notes`, 'GET', null, { 'X-Grant-Token': grantRes.body.data.token })
  assert(vaultList.status === 400, '库路径没配时给明确报错（票据已通过）', vaultList.body.error.code)

  // ── 简历：文本 / 文件（txt 走同一解析器）/ 旧 doc 拒绝 ──
  const resumeTxt = await call(`/api/persons/${PERSON}/resume`, 'POST', {
    file: { name: 'cv.txt', base64: Buffer.from('杨光宇 技术总监 质量与效能 2011-2025 阿里云 带 30 人团队', 'utf8').toString('base64') },
  })
  assert(resumeTxt.status === 200 && resumeTxt.body.data.file && resumeTxt.body.data.file.format === 'txt',
    '简历：txt 文件解析入库', JSON.stringify(resumeTxt.body.data.file))
  const resumeDoc = await call(`/api/persons/${PERSON}/resume`, 'POST', {
    file: { name: 'cv.doc', base64: Buffer.from('whatever').toString('base64') },
  })
  assert(resumeDoc.status === 400 && /docx|PDF/.test(resumeDoc.body.error.message || ''), '简历：旧 .doc 给明确提示', resumeDoc.body.error.message)
  const resumeShort = await call(`/api/persons/${PERSON}/resume`, 'POST', { text: '太短' })
  assert(resumeShort.status === 400, '简历：过短文本被拒')

  // ── 灵光一现：入档 + 按主题给输入 ──
  const spark = await call(`/api/persons/${PERSON}/spark`, 'POST', { text: '最近在纠结要不要接一个管理岗，怕离开一线太久' })
  assert(spark.status === 200 && spark.body.data.episode.id, '灵光一现入档')
  assert((spark.body.data.picks || []).length >= 1, '灵光一现给出可看的输入', JSON.stringify((spark.body.data.picks || []).map(p => p.topic)))
  const sparkPick = (spark.body.data.picks || [])[0] || {}
  assert(!!(sparkPick.book && sparkPick.book.title), '推荐带书名（可溯源）')

  // ── 行为：只记动作，不记正文；可清空 ──
  const beh0 = await call(`/api/persons/${PERSON}/behaviors/summary`)
  assert(beh0.status === 200 && Array.isArray(beh0.body.data.top), '行为画像可读')
  const behAdd = await call(`/api/persons/${PERSON}/behaviors`, 'POST', {
    items: [
      { kind: 'page', name: '首页', durationMs: 4200 },
      { kind: 'tap', name: '换一条', detail: 'meal' },
      { kind: 'bogus', name: '不该进来' },
    ],
  })
  assert(behAdd.body.data.accepted === 2, '非法类型被过滤（只收 2 条）', String(behAdd.body.data.accepted))
  const beh1 = await call(`/api/persons/${PERSON}/behaviors/summary`)
  assert(beh1.body.data.total >= 2 && beh1.body.data.top[0].name, '行为画像有统计', JSON.stringify(beh1.body.data.top[0]))
  assert(/读不到/.test(beh1.body.data.boundary || ''), '画像里写明采不到别的 App')
  const behClear = await call(`/api/persons/${PERSON}/behaviors/clear`, 'POST', {})
  assert(behClear.body.data.removed >= 2, '行为痕迹可一键清空', String(behClear.body.data.removed))

  // ── 成长：需要 vault 票据；没配库时给可读状态而不是 500 ──
  const growthNoToken = await call(`/api/persons/${PERSON}/growth`)
  assert(growthNoToken.status === 401, '成长条目无票据被拦', String(growthNoToken.status))
  const growth = await call(`/api/persons/${PERSON}/growth`, 'GET', null, { 'X-Grant-Token': grantRes.body.data.token })
  assert(growth.status === 200, '成长条目不因库未配置而报错', String(growth.status))
  assert(Array.isArray(growth.body.data.themes), '成长条目返回主题数组')

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
