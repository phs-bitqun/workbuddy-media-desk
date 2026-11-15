// 本地服务接口：鉴权、录数据字段、CSV 导入、导出。审查报告 P2 的回归测试。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Store } from '../skills/media-desk/scripts/lib/store.mjs'
import { emptyState } from '../skills/media-desk/scripts/lib/seed.mjs'
import { startServer } from '../skills/media-desk/scripts/lib/server.mjs'

const HOME = await mkdtemp(join(tmpdir(), 'desk-api-'))
process.env.HOME = HOME // 导出目录别落到真实 Documents

const store = new Store(join(HOME, 'data'))
await store.write(emptyState())
let server
let base

before(async () => {
  server = await startServer({ store, port: 0, quiet: true })
  base = `http://127.0.0.1:${server.port}`
})

after(async () => { await server?.close() })

const call = (path, { method = 'GET', body, token = server.token, headers = {} } = {}) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { 'x-desk-token': token } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

test('没有令牌读不到状态', async () => {
  const res = await call('/api/state', { token: null })
  assert.equal(res.status, 401)
})

test('跨站 Origin 被拒绝', async () => {
  const res = await call('/api/state', { headers: { Origin: 'https://evil.example' } })
  assert.equal(res.status, 403)
})

test('路径穿越读不到 state.json', async () => {
  const res = await fetch(`${base}/files/../state.json`)
  assert.equal(res.status, 404)
})

test('录数据能带全评论、转发、收藏和内容关联', async () => {
  const created = await call('/api/items', { method: 'POST', body: { title: '带数据的稿子' } })
  const item = await created.json()

  const res = await call('/api/metrics', {
    method: 'POST',
    body: { platform: '小红书', itemId: item.id, views: 1000, likes: 50, comments: 7, shares: 3, saves: 20 },
  })
  assert.equal(res.status, 200)
  const metric = await res.json()
  assert.equal(metric.comments, 7)
  assert.equal(metric.shares, 3)
  assert.equal(metric.saves, 20)
  assert.equal(metric.itemId, item.id)

  // 关联到内容后，应该出现在内容排行里
  const state = await (await call('/api/state')).json()
  assert.equal(state.insights.top.length, 1)
  assert.equal(state.insights.top[0].views, 1000)
})

test('CSV 导入：去 BOM、跳坏行、带 externalId', async () => {
  const csv = '\uFEFFplatform,date,views,itemId,externalId\n' +
    '抖音,2026-11-14,2000,,post-1\n' +
    '微博,2026-11-14,100,,x\n' +          // 平台不认识
    '小红书,2026-13-40,50,,y\n'            // 日期非法
  const res = await call('/api/metrics', { method: 'POST', body: { csv } })
  assert.equal(res.status, 200)
  const out = await res.json()
  assert.equal(out.imported, 1)
  assert.equal(out.skipped.length, 2)
  assert.deepEqual(out.skipped.map(s => s.line).sort(), [3, 4])

  const state = await (await call('/api/state')).json()
  const row = state.metrics.find(m => m.externalId === 'post-1')
  assert.ok(row, 'externalId 没写进状态')
})

test('CSV 全坏时报错而不是静默成功', async () => {
  const res = await call('/api/metrics', { method: 'POST', body: { csv: 'platform,views\n微博,1' } })
  assert.equal(res.status, 400)
})

test('导出接口返回目录，重导回同一处', async () => {
  const created = await (await call('/api/items', { method: 'POST', body: { title: '导出接口测试' } })).json()
  // 直接注入一份成稿，避免依赖生成流程
  await store.mutate('注入成稿', (d) => {
    const target = d.items.find(i => i.id === created.id)
    target.production = {
      status: 'planned', stage: 'planned', format: 'script', withImages: false,
      title: '导出接口测试', coverText: '大字', facts: [], outline: [],
      article: '正文内容。', aiArticle: '正文内容。',
      cover: { prompt: 'x', status: 'skipped' }, images: [], shots: [],
    }
    return d
  })

  const first = await (await call(`/api/items/${created.id}/export`, { method: 'POST' })).json()
  assert.ok(first.dir.includes('导出接口测试'))
  assert.ok((await readdir(first.dir)).includes('口播脚本.md'))

  const second = await (await call(`/api/items/${created.id}/export`, { method: 'POST' })).json()
  assert.equal(second.dir, first.dir, '重导换了目录')
})

test('菜单非法类型被丢弃，全隐藏退回默认', async () => {
  const bad = await call('/api/ui', {
    method: 'PUT',
    body: { nav: [{ id: 'x', type: 'hack', label: '坏' }, { id: 'y', type: 'ideas', label: '好' }] },
  })
  assert.equal((await bad.json()).nav.length, 1)

  const hidden = await call('/api/ui', {
    method: 'PUT',
    body: { nav: [{ id: 'z', type: 'ideas', label: 'x', visible: false }] },
  })
  assert.equal((await hidden.json()).nav.length, 5)
})
