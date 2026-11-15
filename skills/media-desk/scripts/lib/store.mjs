// 持久化：<WORKBUDDY_MEDIA_DESK_HOME>/state.json，默认 ~/.workbuddy/media-desk/。
// 每次读写都按 mtime 判断是否要重读，多个终端同时用不会互相覆盖。
// 撤销是三方合并式的：只撤回那一步改过、之后又没被别人动过的部分。
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const VERSION = 1
const MAX_UNDO = 30

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
    await mkdir(this.filesDir, { recursive: true })
  }

  /** 按 mtime 判断要不要重读，避免另一个终端刚写完的被旧缓存盖掉。 */
  async read() {
    await this.ready()
    let info = null
    try {
      info = await stat(this.file)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    if (!info) {
      if (!this.state) this.state = null
      this.mtimeMs = 0
      return null
    }
    if (this.state && info.mtimeMs === this.mtimeMs) return this.state
    const raw = await readFile(this.file, 'utf8')
    this.state = JSON.parse(raw)
    this.mtimeMs = info.mtimeMs
    return this.state
  }

  async write(state) {
    await this.ready()
    const tmp = `${this.file}.${process.pid}.tmp`
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(tmp, this.file)
    const info = await stat(this.file)
    this.mtimeMs = info.mtimeMs
    this.state = state
    return state
  }

  /**
   * 读 → 改 → 写。串行执行，回执由 mutate 的返回值决定。
   * @param {string} label - 这一步在撤销列表里显示的名字。
   * @param {(state: object) => object} fn - 就地修改状态。
   * @param {{undoable?: boolean}} [options]
   */
  mutate(label, fn, { undoable = true } = {}) {
    const run = async () => {
      const current = await this.read()
      if (!current) throw new Error('工作台还没初始化，先运行 init')
      const before = structuredClone(current)
      const result = fn(current)
      await this.write(current)
      if (undoable) await this.pushUndo({ label, at: new Date().toISOString(), before, after: structuredClone(current) })
      return result
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
    await writeFile(this.undoFile, `${JSON.stringify(list.slice(-MAX_UNDO), null, 2)}\n`, 'utf8')
  }

  /** 撤回最近一步。没有可撤的返回 null。 */
  async undo() {
    const list = await this.readUndo()
    const entry = list.pop()
    if (!entry) return null
    await writeFile(this.undoFile, `${JSON.stringify(list, null, 2)}\n`, 'utf8')
    const current = await this.read()
    if (!current) return null
    await this.write(revertChange(entry.before, entry.after, current))
    return entry.label
  }
}
