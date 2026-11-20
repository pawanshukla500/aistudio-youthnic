# Install Graphify, Ponytail, and Understand-Anything into this repo.
# Idempotent. From the repo root:
#   powershell -File tools/install-agent-skills.ps1
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Ensure-Junction([string]$Link, [string]$Target) {
  if (-not (Test-Path -LiteralPath $Target)) {
    throw "Junction target missing: $Target"
  }
  $targetFull = (Resolve-Path -LiteralPath $Target).Path
  if (Test-Path -LiteralPath $Link) {
    $item = Get-Item -LiteralPath $Link -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      $existing = $item.Target
      if ($existing -is [array]) { $existing = $existing[0] }
      if ($existing) {
        $existingFull = (Resolve-Path -LiteralPath $existing).Path
        if ($existingFull -eq $targetFull) {
          Write-Host "ok  $Link"
          return
        }
      }
      $item.Delete()
    } else {
      throw "Refusing to replace a real file or directory with a junction: $Link"
    }
  }
  New-Item -ItemType Junction -Path $Link -Target $targetFull | Out-Null
  Write-Host "linked  $Link"
}

if (-not (Get-Command graphify -ErrorAction SilentlyContinue)) {
  python -m pip install graphifyy
  if ($LASTEXITCODE -ne 0) { throw 'pip install graphifyy failed' }
}

graphify install --project --platform cursor
if ($LASTEXITCODE -ne 0) { throw 'graphify cursor install failed' }
graphify install --project --platform agents
if ($LASTEXITCODE -ne 0) { throw 'graphify agents install failed' }

$Vendor = Join-Path $Root 'tools\vendor'
$Ponytail = Join-Path $Vendor 'ponytail'
$Ua = Join-Path $Vendor 'understand-anything'
Ensure-Dir $Vendor

if (-not (Test-Path -LiteralPath (Join-Path $Ponytail 'skills\ponytail\SKILL.md'))) {
  git clone --depth 1 https://github.com/dietrichgebert/ponytail.git $Ponytail
  if ($LASTEXITCODE -ne 0) { throw 'ponytail clone failed' }
}
if (-not (Test-Path -LiteralPath (Join-Path $Ua 'understand-anything-plugin\package.json'))) {
  git clone --depth 1 https://github.com/Egonex-AI/Understand-Anything.git $Ua
  if ($LASTEXITCODE -ne 0) { throw 'Understand-Anything clone failed' }
}

$CursorSkills = Join-Path $Root '.cursor\skills'
$AgentSkills = Join-Path $Root '.agents\skills'
Ensure-Dir $CursorSkills
Ensure-Dir $AgentSkills

Get-ChildItem -LiteralPath (Join-Path $Ponytail 'skills') -Directory | ForEach-Object {
  Ensure-Junction (Join-Path $CursorSkills $_.Name) $_.FullName
  Ensure-Junction (Join-Path $AgentSkills $_.Name) $_.FullName
}
Get-ChildItem -LiteralPath (Join-Path $Ua 'understand-anything-plugin\skills') -Directory | ForEach-Object {
  Ensure-Junction (Join-Path $CursorSkills $_.Name) $_.FullName
  Ensure-Junction (Join-Path $AgentSkills $_.Name) $_.FullName
}
Ensure-Junction (Join-Path $CursorSkills 'graphify') (Join-Path $AgentSkills 'graphify')

node (Join-Path $Ponytail 'scripts\cursor-hooks.js') install --project
if ($LASTEXITCODE -ne 0) { throw 'ponytail cursor hook install failed' }

$Plugin = Join-Path $Ua 'understand-anything-plugin'
$Dist = Join-Path $Plugin 'packages\core\dist\index.js'
if (-not (Test-Path -LiteralPath $Dist)) {
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw 'pnpm >= 10 is required to build Understand-Anything. Install it, then re-run this script.'
  }
  Push-Location $Plugin
  try {
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) {
      pnpm install
      if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
    }
    pnpm --filter @understand-anything/core build
    if ($LASTEXITCODE -ne 0) { throw 'Understand-Anything core build failed' }
  } finally {
    Pop-Location
  }
}

$checks = @(
  '.cursor\rules\graphify.mdc',
  '.agents\skills\graphify\SKILL.md',
  '.cursor\skills\graphify\SKILL.md',
  '.cursor\skills\ponytail\SKILL.md',
  '.agents\skills\ponytail\SKILL.md',
  '.cursor\skills\understand\SKILL.md',
  '.agents\skills\understand\SKILL.md',
  '.cursor\hooks.json',
  'tools\vendor\understand-anything\understand-anything-plugin\packages\core\dist\index.js'
)
foreach ($rel in $checks) {
  if (-not (Test-Path -LiteralPath (Join-Path $Root $rel))) {
    throw "Missing after install: $rel"
  }
}
$hooks = Get-Content -LiteralPath (Join-Path $Root '.cursor\hooks.json') -Raw
if ($hooks -notmatch 'ponytail-activate') {
  throw 'Cursor hooks.json is missing the ponytail session hook'
}
Write-Host 'Agent skills installed.'
