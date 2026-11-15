// 本地交互界面：只绑 127.0.0.1 的一套 HTTP 接口 + 单页应用。
// 每次启动生成一次性令牌，页面带令牌调接口；没有令牌只能拿到 401。
// 目的是挡住「你浏览器里另一个标签页偷偷往 localhost 发指令」这类跨站请求。
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises'
import { basename, extname, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Store } from './store.mjs'
import { ensureUi, sanitizeUi, NAV_TYPES, NAV_BUILTIN_LABEL, defaultUi } from './seed.mjs'
import { computeInsights, proposeRules } from './insights.mjs'
import {
  STATUSES, STATUS_LABEL, KINDS, PLATFORMS, findItem,
  addItem, updateItem, deleteItem, scheduleItem, applyRevision, registerAsset, assetAt,
  addRule, fullImagePrompt,
} from './ops.mjs'
import { exportProduction } from './export.mjs'
import { renderDesk } from './render.mjs'

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'app')
const MAX_JSON = 8 * 1024 * 1024
const MAX_BIN = 24 * 1024 * 1024
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
}
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('内容太大'), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJson(req) {
  const raw = await readBody(req, MAX_JSON)
  if (!raw.length) return {}
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw Object.assign(new Error('请求不是有效的 JSON'), { status: 400 })
  }
}

/** 列表用的条目：去掉长正文，只留摘要，避免一次拉几 MB。 */
function trimItem(item) {
  const p = item.production
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    tags: item.tags,
    status: item.status,
    platform: item.platform ?? null,
    url: item.url ?? null,
    kind: item.kind,
    createdAt: item.createdAt,
    scheduledAt: item.scheduledAt ?? null,
    publishedAt: item.publishedAt ?? null,
    sample: item.sample === true,
    production: p
      ? {
        status: p.status,
        stage: p.stage,
        format: p.format,
        title: p.title,
        coverText: p.coverText,
        outline: p.outline ?? [],
        facts: p.facts ?? [],
        articleChars: p.article?.length ?? 0,
        articlePreview: (p.article ?? '').slice(0, 160),
        cover: p.cover ? { status: p.cover.status, src: p.cover.src ?? null } : null,
        images: (p.images ?? []).map(row => ({ caption: row.caption, status: row.status, src: row.src ?? null })),
        shots: (p.shots ?? []).map(row => ({ no: row.no, shot: row.shot, visual: row.visual, voice: row.voice, seconds: row.seconds, status: row.status, src: row.src ?? null })),
        savedPath: p.savedPath ?? null,
      }
      : null,
  }
}

function viewState(state) {
  const ui = ensureUi(state)
  return {
    ui,
    items: state.items.map(trimItem),
    styles: state.styles,
    skills: state.skills,
    accounts: state.accounts,
    metrics: state.metrics.slice(-400),
    draftFormat: state.draftFormat,
    activeStyleId: state.activeStyleId,
    settings: state.settings,
    insights: computeInsights(state),
    proposals: proposeRules(state),
    meta: {
      statuses: STATUSES,
      statusLabels: STATUS_LABEL,
      platforms: PLATFORMS,
      kinds: KINDS,
      navTypes: NAV_TYPES,
      navLabels: NAV_BUILTIN_LABEL,
      today: new Date().toISOString(),
    },
  }
}

/* ------------------------------ 接口 ------------------------------ */

async function handleApi(req, res, url, ctx) {
  const { store } = ctx
  const part = url.pathname.split('/').filter(Boolean) // api / items / :id / ...
  const [, resource, id, action] = part
  const method = req.method

  if (resource === 'state' && method === 'GET') {
    const state = await store.read()
    if (!state) return json(res, 409, { error: '工作台还没初始化，先在对话里说「初始化工作台」' })
    return json(res, 200, viewState(state))
  }

  if (resource === 'items') {
    if (!id && method === 'POST') {
      const body = await readJson(req)
      const item = await store.mutate('记下灵感', d => addItem(d, body))
      return json(res, 200, trimItem(item))
    }
    if (id && !action && method === 'GET') {
      const state = await store.read()
      const item = state?.items.find(row => row.id === id)
      if (!item) return json(res, 404, { error: '找不到这条' })
      return json(res, 200, item)
    }
    if (id && !action && method === 'PATCH') {
      const body = await readJson(req)
      const item = await store.mutate('更新条目', d => updateItem(d, id, body))
      return json(res, 200, trimItem(item))
    }
    if (id && !action && method === 'DELETE') {
      const item = await store.mutate('删除条目', d => deleteItem(d, id))
      return json(res, 200, { ok: true, title: item.title })
    }
    if (id && action === 'schedule' && method === 'POST') {
      const body = await readJson(req)
      const at = body.at === null ? null : new Date(body.at)
      if (at !== null && Number.isNaN(at.getTime())) return json(res, 400, { error: '时间无效' })
      const item = await store.mutate('排期', d => scheduleItem(d, id, at === null ? null : at.toISOString(), body.platform))
      return json(res, 200, trimItem(item))
    }
    if (id && action === 'production' && method === 'POST') {
      const body = await readJson(req)
      const result = await store.mutate('改稿', (d) => {
        const target = findItem(d, id)
        if (!target.production) throw Object.assign(new Error('这条还没有成稿'), { status: 400 })
        return applyRevision(target.production, body)
      })
      return json(res, 200, result)
    }
    if (id && action === 'asset' && method === 'POST') {
      const target = url.searchParams.get('target') || 'cover'
      const type = String(req.headers['content-type'] || '').split(';')[0].trim()
      const ext = EXT[type]
      if (!ext) return json(res, 415, { error: '只支持 png / jpeg / webp / gif' })
      const buf = await readBody(req, MAX_BIN)
      if (!buf.length) return json(res, 400, { error: '空文件' })
      const name = `g_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}${ext}`
      await mkdir(store.filesDir, { recursive: true })
      await writeFile(join(store.filesDir, name), buf)
      const asset = await store.mutate('登记画面', (d) => {
        const target2 = findItem(d, id)
        const got = registerAsset(target2, target, name)
        return { src: got.src, status: got.status }
      })
      return json(res, 200, asset)
    }
    if (id && action === 'prompt' && method === 'GET') {
      const state = await store.read()
      const item = state?.items.find(row => row.id === id)
      if (!item?.production) return json(res, 404, { error: '这条还没有成稿' })
      const target = url.searchParams.get('target') || 'cover'
      const asset = assetAt(item.production, target)
      if (!asset) return json(res, 400, { error: `没有这个画面：${target}` })
      return json(res, 200, { target, prompt: fullImagePrompt(item.production, target, asset) })
    }
    if (id && action === 'export' && method === 'POST') {
      const state = await store.read()
      const item = state?.items.find(row => row.id === id)
      if (!item?.production) return json(res, 400, { error: '这条还没有成稿' })
      const out = await exportProduction(store, item)
      await store.mutate('记录导出路径', (d) => {
        const target = findItem(d, id)
        if (target.production) target.production.savedPath = out.dir
        return out.dir
      }, { undoable: false })
      return json(res, 200, out)
    }
  }

  if (resource === 'metrics' && method === 'POST') {
    const body = await readJson(req)
    if (body.csv) {
      const lines = String(body.csv).split(/\r?\n/).filter(line => line.trim())
      if (lines.length < 2) return json(res, 400, { error: 'CSV 至少要有表头和一行数据' })
      const header = lines[0].split(',').map(s => s.trim().toLowerCase())
      const rows = []
      for (const line of lines.slice(1)) {
        const cells = line.split(',').map(s => s.trim())
        const row = Object.fromEntries(header.map((key, i) => [key, cells[i]]))
        if (!row.platform) continue
        const date = row.date ? new Date(row.date) : new Date()
        rows.push({
          id: `m_${Date.now().toString(36)}${rows.length}`,
          itemId: row.itemid || row.item || undefined,
          platform: row.platform,
          date: (Number.isNaN(date.getTime()) ? new Date() : date).toISOString(),
          views: Number(row.views) || 0,
          likes: Number(row.likes) || 0,
          comments: Number(row.comments) || 0,
          shares: Number(row.shares) || 0,
          saves: Number(row.saves) || 0,
        })
      }
      if (!rows.length) return json(res, 400, { error: 'CSV 里没有能用的行' })
      await store.mutate('导入数据', d => { d.metrics.push(...rows) })
      return json(res, 200, { imported: rows.length })
    }
    if (!PLATFORMS.includes(body.platform)) return json(res, 400, { error: `平台只能是：${PLATFORMS.join(' / ')}` })
    const date = body.date ? new Date(body.date) : new Date()
    const metric = {
      id: `m_${Date.now().toString(36)}`,
      itemId: body.itemId || undefined,
      platform: body.platform,
      date: (Number.isNaN(date.getTime()) ? new Date() : date).toISOString(),
      views: Number(body.views) || 0,
      likes: Number(body.likes) || 0,
      comments: Number(body.comments) || 0,
      shares: Number(body.shares) || 0,
      saves: Number(body.saves) || 0,
    }
    await store.mutate('记录数据', d => { d.metrics.push(metric) })
    return json(res, 200, metric)
  }

  if (resource === 'format' && method === 'POST') {
    const body = await readJson(req)
    const next = body.format === 'article' ? 'article' : 'script'
    await store.mutate('切体裁', (d) => { d.draftFormat = next; return next })
    return json(res, 200, { draftFormat: next })
  }

  if (resource === 'ui' && method === 'PUT') {
    const body = await readJson(req)
    const ui = await store.mutate('调整菜单', (d) => {
      d.ui = sanitizeUi(body)
      return d.ui
    })
    return json(res, 200, ui)
  }

  if (resource === 'ui' && method === 'GET') {
    const state = await store.read()
    return json(res, 200, state ? ensureUi(state) : defaultUi())
  }

  if (resource === 'styles' && id === 'active' && method === 'POST') {
    const body = await readJson(req)
    const result = await store.mutate('切换风格', (d) => {
      if (!body.id) { d.activeStyleId = null; return { name: null } }
      const style = (d.styles ?? []).find(row => row.id === body.id)
      if (!style) throw Object.assign(new Error('没有这个风格'), { status: 404 })
      d.activeStyleId = style.id
      return { name: style.name }
    })
    return json(res, 200, result)
  }

  if (resource === 'rules') {
    if (!id && method === 'POST') {
      const body = await readJson(req)
      const rule = await store.mutate('沉淀规则', d => addRule(d, body))
      return json(res, 200, rule)
    }
    if (id && method === 'PATCH') {
      const body = await readJson(req)
      const rule = await store.mutate('规则开关', (d) => {
        const target = d.skills.find(row => row.id === id)
        if (!target) throw Object.assign(new Error('没有这条规则'), { status: 404 })
        target.status = body.status === 'active' ? 'active' : 'proposed'
        return target
      })
      return json(res, 200, rule)
    }
    if (id && method === 'DELETE') {
      await store.mutate('删除规则', d => { d.skills = d.skills.filter(row => row.id !== id) })
      return json(res, 200, { ok: true })
    }
  }

  if (resource === 'undo' && method === 'POST') {
    const label = await store.undo()
    return json(res, 200, { undone: label })
  }

  if (resource === 'render' && method === 'POST') {
    const state = await store.read()
    if (!state) return json(res, 409, { error: '还没初始化' })
    const target = join(store.root, 'desk.html')
    await writeFile(target, renderDesk(state, { root: store.root }), 'utf8')
    return json(res, 200, { path: target })
  }

  return json(res, 404, { error: '没有这个接口' })
}

/* ------------------------------ 静态资源 ------------------------------ */

function safeJoin(root, name) {
  const clean = basename(String(name || ''))
  if (!clean || clean.startsWith('.')) return null
  return join(root, clean)
}

async function sendFile(res, file, { download = false } = {}) {
  try {
    const info = await stat(file)
    if (!info.isFile()) throw new Error('not a file')
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream'
    const headers = { 'content-type': type, 'content-length': info.size, 'cache-control': 'no-cache' }
    if (download) headers['content-disposition'] = `attachment; filename="${encodeURIComponent(basename(file))}"`
    res.writeHead(200, headers)
    createReadStream(file).pipe(res)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('找不到文件')
  }
}

/** 页面里注入令牌；顺带把标题换成用户的。 */
async function sendIndex(res, ctx) {
  const html = await readFile(join(APP_DIR, 'index.html'), 'utf8')
  const state = await ctx.store.read()
  const ui = state ? ensureUi(state) : defaultUi()
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(html
    .replaceAll('%TOKEN%', ctx.token)
    .replaceAll('%TITLE%', ui.title.replace(/</g, '&lt;')))
}

/* ------------------------------ 启动 ------------------------------ */

export function createApp({ store = new Store(), token = randomUUID() } = {}) {
  const ctx = { store, token }
  return async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    try {
      // 跨站防护：有 Origin 就必须是同源；接口一律要令牌
      const origin = req.headers.origin
      if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
        return json(res, 403, { error: '跨站请求被拒绝' })
      }
      if (url.pathname === '/' || url.pathname === '/index.html') return await sendIndex(res, ctx)
      if (url.pathname === '/app.css' || url.pathname === '/app.js') {
        const file = safeJoin(APP_DIR, url.pathname.slice(1))
        if (!file) return json(res, 404, { error: 'not found' })
        return await sendFile(res, file)
      }
      if (url.pathname.startsWith('/files/')) {
        const file = safeJoin(store.filesDir, decodeURIComponent(url.pathname.slice('/files/'.length)))
        if (!file) return json(res, 404, { error: 'not found' })
        return await sendFile(res, file)
      }
      if (url.pathname.startsWith('/api/')) {
        if (req.headers['x-desk-token'] !== token) return json(res, 401, { error: '令牌无效，刷新页面重试' })
        return await handleApi(req, res, url, ctx)
      }
      return json(res, 404, { error: 'not found' })
    } catch (err) {
      const status = err?.status ?? 500
      return json(res, status, { error: err?.message ?? '出错了' })
    }
  }
}

/**
 * 起服务。端口被占就顺延，最多试 20 个。
 * @param {{store?: Store, port?: number, host?: string, quiet?: boolean}} [options]
 * @returns {Promise<{url: string, port: number, token: string, close: () => Promise<void>}>}
 */
export async function startServer({ store = new Store(), port = 4318, host = '127.0.0.1', quiet = false } = {}) {
  const token = randomUUID()
  const app = createApp({ store, token })
  const server = createServer((req, res) => { app(req, res) })

  const listen = tryPort => new Promise((resolve, reject) => {
    const onError = err => { server.removeListener('listening', onOk); reject(err) }
    const onOk = () => { server.removeListener('error', onError); resolve(tryPort) }
    server.once('error', onError)
    server.once('listening', onOk)
    server.listen(tryPort, host)
  })

  let bound = null
  for (let i = 0; i < 20 && bound === null; i += 1) {
    try {
      bound = await listen(port + i)
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err
    }
  }
  if (bound === null) throw new Error(`端口 ${port} 到 ${port + 19} 都被占用，换一个 --port 试试`)

  if (!quiet) {
    process.stdout.write(`工作台界面已启动：http://${host}:${bound}/\n`)
    process.stdout.write(`数据目录：${store.root}\n`)
    process.stdout.write('按 Ctrl+C 停止。关掉就没了，数据不会丢。\n')
  }

  return {
    url: `http://${host}:${bound}/`,
    port: bound,
    token,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}
