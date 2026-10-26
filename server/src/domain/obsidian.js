'use strict'

// Obsidian 决策经验笔记的数据形状与解析。
//
// 库里的格式（YAML frontmatter，简化子集，不引第三方依赖）：
// ---
// type: decision-experience
// situation: "用户要求在一周内上线新功能但团队只有两人"
// action: "砍掉非核心验收标准，先上核心路径"
// outcome: "按期上线，用户反馈核心流程可用"
// validity: 0.8
// applied_count: 3
// last_applied: 2026-10-20
// tags: 工程,上线
// ---
//
// 三条不变量：
//   1. evidence 必须指向笔记路径 —— 沿用「不能溯源的经验不收」红线；
//   2. 笔记 validity 只做「种子」，入库后运行时反馈（applyOutcome）优先，
//      重复同步绝不回滚运行时算出来的分；
//   3. 一篇笔记 = 一条经验，幂等键 = 笔记相对路径。

const crypto = require('crypto')
const { clamp } = require('./experience')

const NOTE_TYPE = 'decision-experience'

function contentHash(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

/**
 * 解析 frontmatter（简化 YAML 子集：仅支持顶层 `key: value`，值可带引号）。
 * 不引入 YAML 库：库是零依赖的，而笔记格式是我们自己定的，够用且可控。
 */
function parseFrontmatter(md) {
  const text = String(md || '')
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!m) return { frontmatter: null, body: text }
  const fm = {}
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line) || /^\s/.test(line)) continue
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    fm[key] = value
  }
  return { frontmatter: fm, body: text.slice(m[0].length) }
}

function toNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 笔记 → 经验候选。字段不齐 / type 不对返回 { ok:false, reason }，由调用方决定跳过或报错。
 */
function mapNote({ relPath, md }) {
  const { frontmatter } = parseFrontmatter(md)
  if (!frontmatter) return { ok: false, reason: '无 frontmatter' }
  if ((frontmatter.type || '').trim() !== NOTE_TYPE) return { ok: false, reason: 'type 不是 decision-experience' }

  const situation = (frontmatter.situation || '').trim()
  const action = (frontmatter.action || '').trim()
  const outcome = (frontmatter.outcome || '').trim()
  if (!situation || !action || !outcome) {
    return { ok: false, reason: 'situation / action / outcome 缺一不可' }
  }

  const validity = clamp(toNumber(frontmatter.validity, 0.5), 0.02, 0.99)
  const appliedCount = Math.max(0, Math.floor(toNumber(frontmatter.applied_count, 0)))
  const lastApplied = frontmatter.last_applied ? String(frontmatter.last_applied).trim() : ''
  const tags = (frontmatter.tags || '')
    .split(/[,，、]/)
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 6)

  return {
    ok: true,
    note: {
      relPath: String(relPath),
      hash: contentHash(md),
      // 规则文本：情境 + 行动，行动用「」括住 —— 检索层靠最后一个「」词提取仲裁对象
      rule: `遇到「${situation}」时，采取「${action}」（结果：${outcome}）`,
      situationText: situation,
      actionText: action,
      outcomeText: outcome,
      validity,
      appliedCount,
      lastApplied,
      tags,
    },
  }
}

/** 笔记路径 → 溯源证据（沿用 experience 的 evidence 形状） */
function toEvidence(relPath) {
  return [{ refId: `obsidian:${relPath}`, kind: 'note' }]
}

/** 幂等键：一篇笔记只对应一条经验 */
function signatureOf(relPath) {
  return `obsidian|${relPath}`
}

module.exports = {
  NOTE_TYPE,
  parseFrontmatter,
  mapNote,
  toEvidence,
  signatureOf,
  contentHash,
}
