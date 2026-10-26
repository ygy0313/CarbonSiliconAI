'use strict'

// 成长推荐：把「灵光一现」与 Obsidian 里正在更新的主题，接上可执行的输入。
//
// 为什么是策展库而不是让模型自由发挥：
//   1) 推荐必须可溯源 —— 每一条都写清出处（书名/片名），不能编；
//   2) 失败要降级 —— 没有模型时也能给东西，不是空白；
//   3) 服务「自我数字决策 agent」—— 目标是补短板，不是投喂爽文。
//
// 红线：不卖课、不带货、不给成功学断言；金句只做「书中观点摘述」，不冒用名人原话。

// 每个主题：keys 用于匹配（标签 / 正文关键词），books / watches / lines 是候选
const TOPICS = [
  {
    id: 'decision',
    name: '判断与决策',
    keys: ['决策', '判断', '选择', '纠结', '权衡', '取舍', '复盘', '经验'],
    why: '你最近在反复琢磨「怎么选」，这类输入补的是判断的框架，不是答案。',
    books: [
      { title: '思考，快与慢', author: '丹尼尔·卡尼曼', note: '两套思维系统怎么骗你，读完会开始怀疑自己的直觉。' },
      { title: '决断力', author: '奇普·希思 / 丹·希思', note: '把决策拆成四个可操作的步骤，适合做具体选择时翻。' },
      { title: '穷查理宝典', author: '查理·芒格', note: '多元思维模型，用来检查自己是不是只用一把锤子。' },
    ],
    watches: [
      { title: 'TED：如何做出更好的决策', by: '演讲合集', note: '短，适合通勤看一个。' },
      { title: '纪录片《但是还有书籍》', by: '哔哩哔哩', note: '看别人怎么把一件事做深，慢下来的一种方式。' },
    ],
    lines: [
      { text: '决策质量取决于过程，不取决于结果好坏 —— 好过程也可能撞上坏运气。', from: '《决断力》观点摘述' },
    ],
  },
  {
    id: 'writing',
    name: '表达与写作',
    keys: ['写作', '表达', '金句', '文案', '公众号', '文章', 'idea', '想法', '记录'],
    why: '你记下的多是想法碎片，这类输入帮你把碎片变成能说清楚的东西。',
    books: [
      { title: '写作这回事', author: '斯蒂芬·金', note: '把写作当手艺而不是灵感，最实用的一本。' },
      { title: '风格感觉', author: '史蒂芬·平克', note: '为什么有些句子读着累，讲得很清楚。' },
      { title: '金字塔原理', author: '芭芭拉·明托', note: '结论先行，用来改汇报和长文。' },
    ],
    watches: [
      { title: 'TED：伟大演讲的结构', by: 'TED 官方', note: '看结构，不看台风。' },
    ],
    lines: [
      { text: '写不清楚，通常是没想清楚 —— 写作是思考的体检测试。', from: '《风格感觉》观点摘述' },
    ],
  },
  {
    id: 'engineering',
    name: '工程与手艺',
    keys: ['技术', '工程', '代码', '架构', '效率', '质量', '测试', '重构', '系统'],
    why: '你在用工程方法处理生活问题，这条线可以继续加深。',
    books: [
      { title: '程序员修炼之道', author: 'Hunt & Thomas', note: '偏习惯与判断，不是语法书。' },
      { title: '设计数据密集型应用', author: 'Martin Kleppmann', note: '讲取舍的底层原因，做架构决策时最有用。' },
      { title: '重构', author: 'Martin Fowler', note: '小步改进的方法论，也能用在流程上。' },
    ],
    watches: [
      { title: '纪录片《神奇大脑》', by: 'BBC', note: '换个角度理解「人这台机器」的局限。' },
    ],
    lines: [
      { text: '复杂度是借来的高利贷 —— 早还便宜，晚还昂贵。', from: '《设计数据密集型应用》观点摘述' },
    ],
  },
  {
    id: 'management',
    name: '带人与协作',
    keys: ['管理', '团队', '带人', '招聘', '绩效', '汇报', '协作', '沟通', '面试'],
    why: '你在带人和找机会之间，这类输入补的是「怎么让别人也做成事」。',
    books: [
      { title: '格鲁夫给经理人的第一课', author: '安迪·格鲁夫', note: '高产出管理的原点，一页一个可执行动作。' },
      { title: '团队协作的五大障碍', author: '帕特里克·兰西奥尼', note: '用一个故事讲清信任为什么难。' },
      { title: '关键对话', author: '科里·帕特森等', note: '把难说的话说出口的具体脚本。' },
    ],
    watches: [
      { title: 'TED：如何让团队敢说真话', by: '演讲合集', note: '心理安全感，讲得比书快。' },
    ],
    lines: [
      { text: '管理者的产出 = 团队的产出，不是自己的忙碌。', from: '《格鲁夫给经理人的第一课》观点摘述' },
    ],
  },
  {
    id: 'body',
    name: '身体与精力',
    keys: ['健康', '运动', '睡眠', '身体', '精力', '体重', '跑步', '快走', '卡路里'],
    why: '你在记运动与睡眠，这条线决定了你其他所有事情的底盘。',
    books: [
      { title: '我们为什么要睡觉', author: '马修·沃克', note: '睡眠不足的代价，读完会想早点关灯。' },
      { title: '运动改造大脑', author: '约翰·瑞迪', note: '运动对情绪与专注的作用，有实验支撑。' },
      { title: '睡眠革命', author: '尼克·利特尔黑尔斯', note: '按周期睡，比按小时睡更实际。' },
    ],
    watches: [
      { title: '纪录片《睡眠的科学》', by: '公开课', note: '半小时，够改变一个习惯。' },
    ],
    lines: [
      { text: '睡眠不是休息的选项，是身体在做维护的窗口。', from: '《我们为什么要睡觉》观点摘述' },
    ],
  },
  {
    id: 'emotion',
    name: '情绪与自我',
    keys: ['情绪', '焦虑', '压力', '自我', '梦', '失眠', '烦', '累', '内耗', '意义'],
    why: '你记下的情绪线索不少，这类输入不是安慰，是工具。',
    books: [
      { title: '伯恩斯新情绪疗法', author: '大卫·伯恩斯', note: '认知扭曲清单，可以直接拿来对照自己的念头。' },
      { title: '被讨厌的勇气', author: '岸见一郎 / 古贺史健', note: '课题分离，处理人际内耗的一把刀。' },
      { title: '正念的奇迹', author: '一行禅师', note: '薄，适合睡前读两页。' },
    ],
    watches: [
      { title: 'TED：脆弱的力量', by: '布琳·布朗', note: '关于羞耻与连接，讲得很实在。' },
    ],
    lines: [
      { text: '情绪不是要解决的问题，是要先被看见的信号。', from: '《伯恩斯新情绪疗法》观点摘述' },
    ],
  },
  {
    id: 'business',
    name: '生意与产品',
    keys: ['生意', '产品', '创业', '销售', '用户', '商业', '红酒', '客户', '副业'],
    why: '你在做小生意，这条线补的是「怎么验证需求」，不是怎么投放。',
    books: [
      { title: '精益创业', author: '埃里克·莱斯', note: '最小可行产品与验证循环，小生意同样适用。' },
      { title: '从0到1', author: '彼得·蒂尔', note: '讲独占性，反常识但值得对照。' },
      { title: '影响力', author: '罗伯特·西奥迪尼', note: '六个说服原理，看着有点不适但很真实。' },
    ],
    watches: [
      { title: '纪录片《美国工厂》', by: 'Netflix', note: '管理与文化的冲突，看得下去的那种商业片。' },
    ],
    lines: [
      { text: '先找到十个人真的愿意付钱，再谈规模。', from: '《精益创业》观点摘述' },
    ],
  },
  {
    id: 'learning',
    name: '学习方法',
    keys: ['学习', '读书', '笔记', '知识', 'obsidian', '课程', '记忆', '单词'],
    why: '你在用 Obsidian 攒知识，这条线补的是「怎么让知识真的留下来」。',
    books: [
      { title: '学习之道', author: '芭芭拉·奥克利', note: '专注与发散两种模式，解释了很多「卡住」的体验。' },
      { title: '刻意练习', author: '安德斯·艾利克森', note: '天赋神话的解毒剂，讲清了反馈的作用。' },
      { title: '认知天性', author: '彼得·布朗等', note: '检索练习比反复阅读有效，有实验。' },
    ],
    watches: [
      { title: 'TED：如何在六个月内学会一门外语', by: '克里斯·朗斯代尔', note: '方法可迁移到任何技能。' },
    ],
    lines: [
      { text: '读十遍不如合上书回想一遍 —— 检索本身就是学习。', from: '《认知天性》观点摘述' },
    ],
  },
]

// 兜底主题：文本没有明显线索时给「学习方法 + 判断」
const FALLBACK = ['learning', 'decision']

const TOPIC_BY_ID = new Map(TOPICS.map(t => [t.id, t]))

/**
 * 从若干段文本 / 标签里挑主题。
 * @returns {Array<{topic, score, hits}>} 按分数倒序，最多 limit 个
 */
function rankTopics(texts, tags = [], limit = 2) {
  const hay = (texts.join(' ') + ' ' + tags.join(' ')).toLowerCase()
  const scored = TOPICS.map(topic => {
    const hits = topic.keys.filter(k => hay.includes(k.toLowerCase()))
    return { topic, hits, score: hits.length }
  })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)

  if (!scored.length) {
    return FALLBACK.map(id => ({ topic: TOPIC_BY_ID.get(id), hits: [], score: 0 })).slice(0, limit)
  }
  return scored.slice(0, limit)
}

/**
 * 生成推荐：每个主题给 1 本书 + 1 个可看的 + 1 句，避免一次推一堆。
 * @param {string[]} texts 灵光一现正文 / 成长主题名
 * @param {string[]} tags
 */
function recommend(texts, tags = []) {
  const ranked = rankTopics(texts, tags, 2)
  const items = []
  for (const r of ranked) {
    const t = r.topic
    const book = t.books[0]
    const watch = t.watches[0]
    const line = t.lines[0]
    items.push({
      topicId: t.id,
      topic: t.name,
      why: t.why,
      matched: r.hits,
      book: { title: book.title, author: book.author, note: book.note },
      watch: watch ? { title: watch.title, by: watch.by, note: watch.note } : null,
      line: line ? { text: line.text, from: line.from } : null,
    })
  }
  return items
}

module.exports = { TOPICS, rankTopics, recommend }
