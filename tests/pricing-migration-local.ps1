param([switch]$StrictHistory, [switch]$DeploymentOrder)
$ErrorActionPreference = 'Stop'
if ($StrictHistory -and $DeploymentOrder) { throw 'Choose either StrictHistory or DeploymentOrder' }

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
    if ($StrictHistory -or $file.Name -ge '20260913130000_customer_price_book.sql') { continue }
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
  if (-not $StrictHistory -and -not $DeploymentOrder) {
  $historyMigration = Join-Path $work '20260902080651_harden_business_history.sql'
  $historySql = [IO.File]::ReadAllText($historyMigration)
  foreach ($table in @('stockflow_delivery_exceptions', 'stockflow_equipment_installations')) {
    $pattern = "(?ms)^create trigger $($table)_no_delete\nbefore delete on private\.$table\nfor each row execute function private\.prevent_business_delete\(\);\n?"
    $historySql = [regex]::Replace($historySql, $pattern, '')
  }
  [IO.File]::WriteAllText($historyMigration, $historySql, [Text.UTF8Encoding]::new($false))
  }

  Invoke-DatabaseCommand 'createdb' @($database)
  $databaseCreated = $true
  Invoke-DatabaseCommand 'psql' @('-X','-q','-v','ON_ERROR_STOP=1','-d',$database,'-f',(Join-Path $PSScriptRoot 'supabase-local-scaffold.sql'))

  $migrationPlan = @(Get-ChildItem $work -Filter '*.sql' | Sort-Object Name)
  if ($DeploymentOrder) {
    $evidence = Get-Content (Join-Path $repository 'supabase/migration-history-map.json') -Raw | ConvertFrom-Json
    $excluded = @('20260831112500_rotate_order_gateway_key.sql')
    # Retain the archived_at schema and access predicate, but never replay the
    # historical command that archived every order in the live company.
    $archiveMigration = Join-Path $work '20260903125500_archive_and_reset_test_orders.sql'
    $archiveSql = [IO.File]::ReadAllText($archiveMigration)
    $archiveSql = [regex]::Replace($archiveSql, '(?ms)^update private\.stockflow_orders\s+set archived_at.*?where archived_at is null;\s*', '')
    if ($archiveSql -match "updated_by_email = 'administrator reset'") { throw 'Historical order reset was not removed from clean-install copy' }
    [IO.File]::WriteAllText($archiveMigration, $archiveSql, [Text.UTF8Encoding]::new($false))
    $deployed = @($evidence.remoteOnly | ForEach-Object { [pscustomobject]@{ localFile=$_.localFile; remoteVersion=$_.version } }) + @($evidence.migrations | Where-Object remoteVersion | Select-Object localFile,remoteVersion)
    $pending = @($evidence.migrations | Where-Object status -eq 'not_deployed' | Sort-Object localFile | Select-Object -ExpandProperty localFile)
    $orderedNames = @($deployed | Where-Object { $_.localFile -notin $excluded } | Sort-Object remoteVersion | Select-Object -ExpandProperty localFile) + $pending
    $migrationPlan = @($orderedNames | ForEach-Object { Get-Item (Join-Path $work $_) })
    if (($migrationPlan | Select-Object -ExpandProperty Name | Sort-Object -Unique).Count -ne $migrationPlan.Count) { throw 'Deployment migration plan contains duplicates' }
  }

  foreach ($migration in $migrationPlan) {
    if (-not $StrictHistory -and -not $DeploymentOrder -and $migration.Name -eq $deferredMigration) { continue }
    if ($migration.Name -eq '20260913130000_customer_price_book.sql') {
      $seed = @'
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Upgrade preservation','upgrade-preservation','test');
insert into private.stockflow_orders(id,customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email) values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Upgrade preservation','phone','packed','upgrade-preservation-order','test','test');
insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity) values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','UPGRADE-ITEM','Existing reagent',2);
create table public.test_upgrade_expected as select to_jsonb(o) as order_data,(select jsonb_agg(to_jsonb(l)) from private.stockflow_order_lines l where l.order_id=o.id) as line_data from private.stockflow_orders o where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
'@
      Invoke-DatabaseCommand 'psql' @('-X','-q','-v','ON_ERROR_STOP=1','-d',$database,'-c',$seed)
    }
    if ($migration.Name -ge '20260913130000_customer_price_book.sql' -and (Get-FileHash $migration.FullName).Hash -ne (Get-FileHash (Join-Path $migrationSource $migration.Name)).Hash) { throw "Pricing migration copy changed: $($migration.Name)" }
    Invoke-DatabaseCommand 'psql' @('-X','-q','-v','ON_ERROR_STOP=1','-d',$database,'-f',$migration.FullName)
    if (-not $StrictHistory -and -not $DeploymentOrder -and $migration.Name -eq '20260902113000_equipment_installations.sql') {
      Invoke-DatabaseCommand 'psql' @('-X','-q','-v','ON_ERROR_STOP=1','-d',$database,'-f',(Join-Path $work $deferredMigration))
    }
  }

  $lateTriggers = 'create trigger stockflow_delivery_exceptions_no_delete before delete on private.stockflow_delivery_exceptions for each row execute function private.prevent_business_delete(); create trigger stockflow_equipment_installations_no_delete before delete on private.stockflow_equipment_installations for each row execute function private.prevent_business_delete();'
  if (-not $StrictHistory -and -not $DeploymentOrder) { Invoke-DatabaseCommand 'psql' @('-X','-q','-v','ON_ERROR_STOP=1','-d',$database,'-c',$lateTriggers) }
  $preserved = @'
do $$begin
if not exists(select 1 from private.stockflow_orders o cross join public.test_upgrade_expected e where o.id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' and to_jsonb(o)=e.order_data and (select jsonb_agg(to_jsonb(l)) from private.stockflow_order_lines l where l.order_id=o.id)=e.line_data) then raise exception 'Pricing upgrade changed existing order data'; end if;
end$$;
'@
  Invoke-DatabaseCommand 'psql' @('-X','-q','-v','ON_ERROR_STOP=1','-d',$database,'-c',$preserved)
  Write-Output 'PASS: byte-identical pricing upgrade preserves existing order and lines'
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
