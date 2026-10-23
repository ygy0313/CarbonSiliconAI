'use strict'

/* 起居注 · H5 端
   零构建、零依赖。与 API 同源部署，因此不处理跨域。
   数据全部来自后端真实接口，页面里没有任何硬编码的假结果。 */

const PERSON = 'p_owner'
const TOKEN_KEY = 'qjz.tokens'

const state = {
  meta: null,
  ganzhi: null,
  silicon: null,
  profile: null,
  quiz: null,
  grants: null,
  result: null,
  loading: false,
  traceOpen: false,
  tokens: loadTokens(),
}

/* ── 基础工具 ─────────────────────────────────────────── */

function loadTokens() {
  try { return JSON.parse(sessionStorage.getItem(TOKEN_KEY) || '{}') } catch (_) { return {} }
}

function saveTokens() {
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(state.tokens)) } catch (_) {}
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (opts.token) headers['X-Grant-Token'] = opts.token
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch (_) {}
  if (!res.ok || !json || json.ok === false) {
    const msg = json?.error?.message || `请求失败（${res.status}）`
    throw new Error(msg)
  }
  return json.data
}

function toast(msg, ms = 2200) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.classList.add('is-show')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => t.classList.remove('is-show'), ms)
}

function fmtDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const p = n => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/* ── 页头 ─────────────────────────────────────────────── */

function masthead(right = '') {
  const meta = state.meta
  return `
    <header class="masthead">
      <div>
        <h1 class="brand-name">${esc(meta?.product || '起居注')}</h1>
        <div class="brand-sub">${esc(meta?.tagline || '一个人的起居注')}</div>
      </div>
      <div class="masthead-meta">${right}</div>
    </header>`
}

/* ── 首页 ─────────────────────────────────────────────── */

function viewHome() {
  const z = state.ganzhi
  const s = state.silicon
  const q = state.quiz

  if (!z || !s) return masthead() + `<div class="empty">正在起卦…</div>`

  const tone = z.tone
  const elBars = (z.elements?.ranked || []).map((r, i) => `
    <div class="el-row">
      <span class="el-name">${esc(r.element)}</span>
      <span class="el-bar"><span class="el-fill ${i === 0 ? 'is-strong' : ''}" style="width:${Math.round(r.share * 100)}%"></span></span>
      <span class="el-val">${r.value}</span>
    </div>`).join('')

  const layers = [
    ['流年', z.year], ['流月', z.month], ['流日', z.day],
  ].map(([label, p]) => `
    <div class="pillar">
      <div class="pillar-k">${label}</div>
      <div class="pillar-v">${esc(p.text)}</div>
      <div class="pillar-n">${esc(p.ganElement)} · ${esc(p.relation)}</div>
    </div>`).join('')

  const pct = Math.round((s.completeness || 0) * 100)
  const done = q ? q.progress.done : 0
  const total = q ? q.progress.total : 12

  return `
    ${masthead(`<b>${esc(z.term?.current?.name || '')}</b> 后<br>${esc(state.meta?.persona?.name || '执笔')} 在册`)}

    <section class="section">
      <h2 class="section-title">今日</h2>
      <div class="panel">
        <div class="tone-row">
          <span class="tone-label">${esc(tone.label)}</span>
          <span class="pillar-n">日主${esc(z.elements.dayMaster.element)} · 宜${esc(z.me.taste)}味</span>
        </div>
        <div class="tone-advice">${esc(tone.advice)}</div>

        <div class="pillars">${layers}</div>

        <div class="elements">${elBars}</div>
        <div class="section-note" style="margin:12px 0 0">
          年柱以立春为界、月柱以十二节为界、日柱按北京时间换日。只谈节奏与宜忌方向，不作任何预测性断言。
        </div>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">档案</h2>
      <div class="panel">
        <div class="progress-line">
          <span class="progress-num">完整度</span>
          <span class="progress-track"><span class="progress-fill" style="width:${pct}%"></span></span>
          <span class="progress-num">${pct}%</span>
        </div>
        <div class="section-note" style="margin:10px 0 0">
          ${s.factCount} 条事实 · ${s.memoryCount} 条记忆 · 入局问答 ${done}/${total}
        </div>
        <div class="btn-row" style="margin-top:14px">
          <button class="btn btn-accent" data-act="go-quiz">${done ? '继续答几题' : '入局：先答几道'}</button>
          <a class="btn btn-ghost" href="#/ask">直接问事</a>
        </div>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">可以这样问</h2>
      <div class="chips">
        ${['今天中午吃什么，一个人，别太辣，预算30',
           '周六想和朋友组个局，6个人，预算150，没玩过的多',
           '今晚一个人，想开一局，不想叫人',
           '人不够，想和 AI 凑一局',
           '过节给我岳父送瓶酒，预算 300',
           '昨晚梦见水一直涨，一直在找一扇门']
          .map(t => `<span class="chip" data-act="quick-ask" data-text="${esc(t)}">${esc(t)}</span>`).join('')}
      </div>
    </section>

    ${quizPanel(q)}
  `
}

function quizPanel(q) {
  if (!q) return ''
  const next = q.progress.next
  if (!next) {
    return `<section class="section"><h2 class="section-title">入局问答</h2>
      <div class="panel"><div class="empty">十二题都答完了。档案里该有的都有了，剩下的靠日常记录慢慢补。</div></div></section>`
  }
  return `
    <section class="section">
      <h2 class="section-title">入局问答 · ${esc(next.group)}</h2>
      <div class="panel">
        <div style="font-size:15.5px;font-weight:600">${esc(next.text)}</div>
        <div class="section-note" style="margin:6px 0 12px">${esc(next.sub || '')}</div>
        <div class="chips" style="margin:0">
          ${next.options.map(o => `<span class="chip" data-act="quiz-answer" data-q="${esc(next.id)}" data-o="${esc(o.key)}">${esc(o.label)}</span>`).join('')}
        </div>
        <div class="section-note" style="margin:14px 0 0">已答 ${q.progress.done}/${q.progress.total}，答完自动进下一题。</div>
      </div>
    </section>`
}

/* ── 问事 ─────────────────────────────────────────────── */

function viewAsk() {
  const r = state.result
  return `
    ${masthead(`<b>${esc(state.meta?.persona?.name || '执笔')}</b> 听候`)}
    <section class="section">
      <h2 class="section-title">说一句</h2>
      <div class="composer">
        <textarea id="ask-input" placeholder="说说你现在的情况…… 比如「今天中午吃什么，一个人，别太辣，预算30」"></textarea>
      </div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-accent" data-act="ask" ${state.loading ? 'disabled' : ''}>
          ${state.loading ? '<span class="spin">◌</span> 编排中' : '问它'}
        </button>
        <button class="btn btn-ghost" data-act="quick-ask" data-text="今天中午吃什么，一个人，别太辣，预算30">吃什么</button>
        <button class="btn btn-ghost" data-act="quick-ask" data-text="周六想和朋友组个局，6个人，预算150，没玩过的多">组个局</button>
        <button class="btn btn-ghost" data-act="quick-ask" data-text="今晚一个人，想开一局，不想叫人">一个人的局</button>
        <button class="btn btn-ghost" data-act="quick-ask" data-text="人不够，想和 AI 凑一局">跟 AI 玩</button>
        <button class="btn btn-ghost" data-act="quick-ask" data-text="过节给我岳父送瓶酒，预算 300">送瓶酒</button>
        <button class="btn btn-ghost" data-act="quick-ask" data-text="昨晚梦见水一直涨，一直在找一扇门">记个梦</button>
      </div>
    </section>

    ${r ? renderResult(r) : `<div class="empty">还没问。上面有四个例子，点一下就行。</div>`}
  `
}

function renderResult(r) {
  const cards = (r.cards || []).map(renderCard).join('')
  const trace = state.traceOpen ? renderTrace(r.trace) : ''
  return `
    <section class="section">
      <h2 class="section-title">结果</h2>
      <div class="panel" style="padding:14px 16px">
        <div style="font-size:13.5px;color:var(--ink-2)">${esc(r.summary)}</div>
        <div class="section-note" style="margin:8px 0 0">
          意图：${esc(r.intent?.label || '')} · 置信 ${esc(r.intent?.confidence)} · ${r.totalMs}ms
        </div>
      </div>
      <div style="margin-top:12px">${cards}</div>
      <div class="btn-row" style="margin-top:6px">
        <button class="btn btn-ghost btn-sm" data-act="toggle-trace">${state.traceOpen ? '收起编排过程' : '看它怎么想的'}</button>
      </div>
      ${trace}
    </section>`
}

function renderCard(c) {
  const cls = c.kind === 'plan' ? 'card is-plan' : c.kind === 'primary' ? 'card is-primary' : 'card'
  const why = (c.why || []).length
    ? `<ul class="card-why">${c.why.slice(0, 4).map(w => `<li>${esc(w)}</li>`).join('')}</ul>`
    : ''

  let extra = ''
  const m = c.meta || {}
  if (m.timeline) {
    extra += `<div class="timeline">${m.timeline.map(t => `
      <div class="tl-item"><span class="tl-time">${esc(t.time)}</span>${esc(t.text)}</div>`).join('')}</div>`
  }
  if (m.todos) {
    extra += `<ul class="todo-list">${m.todos.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`
  }
  if (m.cast && m.cast.length) {
    extra += `<div class="cast">${m.cast.map(p => `
      <div class="cast-item">
        <div><span class="cast-name">${esc(p.name)}</span><span class="cast-role">${esc(p.role)}</span></div>
        <div class="cast-line">「${esc(p.line)}」</div>
        <div class="cast-meta">${esc(p.temperNow || p.temper)} · 他在瞒：${esc(p.secret)}</div>
      </div>`).join('')}</div>`
  }

  return `
    <article class="${cls}">
      <div class="card-head">
        <span class="card-title">${esc(c.title)}</span>
        <span class="card-score">${c.score}</span>
      </div>
      <div class="card-desc">${esc(c.desc)}</div>
      ${why}
      ${extra}
      <div class="card-source">${esc(c.source || '')}${m.totalPerPerson ? ` · 人均 ${m.totalPerPerson} 元` : ''}</div>
    </article>`
}

function renderTrace(trace) {
  if (!trace || !trace.length) return ''
  return `<div class="panel" style="margin-top:10px">
    <div class="section-note" style="margin-bottom:8px">编排过程 · ${trace.length} 步</div>
    ${trace.map(t => `<div class="grant-row">
      <span class="grant-key">${String(t.step).padStart(2, '0')} ${esc(t.stage)}</span>
      <span>${esc(t.label)}${t.ms != null ? ` <span class="grant-key">${t.ms}ms</span>` : ''}</span>
    </div>`).join('')}
  </div>`
}

/* ── 档案 ─────────────────────────────────────────────── */

function viewArchive() {
  const p = state.profile
  if (!p) return masthead() + `<div class="empty">正在翻卷…</div>`

  const facts = (p.facts || []).map(f => `
    <div class="fact ${f.stale ? 'v-weak' : ''}">
      <div class="fact-k">${esc(f.label || f.key)}${f.stale ? '<span class="fact-badge">待核对</span>' : ''}</div>
      <div class="fact-v">${esc(Array.isArray(f.value) ? f.value.join('、') : f.value)}</div>
    </div>`).join('')

  const memos = (p.episodes || []).slice(0, 40).map(e => `
    <div class="memo">
      <div class="memo-meta">
        <span>${fmtDate(e.ts)}</span>
        ${e.redacted ? '<span class="memo-redacted">已脱敏</span>' : ''}
        ${(e.tags || []).slice(0, 3).map(t => `<span>#${esc(t)}</span>`).join('')}
      </div>
      <div>${highlightTokens(esc(e.text || ''))}</div>
    </div>`).join('')

  const conflicts = (p.conflicts || []).length
    ? `<section class="section"><h2 class="section-title">待你裁决</h2>
        ${p.conflicts.map(c => `<div class="panel" style="margin-bottom:8px">
          <div style="font-size:13.5px">${esc(c.label || c.key)}：档案记的是「${esc(c.existing)}」，新记录说「${esc(c.incoming)}」</div>
        </div>`).join('')}
      </section>`
    : ''

  return `
    ${masthead(`<b>${esc(p.person?.name || '')}</b><br>${esc(p.person?.city || '')}`)}
    <section class="section">
      <h2 class="section-title">已确认</h2>
      <div class="fact-grid">${facts || '<div class="empty">还没有事实</div>'}</div>
    </section>

    ${conflicts}

    <section class="section">
      <h2 class="section-title">最近发生</h2>
      <div class="panel">${memos || '<div class="empty">还没有记忆</div>'}</div>
      <div class="section-note" style="margin-top:10px">
        红色的 <span class="memo-token">&lt;手机号1&gt;</span> 是入库时被替换掉的占位符。原文只以密文形式存在，需授权才能还原。
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">脱敏体检</h2>
      <div class="panel">
        <div class="section-note" style="margin:0 0 10px">先看这句话里有什么会被抹掉，再决定记不记。</div>
        <textarea id="redact-input" placeholder="粘贴一段你想记录的话，比如「明天下午去民生花园3号楼2单元501，电话13800001234」"></textarea>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn btn-ghost btn-sm" data-act="redact-preview">体检</button>
        </div>
        <div id="redact-out" style="margin-top:12px"></div>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">规则与条款</h2>
      <div class="panel">
        <a class="legal-link" href="/legal/privacy?from=%23%2Farchive" target="_blank">
          <b>隐私政策</b><span>原文只存密文，读它要签一张有时限的票</span>
        </a>
        <a class="legal-link" href="/legal/terms?from=%23%2Farchive" target="_blank">
          <b>用户协议</b><span>它给建议，你拿主意</span>
        </a>
      </div>
    </section>`
}

function highlightTokens(html) {
  return html.replace(/&lt;([^&]{1,12}?\d)&gt;/g, '<span class="memo-token">&lt;$1&gt;</span>')
}

/* ── 授权 ─────────────────────────────────────────────── */

const SCOPE_UI = [
  ['prompt', '读取人格 prompt', '把档案编成驱动 agent 的系统提示词'],
  ['export', '导出档案', '生成可离线保存、可在别处恢复的标准文件'],
  ['raw', '还原原文', '解密被脱敏前的原始记录'],
  ['pii', '读取身份信息', '还原手机号、证件号等被剥离的字段'],
]

function viewGrant() {
  const g = state.grants
  const tokens = state.tokens

  const grantRows = (g?.grants || []).map(x => `
    <div class="grant-row">
      <span>
        ${esc(x.scopeLabels.join('、'))}
        <div class="grant-key">${esc(x.purpose)} · 剩 ${x.maxUses - x.used}/${x.maxUses} 次 · ${x.expired ? '已过期' : '有效'}</div>
      </span>
      <button class="btn btn-ghost btn-sm" data-act="revoke" data-id="${esc(x.id)}" ${x.revoked ? 'disabled' : ''}>${x.revoked ? '已撤销' : '撤销'}</button>
    </div>`).join('') || '<div class="empty">还没有签发过授权</div>'

  const auditRows = (g?.audits || []).map(a => `
    <div class="grant-row">
      <span class="grant-key">${fmtDate(a.at)}</span>
      <span>${esc(a.action)}${a.scope ? ` · ${esc(a.scope)}` : ''}${a.depth ? ` · ${esc(a.depth)}` : ''}${a.reason ? ` · ${esc(a.reason)}` : ''}</span>
    </div>`).join('') || '<div class="empty">暂无记录</div>'

  return `
    ${masthead(`<b>契</b><br>档案是你的`)}
    <section class="section">
      <h2 class="section-title">先讲清楚</h2>
      <div class="notice">
        记录在入库时就已脱敏：手机号、证件号、地址这类内容会被换成 <span class="memo-token">&lt;手机号1&gt;</span> 这样的占位符，
        原文只存密文。想读 prompt、想导出、想还原原文，都得在这里签一张票据 —— 有用途、有期限、有次数，用完即废。
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">签一张票</h2>
      <div class="panel">
        <div id="scope-list">
          ${SCOPE_UI.map(([k, label, desc]) => `
            <label class="scope-item">
              <input type="checkbox" name="scope" value="${k}" />
              <span><span class="scope-label">${label}</span><span class="scope-desc">${desc}</span></span>
            </label>`).join('')}
        </div>
        <div style="margin-top:14px">
          <input type="text" id="grant-purpose" placeholder="用途，例如：导出给新手机恢复" maxlength="60" />
        </div>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn btn-accent" data-act="issue">签发票据</button>
          <button class="btn btn-ghost btn-sm" data-act="issue-preset" data-scopes="export">快签：导出</button>
          <button class="btn btn-ghost btn-sm" data-act="issue-preset" data-scopes="prompt">快签：读 prompt</button>
        </div>
        <div id="issue-out"></div>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">票据</h2>
      <div class="panel">
        ${grantRows}
        <div class="section-note" style="margin:12px 0 0">
          明文票据只显示一次，之后库里只有指纹。上面的列表里不会再出现它。
        </div>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">导出与恢复</h2>
      <div class="panel">
        <div class="section-note" style="margin:0 0 12px">
          导出文件是 <span class="mono">${esc(state.meta?.exportFormat || 'qijuzhu/v1')}</span> 格式，带校验和。
          这是「换设备、换 App、二十年后还能读」的保证。
        </div>
        <div class="btn-row">
          <button class="btn" data-act="export" data-depth="safe">导出（仅脱敏）</button>
          <button class="btn btn-ghost" data-act="export" data-depth="sealed">导出（含密文）</button>
          <button class="btn btn-ghost" data-act="read-prompt">读取 prompt</button>
        </div>
        <div id="export-out" style="margin-top:12px"></div>

        <hr style="border:none;border-top:1px solid var(--line-2);margin:18px 0" />
        <div style="font-size:13.5px;margin-bottom:8px">从导出文件恢复</div>
        <input type="file" id="import-file" accept=".json,application/json" style="font-size:13px" />
        <div id="import-out" style="margin-top:12px"></div>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">审计</h2>
      <div class="panel">${auditRows}</div>
    </section>`
}

/* ── 经验资产 ─────────────────────────────────────────── */

const XP_GROUPS = [
  { key: 'proposed', label: '待确认', hint: '反思挖出来的，还没被验证过。确认后才参与推荐。' },
  { key: 'active', label: '可用', hint: '已经在用；采纳过的会自动加分。' },
  { key: 'dormant', label: '休眠', hint: '应用后一直不奏效，已自动降权。可以归档或重新启用。' },
]

function xpRow(e) {
  const pct = Math.round((e.effectiveness || 0) * 100)
  const barColor = pct >= 65 ? 'var(--green)' : pct >= 40 ? 'var(--amber)' : 'var(--ink-3)'
  const acts = []
  if (e.status === 'proposed') acts.push(`<button class="btn btn-accent btn-sm" data-act="xp-status" data-id="${esc(e.id)}" data-status="active">确认</button>`)
  if (e.status === 'active') {
    acts.push(`<button class="btn btn-ghost btn-sm" data-act="xp-apply" data-id="${esc(e.id)}" data-outcome="worked">用上了</button>`)
    acts.push(`<button class="btn btn-ghost btn-sm" data-act="xp-apply" data-id="${esc(e.id)}" data-outcome="failed">没成</button>`)
    acts.push(`<button class="btn btn-ghost btn-sm" data-act="xp-status" data-id="${esc(e.id)}" data-status="dormant">搁置</button>`)
  }
  if (e.status === 'dormant') {
    acts.push(`<button class="btn btn-ghost btn-sm" data-act="xp-status" data-id="${esc(e.id)}" data-status="active">启用</button>`)
    acts.push(`<button class="btn btn-ghost btn-sm" data-act="xp-status" data-id="${esc(e.id)}" data-status="archived">归档</button>`)
  }
  return `
    <div class="xp-item">
      <div class="xp-rule">${esc(e.rule)}</div>
      <div class="xp-meta">
        <span>${esc(e.flow)}</span>
        ${e.solidified ? '<span class="xp-badge">已固化</span>' : ''}
        <span class="xp-src">${esc(e.source === 'reflect' ? '反思产出' : e.source === 'manual' ? '手写' : e.source === 'seed' ? '示例' : e.source)}</span>
      </div>
      <div class="xp-bar"><span class="xp-fill" style="width:${pct}%;background:${barColor}"></span></div>
      <div class="xp-foot">
        <span class="xp-pct" style="color:${barColor}">有效性 ${pct}%</span>
        <span class="xp-acts">${acts.join('')}</span>
      </div>
    </div>`
}

function viewAssets() {
  const a = state.assets
  const list = state.experiences || []
  if (!a) return `${masthead('<b>经验</b><br>资产')}<div class="empty">正在算…</div>`

  const groups = XP_GROUPS.map(g => {
    const rows = list.filter(e => e.status === g.key)
    if (!rows.length) return ''
    return `
      <section class="section">
        <h2 class="section-title">${g.label} <span class="xp-count">${rows.length}</span></h2>
        <div class="section-note" style="margin:-4px 0 10px">${g.hint}</div>
        <div class="panel">${rows.map(xpRow).join('')}</div>
      </section>`
  }).join('')

  const next = a.nextAction || {}
  const c = a.criteria || {}
  const t = c.thresholds || {}

  return `
    ${masthead(`<b>${a.total}</b> 条经验<br>其中 ${a.solidified} 条固化`)}
    <section class="section">
      <div class="panel xp-summary">
        <div class="xp-cell"><b>${a.active}</b><span>可用</span></div>
        <div class="xp-cell"><b>${a.appliedTotal}</b><span>被调用</span></div>
        <div class="xp-cell"><b>${a.hitRate == null ? '—' : Math.round(a.hitRate * 100) + '%'}</b><span>奏效率</span></div>
        <div class="xp-cell"><b>${a.avgEffectiveness == null ? '—' : Math.round(a.avgEffectiveness * 100) + '%'}</b><span>平均有效性</span></div>
      </div>
      <div class="section-note" style="margin:10px 0 0">
        近 7 天新增 ${a.growth.last7} 条，近 30 天 ${a.growth.last30} 条。
        评估标准 v${c.version}，${c.confirmedBy === 'user' ? '你确认过' : '用的是默认口径'}。
      </div>
    </section>

    <section class="section">
      <div class="notice">
        <b>下一步</b>：${esc(next.text || '继续记录')}
        <div class="btn-row" style="margin-top:10px">
          <button class="btn btn-accent btn-sm" data-act="reflect">立即提炼</button>
        </div>
      </div>
    </section>

    ${groups || '<section class="section"><div class="panel"><div class="empty">还没有经验。先记几条做过的事，攒够两次同类事件就会自动提炼。</div></div></section>'}

    <section class="section">
      <h2 class="section-title">什么算「有效」</h2>
      <div class="panel">
        <div class="section-note" style="margin:0 0 12px">
          这一层不归 Agent 管。它可以自己调整每条经验的分数（单环），
          但「多少分算有效、几次应用才够升级」必须由你定（双环）。
        </div>
        <div class="xp-crit">
          <label>高于<input type="number" id="crit-promote" min="30" max="99" value="${Math.round((t.promote || 0.72) * 100)}" />分固化为技能</label>
          <label>低于<input type="number" id="crit-archive" min="5" max="90" value="${Math.round((t.archive || 0.25) * 100)}" />分进入休眠</label>
          <label>至少用够<input type="number" id="crit-samples" min="1" max="50" value="${t.minSamples || 3}" />次才升降级</label>
        </div>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn" data-act="save-criteria">确认修改</button>
        </div>
      </div>
    </section>`
}

/* ── 渲染与事件 ───────────────────────────────────────── */

function route() {
  const hash = (location.hash || '#/home').replace('#/', '')
  return ['home', 'ask', 'assets', 'archive', 'grant'].includes(hash) ? hash : 'home'
}

async function render() {
  const tab = route()
  document.querySelectorAll('.tab').forEach(a => {
    a.classList.toggle('is-active', a.dataset.tab === tab)
  })

  const app = document.getElementById('app')
  if (tab === 'home') app.innerHTML = viewHome()
  else if (tab === 'ask') app.innerHTML = viewAsk()
  else if (tab === 'assets') app.innerHTML = viewAssets()
  else if (tab === 'archive') app.innerHTML = viewArchive()
  else app.innerHTML = viewGrant()

  if (tab === 'ask') {
    const ta = document.getElementById('ask-input')
    if (ta && state.draft) ta.value = state.draft
  }
}

async function loadCommon() {
  if (!state.meta) state.meta = await api('/api/meta')
  if (!state.ganzhi) state.ganzhi = await api(`/api/persons/${PERSON}/ganzhi`)
  if (!state.silicon) {
    const r = await api(`/api/persons/${PERSON}/silicon`)
    const s = r.silicon
    state.silicon = {
      completeness: s.completeness,
      factCount: s.facts.length,
      memoryCount: s.traits.recordCount,
    }
  }
  if (!state.quiz) state.quiz = await api(`/api/persons/${PERSON}/quiz`)
}

async function loadTab(tab) {
  if (tab === 'home') return loadCommon()
  if (tab === 'assets') {
    const [assets, exps] = await Promise.all([
      api(`/api/persons/${PERSON}/experiences/assets`),
      api(`/api/persons/${PERSON}/experiences`),
    ])
    state.assets = assets.assets
    state.engine = assets.engine
    state.experiences = exps.experiences
    return
  }
  if (tab === 'archive') {
    state.profile = await api(`/api/persons/${PERSON}/profile`)
    return
  }
  if (tab === 'grant') {
    state.grants = await api(`/api/persons/${PERSON}/grants`)
    return
  }
}

async function refresh(tab) {
  try {
    await loadTab(tab)
    await render()
  } catch (err) {
    toast(err.message)
  }
}

/* ── 动作 ─────────────────────────────────────────────── */

const actions = {
  'go-quiz': () => { location.hash = '#/home' },

  'quick-ask': el => {
    const text = el.dataset.text
    state.draft = text
    location.hash = '#/ask'
    setTimeout(() => {
      const ta = document.getElementById('ask-input')
      if (ta) { ta.value = text; ta.focus() }
      actions.ask()
    }, 60)
  },

  ask: async () => {
    const ta = document.getElementById('ask-input')
    const text = (ta?.value || '').trim()
    if (!text) return toast('先说一句')
    state.draft = text
    state.loading = true
    await render()
    try {
      state.result = await api(`/api/persons/${PERSON}/orchestrate`, { method: 'POST', body: { text } })
      state.silicon = null
      state.quiz = null
    } catch (err) {
      toast(err.message)
    } finally {
      state.loading = false
      await render()
    }
  },

  reflect: async () => {
    try {
      const r = await api(`/api/persons/${PERSON}/experiences/reflect`, { method: 'POST', body: {} })
      if (!r.candidates?.length) {
        toast(r.note || `事件还不够（当前 ${r.events} 条），先多记几次`, 3000)
      } else {
        toast(`提炼 ${r.created} 条新经验，更新 ${r.updated} 条`, 3000)
      }
      await loadTab('assets')
      await render()
    } catch (err) {
      toast(err.message)
    }
  },

  'xp-status': async el => {
    try {
      await api(`/api/persons/${PERSON}/experiences/${el.dataset.id}/status`, {
        method: 'POST',
        body: { status: el.dataset.status },
      })
      await loadTab('assets')
      await render()
    } catch (err) {
      toast(err.message)
    }
  },

  'xp-apply': async el => {
    try {
      const r = await api(`/api/persons/${PERSON}/experiences/${el.dataset.id}/apply`, {
        method: 'POST',
        body: { outcome: el.dataset.outcome },
      })
      toast(`有效性 ${Math.round(r.before * 100)}% → ${Math.round(r.after * 100)}%，${r.statusChanged ? '状态已更新' : '继续观察'}`, 3000)
      await loadTab('assets')
      await render()
    } catch (err) {
      toast(err.message)
    }
  },

  'save-criteria': async () => {
    const promote = Number(document.getElementById('crit-promote')?.value) / 100
    const archive = Number(document.getElementById('crit-archive')?.value) / 100
    const minSamples = Number(document.getElementById('crit-samples')?.value)
    try {
      // confirm:true 是双环的口子，前端必须显式带上，后端也强制校验
      const r = await api(`/api/persons/${PERSON}/criteria`, {
        method: 'POST',
        body: { confirm: true, thresholds: { promote, archive, minSamples } },
      })
      toast(`已按你的口径更新（v${r.criteria.version}）`, 2600)
      await loadTab('assets')
      await render()
    } catch (err) {
      toast(err.message)
    }
  },

  'toggle-trace': async () => {
    state.traceOpen = !state.traceOpen
    await render()
  },

  'quiz-answer': async el => {
    try {
      const r = await api(`/api/persons/${PERSON}/quiz`, {
        method: 'POST',
        body: { questionId: el.dataset.q, optionKey: el.dataset.o },
      })
      state.quiz = { progress: r.progress, questions: [] }
      state.silicon = null
      const changed = r.factChanges.map(f => f.label).join('、')
      toast(`${r.quip}${changed ? `（记下了：${changed}）` : ''}`, 3200)
      await loadCommon()
      await render()
    } catch (err) {
      toast(err.message)
    }
  },

  'redact-preview': async () => {
    const text = (document.getElementById('redact-input')?.value || '').trim()
    if (!text) return toast('先说一句')
    try {
      const r = await api(`/api/persons/${PERSON}/redact/preview`, { method: 'POST', body: { text } })
      document.getElementById('redact-out').innerHTML = `
        <div class="fact-k">入库后长这样</div>
        <div style="font-size:13.5px;margin:4px 0 8px">${highlightTokens(esc(r.redacted))}</div>
        <div class="fact-k">抹掉 ${r.tokenCount} 处：${r.hits.map(h => `${h.label}×${h.count}`).join('、') || '无'}</div>`
    } catch (err) {
      toast(err.message)
    }
  },

  issue: async () => {
    const scopes = [...document.querySelectorAll('input[name="scope"]:checked')].map(i => i.value)
    if (!scopes.length) return toast('至少选一项权限')
    const purpose = (document.getElementById('grant-purpose')?.value || '').trim() || '未说明用途'
    await issueGrant(scopes, purpose)
  },

  'issue-preset': async el => {
    const scopes = el.dataset.scopes.split(',')
    document.querySelectorAll('input[name="scope"]').forEach(i => {
      i.checked = scopes.includes(i.value)
    })
    await issueGrant(scopes, scopes.includes('export') ? '导出档案' : '读取人格 prompt')
  },

  revoke: async el => {
    try {
      await api(`/api/persons/${PERSON}/grants/${el.dataset.id}/revoke`, { method: 'POST' })
      toast('已撤销')
      await refresh('grant')
    } catch (err) {
      toast(err.message)
    }
  },

  export: async el => {
    const depth = el.dataset.depth
    const token = state.tokens.export
    if (!token) return toast('先在下面签一张含「导出」的票')
    try {
      const scopes = depth === 'sealed' ? ['export', 'raw'] : ['export']
      const archive = await api(`/api/persons/${PERSON}/export`, {
        method: 'POST',
        token,
        body: { scopes },
      })
      const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `qijuzhu-${new Date().toISOString().slice(0, 10)}-${archive.depth}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      document.getElementById('export-out').innerHTML = `
        <div class="grant-row"><span class="grant-key">已导出</span><span>${esc(archive.depth)} · ${(archive.payload.episodes || []).length} 条记忆</span></div>
        <div class="grant-row"><span class="grant-key">checksum</span><span class="mono">${esc(archive.checksum.slice(0, 24))}…</span></div>`
      toast('已下载')
      await refresh('grant')
    } catch (err) {
      toast(err.message)
    }
  },

  'read-prompt': async () => {
    const token = state.tokens.prompt
    if (!token) return toast('先从上面签一张含「读取 prompt」的票')
    try {
      const r = await api(`/api/persons/${PERSON}/prompt`, { token })
      document.getElementById('export-out').innerHTML = `
        <div class="grant-row"><span class="grant-key">prompt</span><span>${r.summary.chars} 字 · 约 ${r.summary.approxTokens} tokens</span></div>
        <pre class="prompt">${esc(r.prompt)}</pre>`
      await refresh('grant')
    } catch (err) {
      toast(err.message)
    }
  },
}

async function issueGrant(scopes, purpose) {
  try {
    const r = await api(`/api/persons/${PERSON}/grants`, {
      method: 'POST',
      body: { scopes, purpose, ttlSec: 900, maxUses: 3 },
    })
    for (const s of scopes) state.tokens[s] = r.token
    if (scopes.includes('export')) state.tokens.export = r.token
    saveTokens()

    document.getElementById('issue-out').innerHTML = `
      <div class="token-box">${esc(r.token)}</div>
      <div class="section-note" style="margin:0">
        这张票只显示这一次，15 分钟内有效、最多用 3 次。已自动填进本页按钮，也可以复制走。
      </div>`
    toast('票据已签发')
    await refresh('grant')
  } catch (err) {
    toast(err.message)
  }
}

/* 导入 */
document.addEventListener('change', async e => {
  if (e.target.id !== 'import-file') return
  const file = e.target.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const archive = JSON.parse(text)
    const r = await api('/api/import', { method: 'POST', body: { archive, name: '从文件恢复的档案' } })
    document.getElementById('import-out').innerHTML = `
      <div class="grant-row"><span class="grant-key">已恢复</span><span>${esc(r.person.name)} · ${r.factCount} 条事实 · ${r.episodeCount} 条记忆</span></div>
      <div class="section-note" style="margin:6px 0 0">新档案 id：<span class="mono">${esc(r.person.id)}</span></div>`
    toast('恢复完成')
  } catch (err) {
    toast(`恢复失败：${err.message}`)
  }
})

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]')
  if (!el) return
  const fn = actions[el.dataset.act]
  if (!fn) return
  e.preventDefault()
  await fn(el)
})

window.addEventListener('hashchange', async () => {
  await refresh(route())
})

/* 启动 */
;(async function boot() {
  try {
    await loadTab(route())
    await render()
    await loadCommon()
    await render()
  } catch (err) {
    document.getElementById('app').innerHTML =
      `<div class="empty">连不上服务：${esc(err.message)}<br><br>确认后端已启动（默认 8787），且访问地址与 API 同源。</div>`
  }
})()
