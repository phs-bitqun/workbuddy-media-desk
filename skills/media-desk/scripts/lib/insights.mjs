// 复盘：从真实数据和你对草稿的修改里提炼规则。移植自上游 src/learn.js 的 computeInsights / proposeRules。

/** 按本机时区算日期，早上发的内容不会算到前一天。 */
function localDay(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? String(iso).slice(0, 10)
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] || 0), 0)
const engagement = row => (row.likes || 0) + (row.comments || 0) + (row.shares || 0) + (row.saves || 0)

function itemTotals(metrics) {
  const totals = new Map()
  for (const metric of metrics) {
    if (!metric.itemId) continue
    const entry = totals.get(metric.itemId) ?? { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 }
    for (const key of Object.keys(entry)) entry[key] += metric[key] || 0
    totals.set(metric.itemId, entry)
  }
  return totals
}

/** 有了真实数据后，示例数据就不再参与统计。 */
function realMetrics(state) {
  const real = state.metrics.filter(metric => !metric.sample)
  return real.length ? real : state.metrics
}

/** 一篇内容有导入的累计数据时，只认那一行，避免和其他手动数据重复计。 */
function countedMetrics(state) {
  const metrics = realMetrics(state)
  const imported = new Set(metrics.filter(m => m.externalId && m.itemId).map(m => m.itemId))
  return imported.size ? metrics.filter(m => m.externalId || !imported.has(m.itemId)) : metrics
}

function bestGroup(rows) {
  const groups = new Map()
  for (const row of rows) {
    if (!row.key) continue
    const list = groups.get(row.key) ?? []
    list.push(row.value)
    groups.set(row.key, list)
  }
  return [...groups.entries()]
    .map(([key, values]) => ({ key, n: values.length, avg: values.reduce((a, b) => a + b, 0) / values.length }))
    .sort((a, b) => b.avg - a.avg)
}

/** 对比 AI 原稿和你改完的版本，粗略判断修改方向。 */
function editSignals(state) {
  const signals = []
  for (const item of state.items) {
    const production = item.production
    if (production?.aiArticle && production.article && production.article !== production.aiArticle) {
      const before = production.aiArticle.replace(/\s/g, '').length
      const after = production.article.replace(/\s/g, '').length
      signals.push({ title: item.title, ratio: before ? after / before : 1 })
    }
    for (const format of ['article', 'script']) {
      const draft = item.drafts?.[format]
      if (!draft?.aiText || draft.by !== 'user' || draft.text === draft.aiText) continue
      const before = draft.aiText.replace(/\s/g, '').length
      const after = draft.text.replace(/\s/g, '').length
      signals.push({ title: item.title, ratio: before ? after / before : 1 })
    }
  }
  return signals
}

/** 复盘页的汇总。 */
export function computeInsights(state) {
  const real = realMetrics(state)
  const metrics = countedMetrics(state)
  const onlyReal = real.length !== state.metrics.length
  const totals = itemTotals(metrics)
  const daily = new Map()
  for (const metric of metrics) {
    const day = localDay(metric.date)
    const entry = daily.get(day) ?? { date: day, views: 0, engaged: 0 }
    entry.views += metric.views || 0
    entry.engaged += engagement(metric)
    daily.set(day, entry)
  }
  const platforms = new Map()
  for (const metric of metrics) {
    const entry = platforms.get(metric.platform) ?? { platform: metric.platform, views: 0, engaged: 0, likes: 0, comments: 0, shares: 0, saves: 0 }
    for (const key of ['views', 'likes', 'comments', 'shares', 'saves']) entry[key] += metric[key] || 0
    entry.engaged += engagement(metric)
    platforms.set(metric.platform, entry)
  }
  const top = state.items
    .filter(item => totals.has(item.id))
    .map(item => ({ id: item.id, title: item.title, platform: item.platform, ...totals.get(item.id), engaged: engagement(totals.get(item.id)) }))
    .sort((a, b) => b.views - a.views || b.engaged - a.engaged)
  const views = sum(metrics, 'views')
  const engaged = metrics.reduce((total, metric) => total + engagement(metric), 0)
  const withViews = metrics.filter(metric => metric.views > 0)
  const accounts = state.accounts.filter(account => (onlyReal ? !account.sample : true))
  return {
    views,
    engaged,
    engagementRate: views ? withViews.reduce((total, m) => total + engagement(m), 0) / views : 0,
    published: state.items.filter(item => item.status === 'published').length,
    followers: sum(accounts, 'followers'),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    platforms: [...platforms.values()].sort((a, b) => b.views - a.views || b.engaged - a.engaged),
    top,
    hasSample: metrics.some(metric => metric.sample),
    imported: metrics.some(metric => metric.externalId),
    skipped: real.length - metrics.length,
  }
}

/**
 * 基于现有数据计算规则提案。只有样本足够才提案，不凑数。
 * @returns {Array<{name, rule, evidence, confidence, source}>}
 */
export function proposeRules(state) {
  const proposals = []
  const totals = itemTotals(countedMetrics(state))
  const published = state.items.filter(item => totals.has(item.id))
  const rows = published.map(item => ({ item, views: totals.get(item.id).views }))

  const byPlatform = bestGroup(rows.filter(row => row.views > 0).map(row => ({ key: row.item.platform, value: row.views })))
  if (byPlatform.length >= 2 && byPlatform[0].avg > byPlatform[1].avg * 1.3) {
    const best = byPlatform[0]
    proposals.push({
      name: `首发放在${best.key}`,
      rule: `同一选题优先在${best.key}首发，再改写分发到其他平台。`,
      evidence: `${best.key}平均 ${Math.round(best.avg).toLocaleString('en-US')} 阅读，高于第二名${byPlatform[1].key}的 ${Math.round(byPlatform[1].avg).toLocaleString('en-US')}`,
      confidence: Math.min(0.85, 0.4 + best.n * 0.12),
      source: '数据复盘',
    })
  }

  const hasViews = rows.some(row => row.views > 0)
  const hours = bestGroup(published.filter(item => item.publishedAt).map(item => ({
    key: String(new Date(item.publishedAt).getHours()),
    value: hasViews ? totals.get(item.id).views : engagement(totals.get(item.id)),
  })))
  if (hours.length >= 2 && hours[0].n >= 2) {
    proposals.push({
      name: `${hours[0].key} 点前后发布`,
      rule: `默认把内容排在 ${hours[0].key}:00 前后发布。`,
      evidence: hasViews
        ? `这个时段 ${hours[0].n} 篇平均 ${Math.round(hours[0].avg).toLocaleString('en-US')} 阅读`
        : `这个时段 ${hours[0].n} 篇平均 ${Math.round(hours[0].avg).toLocaleString('en-US')} 互动`,
      confidence: 0.5,
      source: '数据复盘',
    })
  }

  const edits = editSignals(state)
  if (edits.length >= 2) {
    const avg = edits.reduce((a, b) => a + b.ratio, 0) / edits.length
    if (avg < 0.85) {
      proposals.push({
        name: '初稿写短一些',
        rule: `你通常把初稿删到原来的 ${Math.round(avg * 100)}%，以后初稿控制得更紧凑。`,
        evidence: `来自 ${edits.length} 次草稿修改`,
        confidence: Math.min(0.9, 0.5 + edits.length * 0.08),
        source: '草稿修改',
      })
    } else if (avg > 1.15) {
      proposals.push({
        name: '初稿多给细节',
        rule: `你通常把初稿扩写到原来的 ${Math.round(avg * 100)}%，以后初稿多给具体细节和例子。`,
        evidence: `来自 ${edits.length} 次草稿修改`,
        confidence: Math.min(0.9, 0.5 + edits.length * 0.08),
        source: '草稿修改',
      })
    }
  }

  const known = new Set(state.skills.map(skill => skill.name))
  return proposals.filter(row => !known.has(row.name))
}
