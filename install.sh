#!/usr/bin/env bash
# 自媒体工作台 · WorkBuddy 版 · 安装脚本
#
#   git clone --depth 1 https://github.com/phs-bitqun/workbuddy-media-desk \
#     ~/.workbuddy/media-desk-src && bash ~/.workbuddy/media-desk-src/install.sh
#
# 做的事：把仓库克隆到 ~/.workbuddy/media-desk-src，再把 ~/.workbuddy/skills/media-desk
# 软链到它的 skills/media-desk。软链的好处是 git pull 一次就全线更新，不用重装。
# 不碰你的数据（~/.workbuddy/media-desk/），不装任何依赖。
#
# 重复执行是安全的：已有源码走 git pull。
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
# 任何情况下都不删用户已有的目录：不是我们克隆的就停下来让人自己处理。
case "$SRC" in
  /|"$HOME"|"$HOME/"|"") die "MEDIA_DESK_SRC 指向了不该动的目录：$SRC" ;;
esac

if [ -e "$SRC" ]; then
  if [ -d "$SRC/.git" ]; then
    ORIGIN="$(git -C "$SRC" remote get-url origin 2>/dev/null || true)"
    case "$ORIGIN" in
      *workbuddy-media-desk*) : ;;
      *) die "$SRC 已经是个 Git 仓库，但 origin 不是这个项目：
      ${ORIGIN:-（没有 origin）}
    确认要换掉它，请自己移走再重跑；我不会替你删。" ;;
    esac
    info "已有源码，拉取更新"
    git -C "$SRC" pull --ff-only --quiet || info "更新失败，继续用本地版本"
  else
    die "$SRC 已存在，但不是 Git 仓库。我没有删它，也不会删。
    它可能是你解压的源码或别的什么，请自己处理：
      移走：  mv \"$SRC\" \"$SRC.bak-$(date +%s)\"
      换位置：MEDIA_DESK_SRC=/某个空目录 再跑一次
    然后重试。"
  fi
else
  info "克隆到 $SRC"
  mkdir -p "$(dirname "$SRC")"
  # 先克隆到旁边的临时目录，验证完整后再换上去，避免半截目录占坑
  TMP="$SRC.clone-$$"
  rm -rf "$TMP"
  if ! git clone --depth 1 --quiet "$REPO" "$TMP"; then
    rm -rf "$TMP"
    die "克隆失败。检查网络，或用 MEDIA_DESK_REPO 指定镜像地址。"
  fi
  if [ ! -f "$TMP/skills/media-desk/scripts/desk.mjs" ]; then
    rm -rf "$TMP"
    die "克隆下来的内容不完整，缺少 skills/media-desk/scripts/desk.mjs"
  fi
  mv "$TMP" "$SRC"
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
