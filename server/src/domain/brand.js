'use strict'

// 品牌与对外文案的唯一来源。
// 红线：对外任何位置不得出现「硅基记忆体 / 碳基 / 硅基」这类技术隐喻，
// 一律通过这里读取，改名只改本文件。

const BRAND = {
  // 正式名：古代专记帝王言行的官署档案，取「如实记录一个人」之意
  name: '起居注',
  fullName: '起居注 · 一个人的档案',
  enName: 'QiJuZhu',

  tagline: '一个人的起居注',
  slogan: '记下你怎么活，替你安排下一步',
  intro: '它不问你想要什么，它记得你怎么活的。',

  // 导出格式标识，写进导出文件，导入时校验
  exportFormat: 'qijuzhu/v1',
  exportExt: '.qjz.json',

  // 服务代号（内部用，可出现在接口里，但不做对外展示）
  serviceCode: 'qijuzhu',

  // 对外角色称谓：不叫「硅基体」，叫「执笔」（替你记事的人）
  personaName: '执笔',
  personaDesc: '替你记事、替你安排的那个人',

  version: '0.2.0',
}

module.exports = { BRAND }
