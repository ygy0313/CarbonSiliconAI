'use strict'

// 定位：只做「经纬度 → 就近城市」这一件事。
//
// 为什么不做完整逆地理编码：那需要第三方地图密钥，而 MVP 阶段真正被用到的
// 只有「你现在在哪个城市」——城市决定天气、场地库、推荐口径。
// 就近城市用球面距离算，误差上限是相邻城市之间的距离，够用且零依赖。
// 坐标表与 weather.agent 的 CITY_COORDS 保持同源，避免两处漂移。

const CITY_COORDS = {
  银川: { lat: 38.49, lon: 106.23 },
  杭州: { lat: 30.27, lon: 120.15 },
  北京: { lat: 39.9, lon: 116.4 },
  上海: { lat: 31.23, lon: 121.47 },
  广州: { lat: 23.13, lon: 113.26 },
  深圳: { lat: 22.54, lon: 114.06 },
  成都: { lat: 30.57, lon: 104.07 },
  西安: { lat: 34.34, lon: 108.94 },
  兰州: { lat: 36.06, lon: 103.83 },
  武汉: { lat: 30.59, lon: 114.31 },
  南京: { lat: 32.06, lon: 118.8 },
  重庆: { lat: 29.56, lon: 106.55 },
  郑州: { lat: 34.75, lon: 113.63 },
  西宁: { lat: 36.62, lon: 101.78 },
}

const EARTH_R = 6371

function toRad(d) {
  return (d * Math.PI) / 180
}

// 球面距离（km）
function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// 就近城市；坐标非法时返回 null（调用方回退到档案里的城市）
function nearestCity(lat, lon) {
  const la = Number(lat)
  const lo = Number(lon)
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null
  let best = null
  for (const [city, c] of Object.entries(CITY_COORDS)) {
    const d = distanceKm({ lat: la, lon: lo }, c)
    if (!best || d < best.km) best = { city, km: Number(d.toFixed(1)) }
  }
  return best
}

// 请求体里的 geo 只接受数值，且只保留必要字段 —— 不把原始请求对象往下传
function normalizeGeo(input) {
  if (!input || typeof input !== 'object') return null
  const lat = Number(input.lat)
  const lon = Number(input.lon)
  const hit = nearestCity(lat, lon)
  if (!hit) return null
  return {
    lat: Number(lat.toFixed(5)),
    lon: Number(lon.toFixed(5)),
    city: hit.city,
    distanceKm: hit.km,
  }
}

module.exports = { CITY_COORDS, distanceKm, nearestCity, normalizeGeo }
