'use strict'

// 经验资产回归：闭环（记录→反思→检索→应用→回写）、双环约束、隔离、双实现同构、导出携带。
// 跑法：node scripts/check-experience.js（需先启动服务；内核可选，未启动时用 JS 实现）

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787'

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch (_) {}
  return { status: res.status, body: json, data: json?.data }
}

const stamp = Date.now().toString(36)
const QA = `p_expA_${stamp}`
const QB = `p_expB_${stamp}`

async function main() {
  console.log('\n【0】准备两个互不相干的人')
  for (const id of [QA, QB]) {
    const r = await call('/api/persons', { method: 'POST', body: { id, name: `经验测试${id.slice(-4)}`, city: '银川' } })
    ok(`创建 ${id}`, r.status === 200 || r.status === 201)
  }

  console.log('\n【1】手写经验：用户自己写的规则权重最高')
  const manual = await call(`/api/persons/${QA}/experiences`, {
    method: 'POST',
    body: { rule: '预算没定的时候，先按 30 元点，吃完再决定加不加', tags: ['预算紧'], scene: 'solo' },
  })
  ok('创建成功', manual.status === 200 && !!manual.data?.experience?.id)
  const m = manual.data?.experience
  ok('状态为可用', m?.status === 'active')
  ok('初始有效性 0.7（高于默认 0.5）', m?.effectiveness === 0.7)
  ok('带可读描述', typeof m?.readability === 'string' && m.readability.length > 6)

  console.log('\n【2】隔离：跨人访问等同不存在')
  const cross = await call(`/api/persons/${QB}/experiences/${m.id}`)
  ok('B 读 A 的经验 → 404', cross.status === 404, `实际 ${cross.status}`)
  const bList = await call(`/api/persons/${QB}/experiences`)
  ok('B 的列表里没有 A 的经验', (bList.data?.experiences || []).every(x => x.id !== m.id))
  const crossApply = await call(`/api/persons/${QB}/experiences/${m.id}/apply`, { method: 'POST', body: { outcome: 'worked' } })
  ok('B 给 A 的经验记结果 → 404', crossApply.status === 404, `实际 ${crossApply.status}`)

  console.log('\n【3】应用 → 有效性单环更新')
  const applied = await call(`/api/persons/${QA}/experiences/${m.id}/apply`, { method: 'POST', body: { outcome: 'worked' } })
  ok('应用成功', applied.status === 200)
  ok('有效性上升', applied.data?.after > applied.data?.before, `${applied.data?.before} → ${applied.data?.after}`)
  ok('应用次数 +1', applied.data?.experience?.applied === 1)
  ok('奏效次数 +1', applied.data?.experience?.followed === 1)

  const failed = await call(`/api/persons/${QA}/experiences/${m.id}/apply`, { method: 'POST', body: { outcome: 'failed' } })
  ok('失败一次有效性下降', failed.data?.after < failed.data?.before, `${failed.data?.before} → ${failed.data?.after}`)
  ok('一次失败打不穿长期有效的规则', failed.data?.after > 0.5, `实际 ${failed.data?.after}`)

  const bad = await call(`/api/persons/${QA}/experiences/${m.id}/apply`, { method: 'POST', body: { outcome: 'amazing' } })
  ok('非法结果被拒（400）', bad.status === 400)

  console.log('\n【4】双环：评估标准只能由用户改')
  const noConfirm = await call(`/api/persons/${QA}/criteria`, { method: 'POST', body: { thresholds: { promote: 0.5 } } })
  ok('不带 confirm 改标准 → 被拒', noConfirm.status >= 400, `实际 ${noConfirm.status}`)
  const withConfirm = await call(`/api/persons/${QA}/criteria`, {
    method: 'POST',
    body: { confirm: true, thresholds: { promote: 0.8 }, halfLifeDays: 60 },
  })
  ok('带 confirm 可以改', withConfirm.status === 200)
  ok('版本号 +1', withConfirm.data?.criteria?.version === 2, `实际 ${withConfirm.data?.criteria?.version}`)
  ok('记录确认人与时间', !!withConfirm.data?.criteria?.confirmedAt && withConfirm.data?.criteria?.confirmedBy === 'user')
  const reread = await call(`/api/persons/${QA}/criteria`)
  ok('改动持久化', reread.data?.criteria?.thresholds?.promote === 0.8)
  const grants = await call(`/api/persons/${QA}/grants`)
  ok('审计里有 criteria.update', (grants.data?.audits || []).some(a => a.action === 'criteria.update'))

  console.log('\n【5】闭环：连续采纳 → 自动反思 → 挖出规则')
  for (let i = 0; i < 3; i++) {
    const o = await call(`/api/persons/${QA}/orchestrate`, { method: 'POST', body: { text: '中午一个人吃，胃有点不舒服，别太辣' } })
    const inv = o.data
    if (!inv) { ok(`第 ${i + 1} 次编排`, false); break }
    const card = inv.cards[0]
    await call(`/api/persons/${QA}/feedback`, {
      method: 'POST',
      body: { invocationId: inv.invocationId, cardId: card.id, action: 'accept' },
    })
  }
  const refl = await call(`/api/persons/${QA}/experiences/reflect`, { method: 'POST', body: {} })
  ok('反思产出候选', (refl.data?.candidates || []).length >= 1, `events=${refl.data?.events}`)
  const cand = (refl.data?.candidates || [])[0]
  ok('候选带触发情境与倾向', !!cand?.rule && cand.precision >= 0.6)
  ok('规则文本可读（含「优先」或「避开」）', /优先|避开/.test(cand?.rule || ''))
  ok('规则里没有英文场景码', !/「(solo|group|npc)」/.test(cand?.rule || ''), cand?.rule)

  const list = await call(`/api/persons/${QA}/experiences`)
  const mined = (list.data?.experiences || []).filter(e => e.source === 'reflect')
  ok('反思产物入库', mined.length >= 1)
  ok('每条经验都能溯源', mined.every(e => (e.evidence || []).length > 0))

  console.log('\n【6】调用：经验必须影响结果，不能只当注解')
  const o2 = await call(`/api/persons/${QA}/orchestrate`, { method: 'POST', body: { text: '中午一个人吃，胃有点不舒服，别太辣' } })
  ok('编排结果带经验', (o2.data?.experience?.count || 0) >= 1)
  const first = o2.data?.cards?.[0]
  ok('首条卡挂上了经验 id', (first?.experienceIds || []).length > 0)
  ok('首条 why 里能看出是经验驱动的', (first?.why || []).some(w => w.includes('以前')), JSON.stringify(first?.why))
  ok('经验来源可查（cpp/js）', ['cpp', 'js'].includes(o2.data?.experience?.source))

  // 采纳后评分必须回写
  const before = (await call(`/api/persons/${QA}/experiences/${first.experienceIds[0]}`)).data?.experience?.effectiveness
  const fb = await call(`/api/persons/${QA}/feedback`, {
    method: 'POST',
    body: { invocationId: o2.data.invocationId, cardId: first.id, action: 'accept' },
  })
  ok('反馈回写经验评分', (fb.data?.experienceUpdates || []).length > 0)
  const after = (await call(`/api/persons/${QA}/experiences/${first.experienceIds[0]}`)).data?.experience?.effectiveness
  ok('采纳让有效性上升', after > before, `${before} → ${after}`)

  console.log('\n【7】资产盘点')
  const assets = await call(`/api/persons/${QA}/experiences/assets`)
  const a = assets.data?.assets
  ok('资产接口可用', assets.status === 200 && !!a)
  ok('统计口径自洽', a.total === a.active + a.dormant + a.proposed + a.archived, JSON.stringify({ t: a.total, act: a.active, d: a.dormant, p: a.proposed, ar: a.archived }))
  ok('给出下一步动作', !!a.nextAction?.text)
  ok('披露当前评估标准版本', typeof a.criteria?.version === 'number')

  console.log('\n【8】归档后不再参与推荐')
  const archived = await call(`/api/persons/${QA}/experiences/${first.experienceIds[0]}/status`, {
    method: 'POST',
    body: { status: 'archived' },
  })
  ok('归档成功', archived.data?.experience?.status === 'archived')
  const o3 = await call(`/api/persons/${QA}/orchestrate`, { method: 'POST', body: { text: '中午一个人吃，胃有点不舒服，别太辣' } })
  const stillThere = (o3.data?.experience?.items || []).some(i => i.id === first.experienceIds[0])
  ok('归档的经验不再被检索到', !stillThere)

  console.log('\n【9】两套实现同构：C++ 与 JS 必须给出同一个排序')
  const core = require('../src/core/client')
  const fallback = require('../src/core/fallback')
  const now = Date.now()
  const pool = [
    { id: 'a', tags: ['胃敏感', '微辣'], scene: 'solo', rule: '胃敏感优先清汤', effectiveness: 0.8, applied: 6, followed: 5, evidence: [1, 2], updatedAt: now - 86400000 },
    { id: 'b', tags: ['胃敏感'], scene: 'solo', rule: '胃敏感也可以吃辣', effectiveness: 0.2, applied: 4, followed: 1, evidence: [1], updatedAt: now - 3600000 },
    { id: 'c', tags: ['聚会'], scene: 'group', rule: '多人局优先新手本', effectiveness: 0.9, applied: 9, followed: 8, evidence: [1, 2, 3], updatedAt: now - 86400000 * 30 },
    { id: 'd', tags: ['预算紧'], scene: 'solo', rule: '预算紧先点半份', effectiveness: 0.6, applied: 2, followed: 2, evidence: [1], updatedAt: now - 86400000 * 60 },
  ]
  const q = { tags: ['胃敏感'], scene: 'solo', text: '一个人吃饭胃不舒服', limit: 3 }
  const cpp = await core.rank(pool, q, {}, now)
  // fallback.rank 返回数组（它就是内核函数的镜像，不包一层 envelope）
  const js = fallback.rank(pool, q, {}, now)
  const cppItems = cpp.items || []
  ok('两条路径都返回结果', cppItems.length > 0 && js.length > 0)
  ok('第一名一致', cppItems[0]?.id === js[0]?.id, `${cppItems[0]?.id} vs ${js[0]?.id}`)
  ok('名次序列一致', JSON.stringify(cppItems.map(i => i.id)) === JSON.stringify(js.map(i => i.id)))
  const diff = Math.abs((cppItems[0]?.score || 0) - (js[0]?.score || 0))
  ok('分数差 < 0.02', diff < 0.02, `差 ${diff.toFixed(4)}`)
  ok('不相关经验被闸门挡掉', !cppItems.some(i => i.id === 'c'))
  ok('空查询时不过滤（全量按质量排）', fallback.rank(pool, { limit: 4 }, {}, now).length === 4)
  ok('归档条目在打分阶段就被排除',
    fallback.rank([...pool, { ...pool[0], id: 'z', status: 'archived' }], q, {}, now).every(i => i.id !== 'z'))

  console.log('\n【10】导出必须带上经验与评估标准')
  const token = (await call(`/api/persons/${QA}/grants`, {
    method: 'POST',
    body: { scopes: ['export'], purpose: '回归测试-导出经验', ttlSec: 120, maxUses: 3 },
  })).data?.token
  const archive = await fetch(`${BASE}/api/persons/${QA}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Grant-Token': token },
    body: JSON.stringify({ scopes: ['export'] }),
  }).then(r => r.json())
  ok('导出成功', !!archive?.data?.checksum)
  ok('payload 含 experiences', Array.isArray(archive.data?.payload?.experiences) && archive.data.payload.experiences.length > 0)
  ok('payload 含 criteria', !!archive.data?.payload?.criteria)

  const imported = await call('/api/import', { method: 'POST', body: { archive: archive.data, name: '经验恢复验证' } })
  ok('导入成功', imported.status === 200)
  ok('经验条数一致', imported.data?.experienceCount === archive.data.payload.experiences.length,
    `${imported.data?.experienceCount} vs ${archive.data.payload.experiences.length}`)
  const restored = await call(`/api/persons/${imported.data?.person?.id}/experiences`)
  ok('恢复后的经验可读', (restored.data?.experiences || []).length === imported.data?.experienceCount)

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
