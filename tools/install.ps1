# Copies (or links) the plugin into Ulanzi Studio's plugin folder.
#
#   .\tools\install.ps1            copy
#   .\tools\install.ps1 -Link      symlink for a fast dev loop (needs Developer
#                                  Mode or an elevated shell)
param(
  [switch]$Link,
  [string]$PluginFolder = 'com.ulanzi.matUlanziHa.ulanziPlugin'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot $PluginFolder
if (-not (Test-Path -LiteralPath $source -PathType Container)) {
  throw "Plugin folder not found: $source"
}

$target = Join-Path $env:APPDATA "Ulanzi\UlanziDeck\Plugins\$PluginFolder"
$parent = Split-Path -Parent $target
if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
  throw "Ulanzi plugin directory not found: $parent  (is Ulanzi Studio installed?)"
}

# Refuse to touch anything but our own plugin.
if ((Split-Path -Leaf $target) -ne $PluginFolder) {
  throw "Refusing to write to $target"
}

if (Test-Path -LiteralPath $target) {
  $existing = Get-Item -LiteralPath $target -Force
  if ($existing.LinkType) {
    Write-Host "removing existing link $target"
    $existing.Delete()
  } else {
    Write-Host "removing existing copy $target"
    Remove-Item -LiteralPath $target -Recurse -Force
  }
}

$linked = $false
if ($Link) {
  # A directory junction needs no elevation; a symlink does unless Developer
  # Mode is on. Try the cheap one first, then fall back to a plain copy so the
  # plugin always ends up installed.
  foreach ($kind in @('Junction', 'SymbolicLink')) {
    try {
      New-Item -ItemType $kind -Path $target -Target $source -ErrorAction Stop | Out-Null
      Write-Host "$kind $target -> $source"
      $linked = $true
      break
    } catch {
      Write-Host "$kind failed: $($_.Exception.Message)"
    }
  }
  if (-not $linked) { Write-Host 'falling back to a copy' }
}

if (-not $linked) {
  Copy-Item -LiteralPath $source -Destination $target -Recurse
  Write-Host "copied to $target"
}

Write-Host ''
Write-Host 'Restart Ulanzi Studio to pick up the plugin.'
Write-Host ''
Write-Host 'If your edits ever stop showing up in Studio, check this first -'
Write-Host 'something can replace the junction with a stale copy:'
Write-Host ("  (Get-Item -LiteralPath '$target' -Force).LinkType   # must say Junction")
