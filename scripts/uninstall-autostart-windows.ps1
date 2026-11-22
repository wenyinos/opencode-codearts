# Remove the Windows login autostart shortcut for opencode-codearts.

$ErrorActionPreference = "Stop"
$Startup = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $Startup "opencode-codearts.lnk"

if (Test-Path $ShortcutPath) {
  Remove-Item $ShortcutPath -Force
  Write-Host "Removed autostart shortcut: $ShortcutPath"
} else {
  Write-Host "No autostart shortcut found at $ShortcutPath"
}
