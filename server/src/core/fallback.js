'use strict'

// C++ 内核的 JS 镜像实现。
//
// 存在两个理由：
//   1. 内核没启动 / 编译不过 / 崩了，编排必须照跑（这是本项目的降级红线）；
//   2. 压测要有对照组，否则「C++ 更快」只是感觉。
//
// 算法必须与 core/src/kernel.cpp 逐项对齐：同样的权重、同样的闸门、同样的平滑。
// 改一边必须改另一边，check-experience.js 里有两条实现的同构断言。

const DAY = 86400000

function bigrams(text) {
  const cps = Array.from(text || '')
  const bag = new Map()
  if (!cps.length) return bag
  if (cps.length === 1) {
    bag.set(cps[0], 1)
    return bag
  }
  for (let i = 0; i + 1 < cps.length; i += 1) {
    const key = cps[i] + cps[i + 1]
    bag.set(key, (bag.get(key) || 0) + 1)
  }
  return bag
}

function cosine(ga, gb) {
  if (!ga.size || !gb.size) return 0
  let na = 0
  let nb = 0
  for (const v of ga.values()) na += v * v
  for (const v of gb.values()) nb += v * v
  if (na <= 0 || nb <= 0) return 0
  const [small, large] = ga.size <= gb.size ? [ga, gb] : [gb, ga]
  let dot = 0
  for (const [k, v] of small) {
    const other = large.get(k)
    if (other) dot += v * other
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function similarity(a, b) {
  if (!a || !b) return 0
  return cosine(bigrams(a), bigrams(b))
}

function rank(items, query = {}, criteria = {}, nowMs = Date.now()) {
  const q = {
    tags: query.tags || [],
    scene: query.scene || '',
    intent: query.intent || '',
    text: query.text || '',
    limit: query.limit || 5,
  }
  const c = {
    wEffective: num(criteria.wEffective, 0.45),
    wRecent: num(criteria.wRecent, 0.2),
    wSupport: num(criteria.wSupport, 0.2),
    wPrecision: num(criteria.wPrecision, 0.15),
    halfLifeDays: Math.max(1, num(criteria.halfLifeDays, 45)),
  }

  const hasQuery = !!(q.tags.length || q.scene || q.intent || q.text)
  const qbag = q.text ? bigrams(q.text) : null
  const out = []

  for (const e of items) {
    if (e.status === 'archived') continue

    const matched = []
    for (const t of e.tags || []) {
      if (q.tags.includes(t)) matched.push(t)
    }
    const tagMatch = q.tags.length ? matched.length / q.tags.length : 0
    const sceneMatch = q.scene && q.scene === e.scene ? 1 : 0
    const intentMatch = q.intent && q.intent === e.intent ? 1 : 0

    let match
    if (!hasQuery) {
      match = 1
    } else {
      match = Math.max(tagMatch, sceneMatch * 0.85, intentMatch * 0.8)
      if (qbag && match < 0.85) {
        const textMatch = Math.max(cosine(qbag, bigrams(e.rule || '')), cosine(qbag, bigrams(e.text || '')))
        match = Math.max(match, textMatch * 0.9)
      }
      if (match < 0.15) continue
    }

    const sEffective = Math.max(0, Math.min(1, num(e.effectiveness, 0.5)))
    let sRecent
    if (!e.updatedAt) {
      sRecent = 0.5
    } else {
      const days = Math.max(0, (nowMs - e.updatedAt) / DAY)
      sRecent = Math.pow(0.5, days / c.halfLifeDays)
    }
    // evidence 可能是数组（原始记录）也可能已经是条数（内核入参），两种都要能吃
    const evidenceCount = Array.isArray(e.evidence) ? e.evidence.length : Number(e.evidence) || 0
    const n = (Number(e.applied) || 0) + evidenceCount
    const sSupport = n <= 0 ? 0 : Math.min(1, Math.log1p(n) / Math.log(11))
    const sPrecision = ((e.followed || 0) + 1) / ((e.applied || 0) + 2)

    const quality =
      c.wEffective * sEffective + c.wRecent * sRecent + c.wSupport * sSupport + c.wPrecision * sPrecision

    out.push({
      id: e.id,
      rule: e.rule || '',
      score: round3(match * quality),
      match: round3(match),
      sEffective: round3(sEffective),
      sRecent: round3(sRecent),
      sSupport: round3(sSupport),
      sPrecision: round3(sPrecision),
      matched,
      why: buildWhy(matched, sEffective, e),
    })
  }

  out.sort((a, b) => (Math.abs(b.score - a.score) > 1e-9 ? b.score - a.score : 0))
  return q.limit > 0 ? out.slice(0, q.limit) : out
}

function buildWhy(matched, sEffective, e) {
  const parts = []
  if (matched.length) parts.push(`命中「${matched[0]}」`)
  if (sEffective >= 0.6) parts.push('有效率偏高')
  else if (sEffective < 0.35) parts.push('有效率偏低')
  if (e.applied > 0) parts.push(`用过 ${e.applied} 次、${e.followed || 0} 次奏效`)
  return parts.join('；')
}

const SCENE_LABEL = {
  solo: '一个人独处',
  group: '朋友聚会',
  npc: '和 AI 搭子',
  work: '工作场景',
}

function sceneLabel(code) {
  if (!code) return '日常'
  return SCENE_LABEL[code] || code
}

function mine(events, minSupport = 2) {
  const floor = Math.max(2, minSupport)
  const groups = new Map()

  for (const ev of events) {
    if (ev.verdict !== 'accept' && ev.verdict !== 'reject') continue
    if (!ev.title) continue
    const keys = (ev.tags || []).map(t => `t:${t}`)
    if (ev.scene) keys.push(`s:${ev.scene}`)

    for (const key of keys) {
      if (!groups.has(key)) {
        groups.set(key, {
          accept: 0,
          reject: 0,
          tags: ev.tags || [],
          scene: ev.scene || '',
          acceptTitles: new Map(),
          rejectTitles: new Map(),
          evidence: [],
        })
      }
      const ag = groups.get(key)
      if (!ag.tags.length) ag.tags = ev.tags || []
      if (!ag.scene) ag.scene = ev.scene || ''
      if (ev.verdict === 'accept') {
        ag.accept += 1
        ag.acceptTitles.set(ev.title, (ag.acceptTitles.get(ev.title) || 0) + 1)
      } else {
        ag.reject += 1
        ag.rejectTitles.set(ev.title, (ag.rejectTitles.get(ev.title) || 0) + 1)
      }
      ag.evidence.push({ ts: ev.ts || 0, id: ev.id })
    }
  }

  const out = []
  for (const [key, ag] of groups) {
    const support = ag.accept + ag.reject
    if (support < floor) continue

    const acceptRatio = ag.accept / support
    const rejectRatio = ag.reject / support

    const cand = {
      tags: ag.tags,
      scene: ag.scene,
      accept: ag.accept,
      reject: ag.reject,
      support,
      action: '',
      title: '',
      precision: 0,
      rule: '',
      evidenceIds: [],
    }

    let subject
    if (key.startsWith('t:')) {
      subject = `「${key.slice(2)}」这类情境`
      cand.tags = [key.slice(2)]
    } else {
      subject = `「${sceneLabel(ag.scene)}」时`
    }

    if (acceptRatio >= 0.6) {
      cand.action = 'prefer'
      cand.title = topKey(ag.acceptTitles)
      cand.precision = acceptRatio
      cand.rule = `在${subject}下，优先「${cand.title}」——过去 ${ag.accept}/${support} 次你都采纳了。`
    } else if (rejectRatio >= 0.6) {
      cand.action = 'avoid'
      cand.title = topKey(ag.rejectTitles)
      cand.precision = rejectRatio
      cand.rule = `在${subject}下，避开「${cand.title}」——过去 ${ag.reject}/${support} 次你都否掉了。`
    } else {
      continue
    }

    cand.evidenceIds = ag.evidence
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 6)
      .map(x => x.id)
    out.push(cand)
  }

  out.sort((a, b) => (Math.abs(b.precision - a.precision) > 1e-9 ? b.precision - a.precision : b.support - a.support))

  const dedup = []
  for (const c of out) {
    if (dedup.some(d => (d.action === c.action && d.title === c.title) || d.rule === c.rule)) continue
    dedup.push(c)
  }
  return dedup
}

function topKey(counter) {
  let best = ''
  let bestN = 0
  for (const [k, v] of counter) {
    if (v > bestN) {
      bestN = v
      best = k
    }
  }
  return best
}

function num(v, def) {
  return typeof v === 'number' && Number.isFinite(v) ? v : def
}

function round3(v) {
  if (!Number.isFinite(v)) return 0
  return Math.round(v * 1000) / 1000
}

module.exports = { rank, mine, similarity, sceneLabel, bigrams }
