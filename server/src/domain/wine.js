'use strict'

// 酒库：接「九月葡园」在售酒款（真实商品，不编造酒款、不编造价格）。
//
// 三条边界：
//   1. 推荐只在本文件范围内产生 —— 模型不得凭空造酒；
//   2. 不写价格数字。不同渠道价差大，卡片上写「价位带 + 以店铺为准」，
//      宁可少给一个数字，也不给一个会被打脸的报价；
//   3. 五行只做「风味方向」的提示（沿用 fortune 的口径），不做吉凶断言。

const SHOP = {
  name: '九月葡园',
  url: 'https://shop559668979.taobao.com/',
  hint: '淘宝搜店铺「九月葡园」，微信里打不开淘宝，复制链接到 App',
}

// tier：价位带 1 入门 / 2 进阶 / 3 珍藏（只用于排序，不对外报数字）
// tannin：单宁强度 1-5；body：light/medium/heavy
// flavors：五行风味倾向，与 fortune 的「今日宜味」对齐
const WINES = [
  {
    id: 'w01',
    name: '览夏玺鹊精选赤霞珠干红',
    short: '精选赤霞珠',
    type: '柔顺型赤霞珠',
    color: 'red',
    body: 'medium',
    tannin: 2,
    tier: 1,
    aroma: 'red',
    flavors: ['水', '土'],
    temp: '16-18℃',
    profile: '黑加仑、李子，单宁柔和，开瓶 15 分钟就能喝',
    scene: '日常佐餐、外卖配饺子，新手第一瓶',
    pairings: ['家常菜', '饺子', '烧烤', '卤味'],
  },
  {
    id: 'w02',
    name: '览夏玺鹊窖藏马瑟兰干红',
    short: '窖藏马瑟兰',
    type: '马瑟兰',
    color: 'red',
    body: 'heavy',
    tannin: 4,
    tier: 2,
    aroma: 'floral',
    flavors: ['火'],
    temp: '17-19℃',
    profile: '贺兰山东麓招牌品种，紫罗兰与蓝莓，单宁细腻有力',
    scene: '进阶品鉴、独自慢饮，醒酒 30 分钟以上',
    pairings: ['牛排', '烤羊排', '红烧肉'],
  },
  {
    id: 'w03',
    name: '览夏玺鹊庄主珍藏赤霞珠干红',
    short: '庄主珍藏赤霞珠',
    type: '橡木桶陈酿赤霞珠',
    color: 'red',
    body: 'heavy',
    tannin: 4,
    tier: 3,
    aroma: 'oak',
    flavors: ['火', '土'],
    temp: '17-19℃',
    profile: '香草、烤面包、雪松，结构完整，仪式感最强',
    scene: '纪念日、家庭聚会、需要拿得出手的饭局',
    pairings: ['牛排', '烤肉', '硬质奶酪'],
  },
  {
    id: 'w04',
    name: '览夏玺鹊霞多丽干白',
    short: '霞多丽干白',
    type: '霞多丽干白',
    color: 'white',
    body: 'light',
    tannin: 1,
    tier: 1,
    aroma: 'citrus',
    flavors: ['木', '金'],
    temp: '10-12℃',
    profile: '柑橘与白花，酸度明亮，收口干净',
    scene: '清蒸海鲜、白灼虾，也是不能喝红酒的人的稳妥选择',
    pairings: ['海鲜', '清蒸鱼', '白灼虾', '凉菜'],
  },
  {
    id: 'w05',
    name: '览夏玺鹊窖藏西拉干红',
    short: '窖藏西拉',
    type: '西拉',
    color: 'red',
    body: 'heavy',
    tannin: 5,
    tier: 2,
    aroma: 'dark',
    flavors: ['金', '火'],
    temp: '17-19℃',
    profile: '黑胡椒、黑莓与烟熏，酒体厚实，余味长',
    scene: '独酌、配牛排红肉，感受「结构感」',
    pairings: ['牛排', '烤肉', '重口菜'],
  },
  {
    id: 'w06',
    name: '九月兰山风土的表达者—西拉干红',
    short: '九月兰山西拉',
    type: '西拉',
    color: 'red',
    body: 'heavy',
    tannin: 4,
    tier: 2,
    aroma: 'dark',
    flavors: ['金', '土'],
    temp: '17-19℃',
    profile: '风土感外显，熟甜果味与辛香交织，酒体扎实不散',
    scene: '配烤肉、喝惯基础款想再往上走一步',
    pairings: ['烤肉', '炖肉', '牛排'],
  },
]

const TIER_LABEL = { 1: '入门价位带', 2: '进阶级价位带', 3: '珍藏级价位带' }
const BODY_LABEL = { light: '轻酒体', medium: '中酒体', heavy: '重酒体' }
const AROMA_LABEL = { red: '红果', dark: '黑果', floral: '花香', oak: '橡木', citrus: '柑橘' }

// 收礼人 → 口味倾向。不是「给谁就得喝什么」的铁律，只是排序的一票。
const RECIPIENTS = {
  elder: { label: '长辈', prefer: { tanninMax: 2, body: ['light', 'medium'] }, why: '长辈更在意好入口，不追单宁' },
  leader: { label: '领导', prefer: { tierMin: 2, aroma: ['oak'] }, why: '上桌要拿得出手，橡木桶和珍藏级更稳' },
  client: { label: '客户', prefer: { tierMin: 2, aroma: ['oak', 'dark'] }, why: '客户场合先看体面，再看口味' },
  friend: { label: '朋友', prefer: { body: ['medium'], aroma: ['red', 'dark'] }, why: '朋友局图个轻松，果味明显比结构感重要' },
  partner: { label: '伴侣', prefer: { aroma: ['floral'], tierMin: 2 }, why: '纪念日场合，花香和仪式感比酒体更讨喜' },
  self: { label: '自己', prefer: {}, why: '自己喝，合口味比合场面重要' },
}

// 场合 → 判断口径
const OCCASIONS = {
  gift: { label: '送礼', weightTier: 1.4, weightPairing: 0 },
  celebrate: { label: '庆祝', weightTier: 1.2, weightPairing: 0.6 },
  pairing: { label: '佐餐', weightTier: 0.4, weightPairing: 1.4 },
  daily: { label: '日常', weightTier: 0.2, weightPairing: 1 },
}

const PAIRING_WORDS = {
  牛排: ['牛排', '牛肉', '红肉'],
  烤肉: ['烤肉', '烧烤', '烤羊', '羊肉'],
  海鲜: ['海鲜', '清蒸', '虾', '蟹', '鱼'],
  饺子: ['饺子', '包子', '面食'],
  家常菜: ['家常', '外卖', '炒菜', '下饭'],
  火锅: ['火锅', '川菜', '辣'],
}

function detectOccasion(text, intentType) {
  const t = String(text || '')
  if (intentType === 'gift' || /送|礼|伴手|拜访|过节|走亲戚/.test(t)) return 'gift'
  if (/纪念日|生日|庆祝|结婚|升职|拿下/.test(t)) return 'celebrate'
  if (/配|搭|佐餐|吃|饭|菜|肉|海鲜/.test(t)) return 'pairing'
  return 'daily'
}

function detectRecipient(text, intentType) {
  const t = String(text || '')
  if (/爸|妈|父母|长辈|爷爷|奶奶|外公|外婆|岳父|岳母|老人/.test(t)) return 'elder'
  if (/领导|老板|上司|主任|总/.test(t)) return 'leader'
  if (/客户|甲方|合作|生意/.test(t)) return 'client'
  if (/女朋友|男朋友|老婆|老公|爱人|对象|媳妇/.test(t)) return 'partner'
  if (/朋友|同学|兄弟|闺蜜|同事/.test(t)) return 'friend'
  if (intentType === 'gift') return 'leader' // 只说「送礼」不说是谁，按最挑场面的那一档保守处理
  return 'self'
}

function detectPairing(text) {
  const t = String(text || '')
  const hits = []
  for (const [key, words] of Object.entries(PAIRING_WORDS)) {
    if (words.some(w => t.includes(w))) hits.push(key)
  }
  return hits
}

/** 预算 → 价位带（只用于排序，不反推具体价格） */
function tierFromBudget(budget) {
  const b = Number(budget)
  if (!b || b <= 0) return null
  if (b < 150) return 1
  if (b < 400) return 2
  return 3
}

function byId(id) {
  return WINES.find(w => w.id === id) || null
}

module.exports = {
  SHOP,
  WINES,
  TIER_LABEL,
  BODY_LABEL,
  AROMA_LABEL,
  RECIPIENTS,
  OCCASIONS,
  detectOccasion,
  detectRecipient,
  detectPairing,
  tierFromBudget,
  byId,
}
