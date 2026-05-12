#!/bin/sh
# SessionEnd hook 包装器：先在前台把 hook 的事件 JSON 从 stdin 落到临时文件，
# 再把 capture.js 丢到后台跑（后台进程的 stdin 会被 shell 重定向到 /dev/null，
# 所以必须先在前台读完 stdin）。
# 用法（settings.json）: sh /path/to/capture-hook.sh
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp "${TMPDIR:-/tmp}/mebrain-hook.XXXXXX")"
cat > "$T"
LOG="$HOME/.me/.capture-hook.log"
nohup node "$DIR/capture.js" --input "$T" >> "$LOG" 2>&1 &
exit 0
