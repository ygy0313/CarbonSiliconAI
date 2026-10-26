'use strict'

// Obsidian 库 → 经验资产的同步桥。
//
// 职责：扫 vault、筛 decision-experience 笔记、幂等导入经验库。
// 不做的事：不写回笔记（运行时评分以服务端为准，回写属二期）；不碰非决策类笔记。
//
// 同步策略（跑多少遍结果都一样）：
//   - 新笔记         → 建经验，validity 做种子分，status 直接 active（用户手写的经验天然可信）；
//   - 笔记变了       → 只更新文本（rule/situation/action/outcome/tags），
//                      不动 effectiveness / applied —— 运行时反馈已发生，别抹历史；
//   - 笔记没变       → 跳过；
//   - 库里删掉的笔记 → 不删经验（经验是资产，沉睡交给评分机制）。

const fs = require('fs')
const path = require('path')
const log = require('../logger')
const X = require('../domain/experience')
const OB = require('../domain/obsidian')

const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules'])
const MAX_FILES = 5000
const MAX_SIZE = 512 * 1024

function walkMd(root, dir = root, out = [], depth = 0) {
  if (depth > 8 || out.length >= MAX_FILES) return out
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (_) {
    return out
  }
  for (const ent of entries) {
    if (out.length >= MAX_FILES) break
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue
      walkMd(root, full, out, depth + 1)
      continue
    }
    if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) out.push(full)
  }
  return out
}

/**
 * 同步入口。返回计数摘要，路由层直接透传给前端。
 * vaultPath 只认服务端配置（OBSIDIAN_VAULT_PATH），不接受请求体传路径 —— 防目录穿越。
 */
function sync(repos, personId, { vaultPath, dryRun = false } = {}) {
  if (!vaultPath) {
    const err = new Error('没有配置 Obsidian 库路径（OBSIDIAN_VAULT_PATH）')
    err.code = 'VAULT_NOT_CONFIGURED'
    throw err
  }
  let stat
  try {
    stat = fs.statSync(vaultPath)
  } catch (_) {
    const err = new Error(`Obsidian 库路径不可访问：${vaultPath}`)
    err.code = 'VAULT_UNREACHABLE'
    throw err
  }
  if (!stat.isDirectory()) {
    const err = new Error('OBSIDIAN_VAULT_PATH 必须是目录')
    err.code = 'VAULT_NOT_DIR'
    throw err
  }

  const criteria = X.normalizeCriteria(repos.criteria.get(personId) || {})
  const existingBySig = new Map(
    repos.experience.byPerson(personId, { limit: 2000 }).filter(e => e.source === 'obsidian').map(e => [e.signature, e])
  )

  const summary = { scanned: 0, matched: 0, created: 0, updated: 0, skipped: 0, rejected: [] }

  for (const full of walkMd(vaultPath)) {
    summary.scanned++
    let md
    try {
      md = fs.readFileSync(full, 'utf8')
    } catch (_) {
      continue
    }
    if (md.length > MAX_SIZE) continue
    const relPath = path.relative(vaultPath, full).split(path.sep).join('/')

    const mapped = OB.mapNote({ relPath, md })
    if (!mapped.ok) {
      // frontmatter 存在但字段不齐才记入 rejected，普通笔记连提都不提
      const { frontmatter } = OB.parseFrontmatter(md)
      if (frontmatter && frontmatter.type && summary.rejected.length < 20) {
        summary.rejected.push({ path: relPath, reason: mapped.reason })
      }
      continue
    }
    summary.matched++
    if (dryRun) continue

    const note = mapped.note
    const sig = OB.signatureOf(relPath)
    const existing = existingBySig.get(sig)

    if (!existing) {
      const doc = X.createExperience({
        personId,
        situation: { text: note.situationText, scene: '', tags: note.tags },
        action: { kind: 'rule', text: note.actionText },
        outcome: {
          verdict: note.validity >= 0.5 ? 'good' : 'bad',
          note: note.outcomeText,
        },
        rule: note.rule,
        trigger: { tags: note.tags, scene: '', intent: '' },
        evidence: OB.toEvidence(relPath),
        source: 'obsidian',
        status: 'active',
        effectiveness: note.validity,
      })
      doc.signature = sig
      doc.applied = note.appliedCount
      doc.lastAppliedAt = note.lastApplied ? new Date(note.lastApplied).toISOString() : null
      doc.obsidian = { path: relPath, hash: note.hash, syncedAt: new Date().toISOString() }
      doc.status = X.nextStatus(doc, criteria)
      repos.experience.insert(doc)
      summary.created++
      continue
    }

    if (existing.obsidian && existing.obsidian.hash === note.hash) {
      summary.skipped++
      continue
    }
    // 笔记有改动：只换文本，评分历史是运行时攒出来的，不许覆盖
    repos.experience.update(existing.id, {
      rule: note.rule,
      situation: { ...existing.situation, text: note.situationText, tags: note.tags },
      action: { kind: existing.action?.kind || 'rule', text: note.actionText },
      outcome: { ...existing.outcome, note: note.outcomeText },
      trigger: { ...existing.trigger, tags: note.tags },
      obsidian: { path: relPath, hash: note.hash, syncedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    })
    summary.updated++
  }

  log.info('Obsidian 经验同步完成', { personId, ...summary, rejected: summary.rejected.length })
  return summary
}

// ── 查看 / 导出（给「我的」页的 Obsidian 入口）────────────────
// 路径只认服务端配置的 vault，relPath 必须落在 vault 内 —— 防目录穿越。
function assertInside(vaultPath, full) {
  const rel = path.relative(vaultPath, full)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    const err = new Error('路径不合法')
    err.code = 'VAULT_PATH_INVALID'
    throw err
  }
  return rel
}

/** 列出全部笔记（只给元信息：相对路径 / 标题 / 大小 / 更新时间），按更新时间倒序 */
function listNotes(vaultPath) {
  if (!vaultPath) {
    const err = new Error('没有配置 Obsidian 库路径（OBSIDIAN_VAULT_PATH）')
    err.code = 'VAULT_NOT_CONFIGURED'
    throw err
  }
  const notes = walkMd(vaultPath).map(full => {
    let stat = {}
    try { stat = fs.statSync(full) } catch (_) {}
    return {
      path: path.relative(vaultPath, full).split(path.sep).join('/'),
      title: path.basename(full, '.md'),
      bytes: stat.size || 0,
      mtime: stat.mtimeMs || 0,
    }
  }).sort((a, b) => b.mtime - a.mtime)
  return { count: notes.length, notes }
}

/**
 * 导出笔记内容（带全文）。上限保护：最多 80 篇 / 每篇 256KB / 总量 512KB。
 * 内容是用户自己的笔记，读取仍要求 scope=vault 票据（路由层拦）。
 */
function exportNotes(vaultPath, { maxNotes = 80, maxTotal = 512 * 1024 } = {}) {
  const { notes } = listNotes(vaultPath)
  const out = []
  let total = 0
  for (const n of notes.slice(0, maxNotes)) {
    if (total >= maxTotal) break
    const full = path.join(vaultPath, ...n.path.split('/'))
    assertInside(vaultPath, full)
    let content = ''
    try {
      content = fs.readFileSync(full, 'utf8')
    } catch (_) { continue }
    if (content.length > 256 * 1024) content = content.slice(0, 256 * 1024) + '\n<!-- 截断 -->'
    total += content.length
    out.push({ path: n.path, title: n.title, content })
  }
  return { count: out.length, truncated: notes.length > out.length, notes: out }
}

module.exports = { sync, walkMd, SKIP_DIRS, listNotes, exportNotes }
