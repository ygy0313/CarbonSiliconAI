'use strict'

// 文档解析回归：docx / pdf / txt 的边界都在这里钉住。
// 不依赖网络、不依赖系统工具 —— zip 现场用 Buffer 拼，保证 CI 可重复。

const assert = require('assert')
const D = require('../src/services/docparse.service')

let pass = 0
let fail = 0
function ok(name, fn) {
  try {
    fn()
    console.log('  ✓ ' + name)
    pass++
  } catch (e) {
    console.log('  ✗ ' + name + ' — ' + e.message)
    fail++
  }
}

// 最小 zip（store 方式，不压缩）：只需要结构对，解析器不校验 CRC
function zipStore(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8')
    const data = f.data
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt32LE(0, 14)
    lh.writeUInt32LE(data.length, 18)
    lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    locals.push(lh, nameBuf, data)

    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt32LE(data.length, 20)
    ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    ch.writeUInt32LE(offset, 42)
    centrals.push(ch, nameBuf)
    offset += lh.length + nameBuf.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([Buffer.concat(locals), cd, eocd])
}

function makeDocx(paragraphs) {
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paragraphs.map(p => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('') +
    '</w:body></w:document>'
  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>', 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(xml, 'utf8') },
  ])
}

// 手写一个最小 PDF：Helvetica + Tj，文本层可抽
function makePdf(lines) {
  const content = 'BT /F1 12 Tf 72 720 Td ' + lines.map((l, i) =>
    (i ? '0 -18 Td ' : '') + `(${l}) Tj`
  ).join(' ') + ' ET'
  const objs = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>endobj',
    `4 0 obj<</Length ${content.length}>>stream\n${content}\nendstream endobj`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  ]
  let out = '%PDF-1.4\n'
  for (const o of objs) out += o + '\n'
  return Buffer.from(out + 'trailer<</Root 1 0 R>>\n%%EOF', 'latin1')
}

console.log('\n【1】docx：解 OOXML 正文')
const docx = makeDocx([
  '杨光宇 技术总监 / 效能负责人',
  '手机 13800138000 邮箱 me@example.com',
  '2011-2025 阿里云 质量与效能主管 带 30 人团队 交付效率提升 300%',
])
ok('抽出中文正文', () => {
  const r = D.parseResume(docx, 'cv.docx')
  assert.strictEqual(r.format, 'docx')
  assert.ok(r.text.includes('杨光宇'), r.text.slice(0, 40))
  assert.ok(r.text.includes('效率'), '段落应保留')
})
ok('段落被拆成多行', () => {
  const r = D.parseResume(docx, 'cv.docx')
  assert.ok(r.text.split('\n').filter(Boolean).length >= 3, JSON.stringify(r.text))
})
ok('缺少 document.xml 时明确报错', () => {
  const bad = zipStore([{ name: 'a.txt', data: Buffer.from('x') }])
  assert.throws(() => D.parseResume(bad, 'x.docx'), /DOCX_NO_DOCUMENT/)
})

console.log('\n【2】pdf：只抽文本层')
ok('文本型 PDF 能抽出来', () => {
  const r = D.parseResume(makePdf(['Yang Guangyu', 'QA and DevOps Lead', 'Alibaba Cloud 2011-2025']), 'cv.pdf')
  assert.strictEqual(r.format, 'pdf')
  assert.ok(/Yang/.test(r.text), r.text.slice(0, 60))
})
ok('没有文本层（扫描件）时说人话', () => {
  const blank = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF', 'latin1')
  assert.throws(() => D.parseResume(blank, 'scan.pdf'), /扫描件|没抽出文字/)
})

console.log('\n【3】格式边界')
ok('旧 .doc 拒绝并给替代方案', () => {
  assert.throws(() => D.parseResume(Buffer.from('x'), 'cv.doc'), /docx/)
})
ok('不认识的扩展名拒绝', () => {
  assert.throws(() => D.parseResume(Buffer.from('x'), 'cv.pages'), /支持 docx/)
})
ok('空文件拒绝', () => {
  assert.throws(() => D.parseResume(Buffer.alloc(0), 'cv.txt'), /空的/)
})
ok('超过 4MB 拒绝', () => {
  assert.throws(() => D.parseResume(Buffer.alloc(4 * 1024 * 1024 + 1), 'cv.txt'), /太大/)
})
ok('超长文本被截到 2 万字', () => {
  const long = Buffer.from('张'.repeat(30000), 'utf8')
  const r = D.parseResume(long, 'cv.txt')
  assert.strictEqual(r.chars, 30000)
  assert.strictEqual(r.text.length, D.MAX_TEXT)
  assert.strictEqual(r.truncated, true)
})

console.log('\n【4】txt / md 直读')
ok('txt 原样读入', () => {
  const r = D.parseResume(Buffer.from('这是一份简历的正文，够长了吧应该没问题。', 'utf8'), 'cv.txt')
  assert.strictEqual(r.format, 'txt')
  assert.ok(r.text.includes('简历'))
})

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
process.exit(fail ? 1 : 0)
