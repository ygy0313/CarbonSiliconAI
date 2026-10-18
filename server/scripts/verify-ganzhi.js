'use strict'

// 干支历算自检：用公开可查的锚点验证，不依赖任何外部库。
// 跑法：node scripts/verify-ganzhi.js

const g = require('../src/domain/ganzhi')

let pass = 0
let fail = 0
const failures = []

function check(name, actual, expected) {
  if (String(actual) === String(expected)) {
    pass++
    console.log(`  ✓ ${name}  ${actual}`)
  } else {
    fail++
    failures.push(`${name}：期望 ${expected}，实际 ${actual}`)
    console.log(`  ✗ ${name}  期望 ${expected}，实际 ${actual}`)
  }
}

function checkNear(name, actual, expected, toleranceMin) {
  const diff = Math.abs(actual - expected) / 60000
  if (diff <= toleranceMin) {
    pass++
    console.log(`  ✓ ${name}  偏差 ${diff.toFixed(0)} 分钟（容差 ${toleranceMin}）`)
  } else {
    fail++
    failures.push(`${name}：偏差 ${diff.toFixed(0)} 分钟，超容差 ${toleranceMin}`)
    console.log(`  ✗ ${name}  偏差 ${diff.toFixed(0)} 分钟，超容差 ${toleranceMin}`)
  }
}

// 北京时间构造（脚本运行机器时区无关）
function bj(y, m, d, hh = 12, mm = 0) {
  return new Date(Date.UTC(y, m - 1, d, hh - 8, mm, 0))
}

function fmtBJ(ms) {
  const t = new Date(ms + 8 * 3600 * 1000)
  const p = n => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`
}

console.log('\n【1】日柱锚点（两个锚点相隔百年，互相校验）')
check('1900-01-01 日柱', g.dayPillar(bj(1900, 1, 1)).text, '甲戌')
check('2000-01-01 日柱', g.dayPillar(bj(2000, 1, 1)).text, '戊午')

console.log('\n【2】日柱 60 日循环与逐日递增')
const d0 = bj(2026, 10, 18)
const d1 = bj(2026, 10, 19)
const i0 = g.GAN.indexOf(g.dayPillar(d0).gan)
const i1 = g.GAN.indexOf(g.dayPillar(d1).gan)
check('跨日天干前进 1 位', (i1 - i0 + 10) % 10, 1)
const d60 = new Date(d0.getTime() + 60 * 86400000)
check('60 日后回到同一干支', g.dayPillar(d60).text, g.dayPillar(d0).text)

console.log('\n【3】年柱以立春为界（不是元旦、不是正月初一）')
check('2024-02-03 年柱（立春前）', g.yearPillar(bj(2024, 2, 3)).text, '癸卯')
check('2024-02-05 年柱（立春后）', g.yearPillar(bj(2024, 2, 5)).text, '甲辰')
check('2026-10-18 年柱', g.yearPillar(d0).text, '丙午')

console.log('\n【4】月柱以十二节为界，月干由年干推')
const mp = g.monthPillar(bj(2024, 2, 10))
check('2024-02-10 月柱（立春后为寅月，甲年丙寅）', mp.text, '丙寅')
check('2024-02-10 月柱换月节气', mp.term, '立春')
check('2024-06-10 月柱（芒种后为午月）', g.monthPillar(bj(2024, 6, 10)).zhi, '午')

console.log('\n【5】节气时刻（对照公开历书，容差 90 分钟）')
const known = [
  ['2024 立春', 2024, 315, Date.UTC(2024, 1, 4, 16, 27) - 8 * 3600 * 1000],
  ['2024 春分', 2024, 0, Date.UTC(2024, 2, 20, 11, 6) - 8 * 3600 * 1000],
  ['2024 夏至', 2024, 90, Date.UTC(2024, 5, 21, 4, 51) - 8 * 3600 * 1000],
  ['2024 秋分', 2024, 180, Date.UTC(2024, 8, 22, 20, 44) - 8 * 3600 * 1000],
  ['2024 冬至', 2024, 270, Date.UTC(2024, 11, 21, 17, 21) - 8 * 3600 * 1000],
  ['2025 立春', 2025, 315, Date.UTC(2025, 1, 3, 22, 10) - 8 * 3600 * 1000],
  ['2026 立春', 2026, 315, Date.UTC(2026, 1, 4, 4, 2) - 8 * 3600 * 1000],
]
for (const [name, year, lon, expectedMs] of known) {
  const term = g.SOLAR_TERMS.find(t => t.lon === lon)
  const jd = g.termJD(year, term)
  const actualMs = (jd - 2440587.5) * 86400000
  console.log(`     ${name} 实算 ${fmtBJ(actualMs)} / 历书 ${fmtBJ(expectedMs)}`)
  checkNear(name, actualMs, expectedMs, 90)
}

console.log('\n【6】当前节气与下一个节气')
const ct = g.currentTerm(d0)
console.log(`     当前：${ct.current.name}；下一个：${ct.next.name}（${ct.next.daysAway} 天后 ${fmtBJ(Date.parse(ct.next.at))}）`)
check('当前节气在 10 月应为寒露或霜降', ['寒露', '霜降'].includes(ct.current.name), true)

console.log('\n【7】流年 / 流月 / 流日 汇总')
const z = g.ganzhiOf(d0)
console.log(`     ${fmtBJ(d0.getTime())}`)
console.log(`     流年 ${z.year.text}（${z.year.ganElement}）| 流月 ${z.month.text}（${z.month.ganElement}，${z.month.note}）| 流日 ${z.day.text}（${z.day.ganElement}）`)
console.log(`     日主 ${z.elements.dayMaster.gan}${z.elements.dayMaster.element}，宜${z.me.taste}味`)
console.log(`     五行：${z.elements.ranked.map(r => `${r.element}${r.value}`).join(' ')}`)
console.log(`     总调：${z.tone.label} —— ${z.tone.advice}`)
check('流年柱为丙午', z.year.text, '丙午')
check('五行份额合计约为 1', Math.abs(z.elements.ranked.reduce((s, r) => s + r.share, 0) - 1) < 0.02, true)

console.log('\n【8】五行生克关系函数')
// 我 = 第二个参数（baseEl）
check('火 vs 木 = 我生（我=木，木生火，我去生它）', g.relationOf('火', '木'), '我生')
check('木 vs 木 = 比和', g.relationOf('木', '木'), '比和')
check('水 vs 火 = 克我（水克火，火被克）', g.relationOf('水', '火'), '克我')
check('火 vs 水 = 我克（我=水，水克火）', g.relationOf('火', '水'), '我克')
check('木 vs 土 = 克我（木克土，土被克）', g.relationOf('木', '土'), '克我')
check('土 vs 木 = 我克（我=木，木克土）', g.relationOf('土', '木'), '我克')

console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail) {
  console.log('\n失败明细：')
  failures.forEach(f => console.log('  - ' + f))
  process.exit(1)
}
