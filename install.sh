#!/usr/bin/env bash
# MeBrain 一键安装。固定克隆到 ~/.me_brain，重复跑安全（自动 git pull + install.js 幂等）。
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/Hisensen/me_brain/master/install.sh | bash
set -euo pipefail

REPO="https://github.com/Hisensen/me_brain.git"
DEST="${ME_BRAIN_DIR:-$HOME/.me_brain}"

# 颜色（不是 tty 或 NO_COLOR=1 就关）
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  G=$'\033[0;32m'; Y=$'\033[0;33m'; R=$'\033[0;31m'; D=$'\033[2m'; N=$'\033[0m'
else
  G=""; Y=""; R=""; D=""; N=""
fi

say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$N" "$*"; }
die()  { printf '%s✗%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

say ""
say "${G}MeBrain${N} — 个人长期记忆 + 实时 TODO（for Claude Code）"
say ""

# --- 依赖检查 ---
command -v node >/dev/null 2>&1 || die "没找到 node。先装 Node.js (https://nodejs.org/) 再重试。"
ok "node $(node -v)"

command -v git  >/dev/null 2>&1 || die "没找到 git。先装 git 再重试。"
ok "git  $(git --version | awk '{print $3}')"

if command -v claude >/dev/null 2>&1; then
  ok "claude CLI 已就绪"
else
  warn "没找到 claude CLI。注入和实时 TODO 仍能工作；自动采集 / distill 会跳过（它们靠 claude 调 LLM）。"
fi

# --- clone 或 pull ---
say ""
if [ -d "$DEST/.git" ]; then
  say "已存在 ${D}$DEST${N}，更新中…"
  git -C "$DEST" pull --ff-only >/dev/null || die "git pull 失败，请手动检查 $DEST"
  ok "已更新到最新"
elif [ -e "$DEST" ]; then
  die "$DEST 存在但不是 git 仓库。请先备份并删除它，再重跑此脚本。"
else
  say "克隆到 ${D}$DEST${N} …"
  git clone --depth 1 "$REPO" "$DEST" >/dev/null
  ok "克隆完成"
fi

# --- 装 hook + 部署 skill ---
say ""
say "装 hook + 部署 /me skill …"
( cd "$DEST" && node install.js )

# --- 收尾提示 ---
say ""
ok "完成。"
say ""
say "${Y}下一步：${N}完全退出 Claude Code，再重开。"
say ""
say "之后可以："
say "  ${D}/me show${N}            看记忆库"
say "  ${D}/me todo \"…\"${N}        立 TODO"
say "  ${D}/me help${N}            看全部命令"
say ""
say "升级（随时跑）："
say "  ${D}curl -fsSL https://raw.githubusercontent.com/Hisensen/me_brain/master/install.sh | bash${N}"
say ""
say "卸载："
say "  ${D}node ~/.me_brain/uninstall.js${N}    # 摘 hook，~/.me 数据保留"
say "  ${D}rm -rf ~/.me_brain ~/.me${N}          # 彻底清空（可选）"
say ""
