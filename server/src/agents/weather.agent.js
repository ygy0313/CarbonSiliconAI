'use strict'

// 能力：天气体感
// 真实数据源用 Open-Meteo（免费、无需密钥、无需注册）；取不到则用确定性 mock 降级，
// 保证离线环境下编排链路依然完整可演示。

const registry = require('./registry')

const CITY_COORDS = {
  银川: { lat: 38.49, lon: 106.23 },
  杭州: { lat: 30.27, lon: 120.15 },
  北京: { lat: 39.9, lon: 116.4 },
  上海: { lat: 31.23, lon: 121.47 },
}

// 确定性伪随机：同一城市同一天永远同一个结果，demo 可复现。
function seeded(seed) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h % 1000) / 1000
}

const CONDITIONS = ['晴', '多云', '阴', '小雨', '雨夹雪', '雪']

function mockWeather(city, date) {
  const key = `${city}-${date.toISOString().slice(0, 10)}`
  const r = seeded(key)
  const month = date.getMonth() + 1
  // 银川气候：冬冷夏热，昼夜温差大
  const seasonal = 13 - 14 * Math.cos((2 * Math.PI * (month - 1)) / 12)
  const temp = Math.round(seasonal + r * 8 - 4)
  const condition = CONDITIONS[Math.floor(r * CONDITIONS.length)]
  return {
    city,
    temp,
    condition,
    feels: temp <= 8 ? '冷' : temp <= 16 ? '凉' : temp <= 26 ? '舒适' : '热',
    source: 'mock',
  }
}

async function fetchWeather(city) {
  const coords = CITY_COORDS[city] || CITY_COORDS['银川']
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,weather_code&timezone=Asia%2FShanghai`
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    const data = await res.json()
    const t = data?.current?.temperature_2m
    if (typeof t !== 'number') return null
    const code = data?.current?.weather_code
    return {
      city,
      temp: Math.round(t),
      condition: code <= 1 ? '晴' : code <= 3 ? '多云' : code <= 67 ? '雨' : code <= 77 ? '雪' : '阴',
      feels: t <= 8 ? '冷' : t <= 16 ? '凉' : t <= 26 ? '舒适' : '热',
      source: 'open-meteo',
    }
  } catch (_) {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const CACHE_TTL_MS = 10 * 60 * 1000
const cache = new Map()

async function run(ctx) {
  const city = ctx.facts['life.city'] || ctx.profile?.person?.city || '银川'
  const hit = cache.get(city)
  let w
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    w = hit.value
  } else {
    const real = await fetchWeather(city)
    w = real || mockWeather(city, ctx.now || new Date())
    cache.set(city, { at: Date.now(), value: w })
  }

  const advice = []
  if (w.feels === '冷') advice.push('天冷，汤类和水煮的更合适')
  if (w.feels === '热') advice.push('天热，凉菜和清爽的更合适')
  if (w.condition.includes('雨')) advice.push('下雨，优先就近或点外卖')
  if (w.condition.includes('雪')) advice.push('下雪，别跑远，热乎的最重要')

  return {
    items: [{
      id: 'weather_today',
      kind: 'context',
      title: `${w.city} ${w.temp}°C ${w.condition}`,
      desc: advice[0] || '天气对选择影响不大',
      why: [`体感${w.feels}`, w.source === 'mock' ? '离线模拟数据' : '实时天气'],
      score: 0.4,
      source: '天气服务',
    }],
    meta: w,
  }
}

registry.register({
  id: 'weather.now',
  service: '公共数据',
  name: '天气体感',
  icon: '☁',
  description: '实时天气，失败自动降级为离线模拟',
  intents: [],
  needs: [],
  provides: ['context.weather'],
  cost: 'free',
  run,
})

module.exports = { run, mockWeather }
