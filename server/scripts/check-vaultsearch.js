'use strict'

// vault 全文检索回归：打分/片段/缓存 + scope=vault 票据闭环。
// 跑法：node scripts/check-vaultsearch.js（自建临时 vault 与数据目录，不依赖服务）

const fs = require('fs')
const os = require('os')
const path = require('path')
const { createRepos } = require('../src/store/repos')
const grant = require('../src/security/grant')
const vaultSearch = require('../src/services/vaultsearch.service')

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

function write(root, rel, content) {
  const full = path.join(root, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf8')
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qjz-vsearch-'))
  const vault = path.join(tmp, 'vault')
  write(vault, '02-Engineering/上线经验.md', `# 一周两人上线\n\n砍掉非核心验收标准，先上核心路径。每日同步进度避免返工。\n`)
  write(vault, '01-AI/RAG.md', `# RAG 检索增强\n\n检索增强生成（RAG）先召回再生成，上下文窗口有限要压缩。\n`)
  write(vault, '00-Inbox/杂记.md', `今天喝了拿铁，顺带想了下上线排期的事。\n`)
  write(vault, '.obsidian/app.json', '{}')

  const repos = createRepos(path.join(tmp, 'data'))
  repos.person.create({ id: 'p_vs', name: '检索测试', city: '银川' })

  console.log('\n【1】切词')
  const tokens = vaultSearch.tokenize('上线 RAG')
  ok('中文出二元组「上线」', tokens.includes('上线'))
  ok('拉丁词小写保留', tokens.includes('rag'))

  console.log('\n【2】检索与打分')
  vaultSearch.resetCache()
  const r1 = vaultSearch.search({ vaultPath: vault, q: '上线 排期' })
  ok('命中至少 2 篇', r1.total >= 2, `实际 ${r1.total}`)
  ok('标题带「上线」的笔记排第一', r1.items[0].title === '一周两人上线', `实际第一 ${r1.items[0].title}`)
  ok('返回片段且被截断保护', r1.items[0].snippet.length > 0 && r1.items[0].snippet.length <= 121)
  const r2 = vaultSearch.search({ vaultPath: vault, q: 'RAG 召回' })
  ok('拉丁词可检索', r2.items[0] && r2.items[0].title === 'RAG 检索增强')
  const r3 = vaultSearch.search({ vaultPath: vault, q: '' })
  ok('空检索词返回空', r3.total === 0 && r3.items.length === 0)

  console.log('\n【3】缓存与增量')
  write(vault, '02-Engineering/上线经验.md', `# 一周两人上线\n\n新增内容：缓存过期后这条能被搜到，关键词是琥珀。\n`)
  const r5 = vaultSearch.search({ vaultPath: vault, q: '琥珀' })
  ok('60 秒内旧缓存搜不到新词（设计如此）', r5.total === 0)
  vaultSearch.resetCache()
  const r6 = vaultSearch.search({ vaultPath: vault, q: '琥珀' })
  ok('重建索引后可搜到', r6.total === 1)
  const r7 = vaultSearch.search({ vaultPath: path.join(tmp, 'nope'), q: 'x' })
  ok('无效路径不抛错返回空', r7.total === 0)

  console.log('\n【4】scope=vault 票据闭环')
  const { token } = grant.issue(repos, 'p_vs', { scopes: ['vault'], purpose: '检索自己的笔记' })
  const consumed = grant.consume(repos, 'p_vs', token, 'vault', { route: 'test' })
  ok('vault scope 票据可消费', consumed && consumed.id.startsWith('g_'))
  const { token: t2 } = grant.issue(repos, 'p_vs', { scopes: ['prompt'], purpose: '对照测试' })
  let denied = false
  try { grant.consume(repos, 'p_vs', t2, 'vault', { route: 'test' }) } catch (e) { denied = e.code === 'FORBIDDEN' }
  ok('scope 不匹配被拒（403）', denied)
  const { token: t3 } = grant.issue(repos, 'p_vs', { scopes: ['vault'], purpose: '期限测试', ttlSec: 30 })
  grant.revoke(repos, 'p_vs', grant.list(repos, 'p_vs').find(g => !g.revoked)?.id || 'x')
  let revokedDenied = false
  try { grant.consume(repos, 'p_vs', t3, 'vault', { route: 'test' }) } catch (e) { revokedDenied = e.code === 'UNAUTHORIZED' }
  ok('撤销后不可用', revokedDenied)
  const scopeList = Object.keys(grant.SCOPES)
  ok('SCOPES 含 vault 且描述齐', scopeList.includes('vault') && !!grant.SCOPES.vault.label)

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  if (fail) { console.error(failures.join('\n')); process.exit(1) }
}

main().catch(e => { console.error('脚本异常：', e); process.exit(1) })
