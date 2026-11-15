# Media Desk · 自媒体工作台

Jot one line of an idea; get a publishable voiceover script, cover copy and a line-art storyboard; schedule the post; then turn your platform numbers into writing rules that every later draft obeys automatically.

This is a **WorkBuddy port** of [woniuniuniu/dsh-media-desk](https://github.com/woniuniuniu/dsh-media-desk) (MIT). Upstream is a DeepSeek Harness sidebar plugin. WorkBuddy does not expose a UI slot to third-party plugins, so the port is rebuilt in three parts: **a skill (the brain) + a CLI (the only write path) + a local interface (read and edit)**.

**[Landing page](https://phs-bitqun.github.io/workbuddy-media-desk/)** · **[Install guide](INSTALL.md)** (Chinese) · **[中文说明](README.md)** · **[Open an issue](https://github.com/phs-bitqun/workbuddy-media-desk/issues/new/choose)**

![The local interface](docs/ui-desk.png)

## What it does

- **One line in, full draft out** — brief → voiceover script or article → storyboard. No interrogation, no "could you clarify your goal".
- **Point-and-fix revisions** — "make shot 3 an overhead", "punch up the cover text". It edits that one place and leaves everything else alone.
- **15 style cards** — AI tech, gadget reviews, food hunts, reading notes, business teardowns… or distil a card from your own past posts.
- **Schedule and review** — calendar scheduling, then views / likes / comments / shares / saves with engagement rate, platform split and daily trend.
- **Rules that learn** — patterns found in your own numbers become rules, once you confirm them, that later drafts obey.
- **Customisable menu bar** — rename, reorder, hide tabs, or add a filtered view such as "Xiaohongshu, ready to post".

> Screenshots use sample data. A fresh install starts empty.

## Three ways in, one dataset

| Entry point | What you get | Good for |
| --- | --- | --- |
| **Expert card** | A "自媒体工作台" card under **Experts** in the sidebar; click and chat | Using it as a finished product, sharing it with others |
| **Skill** | `media-desk` in the skill list; say "save this idea" in any session and it fires | Reaching for it inside your normal workflow |
| **Local interface** | `desk serve` → `http://127.0.0.1:4318/`, read and write | Recording ideas, editing drafts, scheduling, uploading images |

All three read the same `state.json`. Install once; run them side by side if you like.

## The interface

```bash
node ~/.workbuddy/skills/media-desk/scripts/desk.mjs serve
# → http://127.0.0.1:4318/     Ctrl+C to stop; your data stays put
```

Five pages: Ideas · Content · Schedule · Review · Style. Click a card to open the drawer: edit title, notes, tags, status, platform and schedule; edit the finished article inline; upload a cover or illustration; log metrics or paste a CSV on the review page; flip writing rules on and off; switch style cards with one click.

**The menu bar is yours to configure** (⚙ Menu, top right):

![Menu settings](docs/ui-menu.png)

- Rename the workbench, rename any tab
- Move tabs up and down, hide them, delete them
- **Add a filtered view** — e.g. "Content + Ready + Xiaohongshu" saved as "Xiaohongshu, ready to post"

The menu lives in `state.ui`, so `desk render`'s read-only snapshot uses the same layout. The two views never drift apart.

**One boundary worth stating plainly:** the interface handles every manual task, and **does no generation**. Writing the script and drawing the cover, illustrations and storyboard need a model — that happens in the conversation. The drawer gives you a "copy the brief" button: copy one line, paste it into chat, and the work continues there.

The server binds `127.0.0.1` only, mints a one-time token per launch, and checks `Origin` — another web page cannot drive it.

Just want a glance without starting a server? `desk render` writes a read-only `desk.html` you can double-click.

## The six steps

1. **Capture** — one line becomes a card
2. **Brief** — title, cover text, facts, section headings, and English visual descriptions for every illustration and shot, settled in one pass
3. **Draft** — voiceover script (one line per breath) or article (natural paragraphs), written against your style card and active rules
4. **Draw** — cover + illustrations + black-and-white pencil storyboard; fetch each prompt, hand it to ImageGen, register the result
5. **Deliver** — export a folder: script, storyboard script, cover, illustrations, storyboard images
6. **Wrap up** — refresh the board

Revisions never restart the pipeline. `revise` touches only the fields you name; `edits` does surgical replacements, and changing a shot's look means supplying a new `prompt`.

## Install

Requires **Node.js 20+** (tested on v22) and the WorkBuddy desktop app.

### 0 · One sentence

Paste this into a fresh WorkBuddy session and it installs itself:

```text
Install the Media Desk as a WorkBuddy skill: clone https://github.com/phs-bitqun/workbuddy-media-desk into ~/.workbuddy/media-desk-src, symlink ~/.workbuddy/skills/media-desk to its skills/media-desk, run `doctor` on scripts/desk.mjs and confirm it prints "内置风格预设 15 个", then remind me to restart WorkBuddy. Don't touch anything already in ~/.workbuddy/media-desk/.
```

### A · Expert package

```bash
git clone --depth 1 https://github.com/phs-bitqun/workbuddy-media-desk.git ~/workbuddy-media-desk
mkdir -p ~/.workbuddy/plugins/marketplaces/my-experts/plugins
cp -R ~/workbuddy-media-desk ~/.workbuddy/plugins/marketplaces/my-experts/plugins/
```

Restart WorkBuddy; the card appears under **Experts**.

> Windows (PowerShell): `Copy-Item -Recurse "$HOME\workbuddy-media-desk" "$env:USERPROFILE\.workbuddy\plugins\marketplaces\my-experts\plugins\"`

### B · Skill

```bash
git clone --depth 1 https://github.com/phs-bitqun/workbuddy-media-desk ~/.workbuddy/media-desk-src \
  && bash ~/.workbuddy/media-desk-src/install.sh
```

The script checks your Node version, symlinks `~/.workbuddy/skills/media-desk`, and runs a self-check. Re-running is safe: an existing clone is updated with `git pull`.

> `raw.githubusercontent.com` is frequently blocked in mainland China (TLS handshake fails outright on the machine this was built on), so avoid `curl | bash` installers and use the git command above.

Full walkthrough, FAQ and data migration: **[INSTALL.md](INSTALL.md)** (Chinese).

### Verify

```bash
node ~/.workbuddy/skills/media-desk/scripts/desk.mjs doctor
```

If it prints a data directory and "内置风格预设 15 个", the install is wired up.

## Commands

```bash
DESK=~/.workbuddy/skills/media-desk/scripts/desk.mjs

node $DESK serve                      # start the local interface (read + write)
node $DESK render                     # write the read-only desk.html
node $DESK add --title "…"            # capture an idea
node $DESK plan <id> --file p.json    # save the brief
node $DESK article <id> --file a.md   # save the draft
node $DESK prompt <id> cover          # print the image prompt for ImageGen
node $DESK asset <id> cover --file x.jpg  # register a rendered image
node $DESK revise <id> --file r.json  # apply revisions
node $DESK schedule <id> --at "2026-11-20 20:00"
node $DESK metric import --file d.csv # import metrics
node $DESK insights                   # review summary
node $DESK export <id>                # export a folder
node $DESK undo                       # undo the last step
node $DESK help                       # every command
```

## Using it

```
Save this idea: AI-made covers always look like a pile of assets
Turn it into a Douyin voiceover script in the AI tech blogger style
Make shot 3 an overhead shot; give the cover text more punch
Log this week's numbers and tell me what pattern I can turn into a rule
Open the workbench
```

**The interface, the CLI output and all prompts are in Chinese** — the briefs, style cards and platform conventions are written for a Chinese creator workflow. Command names and flags are English.

## Where the data lives

`~/.workbuddy/media-desk/state.json` — a local file. No cloud, no account, no telemetry.

- Move machines: copy the whole `~/.workbuddy/media-desk/` directory.
- Relocate it: set `WORKBUDDY_MEDIA_DESK_HOME`.
- Don't hand-edit `state.json`; go through the CLI or the interface so the undo chain stays intact.

## Repo layout

```
workbuddy-media-desk/             # the whole folder is the distributable package
├── .codebuddy-plugin/plugin.json # manifest: declares both skills and agents
├── agents/workbuddy-media-desk.md # the expert card's persona and workflow
├── avatars/expert.png
├── skills/media-desk/            # the skill, bundled inside
│   ├── SKILL.md                  # routing + the six-step pipeline
│   ├── references/               # full prompts / 15 presets / data model / platform specs
│   └── scripts/
│       ├── desk.mjs              # the only write path (includes serve / render)
│       ├── app/                  # interface: index.html + app.css + app.js
│       └── lib/                  # store / ops / insights / render / server / export
├── install.sh                    # one-step installer for the skill route
├── docs/                         # screenshots and the landing page
├── .github/ISSUE_TEMPLATE/       # install problem / feature request
├── INSTALL.md · README.md · LICENSE
```

Zero dependencies. Node 20 or newer.

## How it differs from upstream

| | Upstream dsh-media-desk | Here |
| --- | --- | --- |
| **Writing** | Plugin opens its own session against DSH's configured model | WorkBuddy's own model + the ported prompts |
| **Images** | Your own image API key, or a DSH subscription tool | WorkBuddy **ImageGen**, no configuration |
| **Interface** | React pages in the DSH sidebar | `desk serve` local interface + `desk render` read-only snapshot |
| **Data** | `~/.dsh/media-desk/` | `~/.workbuddy/media-desk/` |
| **Writes** | UI → host routes | Always through `desk.mjs`; never hand-edit the JSON |
| **Account import** | Monid, a paid third-party service | Not ported; log metrics by hand or paste a CSV |
| **Languages** | Chinese and English | Chinese |

Carried over verbatim: **the 15 creator presets**, **the brief / draft / revise / style-distillation prompts**, **the metrics-to-rules algorithm**, **three-way merge undo**, and **the image style suffixes**.

## Known limitations

- **No publishing.** No platform offers a unified API. You export a folder and post it yourself.
- **The interface does not generate.** Writing and drawing need a model; go back to the conversation.
- **The interface is a local server**, not a sidebar panel. It stops with the terminal; it does not run in the background (launchd can fix that if you want it).
- **No account import.** Review data comes from manual entry or CSV.
- **Chinese only.** The upstream bilingual support was not ported.

## Feedback

Something broken, missing, or worth improving — one entry point for all of it:

**https://github.com/phs-bitqun/workbuddy-media-desk/issues/new/choose**

- **Install / runtime problem** — the form asks for your OS, Node version, the step you got stuck on, and the raw error. Fill those in and it is usually one round.
- **Feature request** — describe the problem you want solved, not just a proposed solution.

## Credits & license

- Original project: [woniuniuniu/dsh-media-desk](https://github.com/woniuniuniu/dsh-media-desk), MIT, by 蜗牛的科技笔记.
- The port replaced the host/client split with one CLI plus a local interface, swapped image generation for WorkBuddy's built-in tool, and moved storage to `~/.workbuddy/`.
- Released under [MIT](LICENSE), original attribution retained. Not affiliated with the original author; please file issues in this repository.
