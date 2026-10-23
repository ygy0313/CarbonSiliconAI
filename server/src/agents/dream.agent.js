'use strict'

// 能力：记梦（接「梦境」那条线）
//
// 这个能力刻意不做两件事：
//   1. 不解梦 —— 不给「预示/主凶吉/说明你缺钱」这类断言；
//   2. 不替用户写故事 —— 只给三幕骨架和提问，具体内容必须是他自己的梦。
//
// 它做三件事：
//   ① 把梦拆成「意象 + 情绪」，让模糊的东西有结构；
//   ② 如果这个意象以前梦到过，指出来（这才是「记忆」的价值，解梦网站给不了）；
//   ③ 给一个能继续写下去的三幕钩子，接「转连载故事」的下游。

const registry = require('./registry')
const dream = require('../domain/dream')

async function run(ctx) {
  const { rawText, profile } = ctx
  const text = String(rawText || '')

  const motifs = dream.detectMotifs(text).slice(0, 3)
  const tone = dream.detectTone(text)

  if (!motifs.length) {
    // 认不出意象也要给东西：先落一条记录，让人下次还能搜到
    return {
      items: [{
        id: 'dream_raw',
        kind: 'note',
        title: '这个梦先记下来了',
        desc: tone === '未说明' ? '还没读出明显的意象，但原文已经存好' : `情绪基调：${tone}。原文已经存好`,
        why: ['意象词典没命中，不代表梦没内容 —— 换个说法再说一遍，我能拆得更细'],
        evidence: [],
        score: 0.4,
        source: '起居注 · 记梦',
        meta: { tone, motifs: [], acts: [], genre: null },
      }],
      meta: { motifs: [], tone },
    }
  }

  const labels = motifs.map(m => m.label)
  const top = motifs[0]

  // ── 溯源：这个意象以前出现过吗 ──
  // 只比对「记忆摘要」里出现的意象词，不做语义联想，宁可漏也不瞎认。
  const episodes = profile?.episodes || []
  const prior = []
  for (const e of episodes) {
    const t = `${e.summary || ''}${e.text || ''}`
    if (motifs.some(m => m.words.some(w => t.includes(w)))) {
      prior.push({ episodeId: e.id, ts: e.ts, text: (e.summary || e.text || '').slice(0, 24) })
      if (prior.length >= 2) break
    }
  }

  const items = [
    {
      id: `dream_${top.key}`,
      kind: 'primary',
      title: `这个梦的主干：${labels.join(' · ')}`,
      desc: `${top.emotion}${tone !== '未说明' ? ` · 你说的情绪是「${tone}」` : ''} · ${top.question}`,
      why: [
        `意象排序按你话里的出现次数：${motifs.map(m => `${m.label}×${m.matched.length}`).join('、')}`,
        `主线是「${top.label}」，它通常和${top.emotion}绑在一起`,
        '这不是解梦结论，是给你自己回答的一个提问',
      ],
      evidence: prior.slice(0, 2),
      score: 0.8,
      source: '起居注 · 记梦',
      meta: {
        tone,
        genre: dream.GENRE_HINT[top.key] || null,
        motifs: motifs.map(m => ({ key: m.key, label: m.label, emotion: m.emotion, question: m.question })),
        acts: [],
        priorCount: prior.length,
      },
    },
    {
      id: 'dream_story',
      kind: 'option',
      title: `写成故事：${dream.GENRE_HINT[top.key] || '悬疑'}方向的三幕`,
      desc: `拿「${top.label}」当核心意象，${dream.ACT_TEMPLATE.length} 幕就能起个头，不用一次写完`,
      why: [
        top.hook,
        '先把第一幕写三百字，写完再决定要不要连载',
        '故事比解读安全：解读会被当真，故事不会',
      ],
      evidence: [],
      score: 0.6,
      source: '起居注 · 记梦',
      meta: {
        tone,
        genre: dream.GENRE_HINT[top.key] || null,
        hook: top.hook,
        acts: dream.ACT_TEMPLATE,
        // 前端（H5 / 小程序）已经会渲染 meta.timeline，这里复用同一条渲染线：
        // time 放幕次，text 放该幕的写法提示 —— 不用为了梦境单独加一套 UI。
        timeline: dream.ACT_TEMPLATE.map(a => ({ time: a.act.replace(/ · .*/, ''), text: a.hint })),
        motifs: motifs.map(m => ({ key: m.key, label: m.label })),
        priorCount: prior.length,
      },
    },
  ]

  return { items, meta: { motifs: labels, tone, priorCount: prior.length } }
}

registry.register({
  id: 'dream.record',
  service: '梦境',
  name: '记梦',
  icon: '🌙',
  description: '把梦拆成意象与情绪，指出反复出现的主题，再给一个三幕故事骨架（不解梦、不预测）',
  intents: ['dream'],
  needs: [],
  provides: [],
  cost: 'free',
  run,
})

module.exports = { run }
