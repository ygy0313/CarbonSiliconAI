'use strict'

// 简历文件 → 纯文本。零依赖：docx 自己解 zip（zlib 内置），pdf 只抽文本层。
//
// 能力边界（对外文案必须一致）：
//   .docx  ✅ 解 OOXML 正文，段落/换行/制表符都保留
//   .pdf   ⚠️ 只抽「文本型」PDF；扫描件、加密件、CID 复杂编码抽不出来 → 明确报错让用户换格式
//   .doc   ❌ 旧二进制格式，零依赖解不了 → 提示另存为 docx
//   .txt/.md ✅ 直接读
//
// 解析只发生在内存里：拿到文本后立刻走同一条「脱敏 → 原文进保险箱」流水线，
// 文件本身不落盘（与拍照/录音同一条红线）。

const zlib = require('zlib')
const path = require('path')

const MAX_BYTES = 4 * 1024 * 1024 // 4MB，nginx 侧 6m
const MAX_TEXT = 20000

const EXT_OK = ['docx', 'pdf', 'txt', 'md', 'markdown']

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

// ── 最小 zip 读取器（只取需要的条目，不解全包）────────────────
function readZipEntries(buf) {
  const entries = new Map()
  // EOCD 在文件尾部，签名 0x06054b50，最多带 64KB 注释
  let eocd = -1
  const scanFrom = Math.max(0, buf.length - 65558)
  for (let i = buf.length - 22; i >= scanFrom; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('ZIP_EOCD_NOT_FOUND')

  const total = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  if (off === 0xffffffff) throw new Error('ZIP64_NOT_SUPPORTED')

  for (let i = 0; i < total; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    entries.set(name, { method, compSize, localOff })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function readZipFile(buf, entry) {
  const lh = entry.localOff
  if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error('ZIP_LOCAL_HEADER_BAD')
  const nameLen = buf.readUInt16LE(lh + 26)
  const extraLen = buf.readUInt16LE(lh + 28)
  const start = lh + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + entry.compSize)
  if (entry.method === 0) return raw
  if (entry.method === 8) return zlib.inflateRawSync(raw)
  throw new Error('ZIP_UNSUPPORTED_METHOD')
}

// OOXML 正文 → 文本：段落换行、制表符转空格、去掉所有标签
function xmlToText(xml) {
  return decodeEntities(
    xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\s*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseDocx(buf) {
  const entries = readZipEntries(buf)
  const doc = entries.get('word/document.xml')
  if (!doc) throw new Error('DOCX_NO_DOCUMENT')
  const xml = readZipFile(buf, doc).toString('utf8')
  const text = xmlToText(xml)
  // 简历里的表格（工作时间线）常放在表格里，上面已经按段落抽出来了；再兜一次纯文本量
  return text
}

// ── PDF 文本层抽取（尽力而为）────────────────────────────────
function unescapePdfString(s) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (m, g) => {
    if (/^[0-7]+$/.test(g)) return String.fromCharCode(parseInt(g, 8))
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' })[g] || g
  })
}

function stripPdfText(stream) {
  const out = []
  // 逐段找 BT ... ET，块里按 Tj / TJ / ' / " 取字符串
  const blocks = stream.match(/BT[\s\S]*?ET/g) || []
  const push = s => {
    if (!s) return
    const t = unescapePdfString(s).replace(/\u0000/g, '')
    if (t.trim()) out.push(t)
  }
  for (const block of blocks) {
    // 标记：Td/TD/T* 视作换行
    const parts = block.split(/(?:\bTd\b|\bTD\b|\bT\*)/)
    for (const part of parts) {
      const arr = part.match(/\[(.*?)\]\s*TJ/gs)
      if (arr) {
        for (const a of arr) {
          const inner = a.slice(a.indexOf('[') + 1, a.lastIndexOf(']'))
          const strs = inner.match(/\((?:\\.|[^\\()])*\)/g) || []
          push(strs.map(s => s.slice(1, -1)).join(''))
        }
      }
      const single = part.match(/\((?:\\.|[^\\()])*\)\s*(?:Tj|'|")/g) || []
      for (const s of single) {
        const m = /\((?:\\.|[^\\()])*\)/.exec(s)
        if (m) push(m[0].slice(1, -1))
      }
    }
    out.push('\n')
  }
  return out.join('').replace(/\n{3,}/g, '\n\n').trim()
}

function parsePdf(buf) {
  const latin = buf.toString('latin1')
  const chunks = []
  const re = /stream\r?\n?/g
  let m
  while ((m = re.exec(latin)) !== null) {
    const start = m.index + m[0].length
    const end = latin.indexOf('endstream', start)
    if (end < 0) break
    const raw = buf.subarray(start, end)
    let inflated = null
    try {
      inflated = zlib.inflateSync(raw).toString('latin1')
    } catch (_) {
      // 未压缩的内容流（少见）：直接当文本
      const head = raw.subarray(0, 8).toString('latin1')
      if (/BT|\/F\d|Tj|TJ/.test(head)) inflated = raw.toString('latin1')
    }
    if (inflated && /BT[\s\S]{0,2000}ET/.test(inflated)) chunks.push(inflated)
    re.lastIndex = end + 9
  }
  if (!chunks.length) {
    throw new Error('这个 PDF 没抽出文字（可能是扫描件或加密件），另存为 docx / txt 更稳')
  }

  const text = stripPdfText(chunks.join('\n'))
    // PDF 用空格做定位填充，压掉连续空白，否则入库全是空洞
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n */g, '\n')
  const readable = (text.match(/[\u4e00-\u9fa5a-zA-Z0-9]/g) || []).length
  const meaningful = text.replace(/\s/g, '').length
  // 抽出来的东西大多是乱码控制符 → 判定为「编码不可解」，别把垃圾灌进档案
  if (meaningful < 40 || readable / meaningful < 0.5) {
    throw new Error('这个 PDF 的文字用了不常见的编码，抽不出来。粘贴文本或另存为 docx 更快')
  }
  return text
}

/**
 * 主入口。
 * @param {Buffer} buf
 * @param {string} filename
 * @returns {{ text: string, format: string, notice?: string }}
 */
function parseResume(buf, filename) {
  if (!buf || !buf.length) {
    const e = new Error('文件是空的')
    e.code = 'FILE_EMPTY'
    throw e
  }
  if (buf.length > MAX_BYTES) {
    const e = new Error('文件太大（上限 4MB）')
    e.code = 'FILE_TOO_LARGE'
    throw e
  }
  const ext = String(path.extname(filename || '').toLowerCase().replace('.', ''))
  if (ext === 'doc') {
    const e = new Error('旧版 .doc 解析不了，请另存为 .docx 或 PDF 再上传')
    e.code = 'DOC_UNSUPPORTED'
    throw e
  }
  if (!EXT_OK.includes(ext)) {
    const e = new Error(`支持 docx / pdf / txt / md，${ext ? '不认 .' + ext : '没识别出格式'}`)
    e.code = 'FORMAT_UNSUPPORTED'
    throw e
  }

  let text = ''
  if (ext === 'docx') text = parseDocx(buf)
  else if (ext === 'pdf') text = parsePdf(buf)
  else text = buf.toString('utf8')

  text = text.replace(/\u0000/g, '').trim()
  if (text.length < 20) {
    const e = new Error(
      ext === 'pdf'
        ? '这个 PDF 没抽出文字（可能是扫描件或加密件），另存为 docx / txt 更稳'
        : '文件里没读到有效内容'
    )
    e.code = 'TEXT_TOO_SHORT'
    throw e
  }

  const truncated = text.length > MAX_TEXT
  return {
    text: truncated ? text.slice(0, MAX_TEXT) : text,
    format: ext,
    chars: text.length,
    truncated,
    notice: truncated ? `原文较长，只取前 ${MAX_TEXT} 字入库` : '',
  }
}

module.exports = { parseResume, parseDocx, parsePdf, EXT_OK, MAX_BYTES, MAX_TEXT }
