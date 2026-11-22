#!/usr/bin/env bash
# Remove the opencode-codearts login autostart.
#
# Linux:  systemd --user unit
# macOS:  launchd LaunchAgent
# Windows: use uninstall-autostart-windows.ps1 instead.

set -euo pipefail

case "$(uname -s)" in
  Linux)
    systemctl --user disable --now opencode-codearts-signin.timer 2>/dev/null || true
    systemctl --user disable --now opencode-codearts 2>/dev/null || true
    UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    rm -f "$UNIT_DIR/opencode-codearts.service" \
          "$UNIT_DIR/opencode-codearts-signin.service" \
          "$UNIT_DIR/opencode-codearts-signin.timer"
    systemctl --user daemon-reload 2>/dev/null || true
    echo "removed proxy service and daily check-in timer"
    ;;
  Darwin)
    launchctl bootout "gui/$(id -u)/com.opencode-codearts.signin" 2>/dev/null || true
    launchctl bootout "gui/$(id -u)/com.opencode-codearts.proxy" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/com.opencode-codearts.proxy.plist" \
          "$HOME/Library/LaunchAgents/com.opencode-codearts.signin.plist"
    echo "removed proxy agent and daily check-in agent"
    ;;
  *)
    echo "unsupported platform: $(uname -s)" >&2
    echo "on Windows use: powershell -ExecutionPolicy Bypass -File scripts\\uninstall-autostart-windows.ps1" >&2
    exit 1
    ;;
esac
