'use strict'

// 领域词典：事实维度、意图规则、服务能力所需的领域数据。
// 纯数据文件，不含逻辑，便于后续换成运营后台可配置。

// ── 事实维度（档案的事实层骨架）──────────────────────────────
// 每一个 dim 都是一条可被核对、可被修正的「声明」，不是一个分数。
const FACT_DIMENSIONS = [
  { key: 'diet.spicy', label: '辣度耐受', group: '饮食', type: 'enum', options: ['不吃辣', '微辣', '中辣', '重辣'], question: '你能吃多辣？' },
  { key: 'diet.stomach', label: '肠胃', group: '饮食', type: 'enum', options: ['正常', '偏敏感', '易上火'], question: '你的肠胃状态？' },
  { key: 'diet.taste', label: '口味倾向', group: '饮食', type: 'enum', options: ['清淡', '咸鲜', '重口', '偏甜'], question: '你偏好什么口味？' },
  { key: 'diet.avoid', label: '忌口', group: '饮食', type: 'tags', question: '有什么不吃的？' },
  { key: 'social.groupSize', label: '常组局人数', group: '社交', type: 'number', question: '你组局一般几个人？' },
  { key: 'social.experience', label: '剧本杀经验', group: '社交', type: 'enum', options: ['没玩过', '1-3 次', '3 次以上', '老玩家'], question: '你玩过几次剧本杀？' },
  { key: 'social.preference', label: '题材偏好', group: '社交', type: 'tags', question: '喜欢什么题材？' },
  { key: 'social.role', label: '组局角色', group: '社交', type: 'enum', options: ['发起人', '跟随者', '都可'], question: '组局时你通常是什么角色？' },
  { key: 'life.city', label: '常驻城市', group: '生活', type: 'text', question: '你常驻哪个城市？' },
  { key: 'life.budget', label: '单次预算', group: '生活', type: 'number', question: '一次聚会预算大概多少？' },
  { key: 'life.rhythm', label: '作息节奏', group: '生活', type: 'enum', options: ['早睡早起', '正常', '夜猫子'], question: '你的作息？' },
  { key: 'self.identity', label: '自我描述', group: '自我', type: 'text', question: '用一句话描述你自己' },
]

// ── 意图分类 ──────────────────────────────────────────────
// 加意图只需在这里加一条 + 写一个声明了该意图的 agent，编排器不用改。
const INTENTS = [
  {
    type: 'eat',
    label: '今天吃什么',
    service: '给您请安',
    keywords: ['吃什么', '吃啥', '来点吃的', '吃', '饭', '菜', '外卖', '午餐', '晚餐', '早餐', '夜宵', '喝什么', '胃', '饿', '馋'],
    weight: 1,
  },
  {
    type: 'gather',
    label: '组个局',
    service: '剧本杀工坊',
    keywords: ['组个局', '开一局', '组局', '凑一局', '凑局', '开局', '剧本杀', '开本', '聚会', '玩什么', '朋友', '周末', '约', '桌游', '包间', '生日', '陪我玩', '想玩'],
    weight: 1.15,
  },
  {
    type: 'gift',
    label: '送点什么',
    service: '九月葡园',
    keywords: ['送', '礼物', '红酒', '伴手礼', '拜访', '过节'],
    weight: 1,
  },
  {
    type: 'drink',
    label: '喝点什么',
    service: '九月葡园 / 给您请安',
    keywords: ['酒', '茶', '咖啡', '饮子', '小酌', '喝点什么', '喝点', '来一杯', '一杯', '配酒', '佐餐', '下酒'],
    weight: 1,
  },
  {
    type: 'dream',
    label: '记个梦',
    service: '梦境',
    keywords: ['做梦', '梦见', '梦到', '噩梦', '梦里', '梦境', '梦'],
    weight: 1.1,
  },
]

// ── 五行 → 五味（趣味文化向，只做饮食方向提示，不做吉凶断言）──
const ELEMENT_TASTE = { 木: '酸', 火: '苦', 土: '甘', 金: '辛', 水: '咸' }
const GENERATE = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' } // 生
const OVERCOME = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' } // 克

// ── 菜品库 ────────────────────────────────────────────────
// spicy: 0-3；element: 五行属性；load: 消化负担 light/normal/heavy
// helps: 适合的身体状态；pains: 不适合的状态；min: 大致出餐分钟；price: 人均
const DISH_LIBRARY = [
  { id: 'd01', name: '清炖羊肉萝卜', element: '土', taste: '甘', spicy: 0, load: 'normal', helps: ['胃寒', '乏力', '天冷'], pains: ['上火'], min: 45, price: 48, note: '宁夏滩羊，汤清不膻' },
  { id: 'd02', name: '蒿子面', element: '木', taste: '酸', spicy: 0, load: 'light', helps: ['没胃口', '胃敏感'], pains: [], min: 20, price: 18, note: '中宁蒿子面，酸香开胃' },
  { id: 'd03', name: '羊肉臊子面', element: '土', taste: '甘', spicy: 1, load: 'normal', helps: ['饿', '乏力'], pains: ['胃敏感'], min: 25, price: 22, note: '西北家常，汤浓面筋' },
  { id: 'd04', name: '手抓羊肉', element: '土', taste: '甘', spicy: 0, load: 'heavy', helps: ['乏力', '待客'], pains: ['胃敏感', '上火'], min: 50, price: 78, note: '原汤原味，配蒜醋' },
  { id: 'd05', name: '沙湖大鱼头', element: '水', taste: '咸', spicy: 1, load: 'normal', helps: ['待客', '想补'], pains: [], min: 40, price: 88, note: '沙湖鲢鱼，汤白味鲜' },
  { id: 'd06', name: '凉拌沙葱', element: '木', taste: '酸', spicy: 1, load: 'light', helps: ['解腻', '天热'], pains: ['胃寒'], min: 10, price: 16, note: '贺兰山沙葱，脆爽' },
  { id: 'd07', name: '枸杞芽煎蛋', element: '木', taste: '酸', spicy: 0, load: 'light', helps: ['眼干', '上火'], pains: [], min: 12, price: 22, note: '本地枸杞芽，微苦回甘' },
  { id: 'd08', name: '辣糊糊', element: '火', taste: '苦', spicy: 3, load: 'normal', helps: ['嘴馋', '天冷'], pains: ['胃敏感', '上火'], min: 20, price: 25, note: '银川街头味，慎点' },
  { id: 'd09', name: '烩小吃', element: '土', taste: '甘', spicy: 0, load: 'normal', helps: ['胃寒', '想家'], pains: [], min: 25, price: 26, note: '丸子夹板粉条一锅烩' },
  { id: 'd10', name: '蒸南瓜小米粥', element: '土', taste: '甘', spicy: 0, load: 'light', helps: ['胃敏感', '失眠', '上火'], pains: [], min: 30, price: 12, note: '养胃，晚上也能吃' },
  { id: 'd11', name: '山药排骨汤', element: '土', taste: '甘', spicy: 0, load: 'light', helps: ['胃敏感', '乏力'], pains: [], min: 60, price: 42, note: '温补不燥' },
  { id: 'd12', name: '蒜香烤羊排', element: '金', taste: '辛', spicy: 1, load: 'heavy', helps: ['待客', '嘴馋'], pains: ['上火', '胃敏感'], min: 45, price: 98, note: '配红酒很合适' },
  { id: 'd13', name: '醋溜白菜', element: '木', taste: '酸', spicy: 0, load: 'light', helps: ['解腻', '上火'], pains: [], min: 12, price: 14, note: '清爽收口' },
  { id: 'd14', name: '八宝茶', element: '土', taste: '甘', spicy: 0, load: 'light', helps: ['胃寒', '熬夜', '待客'], pains: [], min: 5, price: 12, note: '盖碗八宝，回民待客茶' },
  { id: 'd15', name: '贺兰山赤霞珠', element: '火', taste: '苦', spicy: 0, load: 'light', helps: ['待客', '小酌'], pains: ['胃敏感'], min: 1, price: 128, note: '本地酒庄，配红肉' },
  { id: 'd16', name: '酸汤水饺', element: '木', taste: '酸', spicy: 1, load: 'normal', helps: ['没胃口', '嘴馋'], pains: ['胃敏感'], min: 20, price: 20, note: '酸辣开胃' },
  { id: 'd17', name: '黄焖鸡米饭', element: '土', taste: '甘', spicy: 1, load: 'normal', helps: ['饿'], pains: [], min: 25, price: 28, note: '一个人吃的稳妥选择' },
  { id: 'd18', name: '拌汤（洋芋疙瘩汤）', element: '土', taste: '甘', spicy: 0, load: 'light', helps: ['胃敏感', '胃寒', '宿醉'], pains: [], min: 15, price: 14, note: '最家常的安慰' },
]

// ── 剧本杀本库 ────────────────────────────────────────────
const SCRIPT_LIBRARY = [
  { id: 's01', title: '雾隐山庄', players: [6, 7, 8], level: '新手', minutes: 200, genres: ['推理', '古风'], price: 88, dm: true, hook: '暴雨封山，六人各怀心事' },
  { id: 's02', title: '第七次呼吸', players: [5, 6], level: '进阶', minutes: 240, genres: ['悬疑', '还原'], price: 108, dm: true, hook: '同一天的第七次循环' },
  { id: 's03', title: '贺兰山下', players: [6, 7], level: '新手', minutes: 180, genres: ['情感', '家国'], price: 78, dm: true, hook: '西夏旧事，三代人的选择' },
  { id: 's04', title: '谁动了我的月饼', players: [4, 5, 6], level: '新手', minutes: 120, genres: ['欢乐', '推理'], price: 58, dm: false, hook: '一场家庭聚会的闹剧' },
  { id: 's05', title: '长夜将尽', players: [6, 7, 8], level: '硬核', minutes: 300, genres: ['推理', '机制'], price: 128, dm: true, hook: '没有一个人说真话' },
  { id: 's06', title: '红账本', players: [5, 6], level: '进阶', minutes: 210, genres: ['商战', '阵营'], price: 98, dm: true, hook: '一笔对不上的账' },
  { id: 's07', title: '沙湖谜案', players: [6, 8], level: '新手', minutes: 160, genres: ['推理', '本地'], price: 68, dm: false, hook: '本地实景改编' },
  { id: 's08', title: '我的另一半是 AI', players: [4, 5, 6], level: '新手', minutes: 150, genres: ['欢乐', '科幻'], price: 66, dm: false, hook: '轻松不烧脑，适合破冰' },
]

// ── 单人玩法库（一个人也能开一局）──────────────────────────
// 组局不必凑人。一个人玩的本质是「有结构的独处」，不是「没人陪」。
const SOLO_LIBRARY = [
  { id: 'so1', title: '一个人的推理盒', kind: '解谜盒', minutes: 90, price: 39, needs: ['纸笔'], hook: '一叠信件、一张地图、一个没有答案的问题', mood: '专注' },
  { id: 'so2', title: '沉浸音频剧《夜航》', kind: '音频', minutes: 70, price: 18, needs: ['耳机', '关灯'], hook: '跟着声音走一段夜路，中途不能停', mood: '放空' },
  { id: 'so3', title: '单人剧本《最后一位房客》', kind: '单人本', minutes: 110, price: 45, needs: ['一个安静的晚上'], hook: '整栋楼只剩你和一封信', mood: '沉浸' },
  { id: 'so4', title: '翻出老本，自己分饰三角', kind: '零成本', minutes: 60, price: 0, needs: ['一本旧剧本'], hook: '把台词念出声，你会发现新东西', mood: '怀旧' },
  { id: 'so5', title: '纸上推演：重建一个案发现场', kind: '零成本', minutes: 80, price: 0, needs: ['一张纸', '一支笔'], hook: '画三条时间线，看它们在哪一刻对不上', mood: '专注' },
]

// ── AI NPC 模板 ───────────────────────────────────────────
// 缺人不必等。NPC 不是陪聊机器人，它要有立场、会隐瞒、能顶嘴，
// 否则「跟 AI 玩」就变成了「跟客服玩」。
const NPC_TEMPLATES = [
  { id: 'n1', name: '老周', role: '退休刑警', temper: '嘴硬心软，先泼冷水再给线索', line: '这案子我见过。当年没人信我。', secret: '他认识死者，但不说。' },
  { id: 'n2', name: '阿棠', role: '客栈老板娘', temper: '笑面，句句带钩子', line: '客官来得巧，昨天刚走一位。', secret: '账本上少了一页。' },
  { id: 'n3', name: '小满', role: '跑腿的学徒', temper: '话多、怕事、爱打听', line: '我什么都没看见——真的，我发誓。', secret: '他看见了，但不敢说。' },
  { id: 'n4', name: '沈先生', role: '账房先生', temper: '冷静，只谈数字不谈人', line: '账是平的。人不是。', secret: '他改过一个数字。' },
  { id: 'n5', name: '林小姐', role: '戏班台柱', temper: '骄傲，被戳到就翻脸', line: '台上台下，我演的从来不是同一个人。', secret: '她那晚不在戏班。' },
  { id: 'n6', name: '老K', role: '牌桌上的常客', temper: '油滑，永远只说一半', line: '你想听真话？先押点东西。', secret: '他替人打过一通电话。' },
]

// ── 场地库 ────────────────────────────────────────────────
const VENUE_LIBRARY = [
  { id: 'v01', name: '西夏夜话推理馆', city: '银川', capacity: 8, price: 68, tags: ['古风', '包间', '安静'], distanceKm: 3.2, rating: 4.8 },
  { id: 'v02', name: '阅海·沉浸剧场', city: '银川', capacity: 10, price: 88, tags: ['实景', '大空间'], distanceKm: 5.6, rating: 4.7 },
  { id: 'v03', name: '鼓楼小院桌游', city: '银川', capacity: 6, price: 45, tags: ['平价', '轻本'], distanceKm: 1.8, rating: 4.5 },
  { id: 'v04', name: '金凤万达·谜屋', city: '银川', capacity: 8, price: 75, tags: ['商圈', '好停车'], distanceKm: 4.1, rating: 4.6 },
  { id: 'v05', name: '家里客厅（自助）', city: '银川', capacity: 6, price: 0, tags: ['零成本', '熟人局'], distanceKm: 0, rating: 5.0 },
]

// ── 茶歇组合（按人均预算档）────────────────────────────────
const CATERING_LIBRARY = [
  { id: 'c01', name: '基础茶水（八宝茶 + 瓜子）', perPerson: 12, tags: ['零负担'] },
  { id: 'c02', name: '轻食拼盘（水果 + 坚果）', perPerson: 22, tags: ['不脏手'] },
  { id: 'c03', name: '正餐外卖（面食为主）', perPerson: 35, tags: ['管饱'] },
  { id: 'c04', name: '酒局配置（本地干红 + 奶酪）', perPerson: 68, tags: ['成人局'] },
]

// ── 需求实体词典（规则抽取用）──────────────────────────────
const SYMPTOM_WORDS = {
  胃敏感: ['胃不舒服', '胃疼', '胃痛', '胃胀', '反酸', '拉肚子', '肠胃'],
  上火: ['上火', '口腔溃疡', '嗓子疼', '长痘', '口干'],
  没胃口: ['没胃口', '不想吃', '吃不下'],
  乏力: ['累', '乏力', '没精神', '犯困', '加班'],
  失眠: ['失眠', '睡不着', '熬夜'],
  宿醉: ['宿醉', '喝多了', '头疼'],
}

const TASTE_WORDS = {
  不吃辣: ['不吃辣', '不能吃辣', '不要辣'],
  重辣: ['重辣', '特辣', '无辣不欢'],
  微辣: ['微辣', '一点点辣', '别太辣', '不要太辣', '少辣', '少放辣'],
  清淡: ['清淡', '少油', '少盐'],
  重口: ['重口', '味重', '咸一点'],
  偏甜: ['甜', '喜甜'],
}

module.exports = {
  FACT_DIMENSIONS,
  INTENTS,
  ELEMENT_TASTE,
  GENERATE,
  OVERCOME,
  DISH_LIBRARY,
  SCRIPT_LIBRARY,
  SOLO_LIBRARY,
  NPC_TEMPLATES,
  VENUE_LIBRARY,
  CATERING_LIBRARY,
  SYMPTOM_WORDS,
  TASTE_WORDS,
}
