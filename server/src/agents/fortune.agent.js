'use strict'

// 能力：今日节律（原「给您请安」的五行/黄历内核）
//
// 边界（沿用原项目红线）：只描述「今日节奏」与「饮食方向」，
// 不做吉凶、财运、健康、婚恋等任何预测性断言；文案一律翻译成生活语言。
//
// 本次升级：从「只看日柱」升级到「流年 + 流月 + 流日」三层，
// 年月柱按节气换柱（立春换年、十二节换月），不再用农历初一近似。

const registry = require('./registry')
const gz = require('../domain/ganzhi')
const { ELEMENT_TASTE, GENERATE, OVERCOME } = require('../domain/taxonomy')

const RELATION_TIP = {
  比和: '今天节奏跟你是一个调子，按原来的节拍走就顺，不用刻意折腾。',
  我生: '今天容易把力气用在别人身上，适合收尾不适合开新坑。',
  生我: '今天是有人接得住你的一天，可以谈事情、见人、把难的说出口。',
  我克: '今天事情偏多但可控，适合一件一件推，不适合多线并进。',
  克我: '今天外部节奏比你的快，留出缓冲时间，别把日程排满。',
}

async function run(ctx) {
  const now = ctx.now || new Date()

  // 档案里有日主五行就用，没有就取当日日干 —— 不假装知道用户八字
  const userEl = ctx.facts['self.element'] || null
  const z = gz.ganzhiOf(now, userEl)

  const me = z.me.element
  const favorableEl = Object.keys(GENERATE).find(k => GENERATE[k] === me) || me
  const avoidEl = Object.keys(OVERCOME).find(k => OVERCOME[k] === me) || null
  const favorableTaste = ELEMENT_TASTE[favorableEl]
  const avoidTaste = avoidEl ? ELEMENT_TASTE[avoidEl] : null

  const dayRel = z.day.relation
  const tip = RELATION_TIP[dayRel] || RELATION_TIP['比和']

  const title = `今日${z.day.text}日 · ${z.tone.label}`
  const desc = `${tip}宜${favorableTaste}味，少碰${avoidTaste || '重口'}。`

  return {
    items: [{
      id: `fortune_${now.toISOString().slice(0, 10)}`,
      kind: 'note',
      title,
      desc,
      why: [
        `流年${z.year.text}（${z.year.ganElement}）· 流月${z.month.text}（${z.month.ganElement}）· 流日${z.day.text}（${z.day.ganElement}）`,
        `你的日主属${me}，今日与你${z.tone.dayWord}，宜${favorableTaste}味`,
        `当前节气：${z.term.current?.name || '——'}`,
      ],
      score: 0.5,
      source: '起居注 · 今日节律',
      meta: { mode: 'culture' },
    }],
    meta: {
      // 三层干支
      layers: { year: z.year, month: z.month, day: z.day },
      pillars: z.pillars,
      dayPillar: z.day.text,
      dayElement: z.day.ganElement,
      userElement: me,
      relation: dayRel,
      relationLabel: z.tone.dayWord,
      avoidActivity: z.tone.advice,
      favorableTaste,
      avoidTaste,
      term: z.term,
      elements: z.elements,
      tone: z.tone,
    },
  }
}

registry.register({
  id: 'fortune.today',
  service: '起居注 · 今日节律',
  name: '今日节律',
  icon: '☯',
  description: '流年/流月/流日三层干支给出今日节奏与宜忌味道（文化向，不做吉凶断言）',
  intents: [],
  needs: [],
  provides: ['context.fortune'],
  cost: 'free',
  run,
})

module.exports = { run }
