'use strict'

// 入局问答的写入层：把「选了个选项」变成「档案里多了一条事实」。

const quiz = require('../domain/quiz')
const { FACT_DIMENSIONS } = require('../domain/taxonomy')
const { ValidationError, NotFoundError } = require('../errors')

const VALID_KEYS = new Set(FACT_DIMENSIONS.map(d => d.key))

function applyAnswer(repos, personId, questionId, optionKey) {
  const person = repos.person.get(personId)
  if (!person) throw new NotFoundError('找不到这个人')

  const question = quiz.get(questionId)
  if (!question) throw new ValidationError(`没有这道题：${questionId}`)

  const option = quiz.answerOf(questionId, optionKey)
  if (!option) throw new ValidationError(`选项不存在：${optionKey}`)

  const factChanges = []
  for (const [key, value] of Object.entries(option.facts || {})) {
    // 只允许写进词典里定义过的维度，防止问答内容弄脏档案
    if (!VALID_KEYS.has(key)) continue
    const before = repos.fact.get(personId, key)
    repos.fact.upsert(personId, key, value, {
      confidence: 0.85,
      source: 'quiz',
      note: `入局问答：${question.id}`,
      updatedAt: new Date().toISOString(),
    })
    factChanges.push({
      key,
      label: (FACT_DIMENSIONS.find(d => d.key === key) || {}).label || key,
      action: before ? (String(before.value) === String(value) ? 'confirmed' : 'updated') : 'created',
      before: before?.value ?? null,
      after: value,
    })
  }

  const answered = { ...(person.quiz || {}), [questionId]: optionKey }
  repos.person.update(personId, { quiz: answered, quizUpdatedAt: new Date().toISOString() })

  return {
    questionId,
    optionKey,
    quip: option.quip,
    factChanges,
    progress: quiz.progress(repos, personId),
  }
}

module.exports = { applyAnswer }
