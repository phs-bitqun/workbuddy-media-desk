// 持久化：<WORKBUDDY_MEDIA_DESK_HOME>/state.json，默认 ~/.workbuddy/media-desk/。
// 多进程安全靠数据目录里的 .lock：CLI、服务、两个终端同时写，串行进出，不会互相覆盖。
// 撤销是三方合并式的：只撤回那一步改过、之后又没被别人动过的部分。
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export const VERSION = 1
const MAX_UNDO = 30

// 正常一次写入是毫秒级，持锁超过这个时间基本是进程崩了留下的死锁
const LOCK_STALE_MS = 30_000
// 等不到锁就报错，让用户重试，而不是悄悄写坏数据
const LOCK_TIMEOUT_MS = 8_000

const DIR_MODE = 0o700
const FILE_MODE = 0o600

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const keyed = list => list.every(row => isObject(row) && typeof row.id === 'string')

function revertList(before, after, current) {
  const was = new Map(before.map(row => [row.id, row]))
  const now = new Map(after.map(row => [row.id, row]))
  // 这一步新增的行撤掉，两边都有的行逐字段撤回，其余（之后才加的）原样保留
  const result = current
    .filter(row => !(now.has(row.id) && !was.has(row.id)))
    .map(row => (was.has(row.id) && now.has(row.id) ? revertChange(was.get(row.id), now.get(row.id), row) : row))
  // 这一步删掉的行放回原来的位置
  const present = new Set(result.map(row => row.id))
  before.forEach((row, index) => {
    if (now.has(row.id) || present.has(row.id)) return
    result.splice(Math.min(index, result.length), 0, structuredClone(row))
    present.add(row.id)
  })
  return result
}

/**
 * 三方合并式撤销：只撤回这一步改过、之后又没被别的操作改动的部分。
 * 撤销「切换风格」不会抹掉之后生成的成稿；撤销「改标题」不会把之后画好的图退回去。
 */
export function revertChange(before, after, current) {
  if (same(before, after)) return current
  if (same(current, after)) return before === undefined ? undefined : structuredClone(before)
  if (isObject(before) && isObject(after) && isObject(current)) {
    const result = { ...current }
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const value = revertChange(before[key], after[key], current[key])
      if (value === undefined) delete result[key]
      else result[key] = value
    }
    return result
  }
  if (Array.isArray(before) && Array.isArray(after) && Array.isArray(current)) {
    if (keyed(before) && keyed(after) && keyed(current) && (before.length || after.length)) return revertList(before, after, current)
    if (before.length === after.length && after.length === current.length) return current.map((row, index) => revertChange(before[index], after[index], row))
  }
  // 之后又被改过且无法逐项合并时，保留现在的值
  return current
}

/** 工作台数据的根目录。设置 WORKBUDDY_MEDIA_DESK_HOME 可以换到别处（测试用）。 */
export function deskHome(env = process.env) {
  return env.WORKBUDDY_MEDIA_DESK_HOME || join(env.HOME || homedir(), '.workbuddy', 'media-desk')
}

/**
 * 跨进程互斥锁。用 O_EXCL 创建锁文件，天然原子。
 * 持锁进程崩溃会留下死锁文件，超过 LOCK_STALE_MS 就当作陈旧锁接管。
 * @param {string} dir
 * @returns {Promise<() => Promise<void>>} 释放函数
 */
export async function acquireLock(dir) {
  const file = join(dir, '.lock')
  // 环境变量可覆盖，测试和慢磁盘（比如网络盘）都用得上
  const staleMs = Number(process.env.MEDIA_DESK_LOCK_STALE_MS) || LOCK_STALE_MS
  const timeoutMs = Number(process.env.MEDIA_DESK_LOCK_TIMEOUT_MS) || LOCK_TIMEOUT_MS
  const started = Date.now()
  let wait = 4
  for (;;) {
    try {
      const handle = await open(file, 'wx', FILE_MODE)
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`)
      await handle.close()
      let released = false
      return async () => {
        if (released) return
        released = true
        await unlink(file).catch(() => {})
      }
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      // 陈旧锁：持锁进程已经死了
      try {
        const info = await stat(file)
        if (Date.now() - info.mtimeMs > staleMs) {
          await unlink(file).catch(() => {})
          continue
        }
      } catch {
        // 锁刚好被释放，直接重试
        continue
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`数据目录正被另一个进程写入（${file}）。等几秒再试；如果确认没有别的进程，删掉这个文件。`)
      }
      await sleep(wait + Math.floor(Math.random() * wait))
      wait = Math.min(wait * 2, 160)
    }
  }
}

export class Store {
  constructor(root = deskHome()) {
    this.root = root
    this.file = join(root, 'state.json')
    this.filesDir = join(root, 'files')
    this.undoFile = join(root, 'undo.json')
    this.state = null
    this.mtimeMs = 0
    this.queue = Promise.resolve()
  }

  async ready() {
    await mkdir(this.root, { recursive: true, mode: DIR_MODE })
    await mkdir(this.filesDir, { recursive: true, mode: DIR_MODE })
  }

  /**
   * 读状态。默认按 mtime 用缓存；`fresh` 强制重读，写之前必须用。
   * @param {{fresh?: boolean}} [options]
   */
  async read({ fresh = false } = {}) {
    await this.ready()
    let info = null
    try {
      info = await stat(this.file)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    if (!info) {
      this.state = null
      this.mtimeMs = 0
      return null
    }
    if (!fresh && this.state && info.mtimeMs === this.mtimeMs) return this.state
    const raw = await readFile(this.file, 'utf8')
    this.state = JSON.parse(raw)
    this.mtimeMs = info.mtimeMs
    return this.state
  }

  async write(state) {
    await this.ready()
    const tmp = `${this.file}.${process.pid}.tmp`
    // 临时文件就建成 0600，rename 之后权限跟着过来，不会露出窗口期
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: FILE_MODE })
    await rename(tmp, this.file)
    const info = await stat(this.file)
    this.mtimeMs = info.mtimeMs
    this.state = state
    return state
  }

  /**
   * 读 → 改 → 写。同一实例内串行，跨进程靠 .lock 互斥。
   * @param {string} label - 这一步在撤销列表里显示的名字。
   * @param {(state: object) => object} fn - 就地修改状态。
   * @param {{undoable?: boolean}} [options]
   */
  mutate(label, fn, { undoable = true } = {}) {
    const run = async () => {
      await this.ready()
      const release = await acquireLock(this.root)
      try {
        // 持锁后强制重读：不能拿进锁之前的缓存去写，否则会盖掉别人的改动
        const current = await this.read({ fresh: true })
        if (!current) throw new Error('工作台还没初始化，先运行 init')
        const before = structuredClone(current)
        const result = fn(current)
        await this.write(current)
        if (undoable) await this.pushUndo({ label, at: new Date().toISOString(), before, after: structuredClone(current) })
        return result
      } finally {
        await release()
      }
    }
    this.queue = this.queue.then(run, run)
    return this.queue
  }

  async readUndo() {
    try {
      return JSON.parse(await readFile(this.undoFile, 'utf8'))
    } catch {
      return []
    }
  }

  async pushUndo(entry) {
    const list = await this.readUndo()
    list.push(entry)
    await writeFile(this.undoFile, `${JSON.stringify(list.slice(-MAX_UNDO), null, 2)}\n`, { encoding: 'utf8', mode: FILE_MODE })
  }

  /** 撤回最近一步。没有可撤的返回 null。整个过程持锁。 */
  async undo() {
    await this.ready()
    const release = await acquireLock(this.root)
    try {
      const list = await this.readUndo()
      const entry = list.pop()
      if (!entry) return null
      const current = await this.read({ fresh: true })
      if (!current) return null
      // 先落状态再落撤销栈：中途失败最多多一条可撤记录，不会出现「栈退了但数据没退」
      await this.write(revertChange(entry.before, entry.after, current))
      await writeFile(this.undoFile, `${JSON.stringify(list, null, 2)}\n`, { encoding: 'utf8', mode: FILE_MODE })
      return entry.label
    } finally {
      await release()
    }
  }
}
