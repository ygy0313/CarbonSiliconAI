'use strict'

// 能力回归：意图路由（含新增的 gift / drink / dream）+ 选酒判断 + 记梦结构 + 边界。
// 跑法：node scripts/check-agents.js（需先启动服务 8787）
//
// 这个脚本守的不是「接口能不能通」，而是三条产品边界：
//   ① 选酒不许报出具体价格（价差大，报了就会被打脸）；
//   ② 记梦不许给吉凶/财运/姻缘这类断言（只做素材，不做预测）；
//   ③ 新意图必须走同一条编排链路（needs 自动拉起 fortune，不能各写各的）。

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787'

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch (_) {}
  return { status: res.status, body: json, data: json?.data }
}

const stamp = Date.now().toString(36)
const P = `p_agent_${stamp}`

/** 说一句话，拿编排结果 */
async function say(text, extra = {}) {
  const r = await call(`/api/persons/${P}/orchestrate`, { method: 'POST', body: { text, ...extra } })
  return r
}

/** 卡片全文（用来扫禁用词、扫数字） */
function flatten(cards) {
  return cards.map(c => [
    c.title, c.desc, ...(c.why || []), ...(c.evidence || []).map(e => e.text || ''),
    JSON.stringify(c.meta || {}),
  ].join(' ')).join(' ')
}

async function main() {
  console.log('\n【0】准备一个人')
  const created = await call('/api/persons', { method: 'POST', body: { id: P, name: `能力测试${stamp.slice(-4)}`, city: '银川' } })
  ok('创建测试人员', created.status === 200 || created.status === 201, `status=${created.status}`)

  console.log('\n【1】意图路由：四条线都要认得')
  const gift = await say('中秋给我岳父送瓶酒，预算 300')
  ok('送礼 → gift', gift.data?.intent?.type === 'gift', gift.data?.intent?.type || '')
  ok('送礼摘要点明送哪瓶', /送这瓶|这瓶/.test(gift.data?.summary || ''), gift.data?.summary || '')

  const drink = await say('今晚喝点什么，配牛排')
  ok('喝点 → drink（「喝点什么」也要命中）', drink.data?.intent?.type === 'drink', drink.data?.intent?.type || '')

  const dream = await say('昨晚梦见水一直涨，我一直在找一扇门，怎么都推不开')
  ok('梦 → dream', dream.data?.intent?.type === 'dream', dream.data?.intent?.type || '')

  const none = await say('帮我订一张去上海的机票')
  ok('听不懂时不硬凑', none.data?.intent?.type === 'unknown' && (none.data?.cards || []).length === 0)
  ok('听不懂时给可选项', typeof none.data?.suggestion === 'string' && none.data.suggestion.length > 0)

  console.log('\n【2】声明式依赖：选酒自己没有天气/干支逻辑，靠 needs 拉起')
  const plan = (gift.data?.trace || []).map(t => t.agentId).filter(Boolean)
  ok('自动拉起今日节律（context.fortune）', plan.includes('fortune.today'), plan.join(','))
  ok('只拉起真正需要的节点（不多调）', plan.length <= 2, plan.join(','))
  const fortuneNode = (gift.data?.trace || []).find(t => t.agentId === 'fortune.today')
  const wineNode = (gift.data?.trace || []).find(t => t.agentId === 'wine.suggest')
  ok('依赖层先执行、被依赖后执行', !!fortuneNode && !!wineNode && fortuneNode.step < wineNode.step)

  console.log('\n【3】选酒判断：收礼人 / 预算 / 配餐都要起作用')
  const wineCards = (gift.data?.cards || []).filter(c => c.id.startsWith('wine_'))
  ok('产出至少一个酒款', wineCards.length >= 1, `count=${wineCards.length}`)
  const top = wineCards[0]
  ok('首选标为 primary', top?.kind === 'primary')
  ok('送长辈时选低单宁', (top?.meta?.tannin || 9) <= 2, `tannin=${top?.meta?.tannin}`)
  ok('识别出收礼人是长辈', top?.meta?.recipient === 'elder', top?.meta?.recipient || '')
  ok('给出醒酒/温度建议', typeof top?.meta?.serve === 'string' && top.meta.serve.length > 4)
  ok('每张酒卡都有理由', wineCards.every(c => (c.why || []).length > 0))
  ok('引用店铺而不是瞎报价', top?.meta?.shop?.name === '九月葡园' && /以店铺为准/.test(top?.meta?.priceNote || ''))

  // 报价红线：卡片正文里不许出现「数字 + 元」
  ok('卡片正文不出现具体价格', !/\d+\s*元/.test(flatten(wineCards)), '出现了报价数字')

  const pair = await say('清蒸鱼配什么酒')
  const pairTop = (pair.data?.cards || []).find(c => c.id.startsWith('wine_'))
  ok('配海鲜时推白葡萄酒', pairTop?.meta?.color === 'white', `${pairTop?.title || '无'} / ${pairTop?.meta?.color || ''}`)
  ok('配餐理由落到「压得住/清爽」这类可验证说法',
    (pairTop?.why || []).some(w => /配|清爽|压得住/.test(w)),
    (pairTop?.why || []).join(' | ').slice(0, 60))

  const budget = await say('送客户一瓶红酒，预算 500')
  const bTop = (budget.data?.cards || []).find(c => c.id.startsWith('wine_'))
  ok('预算高时往上走价位带', (bTop?.meta?.tier || 0) >= 2, `tier=${bTop?.meta?.tier}`)
  ok('送客户优先拿得出手', bTop?.meta?.recipient === 'client', bTop?.meta?.recipient || '')

  console.log('\n【4】记梦：拆意象、给结构、不预测')
  const dreamCards = dream.data?.cards || []
  const motif = dreamCards.find(c => c.id.startsWith('dream_') && c.id !== 'dream_story')
  const story = dreamCards.find(c => c.id === 'dream_story')
  ok('拆出意象主干', (motif?.meta?.motifs || []).length >= 2, JSON.stringify((motif?.meta?.motifs || []).map(m => m.label)))
  ok('意象带自我提问', (motif?.meta?.motifs || []).every(m => typeof m.question === 'string' && m.question.length > 6))
  ok('给了三幕骨架', (story?.meta?.acts || []).length === 3, `acts=${(story?.meta?.acts || []).length}`)
  ok('给了一句能开头的钩子', typeof story?.meta?.hook === 'string' && story.meta.hook.length > 8)

  const dreamText = flatten(dreamCards)
  const forbidden = ['预示', '吉凶', '财运', '姻缘', '命中注定', '大凶', '风水']
  const hitWord = forbidden.find(w => dreamText.includes(w))
  ok('不出现占卜断言语', !hitWord, hitWord || '')
  ok('明确说了「不是结论」', /不是解梦结论|故事比解读/.test(dreamText))

  console.log('\n【5】溯源：同一个意象再梦一次，要认出来')
  const again = await say('又梦见水，这次是海水涨上来，还是那扇门')
  const againMotif = (again.data?.cards || []).find(c => c.id.startsWith('dream_') && c.id !== 'dream_story')
  ok('第二次记梦能引用上一次', (againMotif?.evidence || []).length >= 1, `evidence=${(againMotif?.evidence || []).length}`)
  ok('记忆条数在涨', (again.data?.silicon?.memoryCount || 0) >= 2, `memory=${again.data?.silicon?.memoryCount}`)

  console.log('\n【6】服务清单：新能力要能被前端发现')
  const services = await call('/api/services')
  const list = services.data?.services || []
  const wineSvc = list.find(s => s.id === 'wine.suggest')
  const dreamSvc = list.find(s => s.id === 'dream.record')
  ok('服务市集里有「选酒」', !!wineSvc && wineSvc.intents.includes('gift'))
  ok('服务市集里有「记梦」', !!dreamSvc && dreamSvc.intents.includes('dream'))
  ok('能力清单里意图覆盖完整', ['eat', 'gather', 'gift', 'drink', 'dream'].every(t => list.some(s => s.intents.includes(t))),
    list.flatMap(s => s.intents).join(','))

  console.log('\n【7】运动能力与卡路里、定位')
  const move = await call('/api/persons/p_owner/orchestrate', { method: 'POST', body: { text: '今晚想动一动，出出汗' } })
  const moveCards = move.data?.cards || []
  ok('「动一动」路由到运动能力', move.data?.intent?.type === 'move', `intent=${move.data?.intent?.type}`)
  const moveCard = moveCards.find(c => String(c.id || '').startsWith('move_'))
  ok('运动卡给出卡路里量级', !!moveCard && Number(moveCard.meta?.kcal30) > 0, `meta=${JSON.stringify(moveCard?.meta || {})}`)
  ok('运动卡有搜索词（可给 App 导流）', !!(moveCard?.meta?.searchKeyword), moveCard?.meta?.searchKeyword)

  const eat = await call('/api/persons/p_owner/orchestrate', {
    method: 'POST',
    body: { text: '中午吃什么，别太辣', geo: { lat: 30.27, lon: 120.15 } },
  })
  const eatCard = (eat.data?.cards || []).find(c => String(c.id || '').startsWith('meal_'))
  ok('餐饮卡带卡路里', !!eatCard && Number(eatCard.meta?.kcal) > 0, `kcal=${eatCard?.meta?.kcal}`)
  ok('定位决定城市（杭州坐标 → 搜索词含杭州）',
    String(eatCard?.meta?.searchKeyword || '').includes('杭州'), eatCard?.meta?.searchKeyword)

  const badGeo = await call('/api/persons/p_owner/orchestrate', {
    method: 'POST',
    body: { text: '中午吃什么', geo: { lat: 999, lon: 999 } },
  })
  ok('非法经纬度不报错，回退档案城市', badGeo.status === 200 && (badGeo.data?.cards || []).length > 0)

  const servicesAfter = await call('/api/services')
  ok('服务市集里有「运动建议」', (servicesAfter.data?.services || []).some(s => s.id === 'move.suggest'))
  ok('意图覆盖包含 move', (servicesAfter.data?.services || []).some(s => s.intents.includes('move')))

  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
  if (fail) {
    console.log('失败项：')
    failures.forEach(f => console.log('  - ' + f))
    process.exit(1)
  }
}

main().catch(err => {
  console.error('脚本异常：', err)
  process.exit(1)
})
