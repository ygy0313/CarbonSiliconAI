'use strict'

// 演示档案：让第一次打开就能看到「一个已经活了 30 天的档案」。
// 数据不是随机生成的，是围绕一个真实的西北中年男性生活轨迹写的，
// 这样推荐结果才看得出逻辑（而不是随便排三条）。

const DAY = 86400000
const { redactDeep } = require('./security/redact')

function daysAgo(n, hour = 20) {
  const d = new Date(Date.now() - n * DAY)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

function seedDemo(repos, personId) {
  if (repos.person.get(personId)) {
    return { skipped: true, reason: 'already exists' }
  }

  repos.person.create({
    id: personId,
    name: '杨光宇',
    city: '银川',
    createdAt: daysAgo(45, 9),
  })

  // ── 声明事实（用户自己填过的那部分）──
  const facts = [
    ['diet.spicy', '微辣', 0.8, '自述'],
    ['diet.stomach', '偏敏感', 0.78, '多次记录归纳'],
    ['diet.taste', '咸鲜', 0.7, '自述'],
    ['diet.avoid', '香菜', 0.9, '自述'],
    ['social.groupSize', 6, 0.75, '历史组局'],
    ['social.experience', '3 次以上', 0.8, '自述'],
    ['social.preference', '推理,情感', 0.7, '历史选择'],
    ['social.role', '发起人', 0.72, '行为归纳'],
    ['life.city', '银川', 0.98, '自述'],
    ['life.budget', 120, 0.6, '历史消费'],
    ['life.rhythm', '夜猫子', 0.65, '行为归纳'],
    ['self.identity', '18 年技术老兵，现在做红酒和内容', 0.9, '自述'],
  ]
  for (const [key, value, confidence, note] of facts) {
    repos.fact.upsert(personId, key, value, {
      confidence,
      source: 'seed',
      note,
      updatedAt: daysAgo(Math.floor(Math.random() * 20) + 1, 10),
    })
  }

  // ── 记忆（行为事实，带时间与场景）──
  const episodes = [
    {
      d: 2, h: 21,
      text: '晚上跟老同事去吃了辣糊糊，当时爽，半夜胃有点烧',
      tags: ['胃敏感', '重辣'],
      entities: { scene: 'friends', headcount: 4, time: { key: 'today_evening', label: '今晚' } },
      summary: '夜宵吃辣，胃不舒服',
      kind: 'note',
    },
    {
      d: 4, h: 12,
      text: '中午一个人吃了碗拌汤，简单，胃舒服',
      tags: ['胃敏感'],
      entities: { scene: 'alone', headcount: 1, mealType: 'lunch' },
      summary: '一个人的午餐',
      kind: 'note',
    },
    {
      d: 6, h: 19,
      text: '组了个 6 人局，玩《雾隐山庄》，新手多，DM 带得不错',
      tags: ['生日局'],
      entities: { scene: 'friends', headcount: 6, genres: ['推理', '古风'] },
      summary: '6 人剧本杀局',
      kind: 'note',
    },
    {
      d: 8, h: 23,
      text: '熬夜改方案到两点，第二天起来嘴里发苦',
      tags: ['上火', '失眠'],
      entities: { scene: 'alone', time: { key: 'today_evening', label: '今晚' } },
      summary: '熬夜后上火',
      kind: 'note',
    },
    {
      d: 11, h: 15,
      text: '给杭州的客户寄了两瓶贺兰山赤霞珠，他说比想象中好',
      tags: [],
      entities: { scene: 'work' },
      summary: '红酒客户反馈',
      kind: 'note',
    },
    {
      d: 14, h: 18,
      text: '周末想约人再开一局，上次 7 个人有点挤，这次控制在 6 个',
      tags: ['新手局'],
      entities: { scene: 'friends', headcount: 6, time: { key: 'weekend', label: '这个周末' } },
      summary: '计划再组一局',
      kind: 'note',
    },
    {
      d: 18, h: 12,
      text: '中午吃了羊肉臊子面，面有点硬，下午胃胀',
      tags: ['胃敏感'],
      entities: { scene: 'alone', headcount: 1, mealType: 'lunch' },
      summary: '面食后胃胀',
      kind: 'note',
    },
    {
      d: 22, h: 20,
      text: '陪爸妈吃饭，点了清炖羊肉，他们喜欢，我也吃得舒服',
      tags: [],
      entities: { scene: 'family', headcount: 3, mealType: 'dinner' },
      summary: '和家人吃饭',
      kind: 'note',
    },
    {
      d: 26, h: 10,
      text: '在楼下喝了碗八宝茶，配油香，银川的早上就该这样',
      tags: [],
      entities: { scene: 'alone', headcount: 1, mealType: 'breakfast' },
      summary: '本地早餐',
      kind: 'note',
    },
    {
      d: 31, h: 21,
      text: '朋友生日，8 个人，玩了欢乐本，笑到肚子疼',
      tags: ['生日局'],
      entities: { scene: 'friends', headcount: 8, genres: ['欢乐'] },
      summary: '8 人生日局',
      kind: 'note',
    },
  ]

  const inserted = []
  for (const e of episodes) {
    // 演示数据也走同一条脱敏流水线 —— 不能有「这条是 seed 所以可以留明文」的例外口子
    const safe = redactDeep({ text: e.text, summary: e.summary, entities: e.entities })
    inserted.push(repos.episode.insert({
      personId,
      ts: daysAgo(e.d, e.h),
      kind: e.kind,
      text: safe.value.text,
      tags: e.tags,
      entities: safe.value.entities,
      summary: safe.value.summary,
      source: 'seed',
      confidence: 0.9,
      redacted: true,
      redaction: { hits: safe.hits, sealed: false },
      rawCipher: null,
      piiCipher: null,
    }))
  }

  // 演示经验：让「经验资产」页第一次打开就不是空的。
  // 真实产品里这两条会由反思挖出来；这里是为了让新用户看懂这一页在讲什么。
  const seedExperiences = [
    {
      rule: '在「胃敏感、微辣」这类情境下，优先「清汤面」——过去 4/5 次你都采纳了。',
      tags: ['胃敏感', '微辣'],
      scene: 'solo',
      effectiveness: 0.74,
      applied: 5,
      followed: 4,
    },
    {
      rule: '在「聚会、新手」这类情境下，优先「新手欢乐本」——过去 3/4 次你都采纳了。',
      tags: ['聚会', '新手'],
      scene: 'group',
      effectiveness: 0.68,
      applied: 4,
      followed: 3,
    },
  ]

  for (const x of seedExperiences) {
    const now = new Date().toISOString()
    repos.experience.insert({
      personId,
      rule: x.rule,
      trigger: { tags: x.tags, scene: x.scene, intent: '', predicate: '' },
      situation: { text: x.rule, scene: x.scene, tags: x.tags },
      action: { kind: 'rule', text: x.rule },
      outcome: { verdict: 'good', support: x.applied, note: '演示数据' },
      effectiveness: x.effectiveness,
      applied: x.applied,
      followed: x.followed,
      evidence: inserted.slice(0, 3).map(e => ({ refId: e.id, kind: 'episode' })),
      status: 'active',
      source: 'seed',
      loop: 'single',
      signature: `seed|${x.rule.slice(0, 40)}`,
      applications: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
      lastAppliedAt: null,
    })
  }

  return { skipped: false, facts: facts.length, episodes: episodes.length, experiences: seedExperiences.length }
}

module.exports = { seedDemo }
