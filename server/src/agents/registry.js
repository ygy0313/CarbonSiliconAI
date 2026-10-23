'use strict'

// 能力注册表：所有「生活服务 Agent」在这里声明自己能干什么、需要什么。
//
// 关键机制 —— needs / provides 声明式依赖：
//   agent 不互相调用，只声明「我消费 context.fortune，我产出 dishes」。
//   编排器据此自动拼装依赖图（谁提供 context.fortune，就自动把它拉进来执行）。
//   新增一个服务只需注册一个文件，编排器不用改一行代码 —— 这是「链接已有 app/agent/skills」的落点。

const agents = new Map()

// context.* 依赖 → 由哪个 agent 提供
const DEP_PROVIDERS = {
  'context.fortune': 'fortune.today',
  'context.weather': 'weather.now',
  'context.venue': 'venue.suggest',
  'context.catering': 'catering.suggest',
  'context.calendar': 'calendar.check',
  'context.wine': 'wine.suggest',
}

function register(agent) {
  if (!agent.id || typeof agent.run !== 'function') {
    throw new Error(`能力注册失败：${agent.id || '(no id)'} 缺少 id 或 run()`)
  }
  agents.set(agent.id, {
    needs: [],
    provides: [],
    intents: [],
    cost: 'free',
    enabled: true,
    ...agent,
  })
  return agent.id
}

function get(id) {
  return agents.get(id) || null
}

function list() {
  return [...agents.values()].map(a => ({
    id: a.id,
    service: a.service,
    name: a.name,
    icon: a.icon || '·',
    description: a.description,
    intents: a.intents,
    needs: a.needs,
    provides: a.provides,
    cost: a.cost,
    enabled: a.enabled,
  }))
}

function candidatesFor(intentType) {
  return [...agents.values()].filter(a => a.enabled && a.intents.includes(intentType))
}

/**
 * 依赖解析：从种子 agent 出发，递归展开 context.* 依赖，返回分层执行计划。
 * 同层可并行执行，层与层之间串行。
 */
function resolvePlan(seedIds) {
  const included = new Map() // id -> { agent, depth }
  const queue = [...seedIds].map(id => ({ id, depth: 0 }))

  while (queue.length) {
    const { id, depth } = queue.shift()
    const agent = agents.get(id)
    if (!agent || !agent.enabled) continue
    if (included.has(id)) continue
    included.set(id, { agent, depth })

    for (const need of agent.needs) {
      const providerId = DEP_PROVIDERS[need]
      if (providerId && !included.has(providerId)) {
        queue.push({ id: providerId, depth: depth + 1 })
      }
    }
  }

  // 按 depth 分层：depth 大的先执行（依赖在下游）
  const maxDepth = Math.max(0, ...[...included.values()].map(v => v.depth))
  const layers = []
  for (let d = maxDepth; d >= 0; d--) {
    const layer = [...included.values()].filter(v => v.depth === d).map(v => v.agent.id)
    if (layer.length) layers.push(layer)
  }
  return { layers, total: included.size }
}

module.exports = { register, get, list, candidatesFor, resolvePlan, DEP_PROVIDERS }
