// CSV 解析与导入校验。审查报告 P2/P3 的回归测试。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv, csvToMetrics, stripBom } from '../skills/media-desk/scripts/lib/csv.mjs'

test('去掉 UTF-8 BOM，表头能识别', () => {
  const csv = '\uFEFFplatform,views\n小红书,100'
  assert.equal(stripBom(csv).startsWith('platform'), true)
  const { metrics, error } = csvToMetrics(csv)
  assert.equal(error, null)
  assert.equal(metrics.length, 1)
  assert.equal(metrics[0].platform, '小红书')
  assert.equal(metrics[0].views, 100)
})

test('引号字段里的逗号不当分隔符', () => {
  const { rows } = parseCsv('a,b\n"x,y",z')
  assert.deepEqual(rows[1].cells, ['x,y', 'z'])
})

test('双引号转义成一个引号', () => {
  const { rows } = parseCsv('a\n"he said ""hi"""')
  assert.deepEqual(rows[1].cells, ['he said "hi"'])
})

test('引号内换行属于同一个字段', () => {
  const { rows } = parseCsv('a,b\n"第一行\n第二行",z')
  assert.equal(rows.length, 2)
  assert.equal(rows[1].cells[0], '第一行\n第二行')
})

test('CRLF 换行正常解析', () => {
  const { rows } = parseCsv('platform,views\r\n抖音,10\r\n小红书,20\r\n')
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[2].cells, ['小红书', '20'])
})

test('引号未闭合时报错而不是静默吃掉', () => {
  const { error } = parseCsv('a,b\n"没闭合,z')
  assert.match(error, /引号/)
})

test('无效日期被跳过并给出行号，不会悄悄记成今天', () => {
  const csv = 'platform,date,views\n小红书,2026-13-45,100\n抖音,2026-11-14,50'
  const { metrics, skipped } = csvToMetrics(csv)
  assert.equal(metrics.length, 1)
  assert.equal(metrics[0].platform, '抖音')
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0].line, 2)
  assert.match(skipped[0].reason, /日期/)
})

test('不认识的平台被跳过', () => {
  const { metrics, skipped } = csvToMetrics('platform,views\n微博,100')
  assert.equal(metrics.length, 0)
  assert.match(skipped[0].reason, /平台/)
})

test('非数字指标被跳过，不会静默变 0', () => {
  const { metrics, skipped } = csvToMetrics('platform,views\n小红书,很多')
  assert.equal(metrics.length, 0)
  assert.match(skipped[0].reason, /不是数字/)
})

test('externalId 原样带出来（去重靠它）', () => {
  const { metrics } = csvToMetrics('platform,views,itemId,externalId\n小红书,100,it_1,note-abc')
  assert.equal(metrics[0].externalId, 'note-abc')
  assert.equal(metrics[0].itemId, 'it_1')
})

test('没有 externalId 时不写这个字段', () => {
  const { metrics } = csvToMetrics('platform,views\n小红书,100')
  assert.equal('externalId' in metrics[0], false)
})

test('表头缺 platform 直接报错', () => {
  const { error } = csvToMetrics('views,likes\n1,2')
  assert.match(error, /platform/)
})

test('数字带千分位逗号能被接受（引号包裹）', () => {
  const { metrics } = csvToMetrics('platform,views\n小红书,"1,234"')
  assert.equal(metrics[0].views, 1234)
})
