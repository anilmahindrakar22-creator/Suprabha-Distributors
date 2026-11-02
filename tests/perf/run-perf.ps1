$ErrorActionPreference = 'Stop'
$repository = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

# Copied from pricing-migration-local.ps1; keep its program search and user.
function Resolve-PostgresProgram([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidateBins = @($env:STOCKFLOW_POSTGRES_BIN)
  if ($env:LOCALAPPDATA) {
    $candidateBins += Join-Path $env:LOCALAPPDATA 'Programs\PostgreSQL\17-portable\pgsql\bin'
  }
  $candidateBins += @(
    (Join-Path (Split-Path $repository -Parent) 'stockflow-phase3-local-tools\postgres17-portable\pgsql\bin'),
    (Join-Path (Split-Path $repository -Parent) 'stockflow-phase3-local-tools\postgres17\bin'),
    (Join-Path (Split-Path $repository -Parent) 'stockflow-phase3-local-tools\postgres15-portable\pgsql\bin')
  )
  $candidateBins = $candidateBins | Where-Object { $_ -and (Test-Path $_) }
  foreach ($bin in $candidateBins) {
    $program = Join-Path $bin "$Name.exe"
    if (Test-Path $program) { return $program }
  }
  throw "PostgreSQL $Name was not found. Install PostgreSQL or set STOCKFLOW_POSTGRES_BIN to its bin directory."
}

$outputDirectory = Join-Path $repository 'work/perf'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$log = Join-Path $outputDirectory ('perf-' + (Get-Date -Format 'yyyyMMdd-HHmm') + '.txt')
$database = $null
$previousKeep = $env:STOCKFLOW_KEEP_DATABASE
$databaseUser = if ($env:STOCKFLOW_POSTGRES_USER) { $env:STOCKFLOW_POSTGRES_USER } else { 'postgres' }
$dropdbProgram = $null
try {
  $env:STOCKFLOW_KEEP_DATABASE = '1'
  $psqlProgram = Resolve-PostgresProgram 'psql'
  $dropdbProgram = Resolve-PostgresProgram 'dropdb'
  # Run in a child PowerShell so replay errors give an unambiguous exit code.
  # Stream both native channels as text; Windows PowerShell otherwise treats
  # ordinary PostgreSQL NOTICE messages as terminating NativeCommandErrors.
  $replay = Join-Path $repository 'tests/pricing-migration-local.ps1'
  $savedPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
   & powershell -NoProfile -ExecutionPolicy Bypass -File $replay 2>&1 | ForEach-Object {
      $line = $_.ToString()
      $line | Out-File -LiteralPath $log -Append -Encoding utf8
      if ($line -match '^KEPT DATABASE: (stockflow_test_[0-9a-f]{16})$') { $database = $Matches[1] }
   }
   $replayCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $savedPreference }
  if ($replayCode -ne 0) { throw "Migration replay failed; see $log" }
  if (-not $database) { throw "Replay did not report KEPT DATABASE; see $log" }
  foreach ($file in @('seed-scale.sql','time-reads.sql')) {
    # Native stderr is expected for RAISE NOTICE; check native exit status.
    $savedPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      & $psqlProgram -U $databaseUser -X -v ON_ERROR_STOP=1 -d $database -f (Join-Path $PSScriptRoot $file) 2>&1 |
        ForEach-Object {
          $line = $_.ToString()
          $line | Out-File -LiteralPath $log -Append -Encoding utf8
          if ($line -match 'perf \S+ median_ms=') { Write-Output $line }
        }
      $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedPreference }
    if ($code -ne 0) { throw "$file failed with exit code $code; see $log" }
  }
} catch {
  $_.ToString() | Out-File -LiteralPath $log -Append -Encoding utf8
  throw
} finally {
  $savedPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($database -and $dropdbProgram) {
      & $dropdbProgram -U $databaseUser --if-exists $database 2>&1 |
        ForEach-Object { $_.ToString() | Out-File -LiteralPath $log -Append -Encoding utf8 }
      if ($LASTEXITCODE -ne 0) { Write-Warning "Could not drop $database; see $log" }
    }
  } finally {
    $ErrorActionPreference = $savedPreference
    $env:STOCKFLOW_KEEP_DATABASE = $previousKeep
  }
  # Replay's $serverStartedByScript and $postgresData are private to its child
  # process. KEEP_DATABASE emits only the DB name, so startup ownership cannot
  # be established reliably. Leave the server running; never stop a shared one.
  $message = "PostgreSQL left running (replay startup ownership unavailable). Log: $log"
  $message | Out-File -LiteralPath $log -Append -Encoding utf8
  Write-Output $message
}
