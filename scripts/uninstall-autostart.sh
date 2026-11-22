#!/usr/bin/env bash
# Remove the opencode-codearts login autostart.
#
# Linux:  systemd --user unit
# macOS:  launchd LaunchAgent
# Windows: use uninstall-autostart-windows.ps1 instead.

set -euo pipefail

case "$(uname -s)" in
  Linux)
    systemctl --user disable --now opencode-codearts 2>/dev/null || true
    UNIT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/opencode-codearts.service"
    rm -f "$UNIT"
    systemctl --user daemon-reload 2>/dev/null || true
    echo "removed: $UNIT"
    ;;
  Darwin)
    launchctl bootout "gui/$(id -u)/com.opencode-codearts.proxy" 2>/dev/null || true
    PLIST="$HOME/Library/LaunchAgents/com.opencode-codearts.proxy.plist"
    rm -f "$PLIST"
    echo "removed: $PLIST"
    ;;
  *)
    echo "unsupported platform: $(uname -s)" >&2
    echo "on Windows use: powershell -ExecutionPolicy Bypass -File scripts\\uninstall-autostart-windows.ps1" >&2
    exit 1
    ;;
esac
