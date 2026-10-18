'use strict'

// 仓储层底座：JSON 文件存储 + 内存索引 + 串行化写入。
//
// 为什么不用数据库：MVP 要 0 元跑通，且单用户数据量（千级 episode）用文件完全够。
// 迁移路径已预留：所有读写都走 Collection 接口，换 SQLite/Postgres 只替换本文件。

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const log = require('../logger')

class Collection {
  constructor(name, dir) {
    this.name = name
    this.file = path.join(dir, `${name}.json`)
    this.items = []
    // 写队列：同一集合的写入串行化，避免并发写导致文件损坏。
    this._writeChain = Promise.resolve()
  }

  load() {
    if (fs.existsSync(this.file)) {
      try {
        const raw = fs.readFileSync(this.file, 'utf8')
        this.items = raw.trim() ? JSON.parse(raw) : []
      } catch (err) {
        // 文件损坏不阻断启动：备份后重建，避免整个服务起不来。
        const backup = `${this.file}.corrupt-${Date.now()}`
        try { fs.renameSync(this.file, backup) } catch (_) {}
        log.error('集合文件损坏，已备份并重建', { collection: this.name, backup, error: err.message })
        this.items = []
      }
    } else {
      this.items = []
    }
    return this
  }

  _persist() {
    const snapshot = JSON.stringify(this.items, null, 2)
    this._writeChain = this._writeChain.then(async () => {
      const tmp = `${this.file}.tmp`
      await fsp.writeFile(tmp, snapshot, 'utf8')
      await fsp.rename(tmp, this.file) // 原子替换
    }).catch(err => {
      log.error('集合持久化失败', { collection: this.name, error: err.message })
    })
    return this._writeChain
  }

  all() {
    return this.items
  }

  find(predicate) {
    return this.items.filter(predicate)
  }

  findOne(predicate) {
    return this.items.find(predicate) || null
  }

  byId(id) {
    return this.items.find(item => item.id === id) || null
  }

  insert(doc) {
    this.items.push(doc)
    this._persist()
    return doc
  }

  update(id, patch) {
    const idx = this.items.findIndex(item => item.id === id)
    if (idx === -1) return null
    this.items[idx] = { ...this.items[idx], ...patch, updatedAt: new Date().toISOString() }
    this._persist()
    return this.items[idx]
  }

  upsert(id, doc) {
    const existing = this.byId(id)
    if (existing) return this.update(id, doc)
    return this.insert({ id, createdAt: new Date().toISOString(), ...doc })
  }

  remove(id) {
    const idx = this.items.findIndex(item => item.id === id)
    if (idx === -1) return false
    this.items.splice(idx, 1)
    this._persist()
    return true
  }

  async flush() {
    await this._writeChain
  }
}

class Store {
  constructor(dir) {
    this.dir = dir
    fs.mkdirSync(dir, { recursive: true })
    this.collections = {}
  }

  collection(name) {
    if (!this.collections[name]) {
      this.collections[name] = new Collection(name, this.dir).load()
    }
    return this.collections[name]
  }

  async flushAll() {
    await Promise.all(Object.values(this.collections).map(c => c.flush()))
  }
}

module.exports = { Store, Collection }
