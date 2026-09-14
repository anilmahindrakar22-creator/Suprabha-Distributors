$ErrorActionPreference = 'Stop'

$repository = Split-Path $PSScriptRoot -Parent
$migrationSource = Join-Path $repository 'supabase/migrations'
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$work = Join-Path $temporaryRoot "stockflow-migrations-$([guid]::NewGuid().ToString('N'))"
$database = "stockflow_test_$([guid]::NewGuid().ToString('N').Substring(0,16))"
$deferredMigration = '20260902093349_idempotent_remaining_mutations.sql'
$databaseCreated = $false

function Invoke-DatabaseCommand([string]$Program, [string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}

try {
  New-Item -ItemType Directory -Path $work | Out-Null
  Copy-Item (Join-Path $migrationSource '*.sql') -Destination $work

  # Windows PostgreSQL can preserve CR characters in stored function bodies.
  # Historical migrations compare those bodies as text, so normalize only the
  # disposable replay copy before each comparison. Production files are unchanged.
  foreach ($file in Get-ChildItem $work -Filter '*.sql') {
    $sql = [IO.File]::ReadAllText($file.FullName)
    $sql = [regex]::Replace(
      $sql,
      '(?i)(select\s+pg_get_functiondef\([^;]+?\s+into\s+f;)',
      "`$1`n  f := replace(f, chr(13), '');"
    )
    [IO.File]::WriteAllText($file.FullName, $sql, [Text.UTF8Encoding]::new($false))
  }

  # These two legacy triggers precede their tables in timestamp order. Defer
  # only their creation; the original migration files remain immutable.
  $historyMigration = Join-Path $work '20260902080651_harden_business_history.sql'
  $historySql = [IO.File]::ReadAllText($historyMigration)
  foreach ($table in @('stockflow_delivery_exceptions', 'stockflow_equipment_installations')) {
    $pattern = "(?ms)^create trigger $($table)_no_delete\nbefore delete on private\.$table\nfor each row execute function private\.prevent_business_delete\(\);\n?"
    $historySql = [regex]::Replace($historySql, $pattern, '')
  }
  [IO.File]::WriteAllText($historyMigration, $historySql, [Text.UTF8Encoding]::new($false))

  Invoke-DatabaseCommand 'createdb' @($database)
  $databaseCreated = $true
  Invoke-DatabaseCommand 'psql' @('-X','-q','-v','ON_ERROR_STOP=1','-d',$database,'-f',(Join-Path $PSScriptRoot 'supabase-local-scaffold.sql'))

  foreach ($migration in Get-ChildItem $work -Filter '*.sql' | Sort-Object Name) {
    if ($migration.Name -eq $deferredMigration) { continue }
    Invoke-DatabaseCommand 'psql' @('-X','-q','-v','ON_ERROR_STOP=1','-d',$database,'-f',$migration.FullName)
    if ($migration.Name -eq '20260902113000_equipment_installations.sql') {
      Invoke-DatabaseCommand 'psql' @('-X','-q','-v','ON_ERROR_STOP=1','-d',$database,'-f',(Join-Path $work $deferredMigration))
    }
  }

  $lateTriggers = 'create trigger stockflow_delivery_exceptions_no_delete before delete on private.stockflow_delivery_exceptions for each row execute function private.prevent_business_delete(); create trigger stockflow_equipment_installations_no_delete before delete on private.stockflow_equipment_installations for each row execute function private.prevent_business_delete();'
  Invoke-DatabaseCommand 'psql' @('-X','-q','-v','ON_ERROR_STOP=1','-d',$database,'-c',$lateTriggers)
  Invoke-DatabaseCommand 'psql' @('-X','-q','-v','ON_ERROR_STOP=1','-d',$database,'-f',(Join-Path $repository 'supabase/tests/pricing_engine_integrity.sql'))
  Invoke-DatabaseCommand 'psql' @('-X','-q','-v','ON_ERROR_STOP=1','-d',$database,'-f',(Join-Path $repository 'supabase/tests/customer_price_book_integrity.sql'))
  Write-Output 'PASS: complete migration replay and pricing ACID tests'
  Invoke-DatabaseCommand 'psql' @('-X','-q','-v','ON_ERROR_STOP=1','-d',$database,'-f',(Join-Path $repository 'supabase/tests/price_book_concurrency.sql'))
  Write-Output 'PASS: two-session price-book concurrency and bulk rollback'
} finally {
  if ($databaseCreated) { & dropdb --if-exists $database | Out-Null }
  $resolvedWork = [IO.Path]::GetFullPath($work)
  if ($resolvedWork.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedWork -Leaf).StartsWith('stockflow-migrations-')) {
    Remove-Item -LiteralPath $resolvedWork -Recurse -Force -ErrorAction SilentlyContinue
  }
}
