/* 自媒体工作台 · 本地界面。原生 JS，无构建。所有写操作走 /api/*，带启动令牌。 */
const TOKEN = window.__DESK_TOKEN__ || ''
const app = document.getElementById('app')
const drawerRoot = document.getElementById('drawer-root')
const modalRoot = document.getElementById('modal-root')

let S = null
let active = localStorage.getItem('desk.tab') || null
let search = ''
let drawer = null      // { id, item, busy }
let navEdit = null     // { title, nav }
let calDate = new Date()
let selDay = null
let toastTimer = null

/* ------------------------------ 基础工具 ------------------------------ */

const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = v => Number(v || 0).toLocaleString('en-US')

const pad = n => String(n).padStart(2, '0')
function fmtDay(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
function fmtWhen(iso) {
  if (!iso) return '未排期'
  const d = new Date(iso)
  return `${fmtDay(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function relDay(iso) {
  if (!iso) return ''
  const a = new Date(iso); a.setHours(0, 0, 0, 0)
  const b = new Date(); b.setHours(0, 0, 0, 0)
  const diff = Math.round((a - b) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  return diff > 0 ? `${diff} 天后` : `${-diff} 天前`
}
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const statusKey = s => s
const statusLabel = s => S?.meta?.statusLabels?.[s] ?? s

async function api(path, { method = 'GET', body, raw, type } = {}) {
  const headers = { 'x-desk-token': TOKEN }
  let payload
  if (raw) { headers['content-type'] = type; payload = raw }
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body) }
  const res = await fetch(path, { method, headers, body: payload })
  let data = {}
  try { data = await res.json() } catch { /* 空响应 */ }
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`)
  return data
}

function toast(msg, bad = false) {
  let el = document.querySelector('.toast')
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el) }
  el.textContent = msg
  el.style.background = bad ? '#c0392b' : ''
  el.style.color = bad ? '#fff' : ''
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.remove(), 2200)
}

const copy = async text => {
  try { await navigator.clipboard.writeText(text); return true } catch { /* 退回旧接口 */ }
  const ta = document.createElement('textarea')
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
  document.body.appendChild(ta); ta.select()
  const ok = document.execCommand('copy'); ta.remove()
  return ok
}

/* ------------------------------ 数据 ------------------------------ */

async function load() {
  S = await api('/api/state')
  const visible = S.ui.nav.filter(n => n.visible)
  if (!active || !visible.some(n => n.id === active)) active = visible[0]?.id ?? null
}

function navCount(item) {
  switch (item.type) {
    case 'ideas': return S.items.filter(i => i.status === 'idea').length
    case 'content': return S.items.length
    case 'schedule': return S.items.filter(i => i.scheduledAt).length
    case 'insights': return S.metrics.length
    case 'style': return S.styles.length
    case 'view': return applyFilter(S.items, item.filter).length
    default: return 0
  }
}

/** 只接受筛选条件对象本身（status / platform / tag / q），不接受菜单项。 */
function applyFilter(items, filter) {
  const f = filter ?? {}
  let rows = items
  if (f.status) rows = rows.filter(r => r.status === f.status)
  if (f.platform) rows = rows.filter(r => r.platform === f.platform)
  if (f.tag) rows = rows.filter(r => (r.tags ?? []).includes(f.tag))
  if (f.q) {
    const q = f.q.toLowerCase()
    rows = rows.filter(r => `${r.title} ${r.body} ${(r.tags ?? []).join(' ')}`.toLowerCase().includes(q))
  }
  return rows
}

/* ------------------------------ 卡片 ------------------------------ */

function statusChip(status) {
  return `<span class="st s-${esc(statusKey(status))}"><i class="dot"></i>${esc(statusLabel(status))}</span>`
}

function card(item, { showThumb = false } = {}) {
  const p = item.production
  const cover = p?.cover?.src
  return `<article class="card" data-id="${esc(item.id)}">
    ${showThumb && cover ? `<img class="thumb" src="/${esc(cover)}" alt="">` : ''}
    <h3>${esc(item.title)}</h3>
    ${item.body ? `<p>${esc(item.body)}</p>` : ''}
    <div class="meta">
      ${statusChip(item.status)}
      ${item.platform ? `<span>${esc(item.platform)}</span>` : ''}
      <span>${item.scheduledAt ? `${esc(fmtWhen(item.scheduledAt))} 发` : `${esc(fmtDay(item.createdAt))} 记下`}</span>
      ${p?.status === 'done' ? '<span class="tag">已成稿</span>' : ''}
    </div>
    ${(item.tags ?? []).length ? `<div class="meta">${item.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
  </article>`
}

function mini(item) {
  const p = item.production
  const extra = p?.status === 'done' ? `已成稿 · 配图 ${p.images.length} · 分镜 ${p.shots.length}` : (p ? '策划案已定' : item.platform ?? '')
  return `<div class="mini" data-id="${esc(item.id)}"><div class="t">${esc(item.title)}</div><div class="d">${esc(extra)}</div></div>`
}

/* ------------------------------ 各页 ------------------------------ */

function quickAdd() {
  return `<div class="tools">
    <input id="quick" class="grow" type="text" placeholder="记一句灵感，回车收下">
    <input id="quickTags" type="text" placeholder="标签（可空）" style="width:150px">
    <button class="btn primary" id="quickBtn">记下</button>
  </div>`
}

function viewIdeas(filter) {
  const rows = applyFilter([...S.items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), filter ?? {})
    .filter(r => !search || `${r.title} ${r.body} ${(r.tags ?? []).join(' ')}`.toLowerCase().includes(search.toLowerCase()))
  const body = rows.length
    ? `<div class="grid">${rows.map(r => card(r, { showThumb: true })).join('')}</div>`
    : '<div class="empty">还没有灵感。上面写一句，回车收下。</div>'
  return `${quickAdd()}
  <div class="tools"><input id="search" type="search" class="grow" placeholder="搜标题、正文、标签" value="${esc(search)}"></div>
  ${body}`
}

function viewContent(filter) {
  const rows = applyFilter(S.items, filter ?? {})
  const cols = S.meta.statuses.map(status => {
    const list = rows.filter(r => r.status === status)
    return `<div class="col"><h4><span>${esc(statusLabel(status))}</span><span>${list.length}</span></h4>
      ${list.length ? list.map(mini).join('') : '<div class="d" style="font-size:11.5px;color:var(--muted)">空</div>'}</div>`
  }).join('')
  return `<h2>按状态排好</h2><div class="cols">${cols}</div>`
}

function viewSchedule() {
  const y = calDate.getFullYear()
  const m = calDate.getMonth()
  const first = new Date(y, m, 1)
  const startPad = (first.getDay() + 6) % 7
  const days = new Date(y, m + 1, 0).getDate()
  const today = new Date()

  const byDay = new Map()
  for (const item of S.items) {
    const at = item.scheduledAt ?? item.publishedAt
    if (!at) continue
    const d = new Date(at)
    if (d.getFullYear() !== y || d.getMonth() !== m) continue
    const list = byDay.get(d.getDate()) ?? []
    list.push({ item, published: item.status === 'published' })
    byDay.set(d.getDate(), list)
  }

  const cells = []
  for (let i = 0; i < startPad; i += 1) cells.push('<div class="day out"></div>')
  for (let d = 1; d <= days; d += 1) {
    const isToday = y === today.getFullYear() && m === today.getMonth() && d === today.getDate()
    const sel = selDay === d
    const evs = (byDay.get(d) ?? []).slice(0, 2).map(e => `<span class="ev ${e.published ? 'pub' : 'sch'}">${esc(e.item.title)}</span>`).join('')
    const more = (byDay.get(d)?.length ?? 0) > 2 ? `<span class="ev sch">+${byDay.get(d).length - 2}</span>` : ''
    cells.push(`<div class="day${isToday ? ' today' : ''}${sel ? ' sel' : ''}" data-day="${d}"><span class="n">${d}</span>${evs}${more}</div>`)
  }
  const dows = ['一', '二', '三', '四', '五', '六', '日'].map(d => `<div class="dow">${d}</div>`).join('')

  const dayItems = selDay ? (byDay.get(selDay) ?? []).map(e => e.item) : []
  const backlog = S.items.filter(i => !i.scheduledAt && i.status !== 'published' && i.status !== 'idea')

  const dayHtml = selDay
    ? (dayItems.length
      ? dayItems.map(i => `<div class="mini" data-id="${esc(i.id)}"><div class="t">${esc(i.title)}</div><div class="d">${esc(fmtWhen(i.scheduledAt))} · ${esc(i.platform ?? '未定平台')}</div></div>`).join('')
      : '<div style="color:var(--muted);font-size:12.5px">这天还没有安排。</div>')
    : '<div style="color:var(--muted);font-size:12.5px">点日历上的某天，看那天的安排，并把稿子排进去。</div>'

  return `<div class="cal">
    <div class="calhead">
      <div class="row"><button class="btn" id="prevM">‹</button><strong>${y} 年 ${m + 1} 月</strong><button class="btn" id="nextM">›</button></div>
      <span class="hint">${selDay ? `已选 ${m + 1} 月 ${selDay} 日` : '点一天开始排'}</span>
    </div>
    <div class="calgrid">${dows}${cells.join('')}</div>
  </div>
  <div class="cols" style="grid-template-columns:1fr 1fr;margin-top:14px">
    <div class="col"><h4><span>${selDay ? `${m + 1} 月 ${selDay} 日` : '当天安排'}</span><span>${dayItems.length}</span></h4>${dayHtml}</div>
    <div class="col"><h4><span>还没排期</span><span>${backlog.length}</span></h4>
      ${backlog.length ? backlog.slice(0, 12).map(i => `<div class="mini"><div class="t">${esc(i.title)}</div>
        <div class="d">${esc(statusLabel(i.status))} <button class="btn" style="padding:1px 8px;font-size:11px;margin-left:6px" data-sched="${esc(i.id)}" ${selDay ? '' : 'disabled'}>排这天</button></div></div>`).join('') : '<div style="color:var(--muted);font-size:12.5px">没有待排期的稿子。</div>'}
    </div>
  </div>`
}

function viewInsights() {
  const d = S.insights
  if (!d.daily.length) return `<div class="empty">还没有数据。<button class="btn" id="addMetric">录一条</button> 或粘一份 CSV。</div>`
  const peak = Math.max(...d.daily.map(r => r.views), 1)
  const spark = d.daily.map(r => `<div style="height:${Math.max(2, Math.round((r.views / peak) * 100))}%" title="${esc(r.date)} · ${num(r.views)}"></div>`).join('')
  const pmax = Math.max(...d.platforms.map(r => r.views), 1)
  const bars = d.platforms.map(r => `<div class="barsrow"><span>${esc(r.platform)}</span>
    <span class="track"><span class="fill" style="width:${Math.round((r.views / pmax) * 100)}%"></span></span>
    <span style="text-align:right;color:var(--muted)">${num(r.views)}</span></div>`).join('')
  const top = d.top.slice(0, 8).map(r => `<tr><td>${esc(r.title)}</td><td>${esc(r.platform ?? '—')}</td>
    <td class="r">${num(r.views)}</td><td class="r">${num(r.engaged)}</td></tr>`).join('')
  const rules = S.skills.length
    ? S.skills.map(r => `<div class="rule"><span class="mark${r.status === 'active' ? '' : ' off'}" data-rule="${esc(r.id)}" data-on="${r.status === 'active'}">${r.status === 'active' ? '✓' : '·'}</span>
      <span><b>${esc(r.name)}</b>：${esc(r.rule)}${r.evidence ? `<span style="color:var(--muted)">（依据：${esc(r.evidence)}）</span>` : ''}</span></div>`).join('')
    : '<div class="rule"><span class="mark off">·</span><span style="color:var(--muted)">还没有沉淀的规则。</span></div>'
  const proposals = (S.proposals ?? []).map(p => `<div class="rule"><span class="mark">+</span>
    <span><b>${esc(p.name)}</b>：${esc(p.rule)}<span style="color:var(--muted)">（${esc(p.evidence)}）</span>
    <button class="btn" style="padding:1px 8px;font-size:11px;margin-left:6px" data-adopt="${esc(p.name)}" data-ruletext="${esc(p.rule)}" data-evidence="${esc(p.evidence)}">采纳</button></span></div>`).join('')

  return `<div class="tools"><button class="btn" id="addMetric">＋ 录一条数据</button>
    <button class="btn" id="importCsv">粘贴 CSV</button></div>
  <div class="kpis">
    <div class="kpi"><div class="k">总阅读</div><div class="v">${num(d.views)}</div></div>
    <div class="kpi"><div class="k">总互动</div><div class="v">${num(d.engaged)}</div></div>
    <div class="kpi"><div class="k">互动率</div><div class="v">${(d.engagementRate * 100).toFixed(2)}%</div></div>
    <div class="kpi"><div class="k">已发布</div><div class="v">${d.published}</div></div>
  </div>
  ${d.hasSample ? '<p class="hint" style="margin-top:10px">表里还有示例数据，录入真实数据后自动停用。</p>' : ''}
  <div class="panel"><h2 style="margin:0 0 6px">每日播放</h2><div class="spark">${spark}</div>
    <div class="hint" style="display:flex;justify-content:space-between;margin-top:6px"><span>${esc(d.daily[0].date)}</span><span>${esc(d.daily[d.daily.length - 1].date)}</span></div></div>
  <div class="panel"><h2 style="margin:0 0 4px">平台分布</h2>${bars}</div>
  <div class="panel"><h2 style="margin:0 0 4px">表现最好</h2>
    <table><thead><tr><th>标题</th><th>平台</th><th class="r">阅读</th><th class="r">互动</th></tr></thead>
    <tbody>${top || '<tr><td colspan="4" style="color:var(--muted)">还没有能对上内容的数据</td></tr>'}</tbody></table></div>
  <h2>写作规则</h2><div class="panel" style="margin-top:0">${rules}</div>
  ${proposals ? `<h2>可以沉淀的规则</h2><div class="panel" style="margin-top:0">${proposals}</div>` : ''}`
}

function viewStyle() {
  const activeStyle = S.styles.find(s => s.id === S.activeStyleId)
  const groups = new Map()
  for (const s of S.styles) {
    const key = s.category || '自定义'
    const list = groups.get(key) ?? []
    list.push(s)
    groups.set(key, list)
  }
  const html = [...groups.entries()].map(([cat, list]) => `<h2>${esc(cat)}</h2>
    <div class="styles">${list.map(s => `<div class="scard${s.id === S.activeStyleId ? ' on' : ''}" data-style="${esc(s.id)}">
      <h3>${esc(s.icon ?? '✍️')} ${esc(s.name)}</h3><p>${esc(s.summary ?? '')}</p></div>`).join('')}</div>`).join('')
  return `<p class="hint">当前：<b style="color:var(--ink)">${esc(activeStyle?.name ?? '未指定风格')}</b> · 体裁：${S.draftFormat === 'article' ? '文章（自然段）' : '口播脚本（一句一行）'}
    <button class="btn" id="toggleFormat" style="margin-left:8px;padding:2px 10px;font-size:12px">切成${S.draftFormat === 'article' ? '口播脚本' : '文章'}</button></p>
  ${html}`
}

/* ------------------------------ 外壳 ------------------------------ */

function shell() {
  const visible = S.ui.nav.filter(n => n.visible)
  const produced = S.items.filter(i => i.production?.status === 'done').length
  const style = S.styles.find(s => s.id === S.activeStyleId)
  const nav = visible.map(n => `<button class="tab" data-tab="${esc(n.id)}" aria-selected="${n.id === active}">
    <span class="ic">${esc(n.icon ?? '')}</span>${esc(n.label)}<span class="n">${navCount(n)}</span></button>`).join('')
  return `<div class="wrap">
    <header class="top">
      <h1>${esc(S.ui.title)}</h1>
      <div class="chips">
        <span class="chip">条目 <b>${S.items.length}</b></span>
        <span class="chip">已成稿 <b>${produced}</b></span>
        <span class="chip">风格 <b>${esc(style?.name ?? '未指定')}</b></span>
      </div>
    </header>
    <nav class="menu">${nav}<button class="gear" id="gear">⚙ 菜单</button></nav>
    <main id="view">${renderView()}</main>
  </div>`
}

function currentNav() {
  return S.ui.nav.find(n => n.id === active) ?? null
}

function renderView() {
  const nav = currentNav()
  if (!nav) return '<div class="empty">菜单里没有可显示的页面。点右上「⚙ 菜单」加回来。</div>'
  switch (nav.type) {
    case 'ideas': return viewIdeas()
    case 'content': return viewContent()
    case 'schedule': return viewSchedule()
    case 'insights': return viewInsights()
    case 'style': return viewStyle()
    case 'view': return nav.base === 'ideas' ? viewIdeas(nav.filter) : viewContent(nav.filter)
    default: return ''
  }
}

function render() {
  app.innerHTML = shell()
  bindShell()
  renderDrawer()
  renderModal()
}

/* ------------------------------ 事件 ------------------------------ */

function bindShell() {
  document.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click', () => {
    active = el.dataset.tab
    localStorage.setItem('desk.tab', active)
    search = ''
    render()
  }))
  document.getElementById('gear')?.addEventListener('click', openNavEditor)
  document.querySelectorAll('.card').forEach(el => el.addEventListener('click', () => openDrawer(el.dataset.id)))
  document.querySelectorAll('.mini[data-id]').forEach(el => el.addEventListener('click', () => openDrawer(el.dataset.id)))

  const quick = document.getElementById('quick')
  const quickBtn = document.getElementById('quickBtn')
  const submitQuick = async () => {
    const title = quick?.value.trim()
    if (!title) return
    const tags = document.getElementById('quickTags')?.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) ?? []
    try {
      await api('/api/items', { method: 'POST', body: { title, tags } })
      quick.value = ''
      const t = document.getElementById('quickTags')
      if (t) t.value = ''
      await refresh()
      toast('记下了')
      setTimeout(() => document.getElementById('quick')?.focus(), 30)
    } catch (err) { toast(err.message, true) }
  }
  quick?.addEventListener('keydown', e => { if (e.key === 'Enter') submitQuick() })
  quickBtn?.addEventListener('click', submitQuick)

  const s = document.getElementById('search')
  s?.addEventListener('input', () => {
    search = s.value
    const view = document.getElementById('view')
    const nav = currentNav()
    view.innerHTML = nav?.type === 'view' ? (nav.base === 'ideas' ? viewIdeas(nav.filter) : viewContent(nav.filter)) : viewIdeas()
    bindCards()
  })

  document.getElementById('prevM')?.addEventListener('click', () => { calDate = new Date(calDate.getFullYear(), calDate.getMonth() - 1, 1); selDay = null; rerenderView() })
  document.getElementById('nextM')?.addEventListener('click', () => { calDate = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 1); selDay = null; rerenderView() })
  document.querySelectorAll('[data-day]').forEach(el => el.addEventListener('click', () => {
    selDay = Number(el.dataset.day)
    rerenderView()
  }))
  document.querySelectorAll('[data-sched]').forEach(el => el.addEventListener('click', async (e) => {
    e.stopPropagation()
    if (!selDay) return
    const at = new Date(calDate.getFullYear(), calDate.getMonth(), selDay, 20, 0)
    try {
      await api(`/api/items/${el.dataset.sched}/schedule`, { method: 'POST', body: { at: at.toISOString() } })
      await refresh()
      toast(`排到 ${fmtWhen(at.toISOString())}`)
    } catch (err) { toast(err.message, true) }
  }))

  document.getElementById('addMetric')?.addEventListener('click', () => {
    const platform = prompt('平台（公众号/小红书/抖音/B站/视频号/TikTok/Instagram/YouTube/X）', S.settings?.platform ?? '小红书')
    if (!platform) return
    const views = prompt('阅读/播放量', '0')
    if (views === null) return
    const likes = prompt('点赞', '0') ?? '0'
    const saves = prompt('收藏', '0') ?? '0'
    api('/api/metrics', { method: 'POST', body: { platform, views: Number(views), likes: Number(likes), saves: Number(saves) } })
      .then(refresh).then(() => toast('记下了')).catch(err => toast(err.message, true))
  })
  document.getElementById('importCsv')?.addEventListener('click', () => {
    const csv = prompt('粘 CSV，第一行表头：platform,date,views,likes,comments,shares,saves')
    if (!csv) return
    api('/api/metrics', { method: 'POST', body: { csv } })
      .then(r => refresh().then(() => toast(`导入 ${r.imported} 条`)))
      .catch(err => toast(err.message, true))
  })

  document.querySelectorAll('[data-style]').forEach(el => el.addEventListener('click', async () => {
    try {
      const r = await api('/api/styles/active', { method: 'POST', body: { id: el.dataset.style } })
      await refresh()
      toast(`之后按「${r.name}」写`)
    } catch (err) { toast(err.message, true) }
  }))
  document.getElementById('toggleFormat')?.addEventListener('click', async () => {
    const next = S.draftFormat === 'article' ? 'script' : 'article'
    try {
      await api('/api/format', { method: 'POST', body: { format: next } })
      await refresh()
      toast(next === 'article' ? '之后写成文章' : '之后写成口播脚本')
    } catch (err) { toast(err.message, true) }
  })

  document.querySelectorAll('[data-rule]').forEach(el => el.addEventListener('click', async () => {
    const on = el.dataset.on === 'true'
    try {
      await api(`/api/rules/${el.dataset.rule}`, { method: 'PATCH', body: { status: on ? 'proposed' : 'active' } })
      await refresh()
    } catch (err) { toast(err.message, true) }
  }))
  document.querySelectorAll('[data-adopt]').forEach(el => el.addEventListener('click', async () => {
    try {
      await api('/api/rules', { method: 'POST', body: { name: el.dataset.adopt, rule: el.dataset.ruletext, evidence: el.dataset.evidence, status: 'active' } })
      await refresh()
      toast('已生效')
    } catch (err) { toast(err.message, true) }
  }))
}

function bindCards() {
  document.querySelectorAll('.card').forEach(el => el.addEventListener('click', () => openDrawer(el.dataset.id)))
}

function rerenderView() {
  const view = document.getElementById('view')
  if (!view) return
  view.innerHTML = renderView()
  bindShell()
}

/* ------------------------------ 抽屉 ------------------------------ */

function openDrawer(id) {
  drawer = { id, item: null, busy: true }
  renderDrawer()
  api(`/api/items/${id}`).then(item => {
    drawer = { id, item, busy: false }
    renderDrawer()
  }).catch(err => { toast(err.message, true); closeDrawer() })
}

function closeDrawer() { drawer = null; renderDrawer() }

function renderDrawer() {
  if (!drawer) { drawerRoot.innerHTML = ''; return }
  const it = drawer.item
  if (!it) {
    drawerRoot.innerHTML = `<div class="scrim"></div><aside class="drawer"><div class="dbody">载入中…</div></aside>`
    drawerRoot.querySelector('.scrim').addEventListener('click', closeDrawer)
    return
  }
  const p = it.production
  const platforms = S.meta.platforms.map(x => `<option value="${esc(x)}"${it.platform === x ? ' selected' : ''}>${esc(x)}</option>`).join('')
  const statuses = S.meta.statuses.map(x => `<option value="${esc(x)}"${it.status === x ? ' selected' : ''}>${esc(statusLabel(x))}</option>`).join('')

  const production = p ? `
    <hr style="border:0;border-top:1px solid var(--line);margin:2px 0">
    <div class="field"><label>成稿标题</label><input id="dTitle" type="text" value="${esc(p.title ?? '')}"></div>
    <div class="field"><label>封面大字</label><input id="dCoverText" type="text" value="${esc(p.coverText ?? '')}"></div>
    <div class="field"><label>正文（${esc(p.format === 'article' ? '文章' : '口播脚本')} · ${p.article?.length ?? 0} 字）</label>
      <textarea id="dArticle">${esc(p.article ?? '')}</textarea></div>
    <div class="field"><label>画面</label>
      <div class="imgrow">
        ${p.cover ? `<div class="imgcell">${p.cover.src ? `<img src="/${esc(p.cover.src)}" alt="">` : '<div class="ph">待画</div>'}
          <div>封面</div><button data-upload="cover">上传</button></div>` : ''}
        ${(p.images ?? []).map((im, i) => `<div class="imgcell">${im.src ? `<img src="/${esc(im.src)}" alt="">` : '<div class="ph">待画</div>'}
          <div>配图 ${i + 1}</div><button data-upload="image:${i}">上传</button></div>`).join('')}
      </div>
    </div>
    ${(p.shots ?? []).length ? `<div class="field"><label>分镜</label><div class="shots">
      ${p.shots.map((s, i) => `<div class="shot"><b>${s.no} · ${esc(s.shot)}</b> ${esc(s.visual ?? '')}
        <div style="margin-top:4px"><button class="btn" style="padding:1px 7px;font-size:11px" data-upload="shot:${i}">${s.src ? '换图' : '上传'}</button></div></div>`).join('')}
    </div></div>` : ''}
    <div class="field"><label>让它去对话里继续改</label>
      <div class="row"><button class="btn" id="copyProduce">复制成稿指令</button>
      <span class="hint">生成正文和画面需要模型，界面只负责手动部分。</span></div></div>
  ` : `
    <hr style="border:0;border-top:1px solid var(--line);margin:2px 0">
    <p class="hint">这条还没有成稿。去对话里说一句就能生成：</p>
    <div class="row"><button class="btn" id="copyProduce">复制成稿指令</button></div>
  `

  drawerRoot.innerHTML = `<div class="scrim"></div>
  <aside class="drawer">
    <div class="dhead"><strong>${esc(it.title)}</strong><button class="btn" id="dClose">关闭</button></div>
    <div class="dbody">
      <div class="field"><label>标题</label><input id="dItemTitle" type="text" value="${esc(it.title)}"></div>
      <div class="field"><label>补充</label><textarea id="dBody" style="min-height:80px">${esc(it.body ?? '')}</textarea></div>
      <div class="field"><label>标签（逗号分隔）</label><input id="dTags" type="text" value="${esc((it.tags ?? []).join(', '))}"></div>
      <div class="row">
        <div class="field" style="flex:1"><label>状态</label><select id="dStatus">${statuses}</select></div>
        <div class="field" style="flex:1"><label>平台</label><select id="dPlatform"><option value="">未定</option>${platforms}</select></div>
      </div>
      <div class="field"><label>排期（留空＝未排）</label><input id="dSchedule" type="datetime-local" value="${esc(toLocalInput(it.scheduledAt))}"></div>
      ${production}
    </div>
    <div class="dfoot">
      <button class="btn primary" id="dSave">保存</button>
      <button class="btn" id="dScheduleSave">只存排期</button>
      ${p ? '<button class="btn" id="dExport">导出文件夹</button>' : ''}
      <button class="btn danger" id="dDelete">删除</button>
    </div>
  </aside>`

  const close = () => closeDrawer()
  drawerRoot.querySelector('.scrim').addEventListener('click', close)
  document.getElementById('dClose').addEventListener('click', close)

  document.getElementById('dSave').addEventListener('click', async () => {
    const body = {
      title: document.getElementById('dItemTitle').value.trim(),
      body: document.getElementById('dBody').value,
      tags: document.getElementById('dTags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      status: document.getElementById('dStatus').value,
      platform: document.getElementById('dPlatform').value || null,
    }
    try {
      await api(`/api/items/${drawer.id}`, { method: 'PATCH', body })
      if (document.getElementById('dArticle')) {
        const prod = {
          title: document.getElementById('dTitle').value.trim(),
          coverText: document.getElementById('dCoverText').value.trim(),
          article: document.getElementById('dArticle').value,
        }
        await api(`/api/items/${drawer.id}/production`, { method: 'POST', body: prod })
      }
      const scheduled = document.getElementById('dSchedule').value
      await api(`/api/items/${drawer.id}/schedule`, { method: 'POST', body: { at: scheduled ? new Date(scheduled).toISOString() : null } })
      await refresh()
      toast('已保存')
      closeDrawer()
    } catch (err) { toast(err.message, true) }
  })

  document.getElementById('dScheduleSave').addEventListener('click', async () => {
    const v = document.getElementById('dSchedule').value
    try {
      await api(`/api/items/${drawer.id}/schedule`, { method: 'POST', body: { at: v ? new Date(v).toISOString() : null } })
      await refresh()
      toast(v ? '已排期' : '已取消排期')
    } catch (err) { toast(err.message, true) }
  })

  document.getElementById('dDelete').addEventListener('click', async () => {
    if (!confirm(`删除《${it.title}》？这一条和它的数据都会没。`)) return
    try {
      await api(`/api/items/${drawer.id}`, { method: 'DELETE' })
      await refresh()
      closeDrawer()
      toast('已删除')
    } catch (err) { toast(err.message, true) }
  })

  document.getElementById('dExport')?.addEventListener('click', async () => {
    try {
      const r = await api(`/api/items/${drawer.id}/export`, { method: 'POST' })
      toast(`已导出到 ${r.dir}`)
    } catch (err) { toast(err.message, true) }
  })

  document.getElementById('copyProduce')?.addEventListener('click', async () => {
    const text = `把《${it.title}》做成成稿：${p ? '重写' : '生成'}口播脚本，封面和分镜一起画`
    const ok = await copy(text)
    toast(ok ? '指令已复制，粘到对话里' : '复制失败，手动选中文字', !ok)
  })

  drawerRoot.querySelectorAll('[data-upload]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.upload
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/png,image/jpeg,image/webp,image/gif'
      input.addEventListener('change', async () => {
        const file = input.files?.[0]
        if (!file) return
        btn.textContent = '上传中…'
        try {
          const buf = await file.arrayBuffer()
          await api(`/api/items/${drawer.id}/asset?target=${encodeURIComponent(target)}`, {
            method: 'POST', raw: buf, type: file.type || 'image/png',
          })
          const item = await api(`/api/items/${drawer.id}`)
          drawer = { id: drawer.id, item, busy: false }
          await refresh()
          renderDrawer()
          toast('图片已登记')
        } catch (err) { toast(err.message, true); btn.textContent = '上传' }
      })
      input.click()
    })
  })
}

/* ------------------------------ 菜单设置 ------------------------------ */

function openNavEditor() {
  navEdit = { title: S.ui.title, nav: S.ui.nav.map(n => ({ ...n })) }
  renderModal()
}

function closeNavEditor() { navEdit = null; renderModal() }

function renderModal() {
  if (!navEdit) { modalRoot.innerHTML = ''; return }
  const typeName = n => n.type === 'view'
    ? `筛选视图 · ${n.base === 'ideas' ? '灵感' : '内容'}${n.filter?.status ? ` · ${statusLabel(n.filter.status)}` : ''}${n.filter?.platform ? ` · ${n.filter.platform}` : ''}${n.filter?.tag ? ` · #${n.filter.tag}` : ''}`
    : `内置页 · ${S.meta.navLabels[n.type] ?? n.type}`

  const rows = navEdit.nav.map((n, i) => `<div class="navrow">
    <div class="ib" data-up="${i}" style="cursor:pointer">↑</div>
    <div>
      <input type="text" value="${esc(n.label)}" data-label="${i}" style="width:100%;padding:5px 9px;font-size:13px">
      <div class="hd">${esc(typeName(n))}${n.visible ? '' : ' · 已隐藏'}</div>
    </div>
    <div class="ops">
      <button class="ib" data-down="${i}" title="下移">↓</button>
      <button class="ib" data-hide="${i}" title="${n.visible ? '隐藏' : '显示'}">${n.visible ? '◉' : '◌'}</button>
      <button class="ib" data-remove="${i}" title="删除">✕</button>
    </div>
  </div>`).join('')

  const statusOpts = S.meta.statuses.map(s => `<option value="${esc(s)}">${esc(statusLabel(s))}</option>`).join('')
  const platformOpts = S.meta.platforms.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')

  modalRoot.innerHTML = `<div class="scrim"></div>
  <div class="modal">
    <header><strong>菜单栏</strong><button class="btn" id="mClose">关闭</button></header>
    <div class="body">
      <div class="field"><label>工作台名字</label><input id="mTitle" type="text" value="${esc(navEdit.title)}"></div>
      <div class="field"><label>菜单项（↑↓ 调序，◉ 显隐，✕ 删除）</label>
        <div style="display:flex;flex-direction:column;gap:7px">${rows}</div>
      </div>
      <div class="field"><label>加一个筛选视图</label>
        <div class="row">
          <select id="vBase"><option value="content">内容</option><option value="ideas">灵感</option></select>
          <select id="vStatus"><option value="">任意状态</option>${statusOpts}</select>
          <select id="vPlatform"><option value="">任意平台</option>${platformOpts}</select>
          <input id="vTag" type="text" placeholder="标签" style="width:100px">
          <input id="vName" type="text" placeholder="菜单名" style="width:120px">
          <button class="btn" id="vAdd">添加</button>
        </div>
        <p class="hint">例：内容 + 待发布 + 小红书，命名「小红书待发」。</p>
      </div>
    </div>
    <footer>
      <button class="btn" id="mReset">恢复默认</button>
      <button class="btn" id="mCancel">取消</button>
      <button class="btn primary" id="mSave">保存</button>
    </footer>
  </div>`

  modalRoot.querySelector('.scrim').addEventListener('click', closeNavEditor)
  document.getElementById('mClose').addEventListener('click', closeNavEditor)
  document.getElementById('mCancel').addEventListener('click', closeNavEditor)
  document.getElementById('mTitle').addEventListener('input', e => { navEdit.title = e.target.value })
  modalRoot.querySelectorAll('[data-label]').forEach(el => el.addEventListener('input', e => {
    navEdit.nav[Number(el.dataset.label)].label = e.target.value
  }))
  const swap = (a, b) => {
    if (b < 0 || b >= navEdit.nav.length) return
    const list = navEdit.nav
    ;[list[a], list[b]] = [list[b], list[a]]
    renderModal()
  }
  modalRoot.querySelectorAll('[data-up]').forEach(el => el.addEventListener('click', () => swap(Number(el.dataset.up), Number(el.dataset.up) - 1)))
  modalRoot.querySelectorAll('[data-down]').forEach(el => el.addEventListener('click', () => swap(Number(el.dataset.down), Number(el.dataset.down) + 1)))
  modalRoot.querySelectorAll('[data-hide]').forEach(el => el.addEventListener('click', () => {
    const row = navEdit.nav[Number(el.dataset.hide)]
    row.visible = !row.visible
    renderModal()
  }))
  modalRoot.querySelectorAll('[data-remove]').forEach(el => el.addEventListener('click', () => {
    navEdit.nav.splice(Number(el.dataset.remove), 1)
    renderModal()
  }))
  document.getElementById('vAdd').addEventListener('click', () => {
    const base = document.getElementById('vBase').value
    const status = document.getElementById('vStatus').value
    const platform = document.getElementById('vPlatform').value
    const tag = document.getElementById('vTag').value.trim()
    const name = document.getElementById('vName').value.trim()
    if (!status && !platform && !tag) { toast('至少选一个筛选条件', true); return }
    const label = name || [status ? statusLabel(status) : '', platform, tag ? `#${tag}` : ''].filter(Boolean).join(' · ')
    navEdit.nav.push({
      id: `nav_view_${Date.now().toString(36)}`,
      type: 'view',
      label: label.slice(0, 24),
      icon: '◎',
      visible: true,
      base,
      filter: { ...(status ? { status } : {}), ...(platform ? { platform } : {}), ...(tag ? { tag } : {}) },
    })
    renderModal()
  })
  document.getElementById('mReset').addEventListener('click', () => {
    navEdit = {
      title: '自媒体工作台',
      nav: ['ideas', 'content', 'schedule', 'insights', 'style'].map(t => ({
        id: `nav_${t}`, type: t, label: S.meta.navLabels[t], icon: { ideas: '✦', content: '▤', schedule: '◷', insights: '◔', style: '✎' }[t], visible: true,
      })),
    }
    renderModal()
  })
  document.getElementById('mSave').addEventListener('click', async () => {
    try {
      await api('/api/ui', { method: 'PUT', body: { title: navEdit.title, nav: navEdit.nav } })
      closeNavEditor()
      await refresh()
      toast('菜单已更新')
    } catch (err) { toast(err.message, true) }
  })
}

/* ------------------------------ 启动 ------------------------------ */

async function refresh() {
  const keepId = drawer?.id ?? null
  await load()
  render()
  if (keepId && drawer) {
    try {
      const item = await api(`/api/items/${keepId}`)
      drawer = { id: keepId, item, busy: false }
      renderDrawer()
    } catch { closeDrawer() }
  }
}

load().then(() => { render() }).catch(err => {
  app.innerHTML = `<div class="boot"><p>载入失败：${esc(err.message)}</p>
    <p style="font-size:13px">如果提示「还没初始化」，回到对话里说一句「初始化工作台」。</p></div>`
})
