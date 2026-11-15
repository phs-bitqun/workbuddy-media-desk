// 把 state.json 渲染成一份自包含的工作台 HTML：灵感 · 内容 · 排期 · 复盘 · 风格。
// 只读视图，所有改动走 desk.mjs。图片按 files/ 相对路径引用，所以 HTML 必须放在数据根目录。
import { STATUS_LABEL, statusLabel } from './ops.mjs'
import { computeInsights } from './insights.mjs'
import { STYLE_CATEGORIES } from './seed.mjs'
import { activeStyle } from './ops.mjs'
import { fmtWhen } from './ops.mjs'

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const num = value => Number(value || 0).toLocaleString('en-US')

function dayLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function relDay(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date()
  const diff = Math.round((d.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  if (diff < 0) return `${-diff} 天前`
  return `${diff} 天后`
}

const CSS = `
:root{
  --bg:#f7f6f3; --surface:#ffffff; --ink:#1c1b19; --muted:#6f6a63; --line:#e6e2db;
  --accent:#b3462f; --accent-soft:#f6e9e4; --shadow:0 1px 2px rgba(28,27,25,.05),0 8px 24px -12px rgba(28,27,25,.14);
}
@media (prefers-color-scheme: dark){
  :root{ --bg:#15151a; --surface:#1d1d24; --ink:#ecebe8; --muted:#9a958d; --line:#2c2c34; --accent:#e0705a; --accent-soft:#33221e;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px -12px rgba(0,0,0,.6); }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  font-size:14px;line-height:1.65;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:40px 28px 80px}
header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:6px}
h1{font-size:26px;letter-spacing:-.02em;margin:0;font-weight:650}
.sub{color:var(--muted);font-size:13px;margin-top:6px}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.chip{border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:5px 12px;font-size:12px;color:var(--muted)}
.chip b{color:var(--ink);font-weight:600}
nav{display:flex;gap:4px;margin:26px 0 22px;border-bottom:1px solid var(--line);flex-wrap:wrap}
nav button{appearance:none;border:0;background:none;font:inherit;font-size:14px;color:var(--muted);
  padding:9px 14px;border-radius:8px 8px 0 0;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
nav button:hover{color:var(--ink);background:var(--accent-soft)}
nav button[aria-selected="true"]{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}
section[hidden]{display:none}
h2{font-size:13px;font-weight:600;color:var(--muted);letter-spacing:.04em;margin:34px 0 12px}
h2:first-child{margin-top:0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:14px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 17px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:9px}
.card h3{margin:0;font-size:15px;font-weight:600;line-height:1.45}
.card p{margin:0;color:var(--muted);font-size:13px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.meta{display:flex;gap:10px;flex-wrap:wrap;font-size:11.5px;color:var(--muted)}
.tag{background:var(--accent-soft);color:var(--accent);border-radius:5px;padding:1px 7px;font-size:11px;font-weight:500}
.st{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--muted)}
.dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.s-idea{color:#8a8578}.s-outline{color:#a9743f}.s-draft{color:#4a6b8a}.s-ready{color:#4b7a52}.s-published{color:var(--accent)}
.cols{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;align-items:start}
@media(max-width:900px){.cols{grid-template-columns:1fr 1fr}}
.col{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px}
.col h4{margin:0 0 10px;font-size:12px;font-weight:600;color:var(--muted);display:flex;justify-content:space-between}
.mini{border-top:1px solid var(--line);padding:9px 0;font-size:13px}
.mini:first-of-type{border-top:0}
.mini .t{font-weight:500;line-height:1.4}
.mini .d{color:var(--muted);font-size:11.5px;margin-top:3px}
.cal{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px;box-shadow:var(--shadow)}
.calhead{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px}
.calhead strong{font-size:15px}
.calgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.dow{font-size:11px;color:var(--muted);text-align:center;padding-bottom:4px}
.day{min-height:62px;border:1px solid var(--line);border-radius:8px;padding:5px 6px;font-size:11px;position:relative;background:var(--bg)}
.day.out{opacity:.35}
.day .n{color:var(--muted);font-size:11px}
.day.today{border-color:var(--accent);border-width:1.5px}
.day .ev{display:block;margin-top:3px;font-size:10px;line-height:1.3;border-radius:3px;padding:1px 3px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:var(--accent-soft);color:var(--accent)}
.day .ev.pub{background:transparent;color:var(--muted);text-decoration:line-through;opacity:.7}
.stamps{display:flex;gap:5px;flex-wrap:wrap;margin-top:14px}
.stamp{width:22px;height:22px;border-radius:5px;border:1px dashed var(--line);display:grid;place-items:center;font-size:10px;color:var(--muted)}
.stamp.on{background:var(--accent);border:0;color:#fff;border-style:solid}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:15px 16px}
.kpi .k{font-size:11.5px;color:var(--muted)}
.kpi .v{font-size:23px;font-weight:650;letter-spacing:-.02em;margin-top:4px}
.bars{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px;margin-top:14px}
.barsrow{display:grid;grid-template-columns:96px 1fr 76px;gap:10px;align-items:center;margin:9px 0;font-size:12.5px}
.track{position:relative;display:block;height:8px;line-height:0;background:var(--bg);border-radius:999px;overflow:hidden}
.fill{position:absolute;top:0;bottom:0;left:0;background:var(--accent);border-radius:999px}
.spark{display:flex;align-items:flex-end;gap:3px;height:74px;margin-top:6px}
.spark div{flex:1;background:var(--accent);border-radius:2px 2px 0 0;min-height:2px;opacity:.85}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
th{font-size:11.5px;color:var(--muted);font-weight:600}
td.r,th.r{text-align:right}
.rules{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:6px 18px}
.rule{display:flex;gap:10px;padding:11px 0;border-bottom:1px solid var(--line);font-size:13px}
.rule:last-child{border-bottom:0}
.rule .mark{color:var(--accent);font-weight:700}
.rule .mark.off{color:var(--muted)}
.styles{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.scard{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:15px 16px}
.scard.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
.scard .ic{font-size:19px}
.scard h3{font-size:14px;margin:7px 0 5px;font-weight:600}
.scard p{margin:0;font-size:12.5px;color:var(--muted);line-height:1.55}
.scard .w{margin-top:9px;display:flex;gap:5px;flex-wrap:wrap}
.scard .w span{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:0 5px}
.empty{background:var(--surface);border:1px dashed var(--line);border-radius:12px;padding:34px;text-align:center;color:var(--muted);font-size:13px}
.search{appearance:none;border:1px solid var(--line);background:var(--surface);color:var(--ink);
  border-radius:9px;padding:8px 12px;font:inherit;font-size:13px;width:230px;margin-bottom:14px}
.note{font-size:12px;color:var(--muted);margin:0 0 14px}
footer{margin-top:56px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:11.5px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
`

const JS = `
const tabs=[...document.querySelectorAll('nav button')];
const panes=[...document.querySelectorAll('main section')];
function show(id){tabs.forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===id)));
  panes.forEach(p=>{p.hidden=p.id!=='pane-'+id});}
tabs.forEach(b=>b.addEventListener('click',()=>show(b.dataset.tab)));
const q=document.querySelector('#q');
if(q){q.addEventListener('input',()=>{const v=q.value.trim().toLowerCase();
  document.querySelectorAll('#pane-ideas .card').forEach(c=>{
    c.style.display=!v||c.dataset.text.includes(v)?'':'none';});});}
`

/* ------------------------------ 各页渲染 ------------------------------ */

function statusChip(status) {
  return `<span class="st s-${status}"><i class="dot"></i>${esc(statusLabel(status))}</span>`
}

// 成稿视图用成稿标题；只有灵感时用灵感原标题
function displayTitle(item) {
  const p = item.production
  return p && p.title ? p.title : item.title
}

function ideaCard(item) {
  const tags = item.tags ?? []
  const produced = item.production?.status === 'done'
  return `<article class="card" data-text="${esc(`${item.title} ${item.body ?? ''} ${tags.join(' ')}`.toLowerCase())}">
  <h3>${esc(item.title)}</h3>
  ${item.body ? `<p>${esc(item.body)}</p>` : ''}
  <div class="meta">
    ${statusChip(item.status)}
    ${item.platform ? `<span>${esc(item.platform)}</span>` : ''}
    ${item.scheduledAt ? `<span>${esc(dayLabel(item.scheduledAt))} 计划发</span>` : `<span>${esc(dayLabel(item.createdAt))} 记下</span>`}
    ${produced ? '<span class="tag">已成稿</span>' : ''}
  </div>
  ${tags.length ? `<div class="meta">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
</article>`
}

function pageIdeas(state) {
  const rows = [...state.items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  if (!rows.length) return `<div class="empty">灵感墙还是空的。说一句「记个灵感：……」就有第一张卡片。</div>`
  return `<input id="q" class="search" placeholder="搜标题、正文、标签">
<div class="grid">${rows.map(ideaCard).join('')}</div>`
}

function pageContent(state) {
  const cols = Object.keys(STATUS_LABEL).map(status => {
    const rows = state.items.filter(row => row.status === status)
    const body = rows.length
      ? rows.map(row => {
        const p = row.production
        const extra = p?.status === 'done' ? `已成稿 · 配图 ${p.images?.length ?? 0} · 分镜 ${p.shots?.length ?? 0}` : p ? '策划案已定' : row.platform ?? ''
        return `<div class="mini"><div class="t">${esc(displayTitle(row))}</div><div class="d">${esc(extra)}</div></div>`
      }).join('')
      : '<div class="d" style="font-size:11.5px;color:var(--muted)">空</div>'
    return `<div class="col"><h4><span>${esc(statusLabel(status))}</span><span>${rows.length}</span></h4>${body}</div>`
  }).join('')
  return `<h2>按状态排好</h2><div class="cols">${cols}</div>`
}

function pageSchedule(state, now) {
  const year = now.getFullYear()
  const month = now.getMonth()
  const first = new Date(year, month, 1)
  const startPad = (first.getDay() + 6) % 7 // 周一开头
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const byDay = new Map()
  for (const item of state.items) {
    // 排期优先；已发布但没排过期次的，按发布时间落回日历
    const at = item.scheduledAt ?? item.publishedAt
    if (!at) continue
    const d = new Date(at)
    if (d.getFullYear() === year && d.getMonth() === month) {
      const key = d.getDate()
      const list = byDay.get(key) ?? []
      list.push({ title: displayTitle(item), published: item.status === 'published' })
      byDay.set(key, list)
    }
  }
  const cells = []
  for (let i = 0; i < startPad; i += 1) cells.push('<div class="day out"></div>')
  for (let d = 1; d <= daysInMonth; d += 1) {
    const isToday = d === now.getDate()
    const events = (byDay.get(d) ?? []).slice(0, 2).map(e => `<span class="ev${e.published ? ' pub' : ''}">${esc(e.title)}</span>`).join('')
    const more = (byDay.get(d)?.length ?? 0) > 2 ? `<span class="ev">+${byDay.get(d).length - 2}</span>` : ''
    cells.push(`<div class="day${isToday ? ' today' : ''}"><span class="n">${d}</span>${events}${more}</div>`)
  }
  const dows = ['一', '二', '三', '四', '五', '六', '日'].map(d => `<div class="dow">${d}</div>`).join('')

  // 连续发布天数（从今天往回数）
  const publishedDays = new Set(state.items.filter(item => item.publishedAt).map(item => new Date(item.publishedAt).toDateString()))
  const stamps = []
  let streak = 0
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const on = publishedDays.has(d.toDateString())
    if (on) streak += 1
    else if (i !== 0) streak = 0
    stamps.push(`<div class="stamp${on ? ' on' : ''}">${d.getDate()}</div>`)
  }

  const upcoming = state.items
    .filter(item => item.scheduledAt && new Date(item.scheduledAt) >= now && item.status !== 'published')
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
  const unscheduled = state.items.filter(item => !item.scheduledAt && ['draft', 'outline', 'idea'].includes(item.status))

  const upcomingHtml = upcoming.length
    ? upcoming.map(item => `<div class="mini"><div class="t">${esc(displayTitle(item))}</div><div class="d">${esc(fmtWhen(item.scheduledAt))} · ${esc(item.platform ?? '未定平台')} · ${esc(relDay(item.scheduledAt))}</div></div>`).join('')
    : '<div class="d" style="color:var(--muted);font-size:12.5px">还没有排期。说「把某条排到下周三晚上八点」。</div>'
  const backlogHtml = unscheduled.length
    ? unscheduled.map(item => `<div class="mini"><div class="t">${esc(item.title)}</div><div class="d">${esc(statusLabel(item.status))}</div></div>`).join('')
    : '<div class="d" style="color:var(--muted);font-size:12.5px">没有待排期的内容。</div>'

  return `<div class="cal">
  <div class="calhead"><strong>${year} 年 ${month + 1} 月</strong><span style="font-size:12px;color:var(--muted)">连续发布 ${streak} 天</span></div>
  <div class="calgrid">${dows}${cells.join('')}</div>
  <div class="stamps">${stamps.join('')}</div>
</div>
<h2>下一条要发的</h2><div class="cols" style="grid-template-columns:1fr 1fr">
<div class="col"><h4><span>已排期</span><span>${upcoming.length}</span></h4>${upcomingHtml}</div>
<div class="col"><h4><span>还没排期</span><span>${unscheduled.length}</span></h4>${backlogHtml}</div>
</div>`
}

function pageInsights(state) {
  const data = computeInsights(state)
  if (!data.daily.length) return `<div class="empty">还没有数据。手动录一条，或者粘一份 CSV 进来。</div>`
  const peak = Math.max(...data.daily.map(row => row.views), 1)
  const spark = data.daily.map(row => `<div style="height:${Math.max(2, Math.round((row.views / peak) * 100))}%" title="${esc(row.date)} · ${num(row.views)}"></div>`).join('')
  const platformMax = Math.max(...data.platforms.map(row => row.views), 1)
  const platformRows = data.platforms.map(row => `<div class="barsrow">
    <span>${esc(row.platform)}</span>
    <span class="track"><span class="fill" style="width:${Math.round((row.views / platformMax) * 100)}%"></span></span>
    <span class="r" style="text-align:right;color:var(--muted)">${num(row.views)}</span>
  </div>`).join('')
  const topRows = data.top.slice(0, 8).map(row => `<tr><td>${esc(row.title)}</td><td>${esc(row.platform ?? '—')}</td>
    <td class="r">${num(row.views)}</td><td class="r">${num(row.engaged)}</td></tr>`).join('')
  const rules = state.skills.length
    ? state.skills.map(row => `<div class="rule"><span class="mark${row.status === 'active' ? '' : ' off'}">${row.status === 'active' ? '✓' : '·'}</span>
      <span><b>${esc(row.name)}</b>：${esc(row.rule)}${row.evidence ? `<span style="color:var(--muted)">（依据：${esc(row.evidence)}）</span>` : ''}</span></div>`).join('')
    : '<div class="rule"><span class="mark off">·</span><span style="color:var(--muted)">还没有沉淀的规则。数据够了我就会提案，确认后写进这里。</span></div>'

  return `<div class="kpis">
  <div class="kpi"><div class="k">总阅读</div><div class="v">${num(data.views)}</div></div>
  <div class="kpi"><div class="k">总互动</div><div class="v">${num(data.engaged)}</div></div>
  <div class="kpi"><div class="k">互动率</div><div class="v">${(data.engagementRate * 100).toFixed(2)}%</div></div>
  <div class="kpi"><div class="k">已发布</div><div class="v">${data.published}</div></div>
</div>
${data.hasSample ? '<p class="note" style="margin-top:12px">当前表格里还有示例数据，录入真实数据后自动停用。</p>' : ''}
<div class="bars"><h2 style="margin:0 0 10px">每日播放</h2><div class="spark">${spark}</div>
  <div style="font-size:11.5px;color:var(--muted);margin-top:8px;display:flex;justify-content:space-between"><span>${esc(data.daily[0].date)}</span><span>${esc(data.daily[data.daily.length - 1].date)}</span></div>
</div>
<div class="bars"><h2 style="margin:0 0 4px">平台分布</h2>${platformRows}</div>
<div class="bars"><h2 style="margin:0 0 4px">表现最好的内容</h2>
  <table><thead><tr><th>标题</th><th>平台</th><th class="r">阅读</th><th class="r">互动</th></tr></thead><tbody>${topRows || '<tr><td colspan="4" style="color:var(--muted)">还没有能对上内容的数据</td></tr>'}</tbody></table>
</div>
<h2>写作规则</h2><div class="rules">${rules}</div>`
}

function pageStyle(state) {
  const active = activeStyle(state)
  const groups = STYLE_CATEGORIES.map(cat => {
    const rows = state.styles.filter(row => row.category === cat)
    if (!rows.length) return ''
    return `<h2>${esc(cat)}</h2><div class="styles">${rows.map(card).join('')}</div>`
  })
  const loose = state.styles.filter(row => !STYLE_CATEGORIES.includes(row.category))
  if (loose.length) groups.push(`<h2>自定义</h2><div class="styles">${loose.map(card).join('')}</div>`)

  function card(row) {
    return `<div class="scard${row.id === state.activeStyleId ? ' on' : ''}">
    <div class="ic">${esc(row.icon ?? '✍️')}</div>
    <h3>${esc(row.name)}</h3>
    <p>${esc(row.summary ?? '')}</p>
    ${row.words?.length ? `<div class="w">${row.words.slice(0, 5).map(w => `<span>${esc(w)}</span>`).join('')}</div>` : ''}
  </div>`
  }
  return `<p class="note">当前：<b>${esc(active?.name ?? '未指定风格')}</b> · 体裁：${state.draftFormat === 'article' ? '文章（自然段）' : '口播脚本（一句一行）'}</p>
${groups.join('')}`
}

export function renderDesk(state, { root } = {}) {
  const now = new Date()
  const counts = Object.keys(STATUS_LABEL).map(key => state.items.filter(row => row.status === key).length)
  const style = activeStyle(state)
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>自媒体工作台</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header>
  <div>
    <h1>自媒体工作台</h1>
    <div class="sub">记一句灵感，一键做出脚本、封面、配图和分镜</div>
  </div>
  <div class="chips">
    <span class="chip">条目 <b>${state.items.length}</b></span>
    <span class="chip">已成稿 <b>${state.items.filter(i => i.production?.status === 'done').length}</b></span>
    <span class="chip">风格 <b>${esc(style?.name ?? '未指定')}</b></span>
    <span class="chip">${esc(now.getFullYear())}年${now.getMonth() + 1}月${now.getDate()}日</span>
  </div>
</header>

<nav>
  <button data-tab="ideas" aria-selected="true">灵感</button>
  <button data-tab="content" aria-selected="false">内容</button>
  <button data-tab="schedule" aria-selected="false">排期</button>
  <button data-tab="insights" aria-selected="false">复盘</button>
  <button data-tab="style" aria-selected="false">风格</button>
</nav>

<main>
  <section id="pane-ideas">${pageIdeas(state)}</section>
  <section id="pane-content" hidden>${pageContent(state)}</section>
  <section id="pane-schedule" hidden>${pageSchedule(state, now)}</section>
  <section id="pane-insights" hidden>${pageInsights(state)}</section>
  <section id="pane-style" hidden>${pageStyle(state)}</section>
</main>

<footer>
  <span>数据在 ${esc(root ?? '')} · 这个页面是只读的，改动走 desk.mjs</span>
  <span>移植自 woniuniuniu/dsh-media-desk（MIT）</span>
</footer>
</div>
<script>${JS}</script>
</body>
</html>`
}
