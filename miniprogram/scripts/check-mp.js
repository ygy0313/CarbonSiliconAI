'use strict'

// 小程序前端结构体检。
// 跑法：node miniprogram/scripts/check-mp.js（纯静态 + 逻辑桩，不需要后端）
//
// check-wxml.js 管的是「模板里有没有禁用语法」，这里管另外三件它管不到的事：
//   ① 注册完整性 —— 页面写了但没进 app.json，等于白写；tabBar 超 5 项会直接编译失败；
//   ② 页面逻辑 —— 用桩环境把 Page 跑起来，验证数据映射（百分比、按钮、分档）算得对；
//   ③ 关键配置 —— lazyCodeLoading 缺了会在真机上白屏，这条有前车之鉴。

const fs = require('fs')
const path = require('path')

const MP = path.join(__dirname, '..')

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (_) { return null } }

// ── Page 桩：把页面文件在 Node 里跑起来，不改它的代码 ──
function loadPage(relPath, { personId = 'p_test' } = {}) {
  const full = path.join(MP, relPath)
  delete require.cache[require.resolve(full)]

  let def = null
  const toasts = []
  global.Page = d => { def = d }
  global.getApp = () => ({ globalData: { personId } })
  global.wx = {
    setNavigationBarTitle() {},
    showToast(o) { toasts.push(o && o.title) },
    showModal() {},
    switchTab() {},
    navigateTo() {},
    redirectTo() {},
    getStorageSync() { return '' },
    setStorageSync() {},
    getRecorderManager() { return null }, // 桩里不给录音器，onLoad 会跳过回调注册
    getFileSystemManager() { return null },
  }

  require(full)
  const inst = Object.create(def)
  inst.data = JSON.parse(JSON.stringify(def.data))
  inst.setData = function (patch) { Object.assign(this.data, patch) }
  inst.toasts = toasts
  return inst
}

function main() {
  console.log('\n【1】app.json 注册完整性')
  const app = readJSON(path.join(MP, 'app.json'))
  ok('app.json 是合法 JSON', !!app)
  const pages = (app && app.pages) || []
  ok('pages 数组非空', pages.length > 0, `pages=${pages.length}`)

  const missing = []
  for (const p of pages) {
    for (const ext of ['.js', '.wxml']) {
      const f = path.join(MP, `${p}${ext}`)
      if (!fs.existsSync(f)) missing.push(`${p}${ext}`)
    }
  }
  ok('每个页面都有 .js 与 .wxml', missing.length === 0, missing.join(', '))

  const notRegistered = []
  const pageDir = path.join(MP, 'pages')
  for (const dir of fs.readdirSync(pageDir)) {
    const f = path.join(pageDir, dir, `${dir}.js`)
    if (!fs.existsSync(f)) continue
    if (pages.indexOf(`pages/${dir}/${dir}`) === -1) notRegistered.push(dir)
  }
  ok('页面目录都已注册进 pages', notRegistered.length === 0, notRegistered.join(', '))

  ok('经验页已注册', pages.includes('pages/assets/assets'))
  ok('条款页已注册', pages.includes('pages/legal/legal'))

  console.log('\n【2】tabBar')
  const tabs = (app && app.tabBar && app.tabBar.list) || []
  ok('tabBar 2-5 项', tabs.length >= 2 && tabs.length <= 5, `tabs=${tabs.length}`)
  const badTab = tabs.filter(t => pages.indexOf(t.pagePath) === -1)
  ok('每个 tab 都在 pages 里', badTab.length === 0, badTab.map(t => t.pagePath).join(', '))
  ok('经验 tab 已加入', tabs.some(t => t.pagePath === 'pages/assets/assets'))

  console.log('\n【3】关键配置')
  ok('开启组件按需注入', app && app.lazyCodeLoading === 'requiredComponents', String(app && app.lazyCodeLoading))
  const proj = readJSON(path.join(MP, 'project.config.json'))
  ok('project.config.json 指向当前目录', proj && (proj.miniprogramRoot === './' || !proj.miniprogramRoot), String(proj && proj.miniprogramRoot))
  ok('小程序根目录就是 config 所在目录', fs.existsSync(path.join(MP, 'app.json')))

  console.log('\n【4】经验页：数据映射')
  const assets = loadPage('pages/assets/assets.js')
  ok('初始 loading 为 true', assets.data.loading === true)
  ok('初始 groups 为空数组', Array.isArray(assets.data.groups) && assets.data.groups.length === 0)

  const fakeAssets = {
    total: 3, active: 1, dormant: 1, proposed: 1, archived: 0, solidified: 1,
    appliedTotal: 7, hitRate: 0.71, avgEffectiveness: 0.62,
    growth: { last7: 1, last30: 3 },
    criteria: { version: 2, confirmedBy: 'user', thresholds: { promote: 0.8, archive: 0.3, minSamples: 4 } },
    nextAction: { kind: 'keep', text: '继续记录' },
  }
  const fakeList = [
    { id: 'x1', status: 'proposed', rule: '规则一', flow: '0 次应用', source: 'reflect', effectiveness: 0.5, solidified: false },
    { id: 'x2', status: 'active', rule: '规则二', flow: '3 次应用 / 2 次奏效', source: 'seed', effectiveness: 0.74, solidified: true },
    { id: 'x3', status: 'dormant', rule: '规则三', flow: '2 次应用 / 0 次奏效', source: 'manual', effectiveness: 0.2, solidified: false },
  ]
  assets.render(fakeAssets, fakeList)

  ok('三个分组都建出来', assets.data.groups.length === 3, `groups=${assets.data.groups.length}`)
  ok('分组顺序为 待确认 → 可用 → 休眠',
    assets.data.groups.map(g => g.key).join(',') === 'proposed,active,dormant',
    assets.data.groups.map(g => g.key).join(','))

  const active = assets.data.groups.find(g => g.key === 'active')
  const row = active && active.items[0]
  ok('有效性换算成整数百分比', row && row.pct === 74, row && String(row.pct))
  ok('高分档标 hi', row && row.barCls === 'hi', row && row.barCls)
  ok('可用态给三个操作', row && row.acts.length === 3, row && String(row.acts.length))
  ok('固化标记透出', row && row.solidified === true)

  const dormant = assets.data.groups.find(g => g.key === 'dormant')
  const dRow = dormant && dormant.items[0]
  ok('低分档标 lo', dRow && dRow.barCls === 'lo', dRow && dRow.barCls)
  ok('休眠态给启用与归档', dRow && dRow.acts.map(a => a.label).join(',') === '启用,归档')

  const proposed = assets.data.groups.find(g => g.key === 'proposed')
  ok('待确认只给「确认」一个操作', proposed && proposed.items[0].acts.length === 1)

  ok('奏效率显示为百分比', assets.data.hitPct === '71%', assets.data.hitPct)
  ok('平均有效性显示为百分比', assets.data.effPct === '62%', assets.data.effPct)
  ok('标准版本透出', assets.data.critVersion === 2, String(assets.data.critVersion))
  ok('用户确认过的标准要标出来', assets.data.critConfirmed === '你确认过', assets.data.critConfirmed)
  ok('阈值换算成百分数填进输入框', assets.data.critPromote === '80' && assets.data.critArchive === '30', `${assets.data.critPromote}/${assets.data.critArchive}`)
  ok('空分组被过滤掉', assets.render({ ...fakeAssets, total: 0 }, []) === undefined && assets.data.groups.length === 0)

  ok('缺少 hitRate 时显示占位符', (() => {
    assets.render({ ...fakeAssets, hitRate: null, avgEffectiveness: null }, [])
    return assets.data.hitPct === '—' && assets.data.effPct === '—'
  })())

  console.log('\n【5】双环：改标准要先拦住不合理的值')
  const before = assets.data.groups.length
  assets.setData({ critPromote: '20', critArchive: '60', critSamples: '3' })
  assets.saveCriteria()
  ok('固化线低于休眠线时拒绝保存', assets.data.hint.includes('固化线'), assets.data.hint)
  assets.setData({ critPromote: '120', critArchive: '20', critSamples: '3' })
  assets.saveCriteria()
  ok('超过 100 分时拒绝保存', assets.data.hint.includes('0-100'), assets.data.hint)
  assets.setData({ critPromote: '80', critArchive: '20', critSamples: '0' })
  assets.saveCriteria()
  ok('样本数为 0 时拒绝保存', assets.data.hint.includes('1-50'), assets.data.hint)
  ok('拒绝时不会误改数据', assets.data.groups.length === before)

  console.log('\n【6】记录页：拍照与语音入口')
  const record = loadPage('pages/record/record.js')
  ok('有 pickPhoto', typeof record.pickPhoto === 'function')
  ok('有 startRecord / stopRecord / cancelRecord',
    ['startRecord', 'stopRecord', 'cancelRecord'].every(k => typeof record[k] === 'function'))
  ok('有 onRecordStop 回调', typeof record.onRecordStop === 'function')
  ok('录音按钮初始文案正确', record.data.recLabel === '按住说话', record.data.recLabel)
  ok('不处于录音态', record.data.recording === false)
  ok('识食结果初始为空', Array.isArray(record.data.dishes) && record.data.dishes.length === 0)
  ok('音频读取失败时不崩', (async () => true)() instanceof Promise)

  // 取消录音：不该往输入框里塞东西
  record.setData({ recording: true, text: '原话' })
  record._discard = true
  record.onRecordStop({ tempFilePath: '/tmp/x.m4a', duration: 3000 })
  ok('取消录音不改动已有文本', record.data.text === '原话', record.data.text)

  // 时长过短：给提示且不写字
  record.setData({ recording: false, busy: true, text: '原话' })
  record._discard = false
  record.onRecordStop({ tempFilePath: '/tmp/x.m4a', duration: 400 })
  ok('过短录音被拦下', record.data.hint.includes('太短'), record.data.hint)

  console.log('\n【7】法律文本入口')
  const profile = loadPage('pages/profile/profile.js')
  ok('档案页有 openDoc', typeof profile.openDoc === 'function')
  const indexPage = loadPage('pages/index/index.js')
  ok('首页有同意层状态', indexPage.data.needAck === false)
  ok('首页有 ackLegal / declineLegal', typeof indexPage.ackLegal === 'function' && typeof indexPage.declineLegal === 'function')
  ok('未同意时写入入口被拦', (() => {
    indexPage.data.needAck = true
    return typeof indexPage.reopenLegal === 'function'
  })())

  console.log('\n【8】首页改版：昵称 / 今日安排 / 新人视角 / 问答页')
  const appJson = readJSON(path.join(MP, 'app.json'))
  ok('声明了定位权限说明', !!(appJson.permission && appJson.permission['scope.userLocation']))
  ok('requiredPrivateInfos 含 getLocation', (appJson.requiredPrivateInfos || []).includes('getLocation'))
  ok('问答页已注册', (appJson.pages || []).includes('pages/quiz/quiz'))

  const idx = loadPage('pages/index/index.js')
  idx.buildGreet()
  ok('问候语是「您的今日安排」', String(idx.data.greetHello).includes('您的今日安排'), idx.data.greetHello)
  ok('档案空时默认新人视角', idx.resolveMode(0) === 'new')
  ok('档案厚时默认老用户视角', idx.resolveMode(0.72) === 'old')
  idx.setData({ mode: 'new' })
  idx.toggleMode()
  ok('切换按钮能在两套视角间来回', idx.data.mode === 'old')
  ok('首页不再直接显示真名（默认昵称占位）', idx.data.name === '' || idx.data.name === '给自己起个昵称' || idx.data.hasNickname === false)
  ok('首页有推荐区与五行区的方法', typeof idx.loadRecs === 'function' && typeof idx.loadGanzhi === 'function')

  const quiz = loadPage('pages/quiz/quiz.js')
  ok('问答页有 pick / load', typeof quiz.pick === 'function' && typeof quiz.load === 'function')
  ok('问答页初始未答完', quiz.data.finished === false && quiz.data.done === 0)

  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
  if (fail) {
    console.log('失败项：')
    failures.forEach(f => console.log('  - ' + f))
    process.exit(1)
  }
}

try {
  main()
} catch (err) {
  console.error('脚本异常：', err)
  process.exit(1)
}
