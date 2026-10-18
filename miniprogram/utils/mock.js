// 离线演示数据：后端没启动时仍然能看完整产品形态。
// 结构与服务端返回严格一致，避免「有网能跑、没网白屏」。

const silicon = {
  person: { id: 'p_owner', name: '杨光宇', city: '银川' },
  completeness: 0.71,
  facts: [
    { key: 'diet.spicy', label: '辣度耐受', value: '微辣', confidence: 0.8, stale: false, note: '自述', evidenceCount: 3 },
    { key: 'diet.stomach', label: '肠胃', value: '偏敏感', confidence: 0.78, stale: false, note: '多次记录归纳', evidenceCount: 5 },
    { key: 'diet.taste', label: '口味倾向', value: '咸鲜', confidence: 0.7, stale: false, note: '自述', evidenceCount: 2 },
    { key: 'diet.avoid', label: '忌口', value: '香菜', confidence: 0.9, stale: false, note: '自述', evidenceCount: 1 },
    { key: 'social.groupSize', label: '常组局人数', value: 6, confidence: 0.75, stale: false, note: '历史组局', evidenceCount: 2 },
    { key: 'social.experience', label: '剧本杀经验', value: '3 次以上', confidence: 0.8, stale: false, note: '自述', evidenceCount: 3 },
    { key: 'social.preference', label: '题材偏好', value: '推理,情感', confidence: 0.7, stale: false, note: '历史选择', evidenceCount: 2 },
    { key: 'social.role', label: '组局角色', value: '发起人', confidence: 0.72, stale: false, note: '行为归纳', evidenceCount: 2 },
    { key: 'life.city', label: '常驻城市', value: '银川', confidence: 0.98, stale: false, note: '自述', evidenceCount: 1 },
    { key: 'life.budget', label: '单次预算', value: 120, confidence: 0.6, stale: false, note: '历史消费', evidenceCount: 2 },
    { key: 'life.rhythm', label: '作息节奏', value: '夜猫子', confidence: 0.65, stale: false, note: '行为归纳', evidenceCount: 3 },
    { key: 'self.identity', label: '自我描述', value: '18 年技术老兵，现在做红酒和内容', confidence: 0.9, stale: false, note: '自述', evidenceCount: 1 },
  ],
  episodes: [
    { id: 'e1', ts: '2026-10-16T21:00:00.000Z', text: '晚上跟老同事去吃了辣糊糊，当时爽，半夜胃有点烧', tags: ['胃敏感', '重辣'], summary: '夜宵吃辣，胃不舒服' },
    { id: 'e2', ts: '2026-10-14T12:00:00.000Z', text: '中午一个人吃了碗拌汤，简单，胃舒服', tags: ['胃敏感'], summary: '一个人的午餐' },
    { id: 'e3', ts: '2026-10-12T19:00:00.000Z', text: '组了个 6 人局，玩《雾隐山庄》，新手多，DM 带得不错', tags: ['生日局'], summary: '6 人剧本杀局' },
    { id: 'e4', ts: '2026-10-10T23:00:00.000Z', text: '熬夜改方案到两点，第二天起来嘴里发苦', tags: ['上火', '失眠'], summary: '熬夜后上火' },
    { id: 'e5', ts: '2026-10-07T15:00:00.000Z', text: '给杭州的客户寄了两瓶贺兰山赤霞珠，他说比想象中好', tags: [], summary: '红酒客户反馈' },
  ],
  traits: {
    recordCount: 10,
    last7: 2,
    last30: 8,
    topTags: [['胃敏感', 3], ['上火', 1], ['生日局', 2], ['重辣', 1]],
    gatherCount: 3,
    acceptRate: 0.62,
    personaHints: [
      '你能吃辣但胃不太扛得住 —— 这是个需要你自己确认的矛盾点',
      '点菜时会自动帮你避开重油重辣',
      '你是熟人局的常客，组局偏好已经比较稳定',
    ],
  },
  voice: ['晚上更活跃，可以晚一点提醒', '直接给结论和待办，不用铺垫'],
}

const eatResult = {
  invocationId: 'inv_mock_eat',
  intent: { type: 'eat', label: '今天吃什么', confidence: 0.81, matched: ['吃什么', '吃'] },
  cards: [
    {
      id: 'meal_d02', kind: 'primary', title: '蒿子面',
      desc: '中宁蒿子面，酸香开胃 · 人均 18 元 · 约 20 分钟',
      why: ['胃不舒服的时候，这道最稳妥', '一个人吃，18 元的份量刚好', '不辣，在你「微辣」的耐受里'],
      evidence: [{ episodeId: 'e1', text: '夜宵吃辣，胃不舒服' }],
      score: 0.86, source: '给您请安 · 膳食坊',
      meta: { element: '木', taste: '酸', spicy: 0, price: 18, min: 20 },
    },
    {
      id: 'meal_d18', kind: 'option', title: '拌汤（洋芋疙瘩汤）',
      desc: '最家常的安慰 · 人均 14 元 · 约 15 分钟',
      why: ['比「蒿子面」省 4 元，快 5 分钟', '胃不舒服的时候，这道最稳妥', '不辣，在你「微辣」的耐受里'],
      evidence: [{ episodeId: 'e1', text: '夜宵吃辣，胃不舒服' }],
      score: 0.86, source: '给您请安 · 膳食坊',
      meta: { element: '土', taste: '甘', spicy: 0, price: 14, min: 15 },
    },
    {
      id: 'meal_d10', kind: 'option', title: '蒸南瓜小米粥',
      desc: '养胃，晚上也能吃 · 人均 12 元 · 约 30 分钟',
      why: ['比「蒿子面」省 6 元，要多等 10 分钟', '胃不舒服的时候，这道最稳妥', '不辣，在你「微辣」的耐受里'],
      evidence: [{ episodeId: 'e1', text: '夜宵吃辣，胃不舒服' }],
      score: 0.81, source: '给您请安 · 膳食坊',
      meta: { element: '土', taste: '甘', spicy: 0, price: 12, min: 30 },
    },
    {
      id: 'fortune_today', kind: 'note', title: '今日乙丑日 · 同气相和',
      desc: '今天节奏跟你是一个调子，按原来的节拍走就顺。宜咸味，少碰辛。',
      why: ['今天日柱是乙丑（天干属木）', '与你今日节奏同气相和，宜咸味'],
      evidence: [], score: 0.5, source: '给您请安 · 今日节律',
    },
    {
      id: 'weather_today', kind: 'context', title: '银川 6°C 晴',
      desc: '天冷，汤类和水煮的更合适',
      why: ['体感冷', '实时天气'],
      evidence: [], score: 0.4, source: '天气服务',
    },
  ],
  summary: '今天推荐：蒿子面 / 拌汤（洋芋疙瘩汤） / 蒸南瓜小米粥',
  trace: [
    { step: 1, stage: 'intent', label: '识别意图：今天吃什么', confidence: 0.81 },
    { step: 2, stage: 'profile', label: '载入档案：杨光宇（完整度 71%）' },
    { step: 3, stage: 'recall', label: '召回 1 个服务', detail: '给您请安·今日膳食' },
    { step: 4, stage: 'plan', label: '解析出 3 个执行节点 / 2 层', graph: [['今日节律', '天气体感'], ['今日膳食']] },
    { step: 5, stage: 'run', label: '今日节律 完成', ms: 2, status: 'ok' },
    { step: 6, stage: 'run', label: '天气体感 完成', ms: 320, status: 'ok' },
    { step: 7, stage: 'run', label: '今日膳食 完成', ms: 3, status: 'ok' },
    { step: 8, stage: 'compose', label: '合并出 5 条建议' },
    { step: 9, stage: 'done', label: '完成，用时 342ms', totalMs: 342 },
  ],
  totalMs: 342,
}

const gatherResult = {
  invocationId: 'inv_mock_gather',
  intent: { type: 'gather', label: '组个局', confidence: 0.86, matched: ['组个局', '组局', '朋友', '周末'] },
  cards: [
    {
      id: 'plan_gather', kind: 'plan', title: '周六 6 人局',
      desc: '《雾隐山庄》· 家里客厅 · 轻食拼盘 · 人均约 110 元',
      why: ['6 人正好，不用临时凑人', '新手本，没玩过的人不会有压力', '场地零成本，预算全留给茶歇'],
      evidence: [], score: 0.98, source: '多服务协同',
      meta: {
        dateStr: '10月24日 周六',
        headcount: 6,
        totalPerPerson: 110,
        parts: ['script_s01', 'venue_v05', 'catering_c02'],
        timeline: [
          { time: '19:00', text: '在家集合，把轻食拼盘摆上' },
          { time: '19:30', text: '开《雾隐山庄》，3 小时 20 分' },
          { time: '22:50', text: '收尾，留 20 分钟复盘' },
          { time: '23:10', text: '散场' },
        ],
        todos: ['确认 6 人能到（现在定了几个？）', '备轻食拼盘，6 人份约 132 元', '确认 DM 档期', '提前一天把本过一遍'],
        missing: [],
      },
    },
    {
      id: 'script_s01', kind: 'primary', title: '《雾隐山庄》',
      desc: '6/7/8 人 · 新手 · 3 小时 20 分 · 人均 88 元',
      why: ['正好 6 人开', '你偏好推理题材'],
      evidence: [], score: 0.98, source: '剧本杀工坊 · 开本',
      meta: { genres: ['推理', '古风'], hook: '暴雨封山，六人各怀心事', needDM: true, headcountFit: [6, 7, 8], minutes: 200, price: 88, level: '新手' },
    },
    {
      id: 'venue_v05', kind: 'primary', title: '家里客厅（自助）',
      desc: '6 人 · 免费 · 自己家',
      why: ['离你 0km，走过去就行', '评分 5.0', '零成本，熟人局最省'],
      evidence: [], score: 0.82, source: '本地生活 · 场地',
      meta: { tags: ['零成本', '熟人局'], rating: 5, price: 0 },
    },
    {
      id: 'catering_c02', kind: 'primary', title: '轻食拼盘（水果 + 坚果）',
      desc: '人均 22 元 · 6 人合计约 132 元',
      why: ['不脏手，不影响翻本'],
      evidence: [], score: 0.76, source: '本地生活 · 茶歇',
      meta: { perPerson: 22, total: 132, tags: ['不脏手'] },
    },
    {
      id: 'script_s03', kind: 'option', title: '《贺兰山下》',
      desc: '6/7 人 · 新手 · 3 小时 · 人均 78 元',
      why: ['比《雾隐山庄》短 20 分钟，人均便宜 10 元', '正好 6 人开', '你偏好情感题材'],
      evidence: [], score: 0.98, source: '剧本杀工坊 · 开本',
      meta: { genres: ['情感', '家国'], hook: '西夏旧事，三代人的选择', needDM: true, headcountFit: [6, 7], minutes: 180, price: 78, level: '新手' },
    },
    {
      id: 'venue_v03', kind: 'option', title: '鼓楼小院桌游',
      desc: '6 人 · 人均 45 元 · 1.8km',
      why: ['离你 1.8km，走过去就行'],
      evidence: [], score: 0.75, source: '本地生活 · 场地',
      meta: { tags: ['平价', '轻本'], rating: 4.5, price: 45 },
    },
    {
      id: 'catering_c01', kind: 'option', title: '基础茶水（八宝茶 + 瓜子）',
      desc: '人均 12 元 · 6 人合计约 72 元',
      why: ['预算内最稳的组合'],
      evidence: [], score: 0.66, source: '本地生活 · 茶歇',
      meta: { perPerson: 12, total: 72, tags: ['零负担'] },
    },
    {
      id: 'calendar_check', kind: 'context', title: '10月24日 周六 目前空着',
      desc: '可以直接定这个时间',
      why: ['你说的是「周六」'],
      evidence: [], score: 0.4, source: '日程服务',
      meta: { date: '2026-10-24', dateStr: '10月24日 周六', dayOfWeek: '周六', conflict: false },
    },
  ],
  summary: '10月24日 周六 · 6 人 · 《雾隐山庄》· 家里客厅 · 轻食拼盘 · 人均约 110 元',
  trace: [
    { step: 1, stage: 'intent', label: '识别意图：组个局', confidence: 0.86 },
    { step: 2, stage: 'profile', label: '载入档案：杨光宇（完整度 70%）' },
    { step: 3, stage: 'recall', label: '召回 3 个服务', detail: '剧本杀工坊·开本 + 本地生活·场地 + 本地生活·茶歇' },
    { step: 4, stage: 'plan', label: '解析出 4 个执行节点 / 2 层', graph: [['日程核对'], ['剧本杀选本', '场地推荐', '茶歇配套']] },
    { step: 5, stage: 'run', label: '日程核对 完成', ms: 2, status: 'ok' },
    { step: 6, stage: 'run', label: '剧本杀选本 完成', ms: 3, status: 'ok' },
    { step: 7, stage: 'run', label: '场地推荐 完成', ms: 3, status: 'ok' },
    { step: 8, stage: 'run', label: '茶歇配套 完成', ms: 3, status: 'ok' },
    { step: 9, stage: 'compose', label: '合并出 7 条建议' },
    { step: 10, stage: 'done', label: '完成，用时 29ms', totalMs: 29 },
  ],
  totalMs: 29,
}

function orchestrate(text) {
  const t = String(text || '')
  const isGather = /组局|剧本杀|开本|聚会|周末|朋友/.test(t)
  return JSON.parse(JSON.stringify(isGather ? gatherResult : eatResult))
}

function record(text) {
  return {
    episode: { id: 'e_mock', ts: new Date().toISOString(), text, summary: text.slice(0, 20) },
    factChanges: [{ key: 'diet.stomach', label: '肠胃', action: 'confirmed', before: '偏敏感', after: '偏敏感' }],
    conflicts: [],
    silicon: {
      completeness: 0.72,
      hints: ['已经记下来了，下次推荐会用上'],
      factCount: 12,
      memoryCount: 11,
    },
    extracted: {
      tags: /辣/.test(t) ? ['微辣'] : [],
      entities: { time: { key: 'today', label: '今天' } },
      summary: text.slice(0, 20),
      extractor: 'mock',
    },
  }
}

module.exports = { silicon, orchestrate, record, eatResult, gatherResult }
