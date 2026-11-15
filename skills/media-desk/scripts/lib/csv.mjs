// CSV 解析：支持引号包裹、双引号转义、CRLF、UTF-8 BOM。
// 返回表头和行数组（每行是字符串数组），行号从 1 起（含表头），方便报错定位。

/** 去掉 BOM。 */
export function stripBom(text) {
  return String(text ?? '').replace(/^\uFEFF/, '')
}

/**
 * RFC4180 风格的解析：逗号分隔，字段可被双引号包裹，引号内的逗号、换行和 "" 都算字面量。
 * 不抛错——结构问题（引号未闭合）由调用方通过返回值判断。
 * @param {string} text
 * @returns {{rows: Array<{line: number, cells: string[]}>, error: string|null}}
 */
export function parseCsv(text) {
  const src = stripBom(text)
  const rows = []
  let cells = []
  let cell = ''
  let inQuotes = false
  let line = 1
  let rowStartLine = 1

  const pushRow = () => {
    rows.push({ line: rowStartLine, cells })
    cells = []
    cell = ''
    rowStartLine = line
  }

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1 } else { inQuotes = false }
      } else {
        if (ch === '\n') line += 1
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      // 引号必须出现在字段开头，否则当普通字符
      if (cell === '') { inQuotes = true; continue }
      cell += ch
      continue
    }
    if (ch === ',') { cells.push(cell.trim()); cell = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') {
      cells.push(cell.trim())
      pushRow()
      line += 1
      rowStartLine = line
      continue
    }
    cell += ch
  }
  if (inQuotes) return { rows: [], error: '有引号没有闭合，CSV 结构不完整' }
  // 末尾没有换行时补最后一行
  if (cell !== '' || cells.length) {
    cells.push(cell.trim())
    rows.push({ line: rowStartLine, cells })
  }
  return { rows: rows.filter(row => row.cells.some(c => c !== '')), error: null }
}

/** 表头标准化：小写、去空格，兼容 itemId / itemid / item_id。 */
export function headerKey(name) {
  return String(name ?? '').trim().toLowerCase().replace(/[\s_-]/g, '')
}

const PLATFORMS = new Set(['公众号', '小红书', '抖音', 'B站', '视频号', 'TikTok', 'Instagram', 'YouTube', 'X'])

/**
 * 把 CSV 文本转成待写入的指标行，坏行不静默吞掉。
 * @param {string} text - CSV 原文。
 * @param {{newId?: () => string, now?: Date}} [options]
 * @returns {{metrics: object[], skipped: Array<{line: number, reason: string}>, error: string|null}}
 */
export function csvToMetrics(text, { newId, now = new Date() } = {}) {
  const { rows, error } = parseCsv(text)
  if (error) return { metrics: [], skipped: [], error }
  if (!rows.length) return { metrics: [], skipped: [], error: 'CSV 是空的' }

  const head = rows[0].cells.map(headerKey)
  const at = (...names) => {
    for (const name of names) {
      const i = head.indexOf(name)
      if (i >= 0) return i
    }
    return -1
  }
  const idx = {
    platform: at('platform', '平台'),
    date: at('date', '日期'),
    views: at('views', '阅读', '播放'),
    likes: at('likes', '点赞'),
    comments: at('comments', '评论'),
    shares: at('shares', '转发'),
    saves: at('saves', '收藏'),
    itemId: at('itemid', 'item'),
    externalId: at('externalid', 'external'),
  }
  if (idx.platform < 0) return { metrics: [], skipped: [], error: '表头里找不到 platform 列' }

  const metrics = []
  const skipped = []
  const seq = { n: 0 }
  const id = newId ?? (() => `m_${Date.now().toString(36)}${(seq.n += 1)}`)

  for (const row of rows.slice(1)) {
    const get = name => (idx[name] >= 0 ? row.cells[idx[name]] ?? '' : '')
    const platform = get('platform')
    if (!platform) { skipped.push({ line: row.line, reason: 'platform 为空' }); continue }
    if (!PLATFORMS.has(platform)) { skipped.push({ line: row.line, reason: `平台「${platform}」不认识` }); continue }

    let date = now
    const rawDate = get('date')
    if (rawDate) {
      const parsed = new Date(rawDate.replace(/\//g, '-'))
      if (Number.isNaN(parsed.getTime())) { skipped.push({ line: row.line, reason: `日期「${rawDate}」无法解析` }); continue }
      date = parsed
    }

    const num = (name) => {
      const raw = get(name)
      if (!raw) return 0
      const n = Number(String(raw).replace(/,/g, ''))
      return Number.isFinite(n) ? n : NaN
    }
    const values = {}
    let bad = null
    for (const key of ['views', 'likes', 'comments', 'shares', 'saves']) {
      const v = num(key)
      if (Number.isNaN(v)) { bad = `${key}「${get(key)}」不是数字`; break }
      values[key] = v
    }
    if (bad) { skipped.push({ line: row.line, reason: bad }); continue }

    const externalId = get('externalId')
    metrics.push({
      id: id(),
      itemId: get('itemId') || undefined,
      platform,
      date: date.toISOString(),
      ...values,
      ...(externalId ? { externalId } : {}),
    })
  }

  if (!metrics.length) return { metrics, skipped, error: '没有一行能用的数据' }
  return { metrics, skipped, error: null }
}
