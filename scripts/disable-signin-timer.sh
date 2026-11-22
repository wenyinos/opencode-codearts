#!/usr/bin/env bash
# Opt out of the daily CodeArts check-in. The proxy service and the saved
# credentials/cookies are left untouched.

set -euo pipefail

case "$(uname -s)" in
  Linux)
    systemctl --user disable --now opencode-codearts-signin.timer 2>/dev/null || true
    UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    rm -f "$UNIT_DIR/opencode-codearts-signin.service" \
          "$UNIT_DIR/opencode-codearts-signin.timer"
    systemctl --user daemon-reload 2>/dev/null || true
    echo "daily check-in disabled"
    ;;
  Darwin)
    launchctl bootout "gui/$(id -u)/com.opencode-codearts.signin" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/com.opencode-codearts.signin.plist"
    echo "daily check-in disabled"
    ;;
  *)
    echo "unsupported platform: $(uname -s)" >&2
    exit 1
    ;;
esac
