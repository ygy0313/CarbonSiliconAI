'use strict'

// 脱敏：在「记录落库」这一步就把可识别个人的信息剥离。
//
// 原则：
//   1) 先脱敏、再存储 —— 明文永远不进主库，只进加密保险箱（vault）；
//   2) 剥离而不是打码 —— 手机号保留中间四位毫无意义，直接换成占位符；
//   3) 可逆但需授权 —— 占位符 ↔ 原值的映射表加密保存，只有拿到授权票据才能还原；
//   4) 宁可多脱 —— 误脱一段地址只损失一点上下文，漏脱一个身份证号是事故。
//
// 注意：正则不是万能的。真要做严，需要接 NER 模型；本模块是「成本零、可离线、可回归测试」
// 的基线，能挡住绝大多数正常人写记录时会顺手写进去的东西。

// 顺序即优先级：先长后短、先特异后宽泛，避免身份证被手机号规则切碎。
const RULES = [
  {
    type: 'ID_CARD',
    label: '身份证号',
    re: /(?<![\dA-Za-z])[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![\dA-Za-z])/g,
  },
  {
    type: 'BANK_CARD',
    label: '银行卡号',
    re: /(?<!\d)(?:\d{4}[ -]?){3}\d{4,7}(?!\d)/g,
  },
  {
    type: 'PHONE',
    label: '手机号',
    re: /(?<!\d)(?:\+?86[ -]?)?1[3-9]\d{9}(?!\d)/g,
  },
  {
    type: 'EMAIL',
    label: '邮箱',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    type: 'PLATE',
    label: '车牌号',
    re: /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-HJ-NP-Z][A-HJ-NP-Z0-9]{4,5}[A-HJ-NP-Z0-9挂学警港澳]/g,
  },
  {
    type: 'IM_ACCOUNT',
    label: '社交账号',
    re: /(?:微信|weixin|wechat|wx|QQ|qq|钉钉|飞书)\s*(?:号|ID)?\s*[:：]?\s*([A-Za-z][-_A-Za-z0-9]{5,19}|\d{5,12})/g,
    // 只替换账号部分，保留「微信」这个词，否则句子读不通
    keepPrefix: true,
  },
  {
    type: 'ADDRESS',
    label: '详细地址',
    re: /[\u4e00-\u9fa5]{2,8}(?:省|自治区|特别行政区)?[\u4e00-\u9fa5]{2,8}(?:市|自治州|盟)[\u4e00-\u9fa5]{0,10}(?:区|县|旗|市)[\u4e00-\u9fa5]{0,20}?(?:路|街|道|巷|胡同|大道)\s*\d{1,4}\s*号(?:[\u4e00-\u9fa5\d]{0,10}(?:栋|幢|号楼|单元|层|室|门))?/g,
  },
  {
    type: 'GEO',
    label: '精确坐标',
    re: /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g,
  },
  {
    type: 'NAME',
    label: '姓名',
    // 只在明确的自我介绍句式里替换，避免把「张家口」这种地名当人名
    re: /(?:我叫|我的名字是|名字叫|称呼我|我是)\s*([\u4e00-\u9fa5]{2,4})(?=[，,。.！!？?\s]|$)/g,
    keepPrefix: true,
  },
]

const TOKEN_BY_TYPE = {
  ID_CARD: '证件号',
  BANK_CARD: '银行卡',
  PHONE: '手机号',
  EMAIL: '邮箱',
  PLATE: '车牌',
  IM_ACCOUNT: '账号',
  ADDRESS: '地址',
  GEO: '坐标',
  NAME: '称呼',
}

/**
 * 脱敏一段文本。
 * @returns {{text:string, hits:Array<{type,label,count}>, tokens:Array<{token,type,value}>}}
 *   tokens 里的 value 是原文，调用方必须加密后保存，**不得明文落库**。
 */
function redact(input) {
  let text = String(input == null ? '' : input)
  const tokens = []
  const counter = {}

  for (const rule of RULES) {
    // 每次 replace 需要重置 lastIndex（g 正则会被复用）
    rule.re.lastIndex = 0
    text = text.replace(rule.re, (match, captured) => {
      const value = rule.keepPrefix && captured ? captured : match
      if (!value) return match

      counter[rule.type] = (counter[rule.type] || 0) + 1
      const token = `<${TOKEN_BY_TYPE[rule.type]}${counter[rule.type]}>`
      tokens.push({ token, type: rule.type, value })

      if (!rule.keepPrefix) return token
      // 保留前缀（如「微信」），只把冒号后面的账号换掉
      const idx = match.lastIndexOf(value)
      return idx >= 0 ? match.slice(0, idx) + token : token
    })
  }

  const byType = {}
  for (const t of tokens) byType[t.type] = (byType[t.type] || 0) + 1

  return {
    text,
    hits: Object.entries(byType).map(([type, count]) => ({
      type,
      label: TOKEN_BY_TYPE[type],
      count,
    })),
    tokens,
  }
}

/**
 * 只体检不改写：给用户看「这句话里有什么会被抹掉」。
 */
function scan(input) {
  return redact(input).hits
}

/**
 * 深度脱敏：对对象里的所有字符串字段处理（记录里的 entities/summary 等）。
 */
function redactDeep(value) {
  const tokens = []
  const hits = {}

  function walk(v, depth = 0) {
    if (depth > 6) return v
    if (typeof v === 'string') {
      const r = redact(v)
      r.tokens.forEach(t => tokens.push(t))
      r.hits.forEach(h => { hits[h.type] = (hits[h.type] || 0) + h.count })
      return r.text
    }
    if (Array.isArray(v)) return v.map(x => walk(x, depth + 1))
    if (v && typeof v === 'object') {
      const out = {}
      for (const [k, val] of Object.entries(v)) out[k] = walk(val, depth + 1)
      return out
    }
    return v
  }

  const result = walk(value)
  return {
    value: result,
    tokens,
    hits: Object.entries(hits).map(([type, count]) => ({ type, label: TOKEN_BY_TYPE[type], count })),
  }
}

/**
 * 还原：把占位符换回原值。只有拿到授权、解开保险箱后才会调用。
 */
function restore(text, tokens) {
  let out = String(text || '')
  for (const t of tokens || []) {
    out = out.split(t.token).join(t.value)
  }
  return out
}

module.exports = { redact, redactDeep, scan, restore, RULES, TOKEN_BY_TYPE }
