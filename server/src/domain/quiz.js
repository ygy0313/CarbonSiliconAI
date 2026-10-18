'use strict'

// 入局问答：建档不靠填表，靠聊天。
//
// 三条设计原则：
//   1) 每题只问一件事 —— 一道题采一个维度，答完立刻能看到档案长了什么；
//   2) 不正经但有信息量 —— 用外卖、香菜、已读不回这些日常场景，比「请选择你的辣度耐受」真实十倍；
//   3) 答完有回音 —— 每个选项配一句吐槽，让用户感觉是在跟人说话，不是在做问卷。
//
// 八卦题的用法：人对「评价别人」远比「描述自己」诚实，所以第 9、10 题问的是朋友。

const QUESTIONS = [
  {
    id: 'q01',
    group: '破冰',
    text: '周五晚上十点，你打开外卖软件，第一眼在找什么？',
    sub: '别想，凭手感选',
    options: [
      { key: 'a', label: '一碗热汤面', facts: { 'diet.spicy': '不吃辣', 'life.rhythm': '正常' }, quip: '十点还想喝汤的人，胃比心诚实。' },
      { key: 'b', label: '麻辣烫，加宽粉', facts: { 'diet.spicy': '重辣', 'life.rhythm': '夜猫子' }, quip: '记住这句话，明天早上你会回来找我的。' },
      { key: 'c', label: '烧烤，二十串起步', facts: { 'diet.taste': '重口', 'life.rhythm': '夜猫子' }, quip: '一个人点二十串，是一种生活态度。' },
      { key: 'd', label: '关掉 App，睡了', facts: { 'life.rhythm': '早睡早起' }, quip: '稀有物种，先给你记一笔。' },
    ],
  },
  {
    id: 'q02',
    group: '口味',
    text: '服务员问「辣度要多少」，你嘴上说的是？',
    sub: '注意是「嘴上说的」，不是心里想的',
    options: [
      { key: 'a', label: '「微辣」', facts: { 'diet.spicy': '微辣' }, quip: '微辣是成年人的体面。' },
      { key: 'b', label: '「不要辣」', facts: { 'diet.spicy': '不吃辣' }, quip: '干脆，我喜欢。' },
      { key: 'c', label: '「特辣」', facts: { 'diet.spicy': '重辣' }, quip: '好的，明天你的胃会替你说话。' },
      { key: 'd', label: '「你看着办」', facts: { 'diet.spicy': '中辣' }, quip: '把选择权交出去的人，通常最后都会后悔。' },
    ],
  },
  {
    id: 'q03',
    group: '口味',
    text: '吃完一顿火锅，第二天早上你的状态是？',
    sub: '这是全档案里最有用的一题',
    options: [
      { key: 'a', label: '神清气爽，还能再来一顿', facts: { 'diet.stomach': '正常' }, quip: '铁胃，记下了。' },
      { key: 'b', label: '嗓子冒烟，猛灌水', facts: { 'diet.stomach': '易上火' }, quip: '那以后我提前给你点个凉菜。' },
      { key: 'c', label: '肚子不太行，跑了两趟', facts: { 'diet.stomach': '偏敏感' }, quip: '这条比你自己记得准。' },
      { key: 'd', label: '其实没事，但我嘴上说有事', facts: { 'diet.stomach': '正常', 'diet.taste': '重口' }, quip: '懂了，你要的是「被劝两句」这个服务。' },
    ],
  },
  {
    id: 'q04',
    group: '口味',
    text: '香菜，你的立场是？',
    sub: '这题没有中间地带',
    options: [
      { key: 'a', label: '灵魂，越多越好', facts: { 'diet.taste': '咸鲜' }, quip: '同类。' },
      { key: 'b', label: '邪教，看见就挑出来', facts: { 'diet.avoid': '香菜' }, quip: '已加入忌口清单，以后不会有人往你碗里撒。' },
      { key: 'c', label: '无所谓，给我我就吃', facts: { 'diet.taste': '清淡' }, quip: '随和的人最好养，也最难讨好。' },
      { key: 'd', label: '我只对它出现在奶茶里这件事有意见', facts: {}, quip: '这个投诉我受理了，但目前没人管。' },
    ],
  },
  {
    id: 'q05',
    group: '口味',
    text: '你冰箱里一定有的那样东西是？',
    sub: '不是理想中的，是现在真实存在的',
    options: [
      { key: 'a', label: '鸡蛋', facts: { 'diet.taste': '清淡' }, quip: '鸡蛋是厨房里的老实人。' },
      { key: 'b', label: '辣酱，且不止一瓶', facts: { 'diet.spicy': '重辣', 'diet.taste': '重口' }, quip: '一瓶不够，说明你有自己的体系。' },
      { key: 'c', label: '酸奶或者养胃的东西', facts: { 'diet.stomach': '偏敏感' }, quip: '冰箱比体检报告诚实。' },
      { key: 'd', label: '什么都没有，我点外卖', facts: { 'diet.taste': '咸鲜' }, quip: '冰箱对你来说是个柜子。' },
    ],
  },
  {
    id: 'q06',
    group: '社交',
    text: '朋友在群里说「周末组个局吧」，你第一反应是？',
    sub: '说实话',
    options: [
      { key: 'a', label: '「我来安排」', facts: { 'social.role': '发起人' }, quip: '每个群都需要一个你，也只有一个。' },
      { key: 'b', label: '「几点、在哪、几个人」', facts: { 'social.role': '都可' }, quip: '务实派，先要参数再答应。' },
      { key: 'c', label: '「我看看有没有空」', facts: { 'social.role': '跟随者' }, quip: '翻译：我需要一个理由出门。' },
      { key: 'd', label: '已读，装没看见', facts: { 'social.role': '跟随者' }, quip: '已读不回也是回，我记你一笔。' },
    ],
  },
  {
    id: 'q07',
    group: '社交',
    text: '玩剧本杀，你通常是哪种人？',
    sub: '没玩过也行，选你最可能成为的那种',
    options: [
      { key: 'a', label: '死咬线索不放的那个', facts: { 'social.experience': '3 次以上', 'social.preference': '推理' }, quip: '桌上最烦也最有用的人。' },
      { key: 'b', label: '负责搞笑、把本带偏的那个', facts: { 'social.experience': '1-3 次', 'social.preference': '欢乐' }, quip: 'DM 又爱又恨。' },
      { key: 'c', label: '全场最可疑，但不是凶手', facts: { 'social.experience': '3 次以上', 'social.preference': '悬疑' }, quip: '天赋型选手。' },
      { key: 'd', label: '没玩过，先躺一会儿', facts: { 'social.experience': '没玩过' }, quip: '第一次都这样，我给你挑个新手本。' },
    ],
  },
  {
    id: 'q08',
    group: '社交',
    text: '一局几个人你觉得最舒服？',
    sub: '人多了吵，人少了尬',
    options: [
      { key: 'a', label: '4 个，正好一桌', facts: { 'social.groupSize': 4 }, quip: '四个人，谁也别想隐身。' },
      { key: 'b', label: '6 个，热闹但不乱', facts: { 'social.groupSize': 6 }, quip: '最稳的档位，我默认按这个排。' },
      { key: 'c', label: '8 个，越大越好', facts: { 'social.groupSize': 8 }, quip: '那你需要一个大包间。' },
      { key: 'd', label: '一个人在家最好', facts: { 'social.groupSize': 1, 'social.role': '跟随者' }, quip: '记下了。以后我给你排「一个人的局」。' },
    ],
  },
  {
    id: 'q09',
    group: '八卦',
    text: '你朋友里最夸张的那位，组局时一般干什么？',
    sub: '评价别人比描述自己准，这是心理学，不是八卦',
    options: [
      { key: 'a', label: '带三个陌生人来', facts: { 'social.preference': '欢乐' }, quip: '每局都像开盲盒。' },
      { key: 'b', label: '迟到一小时，还说路上堵', facts: { 'social.role': '发起人' }, quip: '所以你后来都自己定时间了，对吧。' },
      { key: 'c', label: '抢 DM 的活，讲得比 DM 还起劲', facts: { 'social.preference': '机制' }, quip: '这种人适合当 NPC，我记住了。' },
      { key: 'd', label: '不来，但点菜最积极', facts: { 'social.role': '都可' }, quip: '远程参与，也是一种参与。' },
    ],
  },
  {
    id: 'q10',
    group: '八卦',
    text: '你身边有没有那种「什么都能吃、从不挑」的人？',
    sub: '这题问的是你羡慕谁',
    options: [
      { key: 'a', label: '有，我羡慕他的胃', facts: { 'diet.stomach': '偏敏感' }, quip: '羡慕是身体在提醒你。' },
      { key: 'b', label: '有，但我一点也不羡慕', facts: { 'diet.taste': '重口' }, quip: '有原则的挑食，值得尊重。' },
      { key: 'c', label: '我就是那个人', facts: { 'diet.stomach': '正常', 'diet.spicy': '中辣' }, quip: '那你可得帮别人做决定了。' },
      { key: 'd', label: '我认识的人里没有这种生物', facts: {}, quip: '物以类聚，说明你圈子挺讲究。' },
    ],
  },
  {
    id: 'q11',
    group: '生活',
    text: '你一般几点睡？',
    sub: '按最近一周算',
    options: [
      { key: 'a', label: '十一点前', facts: { 'life.rhythm': '早睡早起' }, quip: '那以后晚上九点以后我不打扰你。' },
      { key: 'b', label: '十二点到一点', facts: { 'life.rhythm': '正常' }, quip: '标准现代人。' },
      { key: 'c', label: '两点以后，且经常', facts: { 'life.rhythm': '夜猫子' }, quip: '你的局我往后排半小时。' },
      { key: 'd', label: '看情况，主要看第二天有没有事', facts: { 'life.rhythm': '正常' }, quip: '灵活型，那我会先问你。' },
    ],
  },
  {
    id: 'q12',
    group: '生活',
    text: '一次聚会人均多少，你不心疼？',
    sub: '不是能承受多少，是花多少不后悔',
    options: [
      { key: 'a', label: '80 以内', facts: { 'life.budget': 80 }, quip: '那咱们就按性价比排。' },
      { key: 'b', label: '150 左右', facts: { 'life.budget': 150 }, quip: '这个档位选择最多。' },
      { key: 'c', label: '300 也行，要看值不值', facts: { 'life.budget': 300 }, quip: '关键是值，不是便宜。' },
      { key: 'd', label: '看跟谁，不看数字', facts: { 'life.budget': 200 }, quip: '这答案最贵。' },
    ],
  },
]

const BY_ID = new Map(QUESTIONS.map(q => [q.id, q]))

function list() {
  return QUESTIONS.map(q => ({
    id: q.id,
    group: q.group,
    text: q.text,
    sub: q.sub,
    options: q.options.map(o => ({ key: o.key, label: o.label })),
  }))
}

function get(id) {
  return BY_ID.get(id) || null
}

function answerOf(questionId, optionKey) {
  const q = get(questionId)
  if (!q) return null
  return q.options.find(o => o.key === optionKey) || null
}

/**
 * 已答进度。存档在 person.quiz 上，换端也能接着答。
 */
function progress(repos, personId) {
  const person = repos.person.get(personId)
  const answered = (person && person.quiz) || {}
  const done = Object.keys(answered).length
  return {
    answered,
    done,
    total: QUESTIONS.length,
    percent: Number((done / QUESTIONS.length).toFixed(2)),
    next: QUESTIONS.find(q => !answered[q.id]) || null,
    groups: QUESTIONS.reduce((acc, q) => {
      acc[q.group] = acc[q.group] || { total: 0, done: 0 }
      acc[q.group].total++
      if (answered[q.id]) acc[q.group].done++
      return acc
    }, {}),
  }
}

module.exports = { QUESTIONS, list, get, answerOf, progress }
