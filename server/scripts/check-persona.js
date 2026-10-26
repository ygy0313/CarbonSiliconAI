'use strict'

// 执笔人格回归：相处约定（不做应声虫）必须稳定出现在编译出的 prompt 里。
// 跑法：node scripts/check-persona.js（不依赖服务，直接调 domain 层）

const { buildPersonaPrompt, summarize } = require('../src/services/prompt.service')

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const SILICON = {
  person: { id: 'p_test', name: '测试用户', city: '银川' },
  facts: [{ label: '常居城市', value: '银川', confidence: 0.9 }],
  episodes: [{ ts: new Date().toISOString(), summary: '记了一笔' }],
  voice: ['直接，不绕弯'],
  traits: { recordCount: 10, last30: 3, acceptRate: 0.6, topTags: [['工作', 5]] },
}

async function main() {
  const prompt = buildPersonaPrompt(SILICON)

  console.log('\n【1】相处约定存在且完整')
  ok('prompt 非空', prompt.length > 200)
  ok('有「与他相处的方式」节', prompt.includes('## 与他相处的方式'))
  ok('约定排在硬性约束之前（最高优先级）', prompt.indexOf('与他相处的方式') < prompt.indexOf('硬性约束'))
  ok('「不要总是同意」条款在', prompt.includes('不要总是同意他的观点'))
  ok('「主动补位」条款在', prompt.includes('主动补位'))
  ok('「反对必须带出路」条款在', prompt.includes('反对必须带出路'))
  ok('「战友不是下属」条款在', prompt.includes('不是他的下属'))
  ok('五条约定一条不少', (prompt.match(/^- /gm) || []).filter(x => true).length >= 5 && [
    '不要总是同意', '主动补位', '摆事实', '反对必须带出路', '战友',
  ].every(k => prompt.includes(k)))

  console.log('\n【2】约定不破坏原有约束')
  ok('硬性约束仍在', prompt.includes('## 硬性约束'))
  ok('不编事实约束仍在', prompt.includes('没有记录的偏好，不要编'))
  ok('运势红线仍在', prompt.includes('不说吉凶'))
  ok('品牌名来自 brand.js（对外不出现技术词）', !/硅基|碳基/.test(prompt))

  console.log('\n【3】compact 模式与概览')
  const compact = buildPersonaPrompt(SILICON, { style: 'compact', includeEpisodes: false })
  ok('compact 同样携带约定', compact.includes('不要总是同意他的观点'))
  const s = summarize(prompt)
  ok('summarize 能识别相处约定节', s.sections.some(x => x.includes('与他相处的方式')))

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  if (fail) { console.error(failures.join('\n')); process.exit(1) }
}

main().catch(e => { console.error('脚本异常：', e); process.exit(1) })
