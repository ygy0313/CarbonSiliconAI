'use strict'

// 人格 prompt 编译：把档案转成能驱动 agent 的系统提示词。
//
// 这个函数有两个用途，性质完全不同：
//   1) 内部调用 LLM 时作为 system prompt —— 正常路径；
//   2) 用户导出自己的 prompt —— **必须持 grant(scope=prompt)**。
// 因为 prompt 里包含一个人的全部已确认偏好与近期经历，它本身就是最敏感的数据。
//
// 只会用到脱敏后的记录文本：档案里本来就不存明文，prompt 也就不可能泄漏明文。

const { BRAND } = require('../domain/brand')

const MAX_EPISODES = 12

// 与用户的相处约定（2026-10-26 用户亲自定下，最高优先级人格约束）。
// 核心：不做应声虫。这是「战友关系」的合同条款，改动等于改人格，须用户确认。
const PARTNERSHIP_PRINCIPLES = [
  '不要总是同意他的观点。他的想法站不住脚时，直接说站不住脚，并讲清哪里站不住。',
  '主动补位：他没想到的角度、没看见的风险、更省事的替代方案，看到了就讲，不要等他问。',
  '有分歧就摆事实：引用档案记录和历史经验说话，不因为想让他高兴而含糊其辞。',
  '反对必须带出路：只说「不行」不算战友，要附上你认为更好的选项和理由。',
  '你是他的战友，不是他的下属：并肩作战、替判断担责、一起发现和创造。把问题挑明比让他舒服更重要。',
]

function section(title, lines) {
  if (!lines.length) return ''
  return `\n## ${title}\n${lines.map(l => `- ${l}`).join('\n')}`
}

/**
 * @param {object} silicon compileSilicon() 的产出
 * @param {{includeEpisodes?:boolean, style?:'full'|'compact'}} opts
 * @returns {string}
 */
function buildPersonaPrompt(silicon, opts = {}) {
  if (!silicon) return ''
  const includeEpisodes = opts.includeEpisodes !== false
  const compact = opts.style === 'compact'

  const confirmed = silicon.facts.filter(f => f.confidence >= 0.4)
  const stale = silicon.facts.filter(f => f.confidence < 0.4)

  const header = [
    `你是「${BRAND.name}」里的${BRAND.personaName}，${BRAND.personaDesc}。`,
    `你正在为「${silicon.person.name}」服务。你的职责是替他记事、替他判断、替他把事安排明白。`,
    '',
    '## 与他相处的方式（最高优先级人格约定）',
    ...PARTNERSHIP_PRINCIPLES.map(p => `- ${p}`),
    '',
    '## 硬性约束',
    '- 只使用下面档案里出现过的事实。没有记录的偏好，不要编。',
    '- 每条建议必须能说清依据；说不出依据就说不确定。',
    '- 涉及运势时只谈节奏与宜忌方向，不说吉凶、财运、健康、婚恋的结论。',
    '- 用户的口味、身体状态、社交习惯都可能变，旧的判断要允许被新记录推翻。',
  ].join('\n')

  const factLines = confirmed.map(f =>
    `${f.label}：${formatValue(f.value)}${f.stale ? '（已有一段时间未核对）' : ''}`
  )

  const staleLines = stale.slice(0, 6).map(f =>
    `${f.label}：${formatValue(f.value)}（置信度低，需重新确认）`
  )

  const episodeLines = includeEpisodes
    ? silicon.episodes.slice(0, MAX_EPISODES).map(e => `${shortDate(e.ts)} ${e.summary || e.text}`)
    : []

  const styleLines = (silicon.voice || []).map(v => v)

  const traitLines = []
  if (silicon.traits) {
    if (silicon.traits.recordCount) traitLines.push(`累计记录 ${silicon.traits.recordCount} 条，近 30 天 ${silicon.traits.last30} 条`)
    if (silicon.traits.acceptRate !== null && silicon.traits.acceptRate !== undefined) {
      traitLines.push(`历史采纳率 ${Math.round(silicon.traits.acceptRate * 100)}%`)
    }
    const tags = (silicon.traits.topTags || []).slice(0, 5).map(t => t[0])
    if (tags.length) traitLines.push(`高频标签：${tags.join('、')}`)
  }

  const body = [
    section('已确认的档案', factLines),
    section('需要重新核实的旧判断', compact ? [] : staleLines),
    section('最近发生的事', episodeLines),
    section('他喜欢你怎么说话', styleLines),
    section('行为统计', traitLines),
  ].join('')

  return `${header}${body}\n`
}

function formatValue(value) {
  if (value === null || value === undefined) return '未知'
  if (Array.isArray(value)) return value.join('、')
  return String(value)
}

function shortDate(ts) {
  if (!ts) return '——'
  const d = new Date(ts)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 给 UI 展示用的 prompt 结构概览（不返回全文，避免默认就泄露）。
 */
function summarize(prompt) {
  const text = String(prompt || '')
  return {
    chars: text.length,
    approxTokens: Math.ceil(text.length / 1.6),
    sections: (text.match(/^## .+$/gm) || []).map(s => s.replace('## ', '')),
  }
}

module.exports = { buildPersonaPrompt, summarize }
