'use strict'

// 仓储层：只负责「怎么存取」，不含任何业务规则。
// 上层（service）通过这里访问数据，不直接碰 Collection。

const crypto = require('crypto')
const { Store } = require('./db')

const newId = prefix => `${prefix}_${crypto.randomBytes(8).toString('hex')}`

function createRepos(dataDir) {
  const store = new Store(dataDir)
  const persons = store.collection('persons')
  const facts = store.collection('facts')
  const episodes = store.collection('episodes')
  const traits = store.collection('traits')
  const invocations = store.collection('invocations')
  const conflicts = store.collection('conflicts')
  const grants = store.collection('grants')
  const audits = store.collection('audits')
  // 经验层：用户「经验资产」的存放处，与事实层分开 —— 事实是 is，经验是 how。
  const experiences = store.collection('experiences')
  const criteria = store.collection('criteria')
  // 日程：用户认下的事。与记忆分开 —— 记忆是发生过，日程是还没发生。
  const agenda = store.collection('agenda')

  return {
    store,

    // ── 人（一个 person 就是一位用户的宿主）──
    person: {
      get: id => persons.byId(id),
      list: () => persons.all(),
      create: doc => persons.insert({ id: doc.id || newId('p'), createdAt: new Date().toISOString(), ...doc }),
      update: (id, patch) => persons.update(id, patch),
    },

    // ── 事实层：可核对、可修正的声明 ──
    fact: {
      byPerson: personId => facts.find(f => f.personId === personId),
      get: (personId, key) => facts.findOne(f => f.personId === personId && f.key === key),
      upsert: (personId, key, value, meta = {}) => {
        const existing = facts.findOne(f => f.personId === personId && f.key === key)
        if (existing) {
          return facts.update(existing.id, { value, ...meta })
        }
        return facts.insert({
          id: newId('f'),
          personId,
          key,
          value,
          confidence: 0.6,
          source: 'user_record',
          createdAt: new Date().toISOString(),
          ...meta,
        })
      },
      remove: id => facts.remove(id),
    },

    // ── 记忆层：带时间戳的行为事件 ──
    episode: {
      byPerson: (personId, limit = 200) =>
        episodes
          .find(e => e.personId === personId)
          .sort((a, b) => (a.ts < b.ts ? 1 : -1))
          .slice(0, limit),
      get: id => episodes.byId(id),
      insert: doc => episodes.insert({
        id: newId('e'),
        createdAt: new Date().toISOString(),
        ...doc,
      }),
      all: () => episodes.all(),
    },

    // ── 画像层：从记忆归纳出的倾向 ──
    trait: {
      byPerson: personId => traits.find(t => t.personId === personId),
      upsert: (personId, name, patch) => {
        const existing = traits.findOne(t => t.personId === personId && t.name === name)
        if (existing) return traits.update(existing.id, patch)
        return traits.insert({
          id: newId('t'),
          personId,
          name,
          value: 0,
          confidence: 0.3,
          evidence: [],
          createdAt: new Date().toISOString(),
          ...patch,
        })
      },
      remove: id => traits.remove(id),
    },

    // ── 调用记录：编排一次 = 一条 invocation ──
    invocation: {
      get: id => invocations.byId(id),
      byPerson: (personId, limit = 20) =>
        invocations
          .find(i => i.personId === personId)
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .slice(0, limit),
      insert: doc => invocations.insert({
        id: newId('inv'),
        createdAt: new Date().toISOString(),
        ...doc,
      }),
      update: (id, patch) => invocations.update(id, patch),
    },

    // ── 冲突队列：档案与外部事实不一致时进这里，等用户裁决 ──
    conflict: {
      byPerson: personId => conflicts.find(c => c.personId === personId && c.status === 'open'),
      get: id => conflicts.byId(id),
      insert: doc => conflicts.insert({ id: newId('c'), createdAt: new Date().toISOString(), status: 'open', ...doc }),
      update: (id, patch) => conflicts.update(id, patch),
      all: () => conflicts.all(),
    },

    // ── 授权票据：用户对「读取 prompt / 导出 / 还原原文」的显式许可 ──
    grant: {
      get: id => grants.byId(id),
      byPerson: personId => grants.find(g => g.personId === personId),
      findOne: predicate => grants.findOne(predicate),
      insert: doc => grants.insert({ createdAt: new Date().toISOString(), used: 0, revoked: false, ...doc }),
      update: (id, patch) => grants.update(id, patch),
    },

    // ── 审计日志：签发、使用、拒绝都留痕，只追加不修改 ──
    audit: {
      byPerson: personId => audits.find(a => a.personId === personId),
      insert: doc => audits.insert({ id: newId('a'), ...doc }),
      all: () => audits.all(),
    },

    // ── 经验层 ──
    // 隔离是硬约束：任何按 id 取经验的方法都必须带 personId，
    // 跨人访问一律当作「不存在」，返回 null 而不是报「无权限」——
    // 不泄漏「这条经验存在」本身就是隔离的一部分。
    experience: {
      byPerson: (personId, { status = null, limit = 500 } = {}) => {
        const rows = experiences.find(e => e.personId === personId && (!status || e.status === status))
        return rows
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
          .slice(0, limit)
      },
      get: (personId, id) => {
        const e = experiences.byId(id)
        return e && e.personId === personId ? e : null
      },
      insert: doc => experiences.insert({ id: newId('x'), ...doc }),
      update: (id, patch) => experiences.update(id, patch),
      remove: id => experiences.remove(id),
      countAll: () => experiences.all().length,
    },

    // ── 经验评估标准（双环约束点）──
    // 每个用户一份，带版本号和确认时间。反思只能读，不能改。
    criteria: {
      get: personId => criteria.findOne(c => c.personId === personId),
      upsert: (personId, doc) => {
        const existing = criteria.findOne(c => c.personId === personId)
        if (existing) return criteria.update(existing.id, doc)
        return criteria.insert({ id: newId('cr'), personId, ...doc })
      },
    },

    // ── 日程：某天某一刻要做的一件事 ──
    // 隔离规则与经验一致：按 id 取时必须带 personId，跨人一律当作不存在。
    agenda: {
      byPerson: personId => agenda.find(a => a.personId === personId),
      get: (personId, id) => {
        const a = agenda.byId(id)
        return a && a.personId === personId ? a : null
      },
      insert: doc => agenda.insert({
        id: newId('ag'),
        createdAt: new Date().toISOString(),
        done: false,
        ...doc,
      }),
      update: (id, patch) => agenda.update(id, patch),
      remove: id => agenda.remove(id),
      countAll: () => agenda.all().length,
    },

    newId,
  }
}

module.exports = { createRepos }
