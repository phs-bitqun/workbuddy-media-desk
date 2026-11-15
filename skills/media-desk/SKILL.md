---
name: media-desk
description: 自媒体工作台。用户要记灵感、写口播脚本或文章、起标题、做视频封面、配图、黑白线稿分镜、排发布计划、录平台数据做复盘、提炼写作风格或沉淀写作规则时使用。触发词：自媒体、灵感、选题、口播脚本、抖音、小红书、公众号、视频号、B站、封面、配图、分镜、排期、发布时间、复盘、播放量、涨粉、风格、人设、爆款。移植自 woniuniuniu/dsh-media-desk。
---

# 自媒体工作台

一句话记灵感，一键做出脚本、封面、配图和黑白线稿分镜。五个页面：**灵感 · 内容 · 排期 · 复盘 · 风格**。

数据全在本机 `~/.workbuddy/media-desk/`，没有云端、没有账号系统。所有状态改动只走 CLI，**绝不手改 `state.json`**。

## 路径

```
CLI   = <本技能目录>/scripts/desk.mjs
参考  = <本技能目录>/references/
```

`<本技能目录>` 就是**这份 SKILL.md 所在目录**——技能列表里会给你 `filePath`，取它的 dirname。不要猜、不要写死路径。

拿到之后每轮开头先确认一次：

```bash
DESK="<本技能目录>/scripts/desk.mjs"
test -f "$DESK" || echo "找不到 CLI，检查技能是否装完整"
```

如果 `filePath` 取不到，用 glob 兜底：`**/media-desk/scripts/desk.mjs`。

下文命令里的 `desk` 都指 `node "$DESK"`。

## 会话开始先做的事

```bash
node "$DESK" doctor
```

`状态文件 不存在` 就 `init`。**不要**默认加 `--seed`——示例数据会混进真实复盘。只有用户明确想看长什么样时才 `init --seed`。

工作台有两种看法：

```bash
node "$DESK" render    # 只读快照 → ~/.workbuddy/media-desk/desk.html，用 present_files 打开
node "$DESK" serve     # 交互界面 → http://127.0.0.1:4318/ ，能在里面直接改
```

用户要「看看工作台」「打开工作台」时先问一句是想看还是想改：只是看走 `render`（一键、无端口）；要在界面里改条目、排期、传图、调菜单，走 `serve`。

`serve` 是前台进程，会一直占着终端。**不要替用户起**——给他这条命令让他自己在终端跑，或者起好后用 `present_files` 传 `http://127.0.0.1:4318/` 打开预览面板（注意：你起的后台进程在本回合结束后可能被回收）。

## 一键成稿：六步

这是本技能的核心。**必须按顺序走完，中间不要跳步。**

### 第 1 步 · 定灵感

用户说一句想法就先落地，不要反问。

```bash
node "$DESK" add --title "标题" --body "补充" --tags "标签1,标签2" --json
```

拿到 `id`。如果用户没给标题，用他原话里最有信息量的一小段当标题。

### 第 2 步 · 写策划案

**先读 `references/prompts.md` 的「策划案」一节**，照那里的系统提示词生成。产物是一个 JSON，字段固定：

```json
{
  "title": "视频标题，具体、有钩子，不超过 24 字",
  "coverText": "封面大字，要有冲击力，不超过 12 字",
  "facts": ["数字、人名、案例，3 到 6 条，脚本和分镜都要照用"],
  "outline": ["3 到 5 个小标题"],
  "cover": "封面画面描述（英文）",
  "characters": "反复出现的人物和场景外观（英文），没有就留空",
  "images": [{ "anchor": "放在哪个小标题之后", "caption": "平实的中文图注", "prompt": "配图画面描述（英文）" }],
  "shots": [{ "shot": "特写|近景|中景|全景|俯拍", "visual": "拍什么（中文，不超过 40 字）", "voice": "这一镜的口播（中文，不超过 40 字）", "seconds": 5, "prompt": "构图描述（英文）" }]
}
```

`images` 默认 4 个、`shots` 默认 6 个（见 `state.settings`，可用 `--json` 从 `doctor`/`show` 读）。数量不够就用模板补齐，不能让流水线少一块。

落盘：

```bash
node "$DESK" plan <id> --file plan.json          # 只出文字不画图时加 --no-images
```

**三条硬规则**（照抄上游，别改）：
- 画面描述**只写看得见的东西**：主体、动作、环境、构图、光线。画面里不放任何文字。
- 分镜要有景别变化，能串成一段完整的短视频，第一镜就要抓人。
- `facts` 里的数字和案例，正文和分镜必须一字不差地照用。

### 第 3 步 · 写正文

**先读 `references/prompts.md` 的「正文」一节。** 体裁由 `draftFormat` 决定（`script` 口播脚本 / `article` 文章），用 `node "$DESK" format script|article` 切。

- 口播脚本：一句话占一行，在换气处断句，一行不超过 25 字；讲完一层意思空一行。
- 文章：按自然段写，一段 2 到 5 句，段间空一行。不要写成要点列表。

正文直接写进 `.md`，一级标题会自动落到成稿上：

```bash
node "$DESK" article <id> --file body.md
```

写之前**必须**拿到风格要求：

```bash
node "$DESK" style show <active-id>     # 当前风格卡的写作要求
node "$DESK" rule list                   # 生效中的规则
```

这两段内容要**原样**塞进你的写作要求里。风格卡里 `避免`/`绝不要` 的词，一个都不许出现。

### 第 4 步 · 画图

逐张取提示词，交给 **ImageGen** 工具：

```bash
node "$DESK" prompt <id> cover          # 视频封面 16:9 内嵌
node "$DESK" prompt <id> image:0        # 配图第 1 张（0 起）
node "$DESK" prompt <id> shot:0         # 分镜第 1 镜（0 起）
```

`prompt` 输出的已经是**完整提示词**（英文风格后缀 + 画面描述 + 一致性人物描述），直接喂给 ImageGen，不要再改写。

画完登记回来：

```bash
node "$DESK" asset <id> cover --file /绝对路径/cover.jpg
```

- 封面和配图走彩色编辑风；分镜是**黑白铅笔线稿、16:9 横构图**——这是上游刻意定的，别换成彩色。
- 用户没要求画图 / 只想先看文字：`plan --no-images`，之后仍可 `revise` 指定某一镜再画。
- 单张画失败不影响其他：跳过这张，最后统一报。

### 第 5 步 · 交付

```bash
node "$DESK" render               # 刷新看板
node "$DESK" export <id>          # 存到 ~/Documents/自媒体工作台/<标题>/
```

导出目录里有：`口播脚本.md`（或 `文章.md`）、`分镜脚本.md`、`视频封面.*`、`配图N.*`、`分镜N.*`。

**不能直接发布**——各平台没有统一接口。复制脚本或整个文件夹，用户自己发。

### 第 6 步 · 收尾

`render` 之后用 `present_files` 打开 `~/.workbuddy/media-desk/desk.html`，让用户看到成果。

## 界面

`serve` 起来的界面是**真正能改数据**的，五个内置页都在，另外：

- **菜单栏可自定义**：界面右上「⚙ 菜单」里能改工作台名字、给页签改名、上下调序、隐藏、删除，还能**加筛选视图**（例如「内容 + 待发布 + 小红书」命名为「小红书待发」）。配置存在 `state.ui`，跟数据一起走，`render` 生成的静态看板也照这份配置排。
- **详情抽屉**：点卡片改标题/补充/标签/状态/平台/排期，成稿的正文也能直接编辑，封面和配图能上传。
- **复盘页**：录数据、粘 CSV、点勾开关规则、一键采纳提案。
- **风格页**：点一张卡就切过去，还能切体裁。

**界面里不能生成内容。** 生成正文和画面要模型，那是对话里的事。界面在抽屉里给了「复制成稿指令」按钮，点一下把一句话复制走，粘到对话里就接着做。这个分工不要混：别跟用户说「界面里点一下就能出稿」。

菜单被改乱了的恢复方式：界面里「恢复默认」，或者直接改 `state.ui` 后跑 `render`。菜单项是白名单校验过的，非法类型会被丢弃；全隐藏会退回默认五项，不会出现空白界面。

## 改稿

用户说「表达再直接一点」「第 3 镜换成俯拍」「封面字更有冲击力」时，**不要重新成稿**，走 `revise`：

```json
{
  "title": "新标题",
  "coverText": "新的封面大字",
  "edits": [{ "find": "正文里要替换的原文，一字不差且足够长不会重复", "replace": "新内容" }],
  "cover": { "prompt": "新的画面描述（英文）" },
  "images": [{ "no": 1, "caption": "图注", "prompt": "新的画面描述（英文）" }],
  "shots": [{ "no": 3, "shot": "俯拍", "visual": "画面", "voice": "口播", "seconds": 5, "prompt": "新的构图描述（英文）" }]
}
```

```bash
node "$DESK" revise <id> --file revise.json
```

- 只改一小段用 `edits`，**不要**重写全文。要整篇换才用 `article` 字段。
- 改稿要保持原来的体裁和排版（脚本还是脚本，文章还是文章）。
- 要换画面就必须给新的 `prompt`，只改 `caption` 等于没改图。
- 命令会回执「需要重画的画面」，对这些 target 重新走第 4 步。

## 灵感、内容、排期

```bash
node "$DESK" add --title "…" --body "…" --tags "a,b"      # 记灵感
node "$DESK" list --status idea                            # 筛选
node "$DESK" show <id>                                     # 详情含成稿全文
node "$DESK" update <id> --title "…" --tags "…"
node "$DESK" status <id> draft|ready|published
node "$DESK" schedule <id> --at "2026-11-20 20:00" --platform 小红书
node "$DESK" schedule <id> --clear                         # 取消排期
```

状态五档：`idea 灵感 · outline 大纲 · draft 草稿 · ready 待发布 · published 已发布`。排期会自动把状态推到 `ready`（没成稿的推 `outline`），取消排期会退回去。已发布的不动。

平台：公众号、小红书、抖音、B站、视频号、TikTok、Instagram、YouTube、X。

## 复盘

```bash
node "$DESK" metric add --platform 小红书 --item <id> --views 12000 --likes 800 --comments 60 --saves 300
node "$DESK" metric import --file data.csv    # 列：platform,date,views,likes,comments,shares,saves[,itemId]
node "$DESK" insights
node "$DESK" propose                          # 从数据里提炼规则提案
```

`insights` 给总阅读、互动、互动率、平台分布、排行、日趋势。**如果输出里带「含示例数据」，说明还没录真实数据，别把它当结论。**

`propose` 的提案要**逐条念给用户确认**，确认后才落成规则：

```bash
node "$DESK" rule add --name "首发放在小红书" --rule "同一选题优先在小红书首发" --evidence "依据" --active
```

## 风格

```bash
node "$DESK" style list                    # 15 个预设 + 自定义，按 8 个板块分组
node "$DESK" style use preset_ai_tech      # 切换（style use none 取消）
node "$DESK" style show <id>               # 看这张卡的完整写作要求
```

**用户贴自己的稿子要「照着我的风格写」时**：读 `references/prompts.md` 的「风格提炼」一节，把稿子丢进去生成风格卡 JSON，然后 `style add --file style.json` + `style use <new-id>`。

8 个板块 15 个预设：科技数码（AI 科技、数码测评）· 旅行探店（旅行、美食）· Vlog 生活（日常、独居）· 观点认知（读书笔记、职场成长）· 干货教程（工具教程、商业拆解）· 种草测评（美妆护肤、穿搭）· 情感故事（情感、亲子）· 热点资讯（热点快评）。全部预设原文见 `references/style-presets.md`。

## 工作台的自我强化

用户说「以后标题都不要超过 20 个字」「标准都要按这个来」这类**长期偏好**时，立刻沉淀成规则：

```bash
node "$DESK" rule add --name "短标题" --rule "所有标题控制在 20 字以内" --active
```

规则会进之后每次成稿的写作要求。`rule list` 看全部，`rule off <id>` 停用。

## 撤销与自检

```bash
node "$DESK" undo      # 撤销上一步（三方合并：只撤这一步改的，不冲掉之后的工作）
node "$DESK" doctor    # 数据目录、条目数、还没写正文的、还没画的图
node "$DESK" stats     # 各状态条数 + 当前风格 + 体裁
```

## 常见坑

| 现象 | 原因 |
| --- | --- |
| `工作台还没初始化` | 先 `init` |
| `还没有策划案，先落盘策划案` | 写正文前必须 `plan` |
| `没有这个画面：image:4` | 序号从 0 起，且不能超过策划案里的数量 |
| 图片在导出的文件夹里丢了 | `asset` 登记时文件没复制成功，或 `src` 指向的文件被删了 |
| 看板里图片是空白 | `desk.html` 必须放在数据根目录，图片按 `files/` 相对路径引用 |
| 复盘数字不对 | 同一篇内容既有导入数据又有手动数据会重复计；有 `externalId` 时只认导入那行 |

## 参考文档

- `references/prompts.md` — 策划案 / 正文 / 改稿 / 风格提炼 的完整提示词，**成稿前必读**
- `references/style-presets.md` — 15 个博主预设全文
- `references/data-model.md` — `state.json` 字段结构
- `references/platforms.md` — 平台规格与生图风格后缀
