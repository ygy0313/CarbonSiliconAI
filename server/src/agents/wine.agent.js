'use strict'

// 能力：选酒（接「九月葡园」）
//
// 判断顺序跟人一样：先看「送给谁、什么场合」，再看「今天想喝什么口感」，
// 最后才是性价比。所以收礼人和场合的权重高，五行风味只是最后一票 ——
// 它负责让今天这瓶「喝着顺」，不负责替人做决定。
//
// 红线：不报价、不吹年份、不编酒款。价格一律引导到店铺看。

const registry = require('./registry')
const wine = require('../domain/wine')
const log = require('../logger')

const SCENE_WORDS = ['送', '礼', '纪念日', '生日', '过年', '过节', '拜访', '聚会', '家宴']

/** 五行 → 味，用于把 fortune 的「今日宜味」翻回元素，判断这瓶对不对胃口 */
const TASTE_TO_ELEMENT = { 酸: '木', 苦: '火', 甘: '土', 辛: '金', 咸: '水' }

async function run(ctx) {
  const { facts, entities, rawText, intent, outputs, profile } = ctx
  const text = String(rawText || '')

  const occasion = wine.detectOccasion(text, intent.type)
  const recipient = wine.detectRecipient(text, intent.type)
  const pairings = wine.detectPairing(text)
  const tierWant = wine.tierFromBudget(entities.budget)
  const isNewbie = /第一次|新手|不太能喝|不会喝|入门|刚喝/.test(text)

  // 今日宜味（fortune 能力提供）。没有就跳过，不假装有
  const fortune = outputs['fortune.today']?.meta || null
  const favorableEl = fortune?.favorableTaste ? TASTE_TO_ELEMENT[fortune.favorableTaste] : null

  const scored = wine.WINES.map(w => {
    let score = 0.5
    const why = []
    const rec = wine.RECIPIENTS[recipient]
    const occ = wine.OCCASIONS[occasion]

    // ── 收礼人 ──
    if (rec.prefer.tanninMax && w.tannin <= rec.prefer.tanninMax) {
      score += 0.12
      why.push(`${rec.label}这档更喝得惯：单宁 ${w.tannin}/5，不涩`)
    } else if (rec.prefer.tanninMax && w.tannin > rec.prefer.tanninMax + 1) {
      score -= 0.18
    }
    if (rec.prefer.body?.includes(w.body)) score += 0.08
    if (rec.prefer.aroma?.includes(w.aroma)) {
      score += 0.12
      why.push(`${rec.label}场合对味：${wine.AROMA_LABEL[w.aroma]}调性`)
    }
    if (rec.prefer.tierMin && w.tier >= rec.prefer.tierMin) score += 0.1

    // ── 场合 ──
    if (occ.weightTier) score += (w.tier - 2) * 0.08 * occ.weightTier
    if (pairings.length && pairings.some(p => w.pairings.includes(p))) {
      score += 0.15 * occ.weightPairing
      const hit = pairings.find(p => w.pairings.includes(p))
      // 「压得住」只对重酒体成立；轻酒体配海鲜是清爽解腻，别用错词
      const verb = w.body === 'heavy' ? '压得住' : '清爽不抢味'
      why.push(`配${hit}合适：${wine.BODY_LABEL[w.body]}${verb}`)
    }
    // 清蒸海鲜配重单宁红酒是典型的错配，明确扣分而不是留给用户自己发现
    if (pairings.includes('海鲜') && w.color === 'red' && w.body === 'heavy') score -= 0.15

    // ── 预算（只对齐价位带，不报数字）──
    if (tierWant) {
      if (w.tier === tierWant) { score += 0.1; why.push(`价位带对得上你说的预算（${wine.TIER_LABEL[w.tier]}）`) }
      else if (w.tier > tierWant) score -= 0.12
      else {
        // 低于预算带：送礼会显得薄，日常喝反而是省钱，所以按场合给不同力度
        score -= 0.05 * (occ.weightTier || 1)
        if (occasion === 'gift') why.push(`比你说的预算低一档，送礼看着略薄 —— 要体面就往上走一档`)
      }
    }

    // ── 新手 / 不能喝 ──
    if (isNewbie && w.tannin <= 2) {
      score += 0.15
      why.push('单宁低，第一次喝不会被涩到')
    }

    // ── 今日风味（最后一票）──
    if (favorableEl && w.flavors.includes(favorableEl)) {
      score += 0.08
      why.push(`今天宜${fortune.favorableTaste}味，这瓶偏${favorableEl}`)
    }

    return { w, score: Number(Math.max(0, Math.min(1, score)).toFixed(3)), why }
  }).sort((a, b) => b.score - a.score)

  // 溯源：以前提过酒/送礼的对话，能引就引一条，引不到不硬凑
  const episodes = profile?.episodes || []
  const cited = []
  for (const e of episodes) {
    const t = `${e.summary || ''}${e.text || ''}`
    if (SCENE_WORDS.some(k => t.includes(k))) {
      cited.push({ episodeId: e.id, ts: e.ts, text: (e.summary || e.text || '').slice(0, 24) })
      if (cited.length >= 2) break
    }
  }

  const top = scored.slice(0, 2)
  if (!top.length) return { items: [], meta: { empty: true } }

  const items = top.map(({ w, score, why }, i) => ({
    id: `wine_${w.id}`,
    kind: i === 0 ? 'primary' : 'option',
    title: w.name,
    desc: `${w.type} · ${wine.BODY_LABEL[w.body]} · ${w.profile} · ${w.temp}`,
    why: why.length ? why.slice(0, 3) : [`${wine.AROMA_LABEL[w.aroma]}主导，这条线最稳`],
    evidence: i === 0 ? cited.slice(0, 2) : [],
    score,
    source: `${wine.SHOP.name} · 选酒`,
    meta: {
      short: w.short,
      color: w.color,
      body: w.body,
      tannin: w.tannin,
      tier: w.tier,
      tierLabel: wine.TIER_LABEL[w.tier],
      temp: w.temp,
      pairings: w.pairings,
      serve: w.tannin >= 4 ? `醒酒 30 分钟，${w.temp} 上桌` : `开瓶 15 分钟就能喝，${w.temp}`,
      // 动手事项：醒酒和去哪儿买是真正需要用户做的事，顺便把「价格看店铺」说清
      todos: [
        w.tannin >= 4 ? `提前 30 分钟醒酒，${w.temp} 上桌` : `开瓶 15 分钟，${w.temp} 上桌`,
        `在${wine.SHOP.name}下单，价格以店铺为准`,
      ],
      // 不写价格：不同渠道价差大，宁可让用户去店里看
      priceNote: '价格以店铺为准，别按我说的数付钱',
      shop: wine.SHOP,
      occasion,
      recipient,
    },
  }))

  log.debug('选酒完成', { occasion, recipient, candidates: wine.WINES.length })
  return {
    items,
    meta: {
      occasion,
      recipient,
      pairings,
      tierWant,
      favorableTaste: fortune?.favorableTaste || null,
      excluded: scored.filter(s => s.score < 0.35).map(s => s.w.short).slice(0, 3),
    },
  }
}

registry.register({
  id: 'wine.suggest',
  service: '九月葡园',
  name: '选酒',
  icon: '🍷',
  description: '按收礼人、场合、预算、配餐选一瓶，说清为什么是它（不报价）',
  intents: ['gift', 'drink'],
  needs: ['context.fortune'],
  provides: ['context.wine'],
  cost: 'free',
  run,
})

module.exports = { run }
