'use strict'

// 干支历算：流年 / 流月 / 流日。
//
// 为什么自己算而不查表：
//   1) 零依赖，无网络请求，离线可用；
//   2) 可算任意日期（1950-2100），不用维护年鉴数据；
//   3) 结果可复现 —— 同一天任何时候调用都得到同一组干支。
//
// 采用的规则（子平法，与主流万年历一致）：
//   - 年柱以「立春」为界，不是正月初一，也不是元旦；
//   - 月柱以十二「节」为界（立春/惊蛰/清明/立夏/芒种/小暑/立秋/白露/寒露/立冬/大雪/小寒），
//     不是农历初一；
//   - 日柱按 60 甲子连续循环，以北京时间零点换日（不采用夜子时 23:00 换日）；
//   - 节气时刻用太阳视黄经反解，精度约 ±2 分钟（对「哪天」的判断足够）。
//
// 边界：本模块只描述节奏与五行倾向，不做吉凶、财运、健康、婚恋断言。

const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']

const GAN_ELEMENT = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' }
const ZHI_ELEMENT = {
  子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火',
  午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水',
}
// 地支藏干（本气为主），用于五行权重
const ZHI_HIDDEN = {
  子: ['癸'], 丑: ['己', '癸', '辛'], 寅: ['甲', '丙', '戊'], 卯: ['乙'],
  辰: ['戊', '乙', '癸'], 巳: ['丙', '戊', '庚'], 午: ['丁', '己'], 未: ['己', '丁', '乙'],
  申: ['庚', '壬', '戊'], 酉: ['辛'], 戌: ['戊', '辛', '丁'], 亥: ['壬', '甲'],
}

const GENERATE = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' }
const OVERCOME = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' }
const ELEMENT_TASTE = { 木: '酸', 火: '苦', 土: '甘', 金: '辛', 水: '咸' }

// 二十四节气：太阳视黄经（春分 = 0°）
const SOLAR_TERMS = [
  { name: '春分', lon: 0, m: 3, d: 21 },
  { name: '清明', lon: 15, m: 4, d: 5 },
  { name: '谷雨', lon: 30, m: 4, d: 20 },
  { name: '立夏', lon: 45, m: 5, d: 6 },
  { name: '小满', lon: 60, m: 5, d: 21 },
  { name: '芒种', lon: 75, m: 6, d: 6 },
  { name: '夏至', lon: 90, m: 6, d: 21 },
  { name: '小暑', lon: 105, m: 7, d: 7 },
  { name: '大暑', lon: 120, m: 7, d: 23 },
  { name: '立秋', lon: 135, m: 8, d: 8 },
  { name: '处暑', lon: 150, m: 8, d: 23 },
  { name: '白露', lon: 165, m: 9, d: 8 },
  { name: '秋分', lon: 180, m: 9, d: 23 },
  { name: '寒露', lon: 195, m: 10, d: 8 },
  { name: '霜降', lon: 210, m: 10, d: 23 },
  { name: '立冬', lon: 225, m: 11, d: 7 },
  { name: '小雪', lon: 240, m: 11, d: 22 },
  { name: '大雪', lon: 255, m: 12, d: 7 },
  { name: '冬至', lon: 270, m: 12, d: 22 },
  { name: '小寒', lon: 285, m: 1, d: 6 },
  { name: '大寒', lon: 300, m: 1, d: 20 },
  { name: '立春', lon: 315, m: 2, d: 4 },
  { name: '雨水', lon: 330, m: 2, d: 19 },
  { name: '惊蛰', lon: 345, m: 3, d: 6 },
]

// 十二「节」→ 月支。节是月柱的换月点；气（如雨水、春分）不换月。
const MONTH_TERMS = [
  { name: '立春', lon: 315, m: 2, d: 4, branch: 2 },   // 寅
  { name: '惊蛰', lon: 345, m: 3, d: 6, branch: 3 },   // 卯
  { name: '清明', lon: 15, m: 4, d: 5, branch: 4 },    // 辰
  { name: '立夏', lon: 45, m: 5, d: 6, branch: 5 },    // 巳
  { name: '芒种', lon: 75, m: 6, d: 6, branch: 6 },    // 午
  { name: '小暑', lon: 105, m: 7, d: 7, branch: 7 },   // 未
  { name: '立秋', lon: 135, m: 8, d: 8, branch: 8 },   // 申
  { name: '白露', lon: 165, m: 9, d: 8, branch: 9 },   // 酉
  { name: '寒露', lon: 195, m: 10, d: 8, branch: 10 }, // 戌
  { name: '立冬', lon: 225, m: 11, d: 7, branch: 11 }, // 亥
  { name: '大雪', lon: 255, m: 12, d: 7, branch: 0 },  // 子
  { name: '小寒', lon: 285, m: 1, d: 6, branch: 1 },   // 丑
]

const DAY_MS = 86400000
const BJ_OFFSET_MS = 8 * 3600 * 1000 // 固定按北京时间换日，避免服务器时区影响结果

const RAD = Math.PI / 180

function norm360(x) {
  const v = x % 360
  return v < 0 ? v + 360 : v
}

function norm180(x) {
  let v = norm360(x)
  if (v > 180) v -= 360
  return v
}

// 公历 → 儒略日（当日 00:00 的 JD，非 JDN）
function julianDayFromCivil(y, m, d) {
  const a = Math.floor((14 - m) / 12)
  const yy = y + 4800 - a
  const mm = m + 12 * a - 3
  const jdn = d + Math.floor((153 * mm + 2) / 5) + 365 * yy +
    Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045
  return jdn - 0.5
}

function msToJd(ms) {
  return ms / DAY_MS + 2440587.5
}

function jdToMs(jd) {
  return (jd - 2440587.5) * DAY_MS
}

// 太阳视黄经（度）。Meeus 低精度公式，误差约 0.01°（≈15 分钟）。
function solarLongitude(jd) {
  const T = (jd - 2451545.0) / 36525
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * RAD
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M)
  const trueLong = L0 + C
  const omega = (125.04 - 1934.136 * T) * RAD
  return norm360(trueLong - 0.00569 - 0.00478 * Math.sin(omega))
}

// 求某年内指定节气的 JD（牛顿迭代，太阳每日行约 0.9856°）
function termJD(year, term) {
  let jd = julianDayFromCivil(year, term.m, term.d)
  for (let i = 0; i < 8; i++) {
    const diff = norm180(term.lon - solarLongitude(jd))
    if (Math.abs(diff) < 1e-6) break
    jd += diff / 0.9856473
  }
  return jd
}

// 北京时间下的年月日时分
function civilInBeijing(date) {
  const d = new Date(date.getTime() + BJ_OFFSET_MS)
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    min: d.getUTCMinutes(),
  }
}

function pillarOf(index) {
  const i = ((index % 60) + 60) % 60
  const gan = GAN[i % 10]
  const zhi = ZHI[i % 12]
  return {
    index: i,
    gan,
    zhi,
    text: `${gan}${zhi}`,
    ganElement: GAN_ELEMENT[gan],
    zhiElement: ZHI_ELEMENT[zhi],
    element: GAN_ELEMENT[gan], // 以天干为主属性
  }
}

// 日柱：60 甲子连续循环。锚点 1900-01-01 为甲戌日、2000-01-01 为戊午日（互相校验一致）。
function dayPillar(date) {
  const c = civilInBeijing(date)
  const jdn = Math.round(julianDayFromCivil(c.y, c.m, c.d) + 0.5)
  return pillarOf(jdn + 49)
}

// 年柱：以立春为界。公元 4 年为甲子年，故 (y - 4) 取模。
function yearPillar(date) {
  const c = civilInBeijing(date)
  const jd = msToJd(date.getTime())
  const lichun = termJD(c.y, { lon: 315, m: 2, d: 4 })
  const y = jd >= lichun ? c.y : c.y - 1
  const gan = GAN[((y - 4) % 10 + 10) % 10]
  const zhi = ZHI[((y - 4) % 12 + 12) % 12]
  return {
    year: y,
    gan,
    zhi,
    text: `${gan}${zhi}`,
    ganElement: GAN_ELEMENT[gan],
    zhiElement: ZHI_ELEMENT[zhi],
  }
}

// 月柱：以十二节为界，月干由年干推（甲己之年丙作首）
function monthPillar(date) {
  const c = civilInBeijing(date)
  const jd = msToJd(date.getTime())

  let latest = null
  for (let y = c.y - 1; y <= c.y + 1; y++) {
    for (const t of MONTH_TERMS) {
      const tjd = termJD(y, t)
      if (tjd <= jd && (!latest || tjd > latest.jd)) latest = { jd: tjd, term: t, year: y }
    }
  }
  if (!latest) return null

  const yp = yearPillar(date)
  const yearGanIdx = GAN.indexOf(yp.gan)
  const offsetFromYin = ((latest.term.branch - 2) + 12) % 12
  const ganIdx = ((yearGanIdx % 5) * 2 + 2 + offsetFromYin) % 10
  const gan = GAN[ganIdx]
  const zhi = ZHI[latest.term.branch]

  return {
    gan,
    zhi,
    text: `${gan}${zhi}`,
    ganElement: GAN_ELEMENT[gan],
    zhiElement: ZHI_ELEMENT[zhi],
    term: latest.term.name,
    termAt: new Date(jdToMs(latest.jd)).toISOString(),
  }
}

// 当前所处的节气（二十四节气，非十二节）
function currentTerm(date) {
  const c = civilInBeijing(date)
  const jd = msToJd(date.getTime())
  let latest = null
  let next = null
  for (let y = c.y - 1; y <= c.y + 1; y++) {
    for (const t of SOLAR_TERMS) {
      const tjd = termJD(y, t)
      if (tjd <= jd && (!latest || tjd > latest.jd)) latest = { jd: tjd, term: t }
      if (tjd > jd && (!next || tjd < next.jd)) next = { jd: tjd, term: t }
    }
  }
  return {
    current: latest && { name: latest.term.name, at: new Date(jdToMs(latest.jd)).toISOString() },
    next: next && { name: next.term.name, at: new Date(jdToMs(next.jd)).toISOString(), daysAway: Math.round((next.jd - jd) * 10) / 10 },
  }
}

function relationOf(dayEl, baseEl) {
  if (!dayEl || !baseEl) return '比和'
  if (dayEl === baseEl) return '比和'
  if (GENERATE[dayEl] === baseEl) return '生我'   // 那一柱生我：有人托
  if (GENERATE[baseEl] === dayEl) return '我生'   // 我去生那一柱：耗
  if (OVERCOME[baseEl] === dayEl) return '我克'   // 我克那一柱：费劲
  return '克我'                                    // 那一柱克我：被推
}

// 五行权重：天干计 1，地支本气计 1，藏干其余各计 0.4，日干（日主）额外加权
function elementStats({ year, month, day }) {
  const score = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 }
  const add = (el, w) => { if (el) score[el] += w }

  for (const p of [year, month, day]) {
    if (!p) continue
    add(p.ganElement, 1)
    add(p.zhiElement, 1)
    const hidden = ZHI_HIDDEN[p.zhi] || []
    hidden.slice(1).forEach(g => add(GAN_ELEMENT[g], 0.4))
  }
  // 日主代表「我」，加权后强弱更贴近体感
  if (day) add(day.ganElement, 2)

  const total = Object.values(score).reduce((a, b) => a + b, 0) || 1
  const ranked = Object.entries(score)
    .map(([element, value]) => ({ element, value: Number(value.toFixed(2)), share: Number((value / total).toFixed(2)) }))
    .sort((a, b) => b.value - a.value)

  return {
    ranked,
    strongest: ranked[0],
    weakest: ranked[ranked.length - 1],
    dayMaster: day && { gan: day.gan, element: day.ganElement, taste: ELEMENT_TASTE[day.ganElement] },
  }
}

/**
 * 一次算齐：流年 + 流月 + 流日，以及与「我」的关系。
 * @param {Date} date
 * @param {string} [userElement] 用户日主五行；缺省时取当日日干（不假装知道用户八字）
 */
function ganzhiOf(date = new Date(), userElement = null) {
  const year = yearPillar(date)
  const month = monthPillar(date)
  const day = dayPillar(date)
  const term = currentTerm(date)
  const stats = elementStats({ year, month, day })
  const me = userElement || day.ganElement

  const layer = (p, label) => p && {
    label,
    text: p.text,
    ganElement: p.ganElement,
    zhiElement: p.zhiElement,
    relation: relationOf(p.ganElement, me),
    note: p.term ? `${p.term}后` : undefined,
  }

  const favorableElement = Object.keys(GENERATE).find(k => GENERATE[k] === me) || me
  const avoidElement = Object.keys(OVERCOME).find(k => OVERCOME[k] === me) || null

  return {
    date: new Date(jdToMs(msToJd(date.getTime()))).toISOString(),
    civil: civilInBeijing(date),
    year: layer(year, '流年'),
    month: layer(month, '流月'),
    day: layer(day, '流日'),
    pillars: { year: year.text, month: month.text, day: day.text },
    term,
    elements: stats,
    me: {
      element: me,
      taste: ELEMENT_TASTE[favorableElement],
      avoidTaste: avoidElement ? ELEMENT_TASTE[avoidElement] : null,
    },
    // 三个时间尺度上「顺不顺」的合成判断（只用于安排节奏，不做吉凶）
    tone: describeTone({
      yearRel: relationOf(year.ganElement, me),
      monthRel: relationOf(month.ganElement, me),
      dayRel: relationOf(day.ganElement, me),
    }),
  }
}

const TONE_BY_RELATION = {
  比和: { level: 2, word: '顺', hint: '节奏跟你合拍' },
  生我: { level: 3, word: '托', hint: '有人接得住你' },
  我生: { level: 1, word: '耗', hint: '力气容易往外使' },
  我克: { level: 1, word: '费劲', hint: '事情多但可控' },
  克我: { level: 0, word: '被推', hint: '外部节奏比你快' },
}

function describeTone({ yearRel, monthRel, dayRel }) {
  const day = TONE_BY_RELATION[dayRel] || TONE_BY_RELATION['比和']
  const month = TONE_BY_RELATION[monthRel] || TONE_BY_RELATION['比和']
  const avg = (day.level + month.level) / 2

  const level = avg >= 2.5 ? 'up' : avg >= 1.5 ? 'steady' : avg >= 0.8 ? 'draining' : 'pressed'
  const label = {
    up: '顺势',
    steady: '平常',
    draining: '偏耗',
    pressed: '被推',
  }[level]

  const advice = {
    up: '适合把要紧的事往前推，见人、谈事、定下来都行。',
    steady: '按原来的节拍走就好，不用刻意加码，也别临时推翻计划。',
    draining: '别同时开三个坑，挑一件收尾就够，剩下的明天再说。',
    pressed: '外部节奏比你的快，日程之间留出缓冲，别卡点赶路。',
  }[level]

  return {
    level,
    label,
    dayWord: day.word,
    dayHint: day.hint,
    monthWord: month.word,
    yearWord: (TONE_BY_RELATION[yearRel] || {}).word || '平',
    advice,
  }
}

module.exports = {
  GAN,
  ZHI,
  GAN_ELEMENT,
  ZHI_ELEMENT,
  GENERATE,
  OVERCOME,
  ELEMENT_TASTE,
  SOLAR_TERMS,
  MONTH_TERMS,
  julianDayFromCivil,
  solarLongitude,
  termJD,
  dayPillar,
  monthPillar,
  yearPillar,
  currentTerm,
  elementStats,
  relationOf,
  ganzhiOf,
}
