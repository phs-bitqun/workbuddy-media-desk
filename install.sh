#!/usr/bin/env bash
# 自媒体工作台 · WorkBuddy 版 · 安装脚本
#
#   curl -fsSL https://raw.githubusercontent.com/phs-bitqun/workbuddy-media-desk/main/install.sh | bash
#
# 做的事：把仓库克隆到 ~/.workbuddy/media-desk-src，再把 ~/.workbuddy/skills/media-desk
# 软链到它的 skills/media-desk。软链的好处是 git pull 一次就全线更新，不用重装。
# 不碰你的数据（~/.workbuddy/media-desk/），不装任何依赖。
set -euo pipefail

REPO="${MEDIA_DESK_REPO:-https://github.com/phs-bitqun/workbuddy-media-desk.git}"
SRC="${MEDIA_DESK_SRC:-$HOME/.workbuddy/media-desk-src}"
LINK="$HOME/.workbuddy/skills/media-desk"

info() { printf '  %s\n' "$*"; }
die()  { printf '错误：%s\n' "$*" >&2; exit 1; }

printf '\n自媒体工作台 · WorkBuddy 版\n\n'

# --- 前置检查 ---
command -v git >/dev/null 2>&1 || die "需要 git"
command -v node >/dev/null 2>&1 || die "需要 Node.js 20 以上"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node 版本太低（当前 $(node -v)），需要 20 以上"
info "Node $(node -v) ✓"

# --- 取代码 ---
if [ -d "$SRC/.git" ]; then
  info "已有源码，拉取更新"
  git -C "$SRC" pull --ff-only --quiet || info "更新失败，继续用本地版本"
else
  info "克隆到 $SRC"
  mkdir -p "$(dirname "$SRC")"
  rm -rf "$SRC"
  git clone --depth 1 --quiet "$REPO" "$SRC"
fi

SKILL_DIR="$SRC/skills/media-desk"
[ -f "$SKILL_DIR/SKILL.md" ] || die "源码不完整，找不到 $SKILL_DIR/SKILL.md"
[ -f "$SKILL_DIR/scripts/desk.mjs" ] || die "源码不完整，找不到 scripts/desk.mjs"

# --- 挂到技能目录 ---
mkdir -p "$HOME/.workbuddy/skills"
if [ -e "$LINK" ] && [ ! -L "$LINK" ]; then
  die "$LINK 已存在且不是软链（可能是旧的手工安装）。先移走它再重跑。"
fi
ln -sfn "$SKILL_DIR" "$LINK"
info "已挂载 $LINK"

# --- 自检 ---
INFO="$(node "$LINK/scripts/desk.mjs" doctor 2>&1)" || die "CLI 跑不起来：$INFO"
info "CLI 正常，内置风格预设 $(printf '%s' "$INFO" | sed -n 's/.*内置风格预设 \([0-9]*\) 个.*/\1/p')"

cat <<'NEXT'

装好了。接下来：

  1. 重启 WorkBuddy（技能列表在启动时扫描）
  2. 说「记个灵感：…」或「打开工作台」

第一次用会提示「工作台还没初始化」，说「初始化工作台」即可。
示例数据看效果用 init --seed，真实使用别加。

更新：git -C ~/.workbuddy/media-desk-src pull
卸载：rm ~/.workbuddy/skills/media-desk && rm -rf ~/.workbuddy/media-desk-src
     你的内容在 ~/.workbuddy/media-desk/，不会跟着删，要删自己动手。

NEXT
