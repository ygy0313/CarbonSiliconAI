'use strict'

// 能力：今日节律（原「给您请安」的五行/黄历内核）
//
// 边界（沿用原项目红线）：只描述「今日节奏」与「饮食方向」，
// 不做吉凶、财运、健康、婚恋等任何预测性断言；文案一律翻译成生活语言。

const registry = require('./registry')
const { ELEMENT_TASTE, GENERATE, OVERCOME } = require('../domain/taxonomy')

const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
const GAN_ELEMENT = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' }
const ZHI_ELEMENT = {
  子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火',
  午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水',
}

// 儒略日 → 日干支。锚点已验证：2000-01-01 为戊午日。
function julianDay(y, m, d) {
  const a = Math.floor((14 - m) / 12)
  const yy = y + 4800 - a
  const mm = m + 12 * a - 3
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy +
    Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045
}

function dayPillar(date) {
  const jdn = julianDay(date.getFullYear(), date.getMonth() + 1, date.getDate())
  const idx = (jdn + 49) % 60
  const gan = GAN[idx % 10]
  const zhi = ZHI[idx % 12]
  return { gan, zhi, text: `${gan}${zhi}`, ganElement: GAN_ELEMENT[gan], zhiElement: ZHI_ELEMENT[zhi] }
}

const RELATION_TEXT = {
  比和: { label: '同气相和', advice: '今天节奏跟你是一个调子，按原来的节拍走就顺，不用刻意折腾。', avoid: '临时推翻计划、连着赶好几件事' },
  我生: { label: '有点耗', advice: '今天容易把力气用在别人身上，适合收尾不适合开新坑。', avoid: '同时答应太多人的请求' },
  生我: { label: '有人托', advice: '今天是有人接得住你的一天，可以谈事情、见人、把难的说出口。', avoid: '一个人硬扛' },
  我克: { label: '要费劲', advice: '今天事情偏多但可控，适合一件一件推，不适合多线并进。', avoid: '一口气处理完全部' },
  克我: { label: '被推着走', advice: '今天外部节奏比你的快，留出缓冲时间，别把日程排满。', avoid: '卡点赶路、临时加塞' },
}

function relationOf(dayEl, baseEl) {
  if (dayEl === baseEl) return '比和'
  if (GENERATE[dayEl] === baseEl) return '我生'
  if (GENERATE[baseEl] === dayEl) return '生我'
  if (OVERCOME[dayEl] === baseEl) return '我克'
  return '克我'
}

async function run(ctx) {
  const now = ctx.now || new Date()
  const pillar = dayPillar(now)
  const dayEl = pillar.ganElement

  // 用户日主：档案里有就用，没有就取当日天干（不假装知道用户八字）
  const userEl = ctx.facts['self.element'] || dayEl
  const relation = relationOf(dayEl, userEl)

  // 宜味：取「生我」之五行对应的味；忌味：取「克我」之五行对应的味
  const favorableEl = Object.keys(GENERATE).find(k => GENERATE[k] === userEl) || userEl
  const avoidEl = Object.keys(OVERCOME).find(k => OVERCOME[k] === userEl) || null

  const rel = RELATION_TEXT[relation]
  const favorableTaste = ELEMENT_TASTE[favorableEl]
  const avoidTaste = avoidEl ? ELEMENT_TASTE[avoidEl] : null

  return {
    items: [{
      id: `fortune_${now.toISOString().slice(0, 10)}`,
      kind: 'note',
      title: `今日${pillar.text}日 · ${rel.label}`,
      desc: `${rel.advice}宜${favorableTaste}味，少碰${avoidTaste || '重口'}。`,
      why: [`今天日柱是${pillar.text}（天干属${dayEl}）`, `与你今日节奏${rel.label}，宜${favorableTaste}味`],
      score: 0.5,
      source: '给您请安 · 今日节律',
      meta: { mode: 'culture' },
    }],
    meta: {
      dayPillar: pillar.text,
      dayElement: dayEl,
      userElement: userEl,
      relation,
      relationLabel: rel.label,
      avoidActivity: rel.avoid,
      favorableTaste,
      avoidTaste,
    },
  }
}

registry.register({
  id: 'fortune.today',
  service: '给您请安',
  name: '今日节律',
  icon: '☯',
  description: '干支与五行给出今日节奏与宜忌味道（文化向，不做吉凶断言）',
  intents: [],
  needs: [],
  provides: ['context.fortune'],
  cost: 'free',
  run,
})

module.exports = { run, dayPillar }
