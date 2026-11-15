// 状态操作层：CLI 的唯一写入口。模型输出和用户输入都是不可信输入，这里只放行白名单字段。
// 移植自上游 src/ops.js + src/produce.js 的 normalizePlan / applyRevision。
import { draftFormat, styleToVoice } from './style.mjs'

export const STATUSES = ['idea', 'outline', 'draft', 'ready', 'published']
export const STATUS_LABEL = { idea: '灵感', outline: '大纲', draft: '草稿', ready: '待发布', published: '已发布' }
export const KINDS = ['image', 'video', 'web', 'quote', 'note']
export const PLATFORMS = ['公众号', '小红书', '抖音', 'B站', '视频号', 'TikTok', 'Instagram', 'YouTube', 'X']

export const statusLabel = status => STATUS_LABEL[status] ?? String(status)

let counter = 0
export function newId(prefix = 'x') {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

const isHttpUrl = value => {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function coerce(type, value) {
  switch (type) {
    case 'text': return typeof value === 'string' ? value.slice(0, 40000) : undefined
    case 'id': return value === null || typeof value === 'string' ? value : undefined
    case 'kind': return KINDS.includes(value) ? value : undefined
    case 'status': return STATUSES.includes(value) ? value : undefined
    case 'platform': return value === null || PLATFORMS.includes(value) ? value : undefined
    case 'list': return Array.isArray(value) ? value.filter(v => typeof v === 'string').slice(0, 24) : undefined
    case 'bool': return typeof value === 'boolean' ? value : undefined
    case 'num': return Number.isFinite(value) ? value : undefined
    case 'url': return value === null || value === '' ? null : isHttpUrl(value) ? value : undefined
    case 'date': return value === null ? null : typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined
    default: return undefined
  }
}

const ITEM_FIELDS = {
  title: 'text', body: 'text', kind: 'kind', url: 'url', source: 'text', tags: 'list', status: 'status', platform: 'platform',
}

function pick(fields, input) {
  const out = {}
  for (const [key, type] of Object.entries(fields)) {
    if (input?.[key] === undefined) continue
    const value = coerce(type, input[key])
    if (value !== undefined) out[key] = value
  }
  return out
}

const short = (text, n = 22) => {
  const s = String(text || '').trim()
  return s.length > n ? `${s.slice(0, n)}…` : s
}

export function findItem(state, id) {
  const item = state.items.find(row => row.id === id)
  if (!item) throw new Error(`找不到条目：${id}`)
  return item
}

const pad = v => String(v).padStart(2, '0')
export function fmtShort(iso) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
export function fmtWhen(iso) {
  if (!iso) return '未排期'
  const d = new Date(iso)
  return `${fmtShort(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 改状态时一并维护发布时间：进入已发布记下时间，离开已发布清掉。 */
export function applyStatus(item, status) {
  item.status = status
  if (status === 'published' && !item.publishedAt) item.publishedAt = new Date().toISOString()
  if (status !== 'published') delete item.publishedAt
}

/** 排上日历就是待发布（还没成稿的算大纲）；取消排期退回去。已发布的不动。 */
export function applySchedule(item, when) {
  item.scheduledAt = when
  if (item.status === 'published') return
  const produced = item.production?.status === 'done'
  if (when) item.status = produced || ['draft', 'ready'].includes(item.status) ? 'ready' : 'outline'
  else if (item.status === 'ready') item.status = 'draft'
  else if (item.status === 'outline' && !produced) item.status = 'idea'
}

/* ------------------------------ 条目 ------------------------------ */

export function addItem(state, input, now = new Date().toISOString()) {
  const fields = pick(ITEM_FIELDS, input)
  const item = { id: newId('it'), kind: 'note', title: '', body: '', tags: [], status: 'idea', personaIds: [], createdAt: now, drafts: {}, ...fields }
  if (!item.title && !item.body) throw new Error('灵感内容为空，至少给 title 或 body')
  if (!item.title) item.title = short(item.body, 28)
  if (item.status === 'published') applyStatus(item, 'published')
  state.items.unshift(item)
  return item
}

export function updateItem(state, id, input) {
  const item = findItem(state, id)
  const { status, ...fields } = pick(ITEM_FIELDS, input)
  Object.assign(item, fields)
  if (status !== undefined) applyStatus(item, status)
  return item
}

export function deleteItem(state, id) {
  const item = findItem(state, id)
  state.items = state.items.filter(row => row.id !== id)
  state.metrics = state.metrics.filter(row => row.itemId !== id)
  return item
}

export function scheduleItem(state, id, when, platform) {
  const item = findItem(state, id)
  if (platform !== undefined && platform !== null) {
    const p = coerce('platform', platform)
    if (p) item.platform = p
  }
  applySchedule(item, when)
  return item
}

/* ------------------------------ 成稿 ------------------------------ */

/** 模型给的策划案不可信：只取需要的字段，数量按设置截断。 */
export function normalizePlan(plan, settings, title) {
  const text = (value, max = 400) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
  const images = (Array.isArray(plan?.images) ? plan.images : []).slice(0, settings.imageCount)
    .map(row => ({ caption: text(row?.caption, 60), anchor: text(row?.anchor, 60), prompt: text(row?.prompt, 1200) }))
    .filter(row => row.prompt)
  const shots = (Array.isArray(plan?.shots) ? plan.shots : []).slice(0, settings.shotCount)
    .map((row, index) => ({
      no: index + 1,
      shot: text(row?.shot, 12) || '中景',
      visual: text(row?.visual, 200),
      voice: text(row?.voice, 200),
      seconds: Number.isFinite(row?.seconds) ? Math.max(1, Math.min(60, Math.round(row.seconds))) : 5,
      prompt: text(row?.prompt, 1200),
    }))
    .filter(row => row.prompt || row.visual)
  return {
    title: text(plan?.title, 60) || title,
    coverText: text(plan?.coverText, 24) || String(title).slice(0, 12),
    facts: (Array.isArray(plan?.facts) ? plan.facts : []).map(row => text(row, 120)).filter(Boolean).slice(0, 8),
    outline: (Array.isArray(plan?.outline) ? plan.outline : []).map(row => text(row, 40)).filter(Boolean).slice(0, 6),
    cover: text(plan?.cover, 1200) || title,
    characters: text(plan?.characters, 400),
    images,
    shots,
  }
}

/** 把策划案写进成稿。图片状态先记 idle，等 ImageGen 画完再登记。 */
export function savePlan(item, plan, settings, { withImages = true, format = 'script' } = {}) {
  const normalized = normalizePlan(plan, settings, item.title)
  const previous = item.production
  const keep = previous && previous.savedPath ? { savedPath: previous.savedPath, savedHashes: previous.savedHashes } : {}
  item.production = {
    status: 'planned',
    stage: 'planned',
    format: draftFormat(format),
    withImages,
    startedAt: new Date().toISOString(),
    title: normalized.title,
    coverText: normalized.coverText,
    facts: normalized.facts,
    outline: normalized.outline,
    characters: normalized.characters,
    article: '',
    aiArticle: '',
    cover: { prompt: normalized.cover, status: withImages ? 'idle' : 'skipped' },
    images: normalized.images.map(row => ({ ...row, status: withImages ? 'idle' : 'skipped' })),
    shots: normalized.shots.map(row => ({ ...row, status: withImages ? 'idle' : 'skipped' })),
    ...keep,
  }
  if (['idea', 'outline'].includes(item.status)) item.status = 'draft'
  return item.production
}

/** 写正文。文档里如果带一级标题，标题自动落到成稿上。 */
export function saveArticle(item, markdown) {
  if (!item.production) throw new Error('还没有策划案，先落盘策划案再写正文')
  const match = /^\s*#\s+(.+)\n?/.exec(markdown)
  const body = match ? markdown.slice(match[0].length).trim() : markdown.trim()
  item.production.article = body.slice(0, 200000)
  item.production.aiArticle = item.production.article
  if (match) item.production.title = match[1].trim().slice(0, 200)
  item.production.status = 'done'
  item.production.stage = 'done'
  item.production.finishedAt = new Date().toISOString()
  if (['idea', 'outline'].includes(item.status)) item.status = item.scheduledAt ? 'ready' : 'draft'
  return item.production
}

function parseTarget(target) {
  if (target === 'cover') return { kind: 'cover' }
  const match = /^(image|shot):(\d{1,2})$/.exec(String(target))
  return match ? { kind: match[1], index: Number(match[2]) } : null
}

export function assetAt(production, target) {
  const parsed = parseTarget(target)
  if (!parsed) return null
  if (parsed.kind === 'cover') return production.cover
  return (parsed.kind === 'image' ? production.images : production.shots)?.[parsed.index] ?? null
}

/**
 * 把对话里的修改落到成稿上。只认这几个字段，序号越界的直接丢弃。
 * 移植自上游 applyRevision。
 */
export function applyRevision(production, revise) {
  const receipts = []
  const errors = []
  const targets = []
  const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

  const title = text(revise?.title, 80)
  if (title && title !== production.title) {
    production.title = title
    receipts.push(`标题改成《${title}》`)
  }
  const coverText = text(revise?.coverText, 24)
  if (coverText && coverText !== production.coverText) {
    production.coverText = coverText
    receipts.push(`封面大字改成「${coverText}」`)
  }
  if (typeof revise?.article === 'string' && revise.article.trim()) {
    production.article = revise.article.replace(/^\s*#\s+.*\n?/, '').trim().slice(0, 200000)
    receipts.push('重写了正文')
  } else if (Array.isArray(revise?.edits)) {
    let changed = 0
    for (const edit of revise.edits.slice(0, 20)) {
      if (typeof edit?.find !== 'string' || typeof edit?.replace !== 'string' || !edit.find) continue
      if (production.article.includes(edit.find)) {
        production.article = production.article.replace(edit.find, () => edit.replace)
        changed += 1
      } else {
        errors.push(`正文里没找到「${edit.find.slice(0, 16)}」`)
      }
    }
    if (changed) receipts.push(changed === 1 ? '改了正文的 1 处' : `改了正文的 ${changed} 处`)
  }
  const coverPrompt = text(revise?.cover?.prompt, 1200)
  if (coverPrompt && production.cover) {
    production.cover.prompt = coverPrompt
    production.cover.status = 'idle'
    targets.push('cover')
    receipts.push('重画封面')
  }
  for (const row of Array.isArray(revise?.images) ? revise.images.slice(0, 8) : []) {
    const image = production.images?.[Number(row?.no) - 1]
    if (!image) continue
    const caption = text(row.caption, 40)
    if (caption) image.caption = caption
    const prompt = text(row.prompt, 1200)
    if (prompt) {
      image.prompt = prompt
      image.status = 'idle'
      targets.push(`image:${Number(row.no) - 1}`)
    }
    receipts.push(prompt ? `重画配图 ${row.no}` : `改了配图 ${row.no} 的图注`)
  }
  for (const row of Array.isArray(revise?.shots) ? revise.shots.slice(0, 24) : []) {
    const shot = production.shots?.[Number(row?.no) - 1]
    if (!shot) continue
    for (const [key, max] of [['shot', 12], ['visual', 200], ['voice', 200]]) {
      const value = text(row[key], max)
      if (value) shot[key] = value
    }
    if (Number.isFinite(row.seconds)) shot.seconds = Math.max(1, Math.min(60, Math.round(row.seconds)))
    const prompt = text(row.prompt, 1200)
    if (prompt) {
      shot.prompt = prompt
      shot.status = 'idle'
      targets.push(`shot:${Number(row.no) - 1}`)
    }
    receipts.push(prompt ? `重画第 ${row.no} 镜` : `改了第 ${row.no} 镜的文案`)
  }
  return { receipts, errors, targets }
}

/** 登记一张画好的图。src 存相对 files/ 的文件名。 */
export function registerAsset(item, target, file) {
  const production = item.production
  if (!production) throw new Error('还没有成稿')
  const asset = assetAt(production, target)
  if (!asset) throw new Error(`目标无效：${target}`)
  asset.src = `files/${file}`
  asset.status = 'done'
  asset.error = null
  return asset
}

/* ------------------------ 生图提示词（英文后缀） ------------------------ */

const COVER_STYLE = 'Editorial cover image, striking composition with calm negative space in the lower third, refined and cinematic, no text, no letters, no logo.'
const FIGURE_STYLE = 'Editorial article illustration, refined and consistent with a modern magazine, no text, no letters, no logo.'
const SHOT_STYLE = 'Film storyboard panel, black and white pencil line art sketch, loose confident lines, no color, plain white paper background, no text, no letters, no captions, no panel numbers.'

export function fullImagePrompt(production, target, asset) {
  const parsed = parseTarget(target)
  if (!parsed) return null
  if (parsed.kind === 'cover') return `${COVER_STYLE} ${asset.prompt}`
  if (parsed.kind === 'image') return `${FIGURE_STYLE} ${asset.prompt}`
  return `${SHOT_STYLE} Widescreen 16:9 landscape framing, the scene fills the whole frame edge to edge, no borders. ${production.characters ? `Recurring characters and setting: ${production.characters}. ` : ''}${asset.prompt || asset.visual}`
}

/* ------------------------------ 风格与规则 ------------------------------ */

export const STYLE_FIELDS = ['name', 'icon', 'category', 'summary', 'tone', 'sentences', 'opening', 'structure', 'logic', 'story', 'flow', 'words', 'avoid', 'samples']

export function normalizeStyle(raw, preferredName = '') {
  const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
  const list = (value, count, max) => (Array.isArray(value) ? value.filter(row => typeof row === 'string' && row.trim()).slice(0, count).map(row => row.trim().slice(0, max)) : [])
  return {
    name: text(preferredName, 20) || text(raw?.name, 20) || '未命名风格',
    summary: text(raw?.summary, 80),
    tone: text(raw?.tone, 200),
    sentences: text(raw?.sentences, 200),
    opening: text(raw?.opening, 200),
    structure: text(raw?.structure, 200),
    logic: text(raw?.logic, 200),
    story: text(raw?.story, 200),
    flow: text(raw?.flow, 200),
    words: list(raw?.words, 8, 20),
    avoid: list(raw?.avoid, 5, 40),
    samples: list(raw?.samples, 6, 160),
  }
}

export function addStyle(state, input) {
  const style = { id: newId('st'), source: '手动', createdAt: new Date().toISOString(), words: [], avoid: [], samples: [], ...normalizeStyle(input), ...(input.category ? { category: input.category } : {}) }
  if (!style.name) throw new Error('风格需要名字')
  state.styles = [style, ...state.styles]
  return style
}

export function activeStyle(state) {
  return state.styles?.find(row => row.id === state.activeStyleId) ?? null
}

export function addRule(state, input) {
  const name = typeof input?.name === 'string' ? input.name.trim().slice(0, 40) : ''
  const rule = typeof input?.rule === 'string' ? input.rule.trim().slice(0, 400) : ''
  if (!name || !rule) throw new Error('规则需要 name 和 rule')
  const skill = {
    id: newId('s'), name, rule, source: input.source ?? '对话',
    status: input.status === 'active' ? 'active' : 'proposed',
    confidence: Number.isFinite(input.confidence) ? input.confidence : 0.5,
    evidence: typeof input.evidence === 'string' ? input.evidence.slice(0, 200) : '',
    createdAt: new Date().toISOString(),
  }
  state.skills.unshift(skill)
  return skill
}

/** 生效中的规则 + 当前风格卡，合成一段写作要求。 */
export function voiceBlock(state, { withRules = true } = {}) {
  const rules = state.skills.filter(s => s.status === 'active' || s.status === 'exported')
  const style = activeStyle(state)
  const parts = []
  if (withRules && rules.length) parts.push(`必须遵守作者沉淀的写作规则：\n${rules.map(s => `- ${s.name}：${s.rule}`).join('\n')}`)
  if (style) parts.push(styleToVoice(style))
  return parts.join('\n\n')
}

export function activeRules(state) {
  return state.skills.filter(s => s.status === 'active' || s.status === 'exported')
}
