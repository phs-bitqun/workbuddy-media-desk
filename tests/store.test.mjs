// 存储层：跨进程写入、锁接管、文件权限。审查报告 P1/P2 的回归测试。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, writeFile, stat, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Store, acquireLock, deskHome } from '../skills/media-desk/scripts/lib/store.mjs'
import { emptyState } from '../skills/media-desk/scripts/lib/seed.mjs'

const run = promisify(execFile)
const ROOT = dirname(fileURLToPath(import.meta.url))
const DESK = join(ROOT, '..', 'skills', 'media-desk', 'scripts', 'desk.mjs')
const CLI = (home, args, extraEnv = {}) => run(process.execPath, [DESK, ...args], {
  env: { ...process.env, WORKBUDDY_MEDIA_DESK_HOME: home, ...extraEnv },
  maxBuffer: 8 * 1024 * 1024,
})

async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), 'desk-store-'))
  const store = new Store(dir)
  await store.write(emptyState())
  return { dir, store }
}

test('12 个进程并发写，一条都不丢', async () => {
  const { dir } = await freshHome()
  await Promise.all(Array.from({ length: 12 }, (_, i) =>
    CLI(dir, ['add', '--title', `并发-${i}`])))
  const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
  assert.equal(state.items.length, 12, '并发写入丢失了条目')
})

test('CLI 与服务同时写也不互相覆盖', async () => {
  const { dir, store } = await freshHome()
  // 一边用 Store 实例连续写，一边用子进程写，模拟「界面开着 + 终端敲命令」
  const viaStore = (async () => {
    for (let i = 0; i < 5; i += 1) {
      await store.mutate('进程内写', (d) => {
        d.items.push({ id: `mem_${i}`, kind: 'note', title: `内存-${i}`, body: '', tags: [], status: 'idea', createdAt: new Date().toISOString(), drafts: {} })
        return i
      })
    }
  })()
  const viaCli = Promise.all(Array.from({ length: 5 }, (_, i) =>
    CLI(dir, ['add', '--title', `进程-${i}`])))
  await Promise.all([viaStore, viaCli])

  const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
  assert.equal(state.items.length, 10, `期望 10 条，实际 ${state.items.length}`)
})

test('陈旧锁会被接管，不会永久卡死', async () => {
  const { dir, store } = await freshHome()
  const lock = join(dir, '.lock')
  await writeFile(lock, '999999 stale\n')
  const old = new Date(Date.now() - 60_000)
  const { utimes } = await import('node:fs/promises')
  await utimes(lock, old, old)

  const result = await store.mutate('测试', (d) => { d.draftFormat = 'article'; return 'ok' })
  assert.equal(result, 'ok')
  await assert.rejects(stat(lock), /ENOENT/, '锁没有被释放')
})

test('有活锁时写入会报错而不是硬写', async () => {
  const { dir, store } = await freshHome()
  const lock = join(dir, '.lock')
  await writeFile(lock, `${process.pid} now\n`)
  const previous = process.env.MEDIA_DESK_LOCK_TIMEOUT_MS
  process.env.MEDIA_DESK_LOCK_TIMEOUT_MS = '300' // 别让测试等满 8 秒
  try {
    const started = Date.now()
    await assert.rejects(
      () => store.mutate('测试', (d) => d, {}),
      /正被另一个进程写入/,
    )
    assert.ok(Date.now() - started < 5000, '等待时间过长，超时覆盖没生效')
  } finally {
    if (previous === undefined) delete process.env.MEDIA_DESK_LOCK_TIMEOUT_MS
    else process.env.MEDIA_DESK_LOCK_TIMEOUT_MS = previous
  }
})

test('锁对象只能释放一次，重复调用不报错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desk-lock-'))
  await mkdir(dir, { recursive: true })
  const release = await acquireLock(dir)
  await release()
  await release() // 不应抛错，也不应删掉别人的锁
})

test('数据目录 0700、状态与撤销栈 0600', { skip: process.platform === 'win32' ? 'Windows 没有 POSIX 权限位' : false }, async () => {
  const { dir, store } = await freshHome()
  await store.mutate('测试', (d) => { d.draftFormat = 'article'; return 1 })
  const dirMode = (await stat(dir)).mode & 0o777
  const filesMode = (await stat(join(dir, 'files'))).mode & 0o777
  const stateMode = (await stat(join(dir, 'state.json'))).mode & 0o777
  const undoMode = (await stat(join(dir, 'undo.json'))).mode & 0o777
  assert.equal(dirMode, 0o700, `目录权限 ${dirMode.toString(8)}`)
  assert.equal(filesMode, 0o700)
  assert.equal(stateMode, 0o600, `state.json 权限 ${stateMode.toString(8)}`)
  assert.equal(undoMode, 0o600)
})

test('未初始化时不创建状态文件，报错清晰', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desk-empty-'))
  const store = new Store(dir)
  await assert.rejects(() => store.mutate('测试', (d) => d), /还没初始化/)
})

test('deskHome 读环境变量', () => {
  assert.equal(deskHome({ WORKBUDDY_MEDIA_DESK_HOME: '/tmp/x' }), '/tmp/x')
  assert.match(deskHome({ HOME: '/home/tester' }), /media-desk$/)
})
