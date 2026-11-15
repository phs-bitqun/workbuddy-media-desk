// 复盘：平台分组用哪条平台、累计数据去重。审查报告 P2 的回归测试。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { proposeRules, computeInsights } from '../skills/media-desk/scripts/lib/insights.mjs'

const baseState = ({ items = [], metrics = [] } = {}) => ({
  items, metrics, styles: [], skills: [], accounts: [],
  draftFormat: 'script', settings: {}, activeStyleId: null,
})

const metric = (over) => ({
  id: `m_${Math.random().toString(36).slice(2, 8)}`,
  platform: '小红书', date: '2026-11-10T12:00:00.000Z',
  views: 0, likes: 0, comments: 0, shares: 0, saves: 0, ...over,
})

test('平台表现按指标自己的平台分组，不看条目上标的平台', () => {
  // 同一篇内容分发到两个平台：抖音数据高，条目上却只标了小红书
  const state = baseState({
    items: [{ id: 'it_1', title: '跨平台分发', platform: '小红书', status: 'published', publishedAt: '2026-11-01T20:00:00.000Z', createdAt: '2026-11-01T10:00:00.000Z', tags: [] }],
    metrics: [
      metric({ itemId: 'it_1', platform: '抖音', views: 5000 }),
      metric({ itemId: 'it_1', platform: '抖音', views: 5000 }),
      metric({ itemId: 'it_1', platform: '小红书', views: 100 }),
      metric({ itemId: 'it_1', platform: '小红书', views: 100 }),
    ],
  })
  const proposals = proposeRules(state)
  const platform = proposals.find(p => p.name.startsWith('首发放在'))
  assert.ok(platform, '应该有平台建议')
  assert.match(platform.name, /抖音/, `建议应指向抖音，实际：${platform.name}`)
})

test('条目没标平台，也能按指标平台给出建议', () => {
  const state = baseState({
    items: [{ id: 'it_1', title: '没标平台', platform: null, status: 'published', publishedAt: '2026-11-01T20:00:00.000Z', createdAt: '2026-11-01T10:00:00.000Z', tags: [] }],
    metrics: [
      metric({ itemId: 'it_1', platform: 'B站', views: 9000 }),
      metric({ itemId: 'it_1', platform: 'B站', views: 9000 }),
      metric({ itemId: 'it_1', platform: '视频号', views: 300 }),
      metric({ itemId: 'it_1', platform: '视频号', views: 300 }),
    ],
  })
  const platform = proposeRules(state).find(p => p.name.startsWith('首发放在'))
  assert.ok(platform, '条目没平台时也应有建议')
  assert.match(platform.name, /B站/)
})

test('只有一个平台时不硬凑平台建议', () => {
  const state = baseState({
    items: [{ id: 'it_1', title: '单平台', platform: '小红书', status: 'published', publishedAt: '2026-11-01T20:00:00.000Z', createdAt: '2026-11-01T10:00:00.000Z', tags: [] }],
    metrics: [metric({ itemId: 'it_1', views: 100 }), metric({ itemId: 'it_1', views: 200 })],
  })
  assert.equal(proposeRules(state).some(p => p.name.startsWith('首发放在')), false)
})

test('带 externalId 的累计数据优先，同一内容的手动记录不重复计', () => {
  const state = baseState({
    items: [{ id: 'it_1', title: '有导入数据', platform: '小红书', status: 'published', createdAt: '2026-11-01T10:00:00.000Z', tags: [] }],
    metrics: [
      metric({ itemId: 'it_1', platform: '小红书', views: 1000, externalId: 'note-abc' }),
      metric({ itemId: 'it_1', platform: '小红书', views: 500 }), // 手动补录，应被排除
    ],
  })
  const data = computeInsights(state)
  assert.equal(data.views, 1000, `期望只算导入的 1000，实际 ${data.views}`)
  assert.equal(data.imported, true)
})

test('没有 externalId 时两条都算（当前行为，文档已说明）', () => {
  const state = baseState({
    items: [{ id: 'it_1', title: '都算', platform: '小红书', status: 'published', createdAt: '2026-11-01T10:00:00.000Z', tags: [] }],
    metrics: [
      metric({ itemId: 'it_1', views: 1000 }),
      metric({ itemId: 'it_1', views: 500 }),
    ],
  })
  assert.equal(computeInsights(state).views, 1500)
})

test('互动率只用有播放量的行做分母', () => {
  const state = baseState({
    items: [],
    metrics: [
      metric({ platform: '小红书', views: 100, likes: 10 }),
      metric({ platform: '抖音', views: 0, likes: 50 }), // 读不到播放量的平台
    ],
  })
  const data = computeInsights(state)
  assert.equal(data.views, 100)
  assert.equal(data.engaged, 60)
  assert.equal(Number(data.engagementRate.toFixed(4)), 0.1, '互动率应只用有播放量的分母')
})
