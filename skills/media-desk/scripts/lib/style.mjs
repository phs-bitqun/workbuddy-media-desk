// 风格卡 → 写作要求。移植自上游 src/style.js 的 styleToVoice。

/** 把风格卡变成一段写作要求，直接塞进成稿提示词。 */
export function styleToVoice(style) {
  if (!style) return ''
  const lines = [
    style.summary && `整体：${style.summary}`,
    style.tone && `语气：${style.tone}`,
    style.sentences && `句式：${style.sentences}`,
    style.opening && `开头：${style.opening}`,
    style.structure && `结构：${style.structure}`,
    style.logic && `逻辑：${style.logic}`,
    style.story && `讲述：${style.story}`,
    style.flow && `衔接：${style.flow}`,
    style.words?.length && `常用词：${style.words.join('、')}`,
    style.avoid?.length && `绝不要：${style.avoid.join('、')}`,
    style.samples?.length && `样句（学节奏，不要照抄）：\n${style.samples.map(row => `- ${row}`).join('\n')}`,
  ]
  return lines.filter(Boolean).join('\n')
}

export const FORMATS = ['script', 'article']
export const draftFormat = value => (value === 'article' ? 'article' : 'script')
