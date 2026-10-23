'use strict'

// 照片识食。
//
// 这套判断规则不是凭空写的：提示词与「可编辑清单」的结构来自「给您请安」的照片识食，
// 那边已经跑过真实照片、踩过坑（模型爱编菜名、爱报低热量、爱附健康建议）。
// 迁移到起居注时改了两处：
//   ① 不落照片。那边存图是为了回看；这边照片只作为当次识别的输入，识别完即丢弃，
//      隐私政策里才敢写「照片不留存」。
//   ② 输出多了 sentence —— 把菜品清单拼成一句可直接存进档案的话，
//      因为起居注的记录本来就是「一句话」，不该逼用户先编辑一张表。
//
// 红线：识别不出来就说识别不出来，不许猜。失败一律返回 { ok:false, reason }，
// 由前端退化成「自己写一句」，绝不让识图成为记录的必经环节。

const llm = require('../llm/provider')

// base64 之后的字符数上限：约 1MB 图，再大就请用户重拍或裁剪
const MAX_B64_CHARS = 1.35 * 1024 * 1024
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']
const PORTIONS = ['小份', '中份', '大份']
const MAX_DISHES = 12
const MAX_NAME_LEN = 12

const SYSTEM_PROMPT = [
  '你是「起居注」的照片识食助手。用户拍一张饭桌照片，你把它变成一条能存进档案的记录。',
  '硬性规则：',
  '1. 只列照片里真的看得出来的食物或饮品。看不清、拿不准的不要编，直接不列；',
  '   整张照片都认不出时返回空数组，不要硬凑。',
  '2. 菜名用中文家常叫法，2-8 个字（如「番茄炒蛋」「清蒸鲈鱼」），不要写「菜品一」这种占位名。',
  '3. 每项给一个份量档位（小份/中份/大份）和估算热量（整数 kcal）。',
  '   热量按常见家常做法估算，不要为了好看而往低里报。',
  '4. 不写任何健康建议、减肥建议、疾病相关表述 —— 这里只做记录。',
  '5. 不识别照片里的人物、地点、文字招牌，只认食物。',
  '6. 只输出 JSON，不要 Markdown 代码块，不要解释性文字。',
  'JSON 结构：{"dishes":[{"name":"","portion":"","kcal":0}],"note":""}',
  'note 是一句不超过 20 字的补充（例如「光线较暗，可能漏了一项」），没有就留空字符串。',
].join('\n')

const USER_PROMPT = '请识别这张照片里的食物与饮品，按约定的 JSON 结构输出。'

/**
 * 解析前端传来的图片：必须是 data URL，且 MIME 在白名单内。
 * 不做「看起来像 base64 就收」的宽松判断 —— 宽松的代价是把非图片塞给模型。
 */
function parseImage(input) {
  const raw = String(input || '').trim()
  if (!raw) return { ok: false, reason: '没有收到照片' }

  const m = raw.match(/^data:(image\/[a-z+]+);base64,(.+)$/i)
  if (!m) return { ok: false, reason: '照片格式不对，请重新拍一张' }

  const mime = m[1].toLowerCase()
  if (!ALLOWED_MIME.includes(mime)) {
    return { ok: false, reason: `不支持 ${mime}，用 JPG 或 PNG` }
  }

  const base64 = m[2].replace(/\s/g, '')
  if (base64.length > MAX_B64_CHARS) {
    return { ok: false, reason: '这张照片太大了，重拍一张或先在相册里裁一下' }
  }
  if (base64.length < 1024) {
    // 一两百字节的「图片」基本是空图或截断
    return { ok: false, reason: '照片是空的，换一张试试' }
  }

  return { ok: true, dataUrl: `data:${mime};base64,${base64}` }
}

function normalizeDishes(payload) {
  const list = Array.isArray(payload?.dishes) ? payload.dishes : []
  const seen = new Set()
  const out = []
  for (const item of list) {
    const name = String(item?.name || '').replace(/\s+/g, '').slice(0, MAX_NAME_LEN)
    if (!name) continue
    // 同一个菜被列两遍是常见毛病，按名字去重
    if (seen.has(name)) continue
    seen.add(name)
    const portion = PORTIONS.includes(String(item?.portion || '')) ? String(item.portion) : '中份'
    const kcal = Math.max(0, Math.round(Number(item?.kcal) || 0))
    out.push({ name, portion, kcal })
    if (out.length >= MAX_DISHES) break
  }
  return out
}

/**
 * 把清单拼成一句能直接进档案的话。
 * 只拼菜名：份量与热量留在结构化字段里，塞进句子里反而像报表。
 */
function toSentence(dishes, { label = '' } = {}) {
  const names = (dishes || []).map(d => d.name).filter(Boolean)
  if (!names.length) return ''
  let joined
  if (names.length === 1) joined = names[0]
  else joined = `${names.slice(0, -1).join('、')}和${names[names.length - 1]}`
  return `${label ? label + '吃了' : '吃了'}${joined}`
}

/**
 * 主入口：data URL → { ok, dishes, sentence, note, engine }
 * engine: 'model' 走了模型 / 'none' 没走成（前端降级）
 */
async function recognizeMeal(imageInput, opts = {}) {
  const parsed = parseImage(imageInput)
  if (!parsed.ok) return { ok: false, reason: parsed.reason, engine: 'none', dishes: [] }

  // 没配模型和「配了但没认出来」要分开说：前者是配置问题，后者是这一张照片的问题。
  // 混成一句「没认出来」，用户会以为是自己拍得不好。
  const cap = llm.describe()
  if (!cap.enabled || !cap.vision) {
    return {
      ok: false,
      engine: 'disabled',
      dishes: [],
      reason: '拍照识食还没接通（配好视觉模型即可用），先写一句也一样记',
    }
  }

  const payload = await llm.completeVisionJSON({
    system: SYSTEM_PROMPT,
    user: USER_PROMPT,
    imageDataUrl: parsed.dataUrl,
  })

  if (!payload) {
    return {
      ok: false,
      engine: 'none',
      dishes: [],
      reason: '这次没认出来。可以先自己写一句，比如「中午吃了番茄炒蛋和米饭」',
    }
  }

  const dishes = normalizeDishes(payload)
  const note = String(payload.note || '').slice(0, 40)

  if (!dishes.length) {
    return {
      ok: false,
      engine: 'model',
      dishes: [],
      reason: note || '照片里没认出能记的食物，换个角度再拍一张',
    }
  }

  return {
    ok: true,
    engine: 'model',
    dishes,
    sentence: toSentence(dishes, opts),
    note,
    totalKcal: dishes.reduce((sum, d) => sum + d.kcal, 0),
  }
}

module.exports = { recognizeMeal, toSentence, parseImage, normalizeDishes, MAX_B64_CHARS, ALLOWED_MIME }
