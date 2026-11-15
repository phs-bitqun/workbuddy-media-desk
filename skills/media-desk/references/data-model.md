# 数据模型

数据在 `~/.workbuddy/media-desk/`（可用 `WORKBUDDY_MEDIA_DESK_HOME` 覆盖）：

```
~/.workbuddy/media-desk/
├── state.json      # 全部状态
├── undo.json       # 最近 30 步的撤销快照
├── files/          # 画好的封面、配图、分镜
└── desk.html       # render 生成的工作台（只读）
```

**不要手改这些文件。** 所有改动走 `desk.mjs`——它做字段白名单校验、维护 `publishedAt`、推撤销栈、写完原子替换。

## state.json

```json
{
  "version": 1,
  "createdAt": "ISO",
  "items": [],
  "people": [],
  "angles": [],
  "styles": [],
  "activeStyleId": null,
  "skills": [],
  "metrics": [],
  "accounts": [],
  "draftFormat": "script",
  "settings": { "imageCount": 4, "shotCount": 6, "generateImages": true, "platform": "小红书" },
  "sampleCleared": true
}
```

### items[] — 一条灵感 / 一篇内容

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | `it_xxx` |
| `kind` | `note\|image\|video\|web\|quote` | 灵感形态 |
| `title` | string | 空时从 body 截前 28 字 |
| `body` | string | 补充说明 |
| `tags` | string[] | 最多 24 个 |
| `status` | `idea\|outline\|draft\|ready\|published` | 五档 |
| `platform` | 平台名 \| null | 见 platforms.md |
| `url` | http(s) \| null | 来源链接 |
| `source` | string | 来源描述 |
| `createdAt` / `scheduledAt` / `publishedAt` | ISO \| null | 排期和发布状态自动维护 |
| `drafts` | object | `{script:{text,by,at,aiText}, article:{…}}` |
| `production` | object \| null | 成稿，见下 |
| `sample` | boolean | 示例数据，清空时整体移除 |

### items[].production — 成稿

```json
{
  "status": "planned | done",
  "stage": "planned | done",
  "format": "script | article",
  "withImages": true,
  "startedAt": "ISO",
  "finishedAt": "ISO",
  "title": "标题",
  "coverText": "封面大字，≤24 字",
  "facts": ["事实 1", "事实 2"],
  "outline": ["小标题 1", "小标题 2"],
  "characters": "人物和场景外观（英文），保证多张图一致",
  "article": "正文 Markdown（不含一级标题）",
  "aiArticle": "AI 原稿，用来和用户改完的版本对比",
  "cover": { "prompt": "英文", "status": "idle|done|skipped", "src": "files/g_xxx.jpg" },
  "images": [{ "anchor": "小标题", "caption": "中文图注", "prompt": "英文", "status": "…", "src": "…" }],
  "shots":  [{ "no": 1, "shot": "特写", "visual": "画面", "voice": "口播", "seconds": 5, "prompt": "英文", "status": "…", "src": "…" }],
  "savedPath": "导出目录"
}
```

画面状态机：`idle`（等着画）→ `done`（已登记）或 `skipped`（这次不画）。`revise` 改了 prompt 会把状态打回 `idle`。

### styles[] — 风格卡

```json
{
  "id": "preset_ai_tech | st_xxx",
  "category": "科技数码 | … | 自定义",
  "icon": "🤖",
  "name": "AI 科技博主",
  "summary": "一句话概括",
  "tone": "语气和态度",
  "sentences": "句式和断句",
  "opening": "通常怎么开头",
  "structure": "通常怎么组织内容",
  "logic": "看问题的逻辑",
  "story": "讲故事和举例子的方式",
  "flow": "句与句怎么接",
  "words": ["常用词"],
  "avoid": ["绝不写的"],
  "samples": ["代表句"],
  "preset": true,
  "source": "预设 | 手动 | 账号 | 稿子",
  "createdAt": "ISO"
}
```

`activeStyleId` 指向当前生效的那张。`null` 表示不指定风格。

### skills[] — 写作规则

```json
{ "id": "s_xxx", "name": "短标题", "rule": "所有标题控制在 20 字以内", "status": "proposed | active", "confidence": 0.8, "evidence": "依据", "source": "对话 | 数据复盘 | 草稿修改", "createdAt": "ISO" }
```

只有 `active` 的会进成稿的写作要求。

### metrics[] — 平台数据

```json
{ "id": "m_xxx", "itemId": "it_xxx 或省略", "platform": "小红书", "date": "ISO", "views": 0, "likes": 0, "comments": 0, "shares": 0, "saves": 0, "externalId": "导入数据的标记" }
```

- `itemId` 关联到具体内容，才能进「表现最好的内容」排行。不关联的数据只进平台分布和日趋势。
- 有 `externalId` 表示这是导入的累计数，同一篇再有手动数据会被排除，避免重复计。
- 有真实数据（`sample:false`）后，示例数据自动退出统计。

### accounts[] — 账号档案

```json
{ "id": "ac_xxx", "platform": "…", "handle": "@…", "url": "…", "followers": 0, "note": "…" }
```

## 撤销

`undo.json` 存最近 30 步的 `{label, at, before, after}`。撤销是**三方合并**的：

- 这一步新增的行 → 撤掉
- 这一步删的行 → 放回原位
- 两边都有、且之后没被别的操作动过的字段 → 逐字段撤回
- 之后又被改过的部分 → 保留现值

所以撤销「切换风格」不会抹掉之后生成的成稿，撤销「改标题」不会把之后画好的图退回去。

## 与上游的差异

| | 上游 dsh-media-desk | 这里 |
| --- | --- | --- |
| 数据目录 | `~/.dsh/media-desk/` | `~/.workbuddy/media-desk/` |
| 界面 | DSH 侧栏 React 五页 | `desk.html` 静态只读看板 |
| 写脚本 | 插件调 DSH 配置的模型 | WorkBuddy 自身模型 + `references/prompts.md` |
| 生图 | 自填图片 API Key / 订阅工具 | WorkBuddy ImageGen 工具 |
| 撤销 | 进程内存 | `undo.json` 持久化 |
| 账号导入 | Monid 第三方服务（按次计费） | 未移植，改为手动录 / 粘 CSV |
| 多语言 | 中 / 英双语 | 中文 |
