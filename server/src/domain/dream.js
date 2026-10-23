'use strict'

// 梦境素材库：梦不是预言，是可用的素材。
//
// 三条边界（写在代码里，避免以后被改歪）：
//   1. 不做解梦断言 —— 不出现「预示」「主凶吉」「财运」「姻缘」这类词；
//   2. 只提供两类东西：可自我观察的情绪线索 + 可写下去的故事骨架；
//   3. 意象词典只是「常见联想」，不是标准答案。卡片上永远写「可能」「你当时」。
//
// 这样这条能力才站得住：它不是在算命，是在帮你把一个模糊的梦拆成能工作的结构。

// emotion：这个意象最常见的情绪底色（不是定论，是提问的起点）
// question：让用户自己回答的问题 —— 比我们给结论有用得多
// hook：如果把它写成故事，哪一句能当第一句
const MOTIFS = [
  { key: 'water', label: '水', words: ['水', '海', '河', '游泳', '洪水', '下雨', '淹'], emotion: '失控与包围', question: '水是清的还是浑的？你在水里是能呼吸，还是憋着？', hook: '水是从脚踝开始涨的，等我想起来该跑的时候，它已经到腰了。' },
  { key: 'fall', label: '坠落', words: ['坠落', '掉下', '摔', '高楼', '悬崖', '电梯'], emotion: '失控前的失重', question: '掉下去的那一刻，你是醒着的还是已经在做梦了？', hook: '电梯往下走，楼层数字却一直往上跳。' },
  { key: 'chase', label: '被追', words: ['追', '逃', '跑', '躲', '藏'], emotion: '被逼近的压力', question: '回头看过吗？追你的人长什么样？', hook: '我不敢回头，但我听得出来，它跑起来的声音跟我一模一样。' },
  { key: 'fly', label: '飞行', words: ['飞', '飘', '悬空', '腾空'], emotion: '短暂的自主', question: '是飞得起来，还是只能悬着不掉下去？', hook: '我离地三米，够不着地面，也够不着屋顶。' },
  { key: 'exam', label: '考试', words: ['考试', '考', '答卷', '监考', '高考'], emotion: '被评价的紧张', question: '你是没复习，还是找不到考场？', hook: '卷子发下来，第一题的题干我认得，字我一个都不认识。' },
  { key: 'teeth', label: '牙齿脱落', words: ['牙', '掉牙', '牙齿'], emotion: '失去掌控的羞耻', question: '掉的时候有声音吗？旁边有人看见吗？', hook: '我用舌头一推，它们就像没长稳的瓷砖，一片一片松了。' },
  { key: 'dead', label: '故人', words: ['去世', '去世的', '死人', '故人', '爷爷', '奶奶', '爸', '妈'], emotion: '未说完的话', question: '他跟你说话了吗？说的是什么？', hook: '他坐在老位置上，像只是出门买了包烟回来。' },
  { key: 'door', label: '门与房间', words: ['门', '房间', '屋子', '走廊', '钥匙'], emotion: '边界与未知', question: '门是开着的，还是你怎么推都推不开？', hook: '这房子我住了十年，但走廊尽头那扇门，我一次都没开过。' },
  { key: 'lost', label: '迷路', words: ['迷路', '找不到', '走丢', '不认识'], emotion: '失去参照', question: '你是找不到路，还是找不到人？', hook: '每条街我都认识，但拼在一起，就不是我家那片了。' },
  { key: 'late', label: '迟到', words: ['迟到', '赶不上', '来不及', '错过'], emotion: '追赶不上时间', question: '赶不上的那件事，是真的重要，还是你以为重要？', hook: '我一直在跑，可车站的钟每次都比我快两分钟。' },
  { key: 'naked', label: '赤裸', words: ['裸', '没穿', '光着'], emotion: '被看穿的恐惧', question: '有人看你吗？他们在意吗？', hook: '所有人都在讲话，没有一个人看我一眼，这比看我更难受。' },
  { key: 'animal', label: '动物', words: ['猫', '狗', '蛇', '鸟', '虫', '马', '羊'], emotion: '本能的靠近或警惕', question: '它主动靠近你，还是你先退了一步？', hook: '那只猫一直跟着我，隔着三步，我停它也停。' },
  { key: 'fire', label: '火', words: ['火', '烧', '烟', '燃'], emotion: '愤怒或彻底的清理', question: '火是你点的，还是它自己起来的？', hook: '火很安静，安静到我能听见木头在里面裂开。' },
  { key: 'child', label: '孩子', words: ['孩子', '婴儿', '小孩', '宝宝'], emotion: '责任与旧伤', question: '那是谁的孩子？你抱得动吗？', hook: '我抱着他，他很轻，轻到我开始担心他是不是还在。' },
  { key: 'phone', label: '手机与失联', words: ['手机', '没电', '打不通', '信号', '微信'], emotion: '断联的焦虑', question: '你要打给谁？那个人现在还在你生活里吗？', hook: '手机满格电，但屏幕上只有一行字：不在服务区。' },
]

// 情绪基调：从用户自己的用词里读，不替他定义
const TONE_WORDS = [
  { tone: '压抑', words: ['喘不过', '压', '闷', '重', '动不了', '麻痹'] },
  { tone: '惊惶', words: ['怕', '吓', '恐怖', '毛骨悚然', '尖叫'] },
  { tone: '怅然', words: ['想念', '难过', '哭', '舍不得', '遗憾'] },
  { tone: '荒诞', words: ['奇怪', '莫名其妙', '不合逻辑', '离谱'] },
  { tone: '平静', words: ['安静', '舒服', '温暖', '好看'] },
]

// 三幕骨架：不写剧情，只给结构。具体内容必须由用户自己的梦填。
const ACT_TEMPLATE = [
  { act: '第一幕 · 常态里的一处不对', hint: '先把梦里的日常写实：地点、时间、谁在。再放一个说不通的小细节 —— 整篇的钩子就在这里。' },
  { act: '第二幕 · 规则被换掉', hint: '梦真正失控的那一下：水涨起来、门打不开、追的人出现。让主角做一次选择，哪怕是逃。' },
  { act: '第三幕 · 带回一件东西', hint: '醒来前最后看到的那个东西（一句话、一个物件、一张脸）。它是唯一能从梦里带回来的证据。' },
]

const GENRE_HINT = {
  water: '悬疑/心理',
  fall: '悬疑/惊悚',
  chase: '惊悚/动作',
  fly: '奇幻/成长',
  exam: '现实/黑色幽默',
  teeth: '身体恐怖/成长',
  dead: '家庭/情感',
  door: '悬疑/奇幻',
  lost: '公路/成长',
  late: '现实/荒诞',
  naked: '现实/羞耻喜剧',
  animal: '奇幻/寓言',
  fire: '灾难/情感',
  child: '家庭/悬疑',
  phone: '科幻/悬疑',
}

function detectMotifs(text) {
  const t = String(text || '')
  const hits = []
  for (const m of MOTIFS) {
    const matched = m.words.filter(w => t.includes(w))
    if (matched.length) hits.push({ ...m, matched })
  }
  // 命中多的排前面：一句话里反复出现的意象，通常就是梦的主干
  return hits.sort((a, b) => b.matched.length - a.matched.length)
}

function detectTone(text) {
  const t = String(text || '')
  for (const item of TONE_WORDS) {
    if (item.words.some(w => t.includes(w))) return item.tone
  }
  return '未说明'
}

module.exports = { MOTIFS, TONE_WORDS, ACT_TEMPLATE, GENRE_HINT, detectMotifs, detectTone }
