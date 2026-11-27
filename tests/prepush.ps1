param(
  [string]$Base = '',
  [switch]$DryRun,
  [switch]$SkipBrowser,
  [switch]$SkipReplay
)

$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$steps = New-Object System.Collections.Generic.List[object]
$overallExit = 0

function Read-Git([string[]]$GitArguments) {
  $output = & git @GitArguments
  if ($LASTEXITCODE -ne 0) { throw "git $($GitArguments -join ' ') failed ($LASTEXITCODE)" }
  return ($output -join "`n")
}

function Add-Step([string]$Name, [bool]$Enabled, [string]$Reason, [string]$Program, [string[]]$CommandArguments) {
  $steps.Add([pscustomobject]@{
    Step = $Name; Enabled = $Enabled; Reason = $Reason
    Program = $Program; Arguments = $CommandArguments
    Status = 'not needed'; ExitCode = $null; Seconds = 0
  })
}

function Show-Command($Step) {
  $parts = @($Step.Program) + @($Step.Arguments)
  return (($parts | ForEach-Object {
    if ($_ -match '[\s"'']') { "'" + $_.Replace("'", "''") + "'" } else { $_ }
  }) -join ' ')
}

function Test-BrowserPorts {
  try {
    # netstat also works on Windows installations without Get-NetTCPConnection.
    $connections = & netstat -ano -p tcp
    if ($LASTEXITCODE -ne 0) { throw "netstat failed ($LASTEXITCODE)" }
    foreach ($line in $connections) {
      if ($line -match '^\s*TCP\s+\S+:(3000|3100)\s+\S+\s+LISTENING\s+(\d+)\s*$') {
        Write-Warning "Browser port $($Matches[1]) is still listening; owning PID $($Matches[2])."
      }
    }
  } catch { Write-Warning "Could not check browser ports 3000 and 3100: $_" }
}

Push-Location $repository
try {
  if (-not (Test-Path -LiteralPath (Join-Path $repository 'node_modules') -PathType Container)) {
    throw 'node_modules is missing. Install the repository dependencies before running prepush.'
  }
  if ([string]::IsNullOrWhiteSpace($Base)) {
    $Base = (Read-Git @('merge-base', 'HEAD', 'origin/feature/phase3-order-exceptions')).Trim()
  }
  $paths = New-Object System.Collections.Generic.List[string]
  $diff = Read-Git @('diff', '--name-only', '-z', $Base, '--')
  foreach ($path in ($diff -split "`0")) { if ($path) { $paths.Add($path) } }
  # Porcelain -z leaves paths unquoted and emits rename destinations first.
  $status = (Read-Git @('status', '--porcelain=v1', '-z', '--untracked-files=all')) -split "`0"
  for ($i = 0; $i -lt $status.Count; $i++) {
    if ($status[$i].Length -lt 4) { continue }
    $code = $status[$i].Substring(0, 2)
    $paths.Add($status[$i].Substring(3))
    if ($code -match '[RC]') {
      $i++
      if ($i -lt $status.Count -and $status[$i]) { $paths.Add($status[$i]) }
    }
  }
  # Include staged paths even when an unstaged edit restores their HEAD contents.
  $staged = Read-Git @('diff', '--cached', '--name-only', '-z', '--')
  foreach ($path in ($staged -split "`0")) { if ($path) { $paths.Add($path) } }
  $changed = @($paths | Where-Object { $_ -notmatch '^(docs/UI-PREVIEWS/|work/)' } | Sort-Object -Unique)
  Write-Host "Base: $Base"
  Write-Host "Changed files ($($changed.Count); UI previews and work ignored):"
  $changed | ForEach-Object { Write-Host "  $_" }

  $connector = @($changed | Where-Object { $_ -match '^(desktop-connector/|tests/connector-)' }).Count -gt 0
  $browser = @($changed | Where-Object { $_ -match '^(app/|components/|lib/|public/|tests/pricing-browser/.*\.spec\.ts$)' }).Count -gt 0
  $stock = @($changed | Where-Object { $_ -match '^(public/stockflow\.html|components/stockflow-frame\.tsx)(/|$)' }).Count -gt 0
  $replay = @($changed | Where-Object { $_ -match '^(supabase/|tests/pricing-)' }).Count -gt 0
  $needles = @($changed | Where-Object { $_ -match '^(components/|app/|lib/)' } | ForEach-Object {
    [pscustomobject]@{ File = $_; Text = [IO.Path]::GetFileNameWithoutExtension($_) }
    if ($_ -match '^app(/api/.*)/route\.ts$') {
      [pscustomobject]@{ File = $_; Text = $Matches[1] }
    }
  })
  $selected = New-Object System.Collections.Generic.List[string]
  $selectionReasons = @{}
  $componentChange = $changed | Where-Object { $_ -like 'components/*' } | Select-Object -First 1
  foreach ($spec in (Get-ChildItem tests/pricing-browser -Recurse -File -Filter '*.spec.ts' | Sort-Object FullName)) {
    $relative = $spec.FullName.Substring($repository.Length + 1).Replace('\', '/')
    $reason = ''
    if ($changed -contains $relative) { $reason = "$relative (changed spec)" }
    if (-not $reason -and $relative -eq 'tests/pricing-browser/screen-fit-audit.spec.ts' -and $componentChange) {
      $reason = "$componentChange (component change requires screen-fit audit)"
    }
    $content = [IO.File]::ReadAllText($spec.FullName)
    foreach ($needle in $needles) {
      if ($reason) { break }
      if ($content.IndexOf($needle.Text, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $reason = "$($needle.File) (spec contains '$($needle.Text)')"
        break
      }
    }
    if ($reason) { $selected.Add($relative); $selectionReasons[$relative] = $reason }
  }
  Write-Host "Pricing spec list ($($selected.Count); existing specs only):"
  $selected | ForEach-Object { Write-Host "  $_ <- $($selectionReasons[$_])" }

  Add-Step 'tsc' $true 'always' 'node' @('node_modules/typescript/bin/tsc', '--noEmit')
  $lint = (Get-Content package.json -Raw | ConvertFrom-Json).scripts.lint
  # Keep package.json as the source of truth; accept its simple command tokens,
  # but fail closed if it becomes a shell pipeline or compound command.
  if ($lint -notmatch '^oxlint\s+' -or $lint -match '[&|;<>`$]') { throw 'Expected scripts.lint to be a single oxlint command.' }
  $lintTokens = @([regex]::Matches($lint, '"[^"]*"|''[^'']*''|\S+') | ForEach-Object { $_.Value.Trim('"', "'") })
  Add-Step 'lint' $true 'always; arguments from scripts.lint' 'npx' (@('--no-install') + $lintTokens)
  Add-Step 'unit' $true 'always' 'node' @('node_modules/vitest/vitest.mjs', 'run')
  # Discover every tests/connector-*.ps1, including ones missing from the package shortcut.
  foreach ($script in (Get-ChildItem tests -File -Filter 'connector-*.ps1' | Sort-Object Name)) {
    Add-Step "connector/$($script.BaseName)" $connector 'desktop-connector/ or tests/connector-* changed' 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "tests/$($script.Name)")
  }
  $pricingEnabled = $browser -and -not $SkipBrowser -and $selected.Count -gt 0
  Add-Step 'browser/build-offline' $pricingEnabled 'CI prerequisite; skipped if no selected specs or -SkipBrowser' 'npm' @('run', 'build:offline')
  Add-Step 'browser/pricing' $pricingEnabled 'affected pricing specs; skipped if none or -SkipBrowser' 'npx' (@('--no-install', 'playwright', 'test', '--config', 'playwright.pricing.config.ts') + $selected.ToArray() + @('--reporter=line'))
  $stockSpecs = @(Get-ChildItem tests/e2e -File -Filter 'stock*.spec.ts' | Sort-Object Name | ForEach-Object { "tests/e2e/$($_.Name)" })
  Write-Host "Stock e2e spec list ($($stockSpecs.Count); selected=$($stock -and -not $SkipBrowser)):"
  $stockChanges = @($changed | Where-Object { $_ -match '^(public/stockflow\.html|components/stockflow-frame\.tsx)(/|$)' })
  $stockSpecs | ForEach-Object {
    if ($stock -and -not $SkipBrowser) { Write-Host "  $_ <- $($stockChanges -join ', ') (Stock shell changed)" }
    else { Write-Host "  $_ (not selected)" }
  }
  Add-Step 'browser/stock' ($stock -and -not $SkipBrowser) 'Stock shell changed; config starts the dev server on port 3000 unless PLAYWRIGHT_BASE_URL is set' 'npx' (@('--no-install', 'playwright', 'test', '--config', 'playwright.config.ts') + $stockSpecs + @('--reporter=line'))
  # Synchronous commands only: replay is always last and never overlaps tests.
  Add-Step 'replay' ($replay -and -not $SkipReplay) 'supabase/ or tests/pricing-* changed; skipped by -SkipReplay' 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'tests/pricing-migration-local.ps1')

  Write-Host 'Plan (in execution order):'
  foreach ($step in $steps) {
    if ($step.Step -like 'browser/*' -and $SkipBrowser) {
      $step.Status = if ($DryRun) { 'off (-SkipBrowser)' } else { 'off' }
      $step.Reason = '-SkipBrowser'
    } elseif ($step.Step -eq 'replay' -and $SkipReplay) {
      $step.Status = if ($DryRun) { 'off (-SkipReplay)' } else { 'off' }
      $step.Reason = '-SkipReplay'
    } elseif ($step.Enabled) {
      if ($DryRun) { $step.Status = 'planned' }
    } elseif ($step.Step -like 'connector/*') {
      $step.Reason = 'no desktop-connector/ or tests/connector-* changes'
    } elseif ($step.Step -eq 'browser/stock') {
      $step.Reason = 'no Stock shell changes'
    } elseif ($step.Step -like 'browser/*') {
      $step.Reason = if ($browser) { 'no affected pricing specs' } else { 'no browser-related changes' }
    } elseif ($step.Step -eq 'replay') {
      $step.Reason = 'no supabase/ or tests/pricing-* changes'
    }
    $action = if ($step.Enabled) { 'RUN' } else { 'SKIP' }
    Write-Host "  [$action] $($step.Step): $(Show-Command $step)"
    Write-Host "         $($step.Reason)"
  }
  if ($DryRun) {
    Write-Host 'DryRun: no checks, builds, browser tests, port checks or replay executed.'
  } else {
    $browserAttempted = $false
    try {
      foreach ($step in $steps) {
        # Check ports after the browser group, before replay starts.
        if ($step.Step -eq 'replay' -and $browserAttempted) {
          Test-BrowserPorts
          $browserAttempted = $false
        }
        if (-not $step.Enabled) { continue }
        Write-Host "Running $($step.Step): $(Show-Command $step)"
        if ($step.Step -like 'browser/*') { $browserAttempted = $true }
        $timer = [Diagnostics.Stopwatch]::StartNew()
        try {
          # Native stderr is diagnostic; native exit status is authoritative in PS 5.1.
          $ErrorActionPreference = 'Continue'
          $global:LASTEXITCODE = 0
          $commandArguments = $step.Arguments
          & $step.Program @commandArguments
          $commandSucceeded = $?
          $step.ExitCode = $LASTEXITCODE
          if (-not $commandSucceeded -and $step.ExitCode -eq 0) { $step.ExitCode = 1 }
        } catch {
          $step.ExitCode = 1
          Write-Host "Step error: $_"
        } finally {
          $ErrorActionPreference = 'Stop'
          $timer.Stop()
          $step.Seconds = [math]::Round($timer.Elapsed.TotalSeconds, 2)
        }
        $step.Status = if ($step.ExitCode -eq 0) { 'passed' } else { 'failed' }
        $step.Reason = if ($step.ExitCode -eq 0) { 'completed' } else { 'non-zero exit; remaining steps not run' }
        if ($step.ExitCode -ne 0) {
          $overallExit = $step.ExitCode
          Write-Host "FAILED: $($step.Step) (exit $overallExit). Remaining steps skipped."
          break
        }
      }
    } finally {
      if ($browserAttempted) { Test-BrowserPorts }
    }
  }
} catch {
  $overallExit = 1
  Write-Host "FAILED: prepush setup: $_"
} finally {
  if (-not $DryRun) {
    foreach ($step in $steps) {
      if ($step.Enabled -and $step.Status -eq 'not needed') {
        $step.Reason = 'not run: stopped before this step'
      }
    }
  }
  $steps | Select-Object Step, Status, ExitCode, Seconds, Reason | Format-Table -AutoSize -Wrap | Out-Host
  Pop-Location
}
exit $overallExit
