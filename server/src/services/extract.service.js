'use strict'

// 记录抽取：把一段自然语言（或结构化快捷标签）变成「可入库的事实 + 记忆」。
//
// 两种模式：
//   1) rule  —— 纯词典 + 正则，0 成本、0 延迟、结果稳定可复现（默认）
//   2) llm   —— 有密钥时叠加一次模型抽取，输出与 rule 合并取并集，冲突时以 rule 为准
// 这样即使模型抽错，也不会把档案带偏。

const { SYMPTOM_WORDS, TASTE_WORDS, FACT_DIMENSIONS } = require('../domain/taxonomy')
const llm = require('../llm/provider')
const log = require('../logger')

const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 几: 3 }

function parseCount(text) {
  // 支持「6 人」「六个人」「两个朋友」「七八个人」
  const arabic = text.match(/(\d{1,2})\s*(?:个)?\s*(?:人|位|口)/)
  if (arabic) return Number(arabic[1])
  const cn = text.match(/([一二两三四五六七八九十])\s*(?:个)?\s*(?:人|位)/)
  if (cn) return CN_NUM[cn[1]] || null
  const friends = text.match(/([一二两三四五六七八九十\d])\s*个\s*(?:朋友|同事|同学)/)
  if (friends) return (CN_NUM[friends[1]] || Number(friends[1])) + 1 // 朋友数 + 自己
  if (/一个人|自己吃|独自|单人/.test(text)) return 1
  return null
}

function parseBudget(text) {
  const m = text.match(/(\d{2,5})\s*(?:块|元|块钱)/) || text.match(/预算\s*(\d{2,5})/)
  return m ? Number(m[1]) : null
}

function parseTimeHint(text, now = new Date()) {
  if (/今晚|今天晚上/.test(text)) return { key: 'today_evening', label: '今晚' }
  if (/明天/.test(text)) return { key: 'tomorrow', label: '明天' }
  if (/后天/.test(text)) return { key: 'day_after', label: '后天' }
  if (/周末/.test(text)) return { key: 'weekend', label: '这个周末' }
  if (/周六|星期六/.test(text)) return { key: 'saturday', label: '周六' }
  if (/周日|星期天|星期七/.test(text)) return { key: 'sunday', label: '周日' }
  if (/今天|现在|待会|一会儿/.test(text)) return { key: 'today', label: '今天' }
  return { key: 'unspecified', label: '还没定' }
}

function parseMealType(text) {
  if (/早餐|早上|早点/.test(text)) return 'breakfast'
  if (/午餐|午饭|中午/.test(text)) return 'lunch'
  if (/晚餐|晚饭|晚上吃/.test(text)) return 'dinner'
  if (/夜宵|宵夜|加餐/.test(text)) return 'late'
  return null
}

function parseScene(text, headcount) {
  if (/一个人|自己|独自|单人/.test(text)) return 'alone'
  if (/家人|爸妈|父母|孩子|家里/.test(text)) return 'family'
  if (/同事|团建|公司|客户/.test(text)) return 'colleagues'
  if (/朋友|同学|兄弟|闺蜜|聚会|组局/.test(text)) return 'friends'
  if (headcount && headcount > 1) return 'friends'
  return null
}

function parseTags(text) {
  const tags = new Set()
  for (const [tag, words] of Object.entries(SYMPTOM_WORDS)) {
    if (words.some(w => text.includes(w))) tags.add(tag)
  }
  for (const [tag, words] of Object.entries(TASTE_WORDS)) {
    if (words.some(w => text.includes(w))) tags.add(tag)
  }
  if (/生日/.test(text)) tags.add('生日局')
  if (/第一次|没玩过/.test(text)) tags.add('新手局')
  if (/老玩家|玩过很多/.test(text)) tags.add('老手局')
  return [...tags]
}

// 从标签反推可直接写入档案的事实（带来源与置信度）
function tagsToFacts(tags, entities) {
  const facts = []
  if (tags.includes('不吃辣')) facts.push({ key: 'diet.spicy', value: '不吃辣', confidence: 0.9, reason: '明确表述' })
  else if (tags.includes('重辣')) facts.push({ key: 'diet.spicy', value: '重辣', confidence: 0.85, reason: '明确表述' })
  else if (tags.includes('微辣')) facts.push({ key: 'diet.spicy', value: '微辣', confidence: 0.75, reason: '表述推断' })

  if (tags.includes('胃敏感')) facts.push({ key: 'diet.stomach', value: '偏敏感', confidence: 0.7, reason: '身体反馈' })
  if (tags.includes('上火')) facts.push({ key: 'diet.stomach', value: '易上火', confidence: 0.65, reason: '身体反馈' })

  if (tags.includes('清淡')) facts.push({ key: 'diet.taste', value: '清淡', confidence: 0.7, reason: '表述推断' })
  else if (tags.includes('重口')) facts.push({ key: 'diet.taste', value: '重口', confidence: 0.7, reason: '表述推断' })
  else if (tags.includes('偏甜')) facts.push({ key: 'diet.taste', value: '偏甜', confidence: 0.7, reason: '表述推断' })

  if (entities.headcount && entities.headcount > 1) {
    facts.push({ key: 'social.groupSize', value: entities.headcount, confidence: 0.6, reason: '本次组局人数' })
  }
  if (tags.includes('新手局')) facts.push({ key: 'social.experience', value: '没玩过', confidence: 0.55, reason: '自述' })
  if (tags.includes('老手局')) facts.push({ key: 'social.experience', value: '老玩家', confidence: 0.55, reason: '自述' })

  // 只保留词典里定义过的合法维度，防止脏 key 进档案
  const valid = new Set(FACT_DIMENSIONS.map(d => d.key))
  return facts.filter(f => valid.has(f.key))
}

function ruleExtract(text, now = new Date()) {
  const clean = String(text || '').trim()
  const headcount = parseCount(clean)
  const entities = {
    headcount,
    budget: parseBudget(clean),
    time: parseTimeHint(clean, now),
    mealType: parseMealType(clean),
    scene: parseScene(clean, headcount),
    genres: ['情感', '推理', '欢乐', '机制', '阵营', '科幻', '商战', '家国', '本地']
      .filter(g => clean.includes(g)),
  }
  const tags = parseTags(clean)
  return { text: clean, tags, entities, facts: tagsToFacts(tags, entities) }
}

// LLM 只被允许「补充」，不允许改写规则已经确定的字段。
async function llmExtract(text) {
  if (!llm.isEnabled()) return null
  const result = await llm.completeJSON({
    system: [
      '你是个人记忆抽取器。把用户的一句话记录拆成结构化 JSON。',
      '只输出 JSON，不要解释。schema:',
      '{"tags":["症状或口味标签"],"entities":{"headcount":number|null,"budget":number|null,"timeHint":"today|tomorrow|weekend|saturday|sunday|unspecified","scene":"alone|friends|family|colleagues|null","mealType":"breakfast|lunch|dinner|late|null"},"summary":"不超过20字的中文摘要"}',
      'tags 只能取自：胃敏感,上火,没胃口,乏力,失眠,宿醉,不吃辣,微辣,重辣,清淡,重口,偏甜,生日局,新手局,老手局',
    ].join('\n'),
    user: text,
    temperature: 0.1,
    maxTokens: 400,
  })
  if (!result || typeof result !== 'object') return null
  return result
}

/**
 * 抽取入口。
 * @returns {{text, tags, entities, facts, summary, extractor}}
 */
async function extract({ text, tags: explicitTags = [], now = new Date() }) {
  const base = ruleExtract(text, now)

  // 快捷标签（前端点选）优先级最高，直接并入
  const merged = new Set([...base.tags, ...explicitTags])
  base.tags = [...merged]
  base.facts = tagsToFacts(base.tags, base.entities)

  base.summary = buildSummary(base)
  base.extractor = 'rule'

  const enhanced = await llmExtract(base.text)
  if (enhanced) {
    try {
      let touched = false
      for (const t of enhanced.tags || []) {
        if (!base.tags.includes(t)) { base.tags.push(t); touched = true }
      }
      const e = enhanced.entities || {}
      if (!base.entities.headcount && Number.isFinite(e.headcount)) { base.entities.headcount = e.headcount; touched = true }
      if (!base.entities.budget && Number.isFinite(e.budget)) { base.entities.budget = e.budget; touched = true }
      if (base.entities.time.key === 'unspecified' && e.timeHint && e.timeHint !== 'unspecified') {
        base.entities.time = { key: e.timeHint, label: e.timeHint }
        touched = true
      }
      if (!base.entities.scene && e.scene) { base.entities.scene = e.scene; touched = true }
      if (enhanced.summary) base.summary = enhanced.summary
      if (touched) {
        base.facts = tagsToFacts(base.tags, base.entities)
        base.extractor = 'rule+llm'
      }
    } catch (err) {
      log.warn('LLM 抽取结果合并失败，保留规则结果', { error: err.message })
    }
  }

  return base
}

function buildSummary(ex) {
  const parts = []
  if (ex.entities.mealType) {
    parts.push({ breakfast: '早餐', lunch: '午餐', dinner: '晚餐', late: '夜宵' }[ex.entities.mealType])
  }
  if (ex.entities.scene) {
    parts.push({ alone: '一个人', friends: '和朋友', family: '和家人', colleagues: '和同事' }[ex.entities.scene])
  }
  if (ex.tags.length) parts.push(ex.tags.slice(0, 3).join('·'))
  if (ex.text && parts.length === 0) return ex.text.slice(0, 20)
  return parts.join('，') || '一条记录'
}

module.exports = { extract, ruleExtract, parseCount, parseTimeHint }
