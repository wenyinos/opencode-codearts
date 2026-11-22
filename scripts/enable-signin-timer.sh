#!/usr/bin/env bash
# Opt in to the daily CodeArts check-in.
#
# Prerequisites (both are checked):
#   1. npm run login                  # TUI web login
#   2. npm run signin:import-cookie   # paste browser cookie
#   3. npm run signin                 # optional manual test
#
# Then:
#   npm run signin:enable             # installs/starts the daily timer
#   npm run signin:disable            # turns it off again

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$(command -v node || true)"
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
AUTH="$CONFIG_DIR/opencode-codearts/web-auth.json"
COOKIE="${CODEARTS_WEB_COOKIE_FILE:-$CONFIG_DIR/opencode-codearts/web-cookie.txt}"

if [ -z "$NODE" ]; then
  echo "node not found in PATH; install Node.js >= 20 first" >&2
  exit 1
fi
if [ ! -f "$ROOT/dist/signin-cli.js" ]; then
  echo "dist/signin-cli.js is missing; run 'npm install && npm run build' first" >&2
  exit 1
fi
if [ ! -f "$AUTH" ]; then
  echo "还没有完成 web 登录。先运行：" >&2
  echo "  npm run login" >&2
  echo "然后再执行 npm run signin:import-cookie 和 npm run signin:enable。" >&2
  exit 1
fi
if [ ! -s "$COOKIE" ]; then
  echo "还没有导入签到 Cookie。先运行：" >&2
  echo "  npm run signin:import-cookie" >&2
  exit 1
fi
if ! grep -q 'cftk' "$COOKIE"; then
  echo "Cookie 文件里没有 cftk；请从 devcloud.cn-north-4.huaweicloud.com 重新导出。" >&2
  exit 1
fi

case "$(uname -s)" in
  Linux)
    UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    UNIT="$UNIT_DIR/opencode-codearts-signin.service"
    TIMER="$UNIT_DIR/opencode-codearts-signin.timer"
    mkdir -p "$UNIT_DIR"
    sed \
      -e "s|^WorkingDirectory=.*|WorkingDirectory=$ROOT|" \
      -e "s|^ExecStart=.*|ExecStart=$NODE $ROOT/dist/signin-cli.js|" \
      -e "s|^Environment=CODEARTS_WEB_COOKIE_FILE=.*|Environment=CODEARTS_WEB_COOKIE_FILE=$COOKIE|" \
      "$ROOT/scripts/opencode-codearts-signin.service" > "$UNIT"
    cp "$ROOT/scripts/opencode-codearts-signin.timer" "$TIMER"
    systemctl --user daemon-reload
    systemctl --user enable --now opencode-codearts-signin.timer
    echo "daily check-in enabled: $TIMER"
    echo "logs: journalctl --user -u opencode-codearts-signin -n 50 --no-pager"
    ;;
  Darwin)
    PLIST_DIR="$HOME/Library/LaunchAgents"
    PLIST="$PLIST_DIR/com.opencode-codearts.signin.plist"
    LOG_DIR="$HOME/Library/Logs"
    mkdir -p "$PLIST_DIR" "$LOG_DIR"
    sed \
      -e "s|/usr/local/bin/node|$NODE|" \
      -e "s|/Users/me/OpenCodePlugins/opencode-codearts/dist/signin-cli.js|$ROOT/dist/signin-cli.js|" \
      -e "s|/Users/me/OpenCodePlugins/opencode-codearts|$ROOT|g" \
      -e "s|/Users/me/.config/opencode/opencode-codearts/web-cookie.txt|$COOKIE|g" \
      -e "s|/Users/me/Library/Logs/opencode-codearts-signin.log|$LOG_DIR/opencode-codearts-signin.log|g" \
      "$ROOT/scripts/com.opencode-codearts.signin.plist" > "$PLIST"
    launchctl bootout "gui/$(id -u)/com.opencode-codearts.signin" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "daily check-in enabled: $PLIST"
    ;;
  *)
    echo "unsupported platform: $(uname -s)" >&2
    exit 1
    ;;
esac
