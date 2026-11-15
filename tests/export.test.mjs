// 导出：同名标题不互相覆盖，重导回原目录。审查报告 P2 的回归测试。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// homedir() 是调用时读 HOME，所以先把 HOME 指到临时目录，再加载模块
const FAKE_HOME = await mkdtemp(join(tmpdir(), 'desk-export-'))
process.env.HOME = FAKE_HOME
const { exportProduction, safeName, defaultExportDir } = await import('../skills/media-desk/scripts/lib/export.mjs')

const FILES = join(FAKE_HOME, 'files')
await mkdir(FILES, { recursive: true })
await writeFile(join(FILES, 'cover.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
const store = { root: FAKE_HOME }

function makeItem(id, title) {
  return {
    id,
    production: {
      title,
      format: 'script',
      article: '第一句。\n第二句。',
      coverText: '封面大字',
      cover: { src: 'files/cover.png', status: 'done' },
      images: [],
      shots: [{ no: 1, shot: '特写', visual: '画面', voice: '口播', seconds: 5 }],
    },
  }
}

test('两篇同名内容导出到不同目录，不会互相覆盖', async () => {
  const a = makeItem('it_aaaa1', '同一个标题')
  const b = makeItem('it_bbbb2', '同一个标题')
  const first = await exportProduction(store, a)
  const second = await exportProduction(store, b)

  assert.notEqual(first.dir, second.dir, '同名标题用了同一个目录')
  assert.ok(second.dir.startsWith(first.dir), `第二个目录应在同名目录基础上加后缀，实际 ${second.dir}`)

  // 两边各自的正文都还在
  const aFiles = await readdir(first.dir)
  const bFiles = await readdir(second.dir)
  assert.ok(aFiles.includes('口播脚本.md'))
  assert.ok(bFiles.includes('口播脚本.md'))
})

test('同一篇重导回到原目录，并标记 reused', async () => {
  const item = makeItem('it_cccc3', '会重导的稿子')
  const first = await exportProduction(store, item)
  assert.equal(first.reused, false)
  item.production.savedPath = first.dir // CLI 导出后会写回这个字段
  const second = await exportProduction(store, item)
  assert.equal(second.dir, first.dir, '重导应回到原目录')
  assert.equal(second.reused, true)
})

test('正文里带一级标题、分镜表和图片都写得出来', async () => {
  const item = makeItem('it_dddd4', '产物检查')
  const out = await exportProduction(store, item)
  const files = await readdir(out.dir)
  assert.ok(files.includes('口播脚本.md'), files.join(','))
  assert.ok(files.includes('分镜脚本.md'))
  assert.ok(files.includes('视频封面.png'))
})

test('体裁是文章时文件名叫 文章.md', async () => {
  const item = makeItem('it_eeee5', '文章体裁')
  item.production.format = 'article'
  const out = await exportProduction(store, item)
  assert.ok((await readdir(out.dir)).includes('文章.md'))
})

test('safeName 去掉不能当文件名的字符', () => {
  assert.equal(safeName('a/b:c*d?e"f<g>h|i'), 'a_b_c_d_e_f_g_h_i')
  assert.equal(safeName(''), '成稿')
  assert.equal(safeName('   '), '成稿')
})

test('默认目录落在 Documents/自媒体工作台 下', () => {
  assert.equal(defaultExportDir('标题'), join(FAKE_HOME, 'Documents', '自媒体工作台', '标题'))
})
