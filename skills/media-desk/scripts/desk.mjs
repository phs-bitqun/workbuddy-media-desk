#!/usr/bin/env node
// 自媒体工作台 · WorkBuddy 版 CLI。所有状态改动只走这里，避免手改 state.json。
// 用法：node desk.mjs <命令> [参数] [--json]
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { deskHome, Store } from './lib/store.mjs'
import { emptyState, sampleState, STYLE_PRESETS, STYLE_CATEGORIES, defaultSettings } from './lib/seed.mjs'
import {
  STATUSES, STATUS_LABEL, KINDS, PLATFORMS, statusLabel, fmtWhen, fmtShort, findItem,
  addItem, updateItem, deleteItem, scheduleItem, savePlan, saveArticle, applyRevision,
  registerAsset, assetAt, fullImagePrompt, addStyle, addRule, activeStyle, activeRules,
  normalizeStyle, voiceBlock,
} from './lib/ops.mjs'
import { computeInsights, proposeRules } from './lib/insights.mjs'
import { draftFormat } from './lib/style.mjs'
import { renderDesk } from './lib/render.mjs'

/* ------------------------------ 参数解析 ------------------------------ */

const argv = process.argv.slice(2)
const wantsJson = argv.includes('--json')
const rest = argv.filter(a => a !== '--json')

function parseFlags(list) {
  const flags = {}
  const positional = []
  for (let i = 0; i < list.length; i += 1) {
    const token = list[i]
    if (token.startsWith('--')) {
      const eq = token.indexOf('=')
      if (eq > 0) {
        flags[token.slice(2, eq)] = token.slice(eq + 1)
      } else {
        const key = token.slice(2)
        const next = list[i + 1]
        if (next === undefined || next.startsWith('--')) flags[key] = true
        else {
          flags[key] = next
          i += 1
        }
      }
    } else {
      positional.push(token)
    }
  }
  return { flags, positional }
}

const { flags, positional } = parseFlags(rest)
const command = positional[0]
const args = positional.slice(1)

/* ------------------------------ 输出与工具 ------------------------------ */

const say = text => process.stdout.write(`${text}\n`)
const json = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
const fail = message => {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function parseDate(value) {
  if (!value || value === true) return undefined
  const normalized = String(value).replace(/\//g, '-').trim()
  // 「2026-11-20 20:00」这种写法补成 ISO，按本机时区
  const withTime = /^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}$/.test(normalized) ? normalized.replace(' ', 'T') : normalized
  const d = new Date(withTime)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function readInput() {
  if (flags.file) {
    if (flags.file === '-') return readStdin()
    return readFile(resolve(String(flags.file)), 'utf8')
  }
  return readStdin()
}

async function readJsonInput() {
  const raw = (await readInput()).trim()
  if (!raw) fail('需要一个 JSON 文件（--file path.json）或者通过 stdin 传入')
  try {
    return JSON.parse(raw)
  } catch (err) {
    fail(`不是有效的 JSON：${err.message}`)
  }
}

const store = new Store()
const needState = async () => {
  const state = await store.read()
  if (!state) fail('工作台还没初始化，先运行：node desk.mjs init')
  return state
}

const TAGS = value => (value === undefined || value === true ? undefined : String(value).split(/[,，]/).map(s => s.trim()).filter(Boolean))

/* ------------------------------ 命令实现 ------------------------------ */

const commands = {
  async init() {
    const existing = await store.read()
    if (existing && !flags.force) {
      say(`已经初始化过了：${store.file}`)
      say('要重建（会覆盖现有内容）加 --force')
      return
    }
    const state = flags.seed ? sampleState() : emptyState()
    await store.write(state)
    say(`已初始化：${store.file}`)
    say(`风格预设 ${state.styles.length} 个${flags.seed ? '，示例数据 ' + state.items.length + ' 条' : ''}`)
  },

  async add() {
    const state = await needState()
    const title = flags.title && flags.title !== true ? String(flags.title) : undefined
    const body = flags.body && flags.body !== true ? String(flags.body) : undefined
    const item = await store.mutate('记下灵感', draft => {
      const created = addItem(draft, {
        title, body,
        kind: flags.kind,
        tags: TAGS(flags.tags),
        url: flags.url,
        source: flags.source,
        platform: flags.platform,
      })
      if (flags.at) {
        const when = parseDate(flags.at)
        if (!when) throw new Error('排期时间无效')
        scheduleItem(draft, created.id, when)
      }
      return created
    })
    if (wantsJson) return json(item)
    say(`记下灵感《${item.title}》  ${item.id}`)
    if (item.tags.length) say(`标签：${item.tags.join(' · ')}`)
    if (item.scheduledAt) say(`已排期：${fmtWhen(item.scheduledAt)}`)
  },

  async list() {
    const state = await needState()
    let rows = [...state.items]
    if (flags.status) rows = rows.filter(row => row.status === flags.status)
    if (flags.platform) rows = rows.filter(row => row.platform === flags.platform)
    if (flags.q) {
      const q = String(flags.q).toLowerCase()
      rows = rows.filter(row => `${row.title} ${row.body} ${row.tags.join(' ')}`.toLowerCase().includes(q))
    }
    const limit = flags.limit ? Number(flags.limit) : 50
    rows = rows.slice(0, limit)
    if (wantsJson) return json(rows)
    if (!rows.length) return say('没有符合条件的条目')
    for (const row of rows) {
      const bits = [row.id, statusLabel(row.status)]
      if (row.platform) bits.push(row.platform)
      if (row.scheduledAt) bits.push(fmtWhen(row.scheduledAt))
      if (row.production?.status === 'done') bits.push('已成稿')
      say(`${row.title}`)
      say(`  ${bits.join(' · ')}`)
    }
    say(`共 ${rows.length} 条`)
  },

  async show() {
    const state = await needState()
    const item = findItem(state, args[0] ?? '')
    if (wantsJson) return json(item)
    say(`《${item.title}》  ${item.id}`)
    say(`状态：${statusLabel(item.status)}${item.platform ? ` · ${item.platform}` : ''}${item.scheduledAt ? ` · 排期 ${fmtWhen(item.scheduledAt)}` : ''}`)
    if (item.tags.length) say(`标签：${item.tags.join(' · ')}`)
    if (item.body) say('')
    if (item.body) say(item.body)
    const p = item.production
    if (p) {
      say('')
      say(`成稿（${p.status}）：${p.title}`)
      if (p.coverText) say(`封面大字：${p.coverText}`)
      if (p.facts?.length) say(`事实：${p.facts.join(' / ')}`)
      if (p.outline?.length) say(`小标题：${p.outline.join(' / ')}`)
      const done = a => (a?.status === 'done' ? '✓' : '·')
      say(`封面 ${done(p.cover)} · 配图 ${p.images?.length ?? 0} 张 · 分镜 ${p.shots?.length ?? 0} 镜`)
      if (p.article) {
        say('')
        say('--- 正文 ---')
        say(p.article)
      }
    }
  },

  async update() {
    await needState()
    const id = args[0]
    const item = await store.mutate('更新条目', draft => updateItem(draft, id, {
      title: flags.title,
      body: flags.body,
      tags: TAGS(flags.tags),
      kind: flags.kind,
      url: flags.url,
      platform: flags.platform,
      status: flags.status,
    }))
    if (wantsJson) return json(item)
    say(`更新《${item.title}》`)
  },

  async rm() {
    await needState()
    const item = await store.mutate('删除条目', draft => deleteItem(draft, args[0]))
    if (wantsJson) return json({ deleted: item.id, title: item.title })
    say(`删除《${item.title}》`)
  },

  async schedule() {
    await needState()
    if (flags.clear) {
      const item = await store.mutate('取消排期', draft => scheduleItem(draft, args[0], null, flags.platform))
      return wantsJson ? json(item) : say(`取消《${item.title}》的排期`)
    }
    const when = parseDate(flags.at)
    if (!when) fail('需要 --at "2026-11-20 20:00"（或 --clear 取消排期）')
    const item = await store.mutate('排期', draft => scheduleItem(draft, args[0], when, flags.platform))
    if (wantsJson) return json(item)
    say(`把《${item.title}》排到 ${fmtWhen(item.scheduledAt)}${item.platform ? ` · ${item.platform}` : ''}`)
  },

  async status() {
    const state = await needState()
    const next = args[1]
    if (!STATUSES.includes(next)) fail(`状态只能是：${STATUSES.join(' / ')}`)
    const item = await store.mutate('改状态', draft => {
      const target = findItem(draft, args[0])
      target.status = next
      if (next === 'published' && !target.publishedAt) target.publishedAt = new Date().toISOString()
      if (next !== 'published') delete target.publishedAt
      return target
    })
    if (wantsJson) return json(item)
    say(`《${item.title}》状态改为「${statusLabel(next)}」`)
  },

  /** plan <id> --file plan.json：落盘策划案（标题、封面大字、事实、小标题、画面描述）。 */
  async plan() {
    const state = await needState()
    const item = findItem(state, args[0] ?? '')
    const input = await readJsonInput()
    const settings = state.settings ?? defaultSettings()
    const saved = await store.mutate('落盘策划案', draft => savePlan(findItem(draft, args[0] ?? ''), input, settings, {
      withImages: !flags['no-images'],
      format: draftFormat(draft.draftFormat),
    }))
    if (wantsJson) return json(saved)
    say(`策划案已落盘：《${saved.title}》`)
    say(`封面大字：${saved.coverText}`)
    if (saved.outline.length) say(`小标题：${saved.outline.join(' / ')}`)
    say(`配图 ${saved.images.length} 张 · 分镜 ${saved.shots.length} 镜`)
    say('')
    say('下一步：')
    say(`  node desk.mjs prompt ${args[0]} cover      # 取生图提示词，交给 ImageGen`)
    say(`  node desk.mjs article ${args[0]} --file 正文.md`)
  },

  /** article <id> --file body.md */
  async article() {
    const state = await needState()
    findItem(state, args[0] ?? '')
    const markdown = await readInput()
    if (!markdown.trim()) fail('正文是空的')
    const saved = await store.mutate('写正文', draft => saveArticle(findItem(draft, args[0] ?? ''), markdown))
    if (wantsJson) return json({ id: args[0], title: saved.title, chars: saved.article.length, format: saved.format })
    say(`正文已写入《${saved.title}》  ${saved.article.length} 字`)
    say(`成稿状态：${saved.status}`)
  },

  /** revise <id> --file revise.json */
  async revise() {
    const state = await needState()
    const item = findItem(state, args[0] ?? '')
    if (!item.production) fail('这条还没有成稿')
    const input = await readJsonInput()
    const result = await store.mutate('改稿', draft => {
      const target = findItem(draft, args[0] ?? '')
      return applyRevision(target.production, input)
    })
    if (wantsJson) return json(result)
    for (const line of result.receipts) say(`· ${line}`)
    for (const line of result.errors) say(`! ${line}`)
    if (!result.receipts.length && !result.errors.length) say('没有识别到需要修改的字段')
    if (result.targets.length) say(`需要重画的画面：${result.targets.join(' · ')}`)
  },

  /** prompt <id> <cover|image:N|shot:N>：输出可直接交给 ImageGen 的提示词。 */
  async prompt() {
    const state = await needState()
    const item = findItem(state, args[0] ?? '')
    if (!item.production) fail('这条还没有成稿')
    const target = args[1] ?? 'cover'
    const asset = assetAt(item.production, target)
    if (!asset) fail(`没有这个画面：${target}（可用 cover / image:0 / shot:0）`)
    const text = fullImagePrompt(item.production, target, asset)
    if (wantsJson) return json({ target, prompt: text, status: asset.status, src: asset.src ?? null })
    say(text)
  },

  /** asset <id> <cover|image:N|shot:N> --file 图片路径 */
  async asset() {
    const state = await needState()
    findItem(state, args[0] ?? '')
    if (!flags.file || flags.file === true) fail('需要 --file 图片路径')
    const source = resolve(String(flags.file))
    if (!existsSync(source)) fail(`找不到文件：${source}`)
    const ext = extname(source).toLowerCase() || '.png'
    const name = `g_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}${ext}`
    await mkdir(store.filesDir, { recursive: true })
    await copyFile(source, join(store.filesDir, name))
    const asset = await store.mutate('登记画面', draft => registerAsset(findItem(draft, args[0] ?? ''), args[1] ?? 'cover', name))
    if (wantsJson) return json({ target: args[1], src: asset.src })
    say(`${args[1]} 已登记：${join(store.filesDir, name)}`)
  },

  async format() {
    const state = await needState()
    const next = draftFormat(args[0])
    if (!args[0]) fail('需要 script 或 article')
    await store.mutate('切体裁', draft => {
      draft.draftFormat = next
      return next
    })
    say(next === 'article' ? '之后成稿写成文章（自然段）' : '之后成稿写成口播脚本（一句一行）')
  },

  async style() {
    const state = await needState()
    const sub = args[0]
    if (!sub || sub === 'list') {
      if (wantsJson) return json(state.styles.map(row => ({ ...row, active: row.id === state.activeStyleId })))
      for (const cat of STYLE_CATEGORIES) {
        const rows = state.styles.filter(row => row.category === cat)
        if (!rows.length) continue
        say(`【${cat}】`)
        for (const row of rows) say(`  ${row.id === state.activeStyleId ? '▶' : ' '} ${row.id}  ${row.icon ?? ''} ${row.name} — ${row.summary ?? ''}`)
      }
      const loose = state.styles.filter(row => !STYLE_CATEGORIES.includes(row.category))
      if (loose.length) {
        say('【自定义】')
        for (const row of loose) say(`  ${row.id === state.activeStyleId ? '▶' : ' '} ${row.id}  ${row.name} — ${row.summary ?? ''}`)
      }
      say('')
      say(`当前风格：${activeStyle(state)?.name ?? '未指定'}`)
      return
    }
    if (sub === 'use') {
      const id = args[1]
      if (!id || id === 'none') {
        await store.mutate('取消风格', draft => { draft.activeStyleId = null })
        return say('不再使用特定风格')
      }
      const style = state.styles.find(row => row.id === id)
      if (!style) fail(`没有这个风格：${id}`)
      await store.mutate('切换风格', draft => { draft.activeStyleId = style.id })
      return say(`之后按「${style.name}」的风格写`)
    }
    if (sub === 'show') {
      const style = state.styles.find(row => row.id === args[1])
      if (!style) fail(`没有这个风格：${args[1]}`)
      if (wantsJson) return json(style)
      say(`${style.icon ?? ''} ${style.name}（${style.category ?? '自定义'}）`)
      if (style.summary) say(style.summary)
      say('')
      say(voiceBlock({ skills: [], styles: [style], activeStyleId: style.id }))
      return
    }
    if (sub === 'add') {
      const input = await readJsonInput()
      const style = await store.mutate('添加风格', draft => addStyle(draft, { ...input, name: flags.name && flags.name !== true ? flags.name : input.name }))
      if (wantsJson) return json(style)
      return say(`添加风格「${style.name}」  ${style.id}`)
    }
    fail(`style 子命令：list / use <id> / show <id> / add --file style.json`)
  },

  async rule() {
    const state = await needState()
    const sub = args[0]
    if (!sub || sub === 'list') {
      const rows = state.skills
      if (wantsJson) return json(rows)
      if (!rows.length) return say('还没有写作规则')
      for (const row of rows) say(`${row.status === 'active' ? '✓' : '·'} ${row.id}  ${row.name}：${row.rule}${row.evidence ? `（依据：${row.evidence}）` : ''}`)
      return
    }
    if (sub === 'add') {
      const rule = await store.mutate('沉淀规则', draft => addRule(draft, {
        name: flags.name,
        rule: flags.rule,
        evidence: flags.evidence,
        status: flags.active ? 'active' : 'proposed',
      }))
      if (wantsJson) return json(rule)
      return say(`沉淀规则「${rule.name}」  ${rule.id}${rule.status === 'active' ? '（已生效）' : '（待确认，rule on 生效）'}`)
    }
    if (sub === 'on' || sub === 'off') {
      const skill = state.skills.find(row => row.id === args[1])
      if (!skill) fail(`没有这条规则：${args[1]}`)
      await store.mutate('规则开关', draft => {
        const target = draft.skills.find(row => row.id === args[1])
        target.status = sub === 'on' ? 'active' : 'proposed'
      })
      return say(`「${skill.name}」${sub === 'on' ? '已生效' : '已停用'}`)
    }
    if (sub === 'rm') {
      const skill = state.skills.find(row => row.id === args[1])
      if (!skill) fail(`没有这条规则：${args[1]}`)
      await store.mutate('删除规则', draft => { draft.skills = draft.skills.filter(row => row.id !== args[1]) })
      return say(`删除规则「${skill.name}」`)
    }
    fail('rule 子命令：list / add --name N --rule R / on <id> / off <id> / rm <id>')
  },

  async metric() {
    const state = await needState()
    const sub = args[0]
    if (sub === 'add') {
      if (!flags.platform) fail('需要 --platform')
      if (!PLATFORMS.includes(String(flags.platform))) fail(`平台只能是：${PLATFORMS.join(' / ')}`)
      const row = await store.mutate('记录数据', draft => {
        const metric = {
          id: `m_${Date.now().toString(36)}`,
          itemId: flags.item && flags.item !== true ? String(flags.item) : undefined,
          platform: String(flags.platform),
          date: parseDate(flags.date) ?? new Date().toISOString(),
          views: Number(flags.views) || 0,
          likes: Number(flags.likes) || 0,
          comments: Number(flags.comments) || 0,
          shares: Number(flags.shares) || 0,
          saves: Number(flags.saves) || 0,
        }
        draft.metrics.push(metric)
        return metric
      })
      if (wantsJson) return json(row)
      return say(`记录 ${row.platform} 数据 ${row.views} 阅读`)
    }
    if (sub === 'import') {
      const csv = await readInput()
      const lines = csv.split(/\r?\n/).filter(line => line.trim())
      if (!lines.length) fail('CSV 是空的')
      const header = lines[0].split(',').map(s => s.trim().toLowerCase())
      const rows = []
      for (const line of lines.slice(1)) {
        const cells = line.split(',').map(s => s.trim())
        const row = Object.fromEntries(header.map((key, i) => [key, cells[i]]))
        if (!row.platform) continue
        rows.push({
          id: `m_${Date.now().toString(36)}${rows.length}`,
          itemId: row.itemid || row.item || undefined,
          platform: row.platform,
          date: parseDate(row.date) ?? new Date().toISOString(),
          views: Number(row.views) || 0,
          likes: Number(row.likes) || 0,
          comments: Number(row.comments) || 0,
          shares: Number(row.shares) || 0,
          saves: Number(row.saves) || 0,
        })
      }
      if (!rows.length) fail('CSV 里没有能用的行（至少要有 platform 列）')
      await store.mutate('导入数据', draft => { draft.metrics.push(...rows) })
      return say(`导入 ${rows.length} 条数据`)
    }
    if (sub === 'list') {
      if (wantsJson) return json(state.metrics)
      for (const row of state.metrics.slice(-40)) say(`${fmtShort(row.date)}  ${row.platform}  ${row.views} 阅读 · ${row.likes} 赞 · ${row.comments} 评`)
      return say(`共 ${state.metrics.length} 条`)
    }
    fail('metric 子命令：add --platform P --views N / import --file data.csv / list')
  },

  async insights() {
    const state = await needState()
    const data = computeInsights(state)
    if (wantsJson) return json(data)
    say(`总阅读 ${data.views.toLocaleString('en-US')} · 互动 ${data.engaged.toLocaleString('en-US')} · 互动率 ${(data.engagementRate * 100).toFixed(2)}%`)
    say(`已发布 ${data.published} 篇${data.followers ? ` · 粉丝 ${data.followers}` : ''}`)
    if (data.hasSample) say('（含示例数据，录入真实数据后自动停用）')
    say('')
    if (data.platforms.length) {
      say('平台分布：')
      for (const row of data.platforms) say(`  ${row.platform}  ${row.views.toLocaleString('en-US')} 阅读 · 互动 ${row.engaged}`)
    }
    if (data.top.length) {
      say('')
      say('表现最好：')
      for (const row of data.top.slice(0, 5)) say(`  ${row.title}  ${row.views.toLocaleString('en-US')} 阅读`)
    }
    if (data.daily.length) {
      say('')
      say(`日趋势 ${data.daily[0].date} → ${data.daily[data.daily.length - 1].date}，共 ${data.daily.length} 天`)
    }
    const proposals = proposeRules(state)
    if (proposals.length) {
      say('')
      say('可以沉淀成规则：')
      for (const row of proposals) say(`  ${row.name} — ${row.rule}（${row.evidence}）`)
    }
  },

  async propose() {
    const state = await needState()
    const rows = proposeRules(state)
    if (wantsJson) return json(rows)
    if (!rows.length) return say('数据还不够，暂时提炼不出规则')
    for (const row of rows) say(`${row.name} — ${row.rule}（${row.evidence}，置信度 ${row.confidence.toFixed(2)}）`)
  },

  /** export <id>：把成稿存成一个文件夹。 */
  async export() {
    const state = await needState()
    const item = findItem(state, args[0] ?? '')
    const p = item.production
    if (!p) fail('这条还没有成稿')
    const safe = p.title.replace(/[\/\\:*?"<>|]/g, '_').slice(0, 60) || '成稿'
    const outDir = flags.dir && flags.dir !== true ? resolve(String(flags.dir)) : join(homedir(), 'Documents', '自媒体工作台', safe)
    await mkdir(outDir, { recursive: true })
    const written = []

    const format = draftFormat(p.format)
    const articleName = format === 'article' ? '文章.md' : '口播脚本.md'
    if (p.article) {
      await writeFile(join(outDir, articleName), `# ${p.title}\n\n${p.article}\n`, 'utf8')
      written.push(articleName)
    }
    if (p.shots?.length) {
      const lines = [`# ${p.title} · 分镜脚本`, '', `封面大字：${p.coverText}`, '']
      lines.push('| # | 景别 | 画面 | 口播 | 秒 |', '| --- | --- | --- | --- | --- |')
      for (const s of p.shots) lines.push(`| ${s.no} | ${s.shot} | ${s.visual || ''} | ${s.voice || ''} | ${s.seconds} |`)
      await writeFile(join(outDir, '分镜脚本.md'), `${lines.join('\n')}\n`, 'utf8')
      written.push('分镜脚本.md')
    }
    const copy = async (asset, name) => {
      if (!asset?.src) return
      const from = join(store.root, asset.src)
      if (!existsSync(from)) return
      const target = `${name}${extname(from)}`
      await copyFile(from, join(outDir, target))
      written.push(target)
    }
    await copy(p.cover, '视频封面')
    for (const [i, image] of (p.images ?? []).entries()) await copy(image, `配图${i + 1}`)
    for (const shot of p.shots ?? []) await copy(shot, `分镜${shot.no}`)

    await store.mutate('记录导出路径', draft => {
      const target = findItem(draft, args[0] ?? '')
      if (target.production) target.production.savedPath = outDir
      return outDir
    }, { undoable: false })

    if (wantsJson) return json({ dir: outDir, files: written })
    say(`已保存到：${outDir}`)
    for (const file of written) say(`  ${file}`)
    if (!written.length) say('  （这条成稿还没有正文和图片）')
  },

  async render() {
    const state = await needState()
    const target = join(store.root, 'desk.html')
    const html = renderDesk(state, { root: store.root })
    await writeFile(target, html, 'utf8')
    if (wantsJson) return json({ path: target })
    say(`工作台已生成：${target}`)
    say('打开这个文件就能看五个页面：灵感 · 内容 · 排期 · 复盘 · 风格')
  },

  async undo() {
    await needState()
    const label = await store.undo()
    if (!label) return say('没有可以撤销的操作')
    say(`已撤销：${label}`)
  },

  async stats() {
    const state = await needState()
    const counts = Object.fromEntries(STATUSES.map(key => [statusLabel(key), state.items.filter(row => row.status === key).length]))
    if (wantsJson) return json({ counts, total: state.items.length, style: activeStyle(state)?.name ?? null, format: state.draftFormat, rules: activeRules(state).length })
    say(Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · '))
    say(`风格：${activeStyle(state)?.name ?? '未指定'} · 体裁：${state.draftFormat === 'article' ? '文章' : '口播脚本'} · 生效规则 ${activeRules(state).length} 条`)
  },

  async doctor() {
    const state = await store.read()
    say(`数据目录：${store.root}`)
    say(`状态文件：${store.file}  ${state ? '存在' : '不存在'}`)
    if (state) {
      say(`条目 ${state.items.length} · 风格 ${state.styles.length} · 规则 ${state.skills.length} · 数据 ${state.metrics.length}`)
      const stuck = state.items.filter(item => item.production && ['planned'].includes(item.production.status) && !item.production.article)
      if (stuck.length) say(`有 ${stuck.length} 条已落盘策划案但还没写正文`)
      const pendingImages = state.items.flatMap(item => {
        const p = item.production
        if (!p) return []
        const list = [p.cover, ...(p.images ?? []), ...(p.shots ?? [])]
        return list.filter(a => a && a.status === 'idle').map(() => item.title)
      })
      if (pendingImages.length) say(`还有 ${pendingImages.length} 张画面等着画`)
    }
    const presetCount = STYLE_PRESETS.length
    say(`内置风格预设 ${presetCount} 个`)
  },

  help() {
    say(`自媒体工作台 · WorkBuddy 版

  init [--seed] [--force]                 初始化（--seed 带示例数据）
  add --title T [--body B] [--tags a,b]   记一个灵感
      [--kind note|image|video|web|quote] [--url U] [--platform P] [--at 时间]
  list [--status s] [--platform p] [--q 关键词]
  show <id>                               看详情（含成稿全文）
  update <id> [--title] [--body] [--tags] [--status]
  rm <id>                                 删除
  schedule <id> --at "2026-11-20 20:00"   排期（--clear 取消）
  status <id> <${STATUSES.join('|')}>

  plan <id> --file plan.json              落盘策划案（--no-images 只出文字）
  article <id> --file 正文.md             写正文（带一级标题时自动更新标题）
  revise <id> --file revise.json          改稿（title/coverText/edits/article/cover/images/shots）
  prompt <id> <cover|image:N|shot:N>      输出生图提示词，直接交给 ImageGen
  asset <id> <cover|image:N|shot:N> --file 图片路径   登记画好的图
  export <id> [--dir 路径]                存成文件夹（脚本/分镜/封面/配图）

  format <script|article>                 切换体裁
  style list | style use <id> | style show <id> | style add --file s.json
  rule list | rule add --name N --rule R [--active] | rule on/off <id> | rule rm <id>
  metric add --platform P [--item id] [--views n] [--likes n] ... 
  metric import --file data.csv | metric list
  insights                                复盘汇总
  propose                                 提炼规则提案

  render                                  生成五页工作台 HTML
  undo                                    撤销上一步
  stats | doctor                          概览 / 自检

  通用：--json 输出结构化结果；--file - 从 stdin 读
`)
  },
}

const run = commands[command ?? 'help'] ?? (() => fail(`没有这个命令：${command}（node desk.mjs help 看全部）`))
try {
  await run()
} catch (err) {
  fail(err.message)
}
