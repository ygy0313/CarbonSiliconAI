'use strict'

// 输入端回归：拍照识食与语音转写。
// 跑法：node scripts/check-input.js（需先启动服务 8787）
//
// 这两条链路守的不是「能不能认出菜」，而是三条隐私承诺，都要能被验证：
//   ① 照片与录音不落盘 —— 调完之后 data 目录文件数不变；
//   ② 识别不写档案 —— 记忆条数不变，只有用户点保存才进库；
//   ③ 未配模型时明说是配置问题，不把「没接通」说成「你没拍好」。
//
// 识别质量本身不在这里断言：CI 没有模型密钥，硬断言模型输出只会造出一个时好时坏的测试。

const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787'
const DATA_DIR = path.join(__dirname, '..', 'data')

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

async function call(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch (_) {}
  return { status: res.status, data: json && json.data, error: json && json.error }
}

// 生成一段「看起来是图片」的 base64：内容不重要，长度与 MIME 才重要
function fakeImage(bytes = 3000, mime = 'image/jpeg') {
  return `data:${mime};base64,${Buffer.alloc(bytes, 0x41).toString('base64')}`
}

function fakeAudio(bytes = 2000) {
  return Buffer.alloc(bytes, 0x42).toString('base64')
}

function dataFileCount() {
  try {
    return fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).length
  } catch (_) {
    return -1
  }
}

const stamp = Date.now().toString(36)
const P = `p_input_${stamp}`

async function main() {
  const vision = require('../src/services/vision.service')
  const asr = require('../src/services/asr.service')

  console.log('\n【0】准备一个人')
  const created = await call('/api/persons', { method: 'POST', body: { id: P, name: `输入端${stamp.slice(-4)}`, city: '银川' } })
  ok('创建测试人员', created.status === 200 || created.status === 201, `status=${created.status}`)

  const before = await call(`/api/persons/${P}/silicon`)
  const memBefore = before.data?.silicon?.traits?.recordCount ?? 0
  const filesBefore = dataFileCount()

  console.log('\n【1】图片校验：不合规的就不该送去模型')
  const empty = vision.parseImage('')
  ok('空输入被拒', empty.ok === false && empty.reason.includes('没有收到'))
  const notImage = vision.parseImage('data:text/plain;base64,AAAA')
  ok('非图片 MIME 被拒', notImage.ok === false)
  const gif = vision.parseImage(fakeImage(3000, 'image/gif'))
  ok('不在白名单的图片格式被拒', gif.ok === false && gif.reason.includes('不支持'))
  const tiny = vision.parseImage(fakeImage(100))
  ok('过小的图片被拒', tiny.ok === false && tiny.reason.includes('空'))
  const big = vision.parseImage(fakeImage(Math.ceil(vision.MAX_B64_CHARS * 0.8) + 2000))
  ok('过大的图片被拒', big.ok === false && big.reason.includes('太大'))
  const good = vision.parseImage(fakeImage(3000))
  ok('合规图片通过', good.ok === true && good.dataUrl.startsWith('data:image/jpeg;base64,'))

  console.log('\n【2】菜名规范化：模型说什么不能照单全收')
  const normalized = vision.normalizeDishes({
    dishes: [
      { name: '番茄炒蛋', portion: '大份', kcal: 220 },
      { name: '番茄炒蛋', portion: '小份' }, // 重复
      { name: '  清蒸鲈鱼 ', portion: '超大份', kcal: '-5' }, // 非法份量 + 负热量
      { name: '', portion: '中份' }, // 空名
      { name: '一二三四五六七八九十十一十二十三', kcal: 100 }, // 超长
      ...Array.from({ length: 20 }, (_, i) => ({ name: `填充${i}`, kcal: 10 })),
    ],
  })
  ok('同名菜去重', normalized.filter(d => d.name === '番茄炒蛋').length === 1)
  ok('非法份量归到中份', normalized.find(d => d.name === '清蒸鲈鱼')?.portion === '中份')
  ok('负热量归零', normalized.find(d => d.name === '清蒸鲈鱼')?.kcal === 0)
  ok('空菜名被丢弃', !normalized.some(d => !d.name))
  ok('超长菜名被截断', normalized.every(d => d.name.length <= 12))
  ok('条数封顶 12', normalized.length === 12, `len=${normalized.length}`)

  console.log('\n【3】拼句：给人看的那一句话')
  ok('两样用「和」连接', vision.toSentence([{ name: '番茄炒蛋' }, { name: '米饭' }]) === '吃了番茄炒蛋和米饭')
  ok('三样用顿号加「和」', vision.toSentence([{ name: 'A' }, { name: 'B' }, { name: 'C' }]) === '吃了A、B和C')
  ok('带顿次前缀', vision.toSentence([{ name: '面条' }], { label: '中午' }) === '中午吃了面条')
  ok('空清单返回空串', vision.toSentence([]) === '')

  console.log('\n【4】音频校验')
  ok('过短的录音被拒', asr.parseAudio('A'.repeat(100)).ok === false)
  ok('不支持的音频格式被拒', asr.parseAudio('A'.repeat(600), 'audio/ogg').ok === false)
  ok('裸 base64 默认为 m4a', asr.parseAudio(fakeAudio()).ok === true)
  ok('data URL 形式也能收', asr.parseAudio(`data:audio/mpeg;base64,${fakeAudio()}`).ok === true)
  const parsedAudio = asr.parseAudio(fakeAudio())
  ok('按 MIME 给出正确扩展名', parsedAudio.filename.endsWith('.m4a'), parsedAudio.filename)

  console.log('\n【5】接口：未配模型时要说清是配置问题')
  const meal = await call(`/api/persons/${P}/vision/meal`, { method: 'POST', body: { image: fakeImage(3000) } })
  ok('识图接口通', meal.status === 200, `status=${meal.status}`)
  ok('识图返回 ok:false 但不算报错', meal.data?.ok === false)
  const visionOff = meal.data?.engine === 'disabled' || meal.data?.engine === 'model'
  ok('engine 标明来源', visionOff, `engine=${meal.data?.engine}`)
  if (meal.data?.engine === 'disabled') {
    ok('未配模型时提示指向配置，而不是怪照片', meal.data.reason.includes('还没接通'), meal.data.reason)
  } else {
    ok('（已配模型，跳过未配置断言）', true)
  }
  ok('识图附隐私说明', typeof meal.data?.notice === 'string' && meal.data.notice.includes('没有保存'))

  const voice = await call(`/api/persons/${P}/voice/transcribe`, {
    method: 'POST',
    body: { audio: fakeAudio(), mime: 'audio/mp4' },
  })
  ok('转写接口通', voice.status === 200, `status=${voice.status}`)
  ok('转写未配置时如实说明', voice.data?.ok === false)
  ok('转写附隐私说明', typeof voice.data?.notice === 'string' && voice.data.notice.includes('没有保存'))

  console.log('\n【6】异常输入：不能把 500 抛给用户')
  const badImg = await call(`/api/persons/${P}/vision/meal`, { method: 'POST', body: { image: 'not-a-data-url' } })
  ok('坏图片返回 200 + 人话', badImg.status === 200 && badImg.data?.ok === false, `status=${badImg.status}`)
  const shortAudio = await call(`/api/persons/${P}/voice/transcribe`, { method: 'POST', body: { audio: 'AAAA', mime: 'audio/mp4' } })
  ok('过短录音返回人话', shortAudio.status === 200 && shortAudio.data?.ok === false)
  const noPerson = await call('/api/persons/nobody999/vision/meal', { method: 'POST', body: { image: fakeImage(3000) } })
  ok('不存在的人返回 404', noPerson.status === 404, `status=${noPerson.status}`)
  const wrongMime = await call(`/api/persons/${P}/voice/transcribe`, { method: 'POST', body: { audio: fakeAudio(), mime: 'application/pdf' } })
  ok('非音频 MIME 被拒', wrongMime.status === 200 && wrongMime.data?.ok === false)

  console.log('\n【7】隐私承诺：可验证的那三条')
  const after = await call(`/api/persons/${P}/silicon`)
  const memAfter = after.data?.silicon?.traits?.recordCount ?? 0
  ok('识图转写不写档案（记忆条数不变）', memAfter === memBefore, `${memBefore} → ${memAfter}`)

  const filesAfter = dataFileCount()
  ok('没有新增数据文件（照片/录音不落盘）', filesAfter === filesBefore, `${filesBefore} → ${filesAfter}`)

  // 再扫一遍 data 目录，确认没有图片/音频残留下车
  let mediaFiles = []
  try {
    mediaFiles = fs.readdirSync(DATA_DIR).filter(f => /\.(jpg|jpeg|png|webp|m4a|mp3|aac|wav)$/i.test(f))
  } catch (_) {}
  ok('data 目录里没有图片或音频文件', mediaFiles.length === 0, mediaFiles.join(','))

  console.log('\n【8】能力自述：前端据此决定要不要显示入口')
  const meta = await call('/api/meta')
  ok('/api/meta 暴露 llm 能力面', !!meta.data?.llm, JSON.stringify(meta.data?.llm || {}))
  const llmInfo = meta.data?.llm || {}
  if (llmInfo.enabled) {
    ok('已启用时带 provider 与 model', !!llmInfo.provider && !!llmInfo.model)
  } else {
    ok('未启用时明确 enabled:false', llmInfo.enabled === false && llmInfo.provider === 'none')
  }

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
