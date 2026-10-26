#!/usr/bin/env node
'use strict'

// WXML 发布前体检。
// 这三类问题都不会在本地报错，只会在「上传/预览」时炸，或者静默失效：
//   1) 开标签前紧贴中文 —— 编译器会把 <text ...> 当成文本吞掉，报错位置完全误导
//   2) 模板里调用数组方法 —— 不报错，静默失效（选中态永远不亮）
//   3) wx:for 缺 wx:key —— 只刷警告，列表重排会丢状态

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const CJK = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) walk(full, out)
    else if (name.endsWith('.wxml')) out.push(full)
  }
  return out
}

const errors = []
const warnings = []

for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file)
  let src = fs.readFileSync(file, 'utf8')

  // 去掉注释再检查
  const stripped = src.replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length))
  const lines = stripped.split('\n')

  lines.forEach((line, i) => {
    // ① 开标签前紧贴中文
    const re = /(<[a-zA-Z][\w-]*)/g
    let m
    while ((m = re.exec(line))) {
      const before = line.slice(0, m.index)
      if (!before) continue
      const prev = before[before.length - 1]
      if (CJK.test(prev)) {
        errors.push(`${rel}:${i + 1} 开标签前紧贴中文「${prev}${m[1]}」，改成先包一层 <text> 或用 }} 分隔`)
      }
    }

    // ② 模板里用数组方法
    const exprRe = /\{\{([\s\S]*?)\}\}/g
    while ((m = exprRe.exec(line))) {
      const expr = m[1]
      const bad = ['indexOf', 'includes', 'filter', 'map(', 'some(', 'every(', 'find(', 'toFixed', 'slice(']
      for (const fn of bad) {
        if (expr.includes(fn)) {
          errors.push(`${rel}:${i + 1} 模板表达式不支持 ${fn}，请预计算后再渲染：{{${expr.trim().slice(0, 40)}}}`)
        }
      }
    }

    // ③ wx:for 缺 wx:key
    if (/wx:for=/.test(line) && !/wx:key=/.test(line)) {
      // 允许 key 写在后续行（多行标签），做个宽松判断
      const rest = lines.slice(i, i + 4).join(' ')
      if (!/wx:key=/.test(rest)) {
        warnings.push(`${rel}:${i + 1} wx:for 缺少 wx:key`)
      }
    }
  })

  // ④ 标签配对（只查非自闭合的常见容器标签）
  const containers = ['view', 'text', 'scroll-view', 'block']
  for (const tag of containers) {
    const open = (stripped.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length
    const close = (stripped.match(new RegExp(`</${tag}>`, 'g')) || []).length
    if (open !== close) {
      errors.push(`${rel} <${tag}> 标签不配对：开 ${open} / 闭 ${close}`)
    }
  }

  // ⑤ 同目录 wxss 的选择器里不许出现中文（WXSS 编译器不认，报 unexpected char）
  const wxss = file.replace(/\.wxml$/, '.wxss')
  if (fs.existsSync(wxss)) {
    const wsrc = fs.readFileSync(wxss, 'utf8')
    const selRe = /\.[\w-]*[\u4e00-\u9fff]+[\w-]*/g
    let sm
    while ((sm = selRe.exec(wsrc))) {
      errors.push(`${path.relative(ROOT, wxss)} 类名含中文「${sm[0]}」——WXSS 编译器不支持，改英文类名并在 JS 预计算映射`)
    }
  }
}

if (warnings.length) {
  console.log('\n警告：')
  warnings.forEach(w => console.log('  · ' + w))
}

if (errors.length) {
  console.log('\n错误：')
  errors.forEach(e => console.log('  × ' + e))
  console.log(`\n共 ${errors.length} 处问题，修完再上传。\n`)
  process.exit(1)
}

console.log(`\nWXML 体检通过：${walk(ROOT).length} 个文件，0 处问题。\n`)
