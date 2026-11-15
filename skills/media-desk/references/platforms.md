# 平台规格与生图风格后缀

移植自上游 `src/ops.js`（平台白名单）与 `src/images.js`（三段风格后缀）。

## 平台

| 平台 | 适合体裁 | 备注 |
| --- | --- | --- |
| 公众号 | 文章 | 长文为主，标题不超过 20 字更稳 |
| 小红书 | 图文 / 短视频 | 封面大字最重要，正文 100 字内最抓人 |
| 抖音 | 口播脚本 | 前 3 秒定生死，第一镜必须抓人 |
| B站 | 口播脚本 / 文章 | 可以更长，允许铺垫 |
| 视频号 | 口播脚本 | 偏熟龄受众，少用网络梗 |
| TikTok | 口播脚本 | 英文，一行不超过 15 个单词 |
| Instagram | 图文 | 英文 |
| YouTube | 口播脚本 / 文章 | 英文，450 到 800 词 |
| X | 短评 | 英文，短平快 |

CLI 里的合法值是：`公众号 · 小红书 · 抖音 · B站 · 视频号 · TikTok · Instagram · YouTube · X`。写错会被拒。

## 生图：三段风格后缀

`prompt` 命令输出的已经是拼好的完整提示词（英文后缀 + 你的画面描述），**直接交给 ImageGen，不要改写，不要翻译成中文**。

### 封面 · `cover`

```
Editorial cover image, striking composition with calm negative space in the lower third, refined and cinematic, no text, no letters, no logo.
```

构图要点：主体突出，**下方留白**用来放大字。封面大字由 `coverText` 单独提供，**画在图里就是废图**——所以后缀里反复强调 no text。

### 配图 · `image:N`

```
Editorial article illustration, refined and consistent with a modern magazine, no text, no letters, no logo.
```

用途：正文里插在某个小标题后面的说明性画面。

### 分镜 · `shot:N`

```
Film storyboard panel, black and white pencil line art sketch, loose confident lines, no color, plain white paper background, no text, no letters, no captions, no panel numbers.
```

再追加：

```
Widescreen 16:9 landscape framing, the scene fills the whole frame edge to edge, no borders. Recurring characters and setting: {characters}. {画面描述}
```

- **黑白铅笔线稿**是刻意定的，别改成彩色或写实——分镜是用来看调度的，不是成片。
- 16:9 横构图，画面铺满整幅，不要画边框。
- `characters` 来自策划案，用来让每一镜的人物和场景保持一致。没有就留空。

## 序号约定

CLI 里 `image:0` / `shot:0` 是**第一张/第一镜**（0 起）；`revise` 里的 `no` 是 **1 起**。`image:0` 对应 `no:1`。

## 数量

`state.settings`：

```json
{ "imageCount": 4, "shotCount": 6, "generateImages": true, "platform": "小红书" }
```

- `imageCount` 默认 4，`shotCount` 默认 6。上游宣传的「一次成稿默认 9 张图」= 1 封面 + 4 配图 + 6 分镜，其中封面单独算。
- `--no-images` 时只出文字，画面状态记 `skipped`；之后仍可 `revise` 指定某一镜单独画。

## 不能做的事

**不能直接发布。** 各平台没有统一接口。做完只能导出文件夹，用户自己发。别承诺自动发布，也别去调任何平台的上传接口。
