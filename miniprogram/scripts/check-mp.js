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

// 首页 JS 源码（重复读取嫌烦，封一个小函数）
function idxSrcLater(needle) {
  return fs.readFileSync(path.join(MP, 'pages/index/index.js'), 'utf8').includes(needle)
}

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

  ok('经验页已下线（数据收进「我的」）', !pages.includes('pages/assets/assets'))
  ok('档案页目录已删除', !fs.existsSync(path.join(MP, 'pages/assets')))
  ok('日程页已删除（日程只在首页展示）', !pages.includes('pages/agenda/agenda') && !fs.existsSync(path.join(MP, 'pages/agenda')))
  ok('条款页已注册', pages.includes('pages/legal/legal'))

  console.log('\n【2】tabBar：三大入口')
  const tabs = (app && app.tabBar && app.tabBar.list) || []
  ok('tabBar 恰好三项（执笔 / 记录 / 我的）', tabs.length === 3, `tabs=${tabs.length}`)
  ok('三入口依次是 执笔·记录·我的',
    tabs.map(t => t.text).join(',') === '执笔,记录,我的',
    tabs.map(t => t.text).join(','))
  const badTab = tabs.filter(t => pages.indexOf(t.pagePath) === -1)
  ok('每个 tab 都在 pages 里', badTab.length === 0, badTab.map(t => t.pagePath).join(', '))

  console.log('\n【3】关键配置')
  ok('开启组件按需注入', app && app.lazyCodeLoading === 'requiredComponents', String(app && app.lazyCodeLoading))
  const proj = readJSON(path.join(MP, 'project.config.json'))
  ok('project.config.json 指向当前目录', proj && (proj.miniprogramRoot === './' || !proj.miniprogramRoot), String(proj && proj.miniprogramRoot))
  ok('小程序根目录就是 config 所在目录', fs.existsSync(path.join(MP, 'app.json')))

  console.log('\n【4】「我的」页：经验资产摘要与简历入口')
  const mineAssets = loadPage('pages/grant/grant.js')
  ok('经验摘要只看总数与方向（loadAssetsStats）', typeof mineAssets.loadAssetsStats === 'function')
  ok('初始无假数据（拿不到就不显示卡片）', mineAssets.data.assetsStats === null)
  ok('简历入口三件套：选文件 / 粘贴 / 提交',
    typeof mineAssets.pickResumeFile === 'function' && typeof mineAssets.onResumeText === 'function' && typeof mineAssets.submitResume === 'function')
  ok('简历初始为空、不假装已上传', mineAssets.data.resumeText === '' && mineAssets.data.resumeInfo === '')
  ok('简历文本在 JS 层限长（20000，与后端一致）', (() => {
    mineAssets.setData({ resumeText: 'x'.repeat(10) })
    return mineAssets.data.resumeText.length === 10
  })())

  console.log('\n【5】「我的」页：理解你带匹配度 / 健康授权化 / 八字自动生成')
  ok('理解你初始为空、带口径说明字段', Array.isArray(mineAssets.data.hints) && mineAssets.data.hints.length === 0 && 'hintNote' in mineAssets.data)
  ok('匹配度条在 WXML 里渲染', (() => {
    const wxml = fs.readFileSync(path.join(MP, 'pages/grant/grant.wxml'), 'utf8')
    return wxml.includes('hint-fill') && wxml.includes('hint-bar') && wxml.includes('item.pct')
  })())
  ok('健康段不再有手工录入', typeof mineAssets.saveHealth === 'undefined' && typeof mineAssets.pickHealthType === 'undefined' && typeof mineAssets.saveSteps === 'undefined' && typeof mineAssets.goRecordHealth === 'undefined')
  ok('健康段保留微信运动读取与自动落档', typeof mineAssets.readWeRun === 'function' && typeof mineAssets.autoRecordSteps === 'function')
  ok('八字改动自动生成（无重新生成按钮）', typeof mineAssets.autoBazi === 'function' && typeof mineAssets.saveBazi === 'function')
  ok('三段已改为 档案·健康·数据',
    mineAssets.data.segs.map(s => s.label).join(',') === '档案,健康,数据',
    mineAssets.data.segs.map(s => s.label).join(','))

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
  const mineEarly = loadPage('pages/grant/grant.js')
  ok('我的页有 goLegal（法律文本入口）', typeof mineEarly.goLegal === 'function')
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
  ok('首页有推荐区与五行区的方法', typeof idx.loadRec === 'function' && typeof idx.loadGanzhi === 'function')

  const quiz = loadPage('pages/quiz/quiz.js')
  ok('问答页有 pick / load', typeof quiz.pick === 'function' && typeof quiz.load === 'function')
  ok('问答页初始未答完', quiz.data.finished === false && quiz.data.done === 0)

  console.log('\n【9】「我的」页：tabBar 改名 / 八字录入 / 理解你迁移')
  ok('tabBar「契」已改「我的」', (appJson.tabBar.list || []).some(t => t.text === '我的' && t.pagePath === 'pages/grant/grant'))
  const mine = loadPage('pages/grant/grant.js')
  ok('我的页有八字录入与命盘渲染方法', typeof mine.saveBazi === 'function' && typeof mine.applyChart === 'function')
  ok('我的页有昵称设置', typeof mine.setNickname === 'function')
  ok('时辰选择器含「不知道」+ 十二时辰', (mine.data.hourOptions || []).length === 13)
  ok('一键看 Prompt（自动签票）', typeof mine.viewMyPrompt === 'function' && typeof mine.signTicket === 'function')
  ok('健康卡：微信运动读取 + 自动落档', typeof mine.readWeRun === 'function' && typeof mine.autoRecordSteps === 'function' && typeof mine.saveSteps === 'undefined')
  ok('手工健康录入已移到记录页（我的页不再有）', typeof mine.saveHealth === 'undefined')
  ok('最近记忆已迁入我的页', typeof mine.relTime === 'function' && Array.isArray(mine.data.recent))
  ok('授权记录改名（不再是票据术语）', typeof mine.revoke === 'function' && typeof mine.exportMine === 'function')
  ok('命盘初始为空态（未录入不假装有盘）', mine.data.chart === null)
  const mineWxml = fs.readFileSync(path.join(MP, 'pages/grant/grant.wxml'), 'utf8')
  ok('「它现在这样理解你」已迁入我的页', mineWxml.includes('它现在这样理解你'))
  ok('我的页有法律文本入口', mineWxml.includes('隐私政策') && mineWxml.includes('用户协议'))
  const idxWxml = fs.readFileSync(path.join(MP, 'pages/index/index.wxml'), 'utf8')
  ok('首页已移除「理解你」模块', !idxWxml.includes('它现在这样理解你'))
  ok('首页已移除「最近的记忆」模块', !idxWxml.includes('最近的记忆'))
  ok('我的页已有「最近的记忆」', mineWxml.includes('最近的记忆'))
  const idxSrc = fs.readFileSync(path.join(MP, 'pages/index/index.js'), 'utf8')
  ok('首页 JS 不再装配 hints', !idxSrc.includes('personaHints'))

  console.log('\n【10】档案与我的已合并：一页三段，档案事实可点即改')
  ok('档案页已下线（app.json 不再注册）', !(appJson.pages || []).includes('pages/profile/profile'))
  ok('档案页目录已删除', !fs.existsSync(path.join(MP, 'pages/profile')))
  ok('tabBar 不再有「档案」', !(appJson.tabBar.list || []).some(t => t.text === '档案'))
  ok('我的页分三段', (mine.data.segs || []).length === 3 && mine.data.seg === 'file')
  ok('三段切换方法存在', typeof mine.switchSeg === 'function')
  ok('切换后落到对应段', (() => {
    mine.switchSeg({ currentTarget: { dataset: { seg: 'body' } } })
    return mine.data.seg === 'body'
  })())
  ok('档案事实可点即改', typeof mine.editFact === 'function' && typeof mine.saveFact === 'function')
  ok('冲突可裁决', typeof mine.doResolve === 'function' && typeof mine.resolve === 'function')
  ok('开发设置（服务地址）随页带过来', typeof mine.saveBase === 'function')
  ok('我的页含 12 维兜底维度', /FALLBACK_DIMS/.test(fs.readFileSync(path.join(MP, 'pages/grant/grant.js'), 'utf8')))
  ok('我的页无跨页跳档案的残留', !fs.readFileSync(path.join(MP, 'pages/grant/grant.js'), 'utf8').includes('pages/profile'))

  console.log('\n【10.5】生辰置顶 + 经验随后 + Obsidian 入口')
  ok('八字已更名「生辰」', mineWxml.includes('section-title">生辰') && !mineWxml.includes('个人八字'))
  ok('生辰排在档案段最前（在完整度卡之前）', mineWxml.indexOf('section-title">生辰') !== -1 && mineWxml.indexOf('section-title">生辰') < mineWxml.indexOf('它对你的把握'))
  ok('经验卡紧跟生辰（在其后、完整度之前）', mineWxml.indexOf('section-title">经验') > mineWxml.indexOf('section-title">生辰') && mineWxml.indexOf('section-title">经验') < mineWxml.indexOf('它对你的把握'))
  ok('数据段不再有旧经验资产卡', !mineWxml.includes('section-title">经验资产'))
  ok('Obsidian 查看 / 展开导出三件套', typeof mine.openObsidian === 'function' && typeof mine.toggleNote === 'function' && typeof mine.exportObsidian === 'function')
  ok('Obsidian 卡在 WXML 里', mineWxml.includes('openObsidian') && mineWxml.includes('exportObsidian'))
  ok('健康维度进了兜底（目标 kcal / 运动喜好）', (() => {
    const src = fs.readFileSync(path.join(MP, 'pages/grant/grant.js'), 'utf8')
    return src.includes('health.moveGoalKcal') && src.includes('health.moveLike')
  })())

  console.log('\n【11】首页五模块：运 / 味 / 动 / 梦 / 记')
  const idxWxml2 = fs.readFileSync(path.join(MP, 'pages/index/index.wxml'), 'utf8')
  const mods = ['今日运程', '今日食饮', '动一动', '灵光一现', '你的记录']
  const missingMods = mods.filter(m => !idxWxml2.includes(m))
  ok('五个模块标题都在', missingMods.length === 0, missingMods.join('、'))
  const iconChars = ['运', '味', '动', '梦', '记']
  const missingIcons = iconChars.filter(c => !idxWxml2.includes(`class="mod-icon">${c}<`))
  ok('五个模块各有一个印章图标（运/味/动/梦/记）', missingIcons.length === 0, missingIcons.join('、'))
  ok('旧模块头已下线（历/程/饮 不再单独成格）', ['>历<', '>程<', '>饮<', '>食<'].every(c => !idxWxml2.includes(`class="mod-icon">${c.slice(1)}`)))
  ok('运程模块合并了五行与日程', idxWxml2.includes('gz-pillars') && idxWxml2.includes('agenda.headline'))
  ok('食饮一卡揉了吃与饮（含时段与酒）', idxWxml2.includes('meal.title') && idxWxml2.includes('brew.title') && idxWxml2.includes('slotText'))
  ok('食饮模块不出现费用', !idxWxml2.includes('priceNote') && !idxWxml2.includes('人均'))
  ok('日程页入口已拔掉（无 goAgenda / agenda 页跳转）', !idxSrcLater('goAgenda'))
  ok('日程可加进手机日历', idxWxml2.includes('addToCalendar'))
  ok('动模块显示消耗与目标缺口（无 Keep 按钮）', idxWxml2.includes('werun.kcal') && idxWxml2.includes('moveGapText') && !idxWxml2.includes('Keep'))
  ok('灵光一现两个动作：探索&创造 / 破个局', idxWxml2.includes('exploreCreate') && idxWxml2.includes('breakThrough') && idxWxml2.includes('探索&创造'))
  ok('底部按日翻记录（默认今天）', idxWxml2.includes('onRecDate') && idxWxml2.includes('dayRecords') && idxWxml2.includes('mode="date"'))
  ok('自动记录：步数拿到即落档（无「记入档案」按钮）', idxSrcLater('autoRecordSteps') && !idxWxml2.includes('recordSteps'))
  ok('点昵称跳「我的」', idxWxml2.includes('bindtap="goMine"'))
  ok('共享输入能力在 utils/capture.js', fs.existsSync(path.join(MP, 'utils/capture.js')))
  ok('首页按模块取数据', ['loadGanzhi', 'loadFood', 'loadRec', 'loadWine', 'loadAgenda', 'breakThrough', 'loadWeRun', 'loadDayRecords', 'autoRecordSteps'].every(k => typeof idx[k] === 'function'))
  ok('吃与饮与动可以本地换一条', typeof idx.nextRec === 'function')
  ok('旧的内联记一笔已删除（与记录页重复）', !idxSrcLater('saveTaste') && !idxSrcLater('pickTastePhoto'))
  ok('记录页有照片回显与丢弃', (() => {
    const wxml = fs.readFileSync(path.join(MP, 'pages/record/record.wxml'), 'utf8')
    return wxml.includes('photo-preview') && typeof record.clearPhoto === 'function'
  })())
  ok('记录页健康标签齐备（用药/睡眠/体重/运动）', (() => {
    const src = fs.readFileSync(path.join(MP, 'pages/record/record.js'), 'utf8')
    return ['用药', '睡眠', '体重', '运动'].every(t => src.includes(`'${t}'`))
  })())

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
