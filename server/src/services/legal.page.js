'use strict'

// 把 legal.js 的结构化正文渲染成一页可独立打开的 HTML。
// 只在服务端渲染，前端不需要 JS —— 审核员点开就能看到全文，不依赖网络请求成功。

const legal = require('../domain/legal')

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const CSS = `
:root{--bg:#f7f2e8;--surface:#fffdf8;--line:#e3dac8;--ink:#2a2118;--ink-2:#6b5c48;--ink-3:#9a8a73;--red:#8c2f24}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font:16px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-text-size-adjust:100%}
.wrap{max-width:720px;margin:0 auto;padding:28px 20px 72px}
.top{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:22px}
.brand{font-size:15px;color:var(--ink-3);letter-spacing:.08em}
.back{font-size:14px;color:var(--red);text-decoration:none;white-space:nowrap}
h1{font-size:26px;line-height:1.3;margin:0 0 8px;letter-spacing:.02em}
.sub{color:var(--ink-2);font-size:14px;margin:0 0 6px}
.meta{color:var(--ink-3);font-size:13px;margin:0 0 24px}
.digest{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:0 0 28px}
.digest h2{font-size:14px;color:var(--ink-3);font-weight:600;margin:0 0 10px;letter-spacing:.06em}
.digest ul{margin:0;padding-left:18px;color:var(--ink-2);font-size:14px}
.digest li{margin:6px 0}
section{margin:0 0 26px}
h2{font-size:17px;margin:0 0 10px;letter-spacing:.02em}
p{margin:0 0 12px;color:var(--ink)}
ul.items{margin:0 0 12px;padding-left:20px}
ul.items li{margin:8px 0;color:var(--ink)}
footer{margin-top:36px;padding-top:18px;border-top:1px solid var(--line);color:var(--ink-3);font-size:13px;line-height:1.9}
footer a{color:var(--red);text-decoration:none}
`

function renderSections(doc) {
  return doc.sections
    .map(s => {
      const ps = (s.paragraphs || []).map(p => `<p>${esc(p)}</p>`).join('')
      const ul = (s.items || []).length
        ? `<ul class="items">${s.items.map(it => `<li>${esc(it)}</li>`).join('')}</ul>`
        : ''
      const after = (s.paragraphs_after || []).map(p => `<p>${esc(p)}</p>`).join('')
      return `<section><h2>${esc(s.title)}</h2>${ps}${ul}${after}</section>`
    })
    .join('\n')
}

function render(id, { from = '/' } = {}) {
  const doc = legal.get(id)
  if (!doc) return null

  const other = id === 'privacy' ? 'terms' : 'privacy'
  const otherTitle = legal.get(other).title
  const back = from && from.startsWith('/') ? from : '/'

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#f7f2e8" />
<title>${esc(doc.title)} · 起居注</title>
<meta name="description" content="${esc(doc.subtitle)}" />
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <span class="brand">起居注</span>
    <a class="back" href="${esc(back)}">返回</a>
  </div>

  <h1>${esc(doc.title)}</h1>
  <p class="sub">${esc(doc.subtitle)}</p>
  <p class="meta">版本 ${esc(doc.version)} · ${esc(doc.effectiveAt)} 生效</p>

  ${id === 'privacy'
    ? `<div class="digest"><h2>五句话说清</h2><ul>${legal.digest().map(d => `<li>${esc(d)}</li>`).join('')}</ul></div>`
    : ''}

  ${renderSections(doc)}

  <footer>
    运营者：${esc(legal.OPERATOR.name)}<br />
    联系邮箱：<a href="mailto:${esc(legal.OPERATOR.contact)}">${esc(legal.OPERATOR.contact)}</a><br />
    另见：<a href="/legal/${other}">${esc(otherTitle)}</a>
  </footer>
</div>
</body>
</html>`
}

module.exports = { render }
