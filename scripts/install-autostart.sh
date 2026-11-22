#!/usr/bin/env bash
# Install and start the opencode-codearts proxy at login.
#
# Linux:  systemd --user unit
# macOS:  launchd LaunchAgent
# Windows: use install-autostart-windows.ps1 instead.
#
# Run from anywhere:
#   bash scripts/install-autostart.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$(command -v node || true)"

if [ -z "$NODE" ]; then
  echo "node not found in PATH; install Node.js >= 20 first" >&2
  exit 1
fi
if [ ! -f "$ROOT/dist/proxy-cli.js" ]; then
  echo "dist/proxy-cli.js is missing; run 'npm install && npm run build' first" >&2
  exit 1
fi

case "$(uname -s)" in
  Linux)
    UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    UNIT="$UNIT_DIR/opencode-codearts.service"
    mkdir -p "$UNIT_DIR"
    sed \
      -e "/^\[Service\]/a Environment=SHELL=${SHELL:-/bin/sh}" \
      -e "s|^WorkingDirectory=.*|WorkingDirectory=$ROOT|" \
      -e "s|^ExecStart=.*|ExecStart=$NODE $ROOT/dist/proxy-cli.js|" \
      "$ROOT/scripts/opencode-codearts.service" > "$UNIT"
    systemctl --user daemon-reload
    systemctl --user enable --now opencode-codearts
    echo "installed and started: $UNIT"
    echo "logs: journalctl --user -u opencode-codearts -f"
    ;;
  Darwin)
    PLIST_DIR="$HOME/Library/LaunchAgents"
    PLIST="$PLIST_DIR/com.opencode-codearts.proxy.plist"
    LOG_DIR="$HOME/Library/Logs"
    mkdir -p "$PLIST_DIR" "$LOG_DIR"
    sed \
      -e "s|/usr/local/bin/node|$NODE|" \
      -e "s|/Users/me/OpenCodePlugins/opencode-codearts/dist/proxy-cli.js|$ROOT/dist/proxy-cli.js|" \
      -e "s|/Users/me/OpenCodePlugins/opencode-codearts|$ROOT|g" \
      -e "s|/Users/me/Library/Logs/opencode-codearts.log|$LOG_DIR/opencode-codearts.log|g" \
      -e "s|<string>/bin/zsh</string>|<string>${SHELL:-/bin/zsh}</string>|" \
      "$ROOT/scripts/com.opencode-codearts.proxy.plist" > "$PLIST"
    launchctl bootout "gui/$(id -u)/com.opencode-codearts.proxy" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "installed and started: $PLIST"
    echo "logs: tail -f $LOG_DIR/opencode-codearts.log"
    ;;
  *)
    echo "unsupported platform: $(uname -s)" >&2
    echo "on Windows use: powershell -ExecutionPolicy Bypass -File scripts\\install-autostart-windows.ps1" >&2
    exit 1
    ;;
esac
