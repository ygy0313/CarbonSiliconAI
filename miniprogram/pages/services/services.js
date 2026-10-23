const api = require('../../utils/api')

const NEED_LABEL = {
  'profile.diet': '饮食档案',
  'profile.social': '社交档案',
  'context.fortune': '今日节律',
  'context.weather': '天气',
  'context.calendar': '日程',
  'context.venue': '场地',
  'context.catering': '茶歇',
  'context.wine': '选酒',
}

const FALLBACK = [
  { id: 'meal.prepare', service: '给您请安', name: '今日膳食', icon: '🍲', description: '按口味、身体状态、天气、今日宜味和预算推荐三道菜', needs: ['context.fortune', 'context.weather', 'profile.diet'], intents: ['eat', 'drink'], cost: 'free' },
  { id: 'fortune.today', service: '给您请安', name: '今日节律', icon: '☯', description: '干支与五行给出今日节奏与宜忌味道', needs: [], intents: [], cost: 'free' },
  { id: 'mystery.pick', service: '剧本杀工坊', name: '剧本杀选本', icon: '🎭', description: '按人数、经验、题材、时长、预算挑本', needs: ['context.calendar', 'profile.social'], intents: ['gather'], cost: 'free' },
  { id: 'venue.suggest', service: '本地生活', name: '场地推荐', icon: '📍', description: '按人数、距离、预算、场景推荐可开本的场地', needs: ['context.calendar'], intents: ['gather'], cost: 'free' },
  { id: 'catering.suggest', service: '本地生活', name: '茶歇配套', icon: '🍵', description: '按预算与忌口给茶歇组合', needs: ['profile.diet'], intents: ['gather'], cost: 'free' },
  { id: 'weather.now', service: '公共数据', name: '天气体感', icon: '☁', description: '实时天气，失败自动降级', needs: [], intents: [], cost: 'free' },
  { id: 'calendar.check', service: '公共数据', name: '日程核对', icon: '◷', description: '把模糊时间落到具体日期并检查冲突', needs: [], intents: [], cost: 'free' },
  // 离线兜底也要有两张新面孔，否则网络一断，用户会以为「选酒/记梦」没上线
  { id: 'wine.suggest', service: '九月葡园', name: '选酒', icon: '🍷', description: '按收礼人、场合、预算、配餐选一瓶，不报价', needs: ['context.fortune'], intents: ['gift', 'drink'], cost: 'free' },
  { id: 'dream.record', service: '梦境', name: '记梦', icon: '🌙', description: '把梦拆成意象与情绪，给三幕故事骨架，不解梦', needs: [], intents: ['dream'], cost: 'free' },
]

Page({
  data: {
    services: [],
    offline: false,
    enabled: 7,
  },

  onLoad() {
    this.load()
  },

  async load() {
    let list = FALLBACK
    try {
      const meta = await api.getMeta()
      if (meta.services && meta.services.length) list = meta.services
      this.setData({ offline: false })
    } catch (err) {
      this.setData({ offline: true })
    }

    const services = list.map(s => ({
      id: s.id,
      name: s.name,
      service: s.service,
      icon: s.icon || '·',
      description: s.description,
      cost: s.cost === 'free' ? '免费' : s.cost,
      needs: (s.needs || []).map(n => NEED_LABEL[n] || n),
      intents: (s.intents || []).length ? '主动可用' : '被其他服务调用',
      isEntry: (s.intents || []).length > 0,
    }))

    this.setData({ services, enabled: services.length })
  },
})
