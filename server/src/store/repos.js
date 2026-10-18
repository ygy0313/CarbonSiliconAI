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

  return {
    store,

    // ── 人（一个 person 就是一个硅基体的宿主）──
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

    newId,
  }
}

module.exports = { createRepos }
