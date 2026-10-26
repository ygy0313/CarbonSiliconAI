'use strict'

// Obsidian 决策经验闭环回归：解析 → 幂等同步 → 检索重排序 → 反馈更新 → 隔离。
// 跑法：node scripts/check-obsidian.js（自建临时 vault + 临时数据目录，不依赖已启动的服务）

const fs = require('fs')
const os = require('os')
const path = require('path')
const { createRepos } = require('../src/store/repos')
const obsidianService = require('../src/services/obsidian.service')
const experienceService = require('../src/services/experience.service')
const OB = require('../src/domain/obsidian')

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const NOTE_FIXTURE = `---
type: decision-experience
situation: "用户要求在一周内上线新功能但团队只有两人"
action: "砍掉非核心验收标准，先上核心路径"
outcome: "按期上线，用户反馈核心流程可用"
validity: 0.8
applied_count: 3
last_applied: 2026-10-20
tags: 工程,上线
---

# 一周上线两人团队

正文内容不影响结构化字段。
`

function writeVault(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf8')
  }
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qjz-obsidian-'))
  const vault = path.join(tmp, 'vault')
  const repos = createRepos(path.join(tmp, 'data'))
  const PERSON = 'p_obs_test'

  repos.person.create({ id: PERSON, name: '经验同步测试', city: '银川' })

  console.log('\n【1】frontmatter 解析（零依赖 YAML 子集）')
  const parsed = OB.parseFrontmatter(NOTE_FIXTURE)
  ok('能识别 frontmatter', !!parsed.frontmatter)
  ok('type 字段正确', parsed.frontmatter.type === 'decision-experience')
  ok('带引号值剥壳', parsed.frontmatter.situation === '用户要求在一周内上线新功能但团队只有两人')
  const noFm = OB.parseFrontmatter('没有 frontmatter 的普通笔记')
  ok('无 frontmatter 返回 null', noFm.frontmatter === null)

  console.log('\n【2】mapNote 校验')
  const good = OB.mapNote({ relPath: '02-Engineering/一周上线.md', md: NOTE_FIXTURE })
  ok('合法笔记通过', good.ok === true)
  ok('validity 解析为 0.8', good.note.validity === 0.8)
  ok('applied_count 解析为 3', good.note.appliedCount === 3)
  ok('tags 拆分为 2 个', good.note.tags.length === 2)
  ok('规则文本含「」括住的行动（供仲裁提取）', /「砍掉非核心验收标准，先上核心路径」/.test(good.note.rule))
  ok('evidence 指向笔记路径', OB.toEvidence(good.note.relPath)[0].refId === 'obsidian:02-Engineering/一周上线.md')
  const missing = OB.mapNote({ relPath: 'x.md', md: '---\ntype: decision-experience\nsituation: "只有情境"\n---\n' })
  ok('字段不齐被拒收', missing.ok === false)
  const wrongType = OB.mapNote({ relPath: 'x.md', md: '---\ntype: daily-note\n---\n' })
  ok('type 不对被拒收', wrongType.ok === false)
  ok('同样内容 hash 稳定', OB.mapNote({ relPath: 'a.md', md: NOTE_FIXTURE }).note.hash === good.note.hash)

  console.log('\n【3】同步：创建 + 幂等')
  writeVault(vault, {
    '02-Engineering/一周上线.md': NOTE_FIXTURE,
    '02-Engineering/普通笔记.md': '# 普通笔记\n没有 frontmatter',
    '01-AI/带错字段.md': '---\ntype: decision-experience\nsituation: "缺行动"\n---\n',
    '.obsidian/config.json': '{}',
  })
  const r1 = obsidianService.sync(repos, PERSON, { vaultPath: vault })
  ok('只扫 3 个 .md（.obsidian 目录被跳过）', r1.scanned === 3, `实际 ${r1.scanned}`)
  ok('匹配 1 条决策经验', r1.matched === 1)
  ok('新建 1 条', r1.created === 1)
  ok('普通笔记不计入 rejected', r1.rejected.length === 1 && r1.rejected[0].reason.includes('situation'))
  const r2 = obsidianService.sync(repos, PERSON, { vaultPath: vault })
  ok('重复同步不新建', r2.created === 0)
  ok('重复同步命中跳过', r2.skipped === 1)

  const list = experienceService.list(repos, PERSON)
  const imported = list.find(e => e.source === 'obsidian')
  ok('经验入库且 source=obsidian', !!imported)
  ok('validity 做种子分（0.8）', imported.effectiveness === 0.8)
  ok('applied_count 迁移（3）', imported.applied === 3)
  ok('evidence 可溯源到笔记', imported.evidence[0].refId.startsWith('obsidian:'))
  ok('last_applied 迁移', !!imported.lastAppliedAt && imported.lastAppliedAt.startsWith('2026-10-20'))

  console.log('\n【4】检索重排序：validity/applied 参与 core.rank 权重')
  // 手写一条低分经验做对照：同 tags 下，高分笔记经验应排前面
  experienceService.createManual(repos, PERSON, {
    rule: '遇到「评审卡壳」时，优先「先小范围试讲」',
    tags: ['工程', '上线'],
    outcome: 'neutral',
  })
  const manualExp = experienceService.list(repos, PERSON).find(e => e.source === 'manual')
  experienceService.applyOutcome(repos, PERSON, manualExp.id, 'failed')
  const hit = await experienceService.retrieve(repos, PERSON, { tags: ['工程', '上线'], limit: 5 })
  ok('两条经验都参与检索', hit.items.length >= 2)
  ok('高 validity 笔记经验排第一', hit.items[0].id === imported.id, `实际第一 ${hit.items[0].rule.slice(0, 20)}`)
  ok('检索结果带 why 与 evidence', !!hit.items[0].why && hit.items[0].evidence.length > 0)

  console.log('\n【5】运行时反馈覆盖种子分（单环）')
  const before = experienceService.get(repos, PERSON, imported.id).effectiveness
  experienceService.applyOutcome(repos, PERSON, imported.id, 'failed')
  const after = experienceService.get(repos, PERSON, imported.id).effectiveness
  ok('反馈后分数下降（0.8 × 0.78）', after < before && Math.abs(after - 0.8 * 0.78) < 0.001)

  console.log('\n【6】笔记改动：只换文本，不回滚运行时分数')
  const edited = NOTE_FIXTURE.replace('砍掉非核心验收标准，先上核心路径', '砍掉非核心验收标准，先上核心路径并每日同步进度')
  writeVault(vault, { '02-Engineering/一周上线.md': edited })
  const r3 = obsidianService.sync(repos, PERSON, { vaultPath: vault })
  ok('识别为更新', r3.updated === 1 && r3.created === 0)
  const afterSync = experienceService.get(repos, PERSON, imported.id)
  ok('行动文本已更新', afterSync.action.text.includes('每日同步进度'))
  ok('运行时分数未被覆盖', Math.abs(afterSync.effectiveness - after) < 0.001)

  console.log('\n【7】边界与隔离')
  ok('未配置 vault 给出明确错误', (() => {
    try { obsidianService.sync(repos, PERSON, { vaultPath: '' }); return false }
    catch (e) { return e.code === 'VAULT_NOT_CONFIGURED' }
  })())
  ok('路径不存在给出明确错误', (() => {
    try { obsidianService.sync(repos, PERSON, { vaultPath: path.join(tmp, 'nope') }); return false }
    catch (e) { return e.code === 'VAULT_UNREACHABLE' }
  })())
  const OTHER = 'p_obs_other'
  repos.person.create({ id: OTHER, name: '隔离测试', city: '银川' })
  const otherList = experienceService.list(repos, OTHER)
  ok('跨人不可见导入经验', otherList.length === 0)

  await repos.store.flushAll() // 等异步写队列落盘，再清理临时目录
  fs.rmSync(tmp, { recursive: true, force: true })

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  if (fail) { console.error(failures.join('\n')); process.exit(1) }
}

main().catch(e => { console.error('脚本异常：', e); process.exit(1) })
