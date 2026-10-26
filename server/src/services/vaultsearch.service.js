'use strict'

// Obsidian 库全文检索（MCP 桥一期的内置实现）。
//
// 为什么不先接 stdio MCP：库里已有零依赖约定，检索本身是纯 IO + 打分，
// 内置实现免掉「公网小程序 → HTTP → 本地 stdio 进程」这条高风险链路。
// 二期若接真 RAG（向量/语义），本文件的 search() 签名不变，实现可替换。
//
// 检索口径：词频打分 + 标题加权，CJK 用二元切分。命中只返回片段，
// 全文必须另行持票读取（scope=vault）—— 这里只给「哪篇笔记、哪一行」。

const fs = require('fs')
const path = require('path')
const { walkMd } = require('./obsidian.service')

const TTL_MS = 60 * 1000 // 索引缓存 60 秒：写笔记 → 检索可见，最多延迟一分钟
const MAX_DOC = 256 * 1024
const SNIPPET_LEN = 120

const STATE = { root: null, builtAt: 0, docs: [] }

/** CJK 二元切分 + 拉丁词。query 和文档用同一套，保证能对上。 */
function tokenize(text) {
  const out = []
  const lower = String(text || '').toLowerCase()
  // 拉丁/数字词
  for (const w of lower.match(/[a-z0-9_]{2,}/g) || []) out.push(w)
  // CJK 二元组（单字太噪，三元太稀）
  const cjk = lower.match(/[\u4e00-\u9fff]+/g) || []
  for (const run of cjk) {
    if (run.length === 1) { out.push(run); continue }
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2))
  }
  return out
}

function firstHeading(text, file) {
  const m = /^#\s+(.+)$/m.exec(text)
  if (m) return m[1].trim().slice(0, 80)
  const { frontmatter } = require('../domain/obsidian').parseFrontmatter(text)
  if (frontmatter && frontmatter.title) return String(frontmatter.title).slice(0, 80)
  return path.basename(file, '.md')
}

function buildIndex(root) {
  const files = walkMd(root)
  const docs = []
  for (const full of files) {
    let text
    try {
      text = fs.readFileSync(full, 'utf8')
    } catch (_) { continue }
    if (text.length > MAX_DOC) continue
    const relPath = path.relative(root, full).split(path.sep).join('/')
    const mtime = fs.statSync(full).mtimeMs
    const cached = STATE.docs.find(d => d.path === relPath)
    // 增量：mtime 没变就沿用旧文档的预处理结果
    if (cached && cached.mtime === mtime) { docs.push(cached); continue }
    const title = firstHeading(text, relPath)
    const bodyNoFm = text.replace(/^---[\s\S]*?---/, '')
    docs.push({
      path: relPath,
      title,
      titleTokens: new Set(tokenize(title)),
      mtime,
      lines: bodyNoFm.split(/\r?\n/).filter(l => l.trim()),
    })
  }
  STATE.root = root
  STATE.docs = docs
  STATE.builtAt = Date.now()
  return docs
}

function bestSnippet(doc, tokens) {
  let best = { line: '', hits: 0 }
  for (const line of doc.lines) {
    const low = line.toLowerCase()
    let hits = 0
    for (const t of tokens) if (low.includes(t)) hits++
    if (hits > best.hits) best = { line, hits }
    if (best.hits >= 3) break
  }
  const raw = best.line.trim() || doc.lines[0] || ''
  return raw.length > SNIPPET_LEN ? `${raw.slice(0, SNIPPET_LEN)}…` : raw
}

/**
 * 全文检索。返回 { total, tookMs, items: [{path, title, snippet, score}] }。
 * q 为空或索引为空都返回空结果，不抛错。
 */
function search({ vaultPath, q, limit = 8 }) {
  const query = String(q || '').trim()
  if (!query || !vaultPath) return { total: 0, tookMs: 0, items: [] }

  const fresh = STATE.root === vaultPath && Date.now() - STATE.builtAt < TTL_MS
  const docs = fresh ? STATE.docs : buildIndex(vaultPath)

  const tokens = [...new Set(tokenize(query))]
  if (!tokens.length) return { total: 0, tookMs: 0, items: [] }

  const t0 = Date.now()
  const scored = []
  for (const doc of docs) {
    let score = 0
    const counted = new Map()
    for (const t of tokens) {
      if (doc.titleTokens.has(t)) score += 5
    }
    for (const line of doc.lines) {
      const low = line.toLowerCase()
      for (const t of tokens) {
        if (!low.includes(t)) continue
        counted.set(t, (counted.get(t) || 0) + 1)
      }
    }
    // 命中词种数为主，频次取对数防单行刷分
    for (const n of counted.values()) score += Math.min(n, 8)
    if (score > 0) scored.push({ doc, score })
  }
  scored.sort((a, b) => b.score - a.score)

  const items = scored.slice(0, Math.min(Math.max(Number(limit) || 8, 1), 20)).map(({ doc, score }) => ({
    path: doc.path,
    title: doc.title,
    snippet: bestSnippet(doc, tokens),
    score,
  }))

  return { total: scored.length, tookMs: Date.now() - t0, items }
}

/** 测试与运维用：强制下次重建索引 */
function resetCache() {
  STATE.root = null
  STATE.docs = []
  STATE.builtAt = 0
}

module.exports = { search, tokenize, resetCache }
