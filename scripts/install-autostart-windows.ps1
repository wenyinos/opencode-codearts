# Install a Startup-folder shortcut so the proxy starts at Windows login.
#
# The shortcut runs start-windows.ps1 hidden; that script starts the supervisor
# (dist/daemon.js) in a hidden window. Remove it with uninstall-autostart-windows.ps1.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart-windows.ps1

param(
  [int]$Port = 17228
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$StartScript = Join-Path $ScriptDir "start-windows.ps1"

if (-not (Test-Path $StartScript)) {
  throw "start-windows.ps1 not found at $StartScript"
}

$Startup = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $Startup "opencode-codearts.lnk"
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`" -Port $Port"
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.WindowStyle = 7
$Shortcut.Description = "Start the opencode-codearts proxy"
$Shortcut.Save()

Write-Host "Autostart shortcut created: $ShortcutPath"
Write-Host "It will run at the next login. To start now: $StartScript"
