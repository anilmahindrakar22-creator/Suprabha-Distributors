$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../desktop-connector/recovery.ps1')
$old = @(@{masterId='1';date='20250101'},@{masterId='2';date='20260901'},@{masterId='3';date='20240101'})
$fresh = @(@{masterId='3';date='20260902';cancelled=$true})
$merged = @(Merge-SalesRecords $old $fresh '20260801')
if ($merged.Count -ne 2) { throw 'Incorrect voucher count' }
if (-not ($merged | Where-Object masterId -eq '1')) { throw 'Older history lost' }
if ($merged | Where-Object masterId -eq '2') { throw 'Deleted recent voucher retained' }
if (@($merged | Where-Object masterId -eq '3').Count -ne 1 -or -not ($merged | Where-Object masterId -eq '3').cancelled) { throw 'Moved/cancelled voucher not replaced' }
$empty = @(Merge-SalesRecords $old @() '20260801')
if ($empty.Count -ne 2) { throw 'Empty window must preserve only older history' }
$rejected = $false
try { Merge-SalesRecords $old @(@{date='20260901'}) '20260801' | Out-Null } catch { $rejected = $true }
if (-not $rejected) { throw 'Missing identity accepted' }
[xml]$legacy = '<ENVELOPE><COLLECTION><VOUCHER><MASTERID>9</MASTERID><DATE>20260905</DATE><VOUCHERNUMBER>SD/26-27/0009</VOUCHERNUMBER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>City Lab</PARTYLEDGERNAME><ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Kit</STOCKITEMNAME><BILLEDQTY> 2 qty</BILLEDQTY><RATE>485.00/box</RATE><AMOUNT>-970.00</AMOUNT></ALLINVENTORYENTRIES.LIST></VOUCHER></COLLECTION></ENVELOPE>'
$converted = @(Convert-LegacySalesRecords $legacy.OuterXml)
if ($converted.Count -ne 1 -or $converted[0].date -ne '20260905' -or $converted[0].voucherNumber -ne 'SD/26-27/0009' -or $converted[0].voucherType -ne 'Sales' -or $converted[0].party -ne 'City Lab' -or $converted[0].lineItems[0].quantity -ne 2 -or $converted[0].lineItems[0].rate -ne 485 -or $converted[0].masterId -ne 'master:9') { throw 'Legacy cache conversion failed' }
$evidence = @(Get-PricingSalesEvidence $converted @(@{name='City Lab';tallyKey='ledger:city'}) 5 50)
if ($evidence.Count -ne 1 -or $evidence[0].customerTallyKey -ne 'ledger:city' -or $evidence[0].tallyItemKey -ne 'Kit' -or $evidence[0].rate -ne 485 -or $evidence[0].invoiceDate -ne '2026-09-05' -or -not $evidence[0].sourceVersion) { throw 'Pricing sales evidence was not built safely' }
$focXml = $legacy.OuterXml.Replace('<RATE>485.00/box</RATE><AMOUNT>-970.00</AMOUNT>','<RATE>0.00/box</RATE><AMOUNT>0.00</AMOUNT>')
$focEvidence = @(Get-PricingSalesEvidence @(Convert-LegacySalesRecords $focXml) @(@{name='City Lab';tallyKey='ledger:city'}) 5 50)
if ($focEvidence.Count -ne 1 -or -not $focEvidence[0].exceptional -or $focEvidence[0].exceptionType -ne 'foc') { throw 'FOC evidence was not classified' }
$unscoped = [pscustomobject]@{ company='TEST'; records=@([pscustomobject]@{ party='Purchase supplier' }) }
if ($null -ne (Get-TrustedSalesSnapshot $unscoped 'TEST')) { throw 'Unscoped historical supply cache accepted' }
$salesScoped = [pscustomobject]@{ company='TEST'; sourceScope='sales_vouchers_v1'; records=@() }
if ($null -eq (Get-TrustedSalesSnapshot $salesScoped 'TEST')) { throw 'Sales-only cache was rejected' }
$today = [datetime]'2026-09-07'
$firstWindow = Get-SalesWindow $today '' 7 30 24
if ($firstWindow.fromDate -ne '20260808' -or -not $firstWindow.reconciliation) { throw 'Initial sales reconciliation window is incorrect' }
$freshWindow = Get-SalesWindow $today ([datetimeoffset]::UtcNow.AddHours(-1).ToString('o')) 7 30 24
if ($freshWindow.fromDate -ne '20260831' -or $freshWindow.reconciliation) { throw 'Frequent sales window is incorrect' }
$staleWindow = Get-SalesWindow $today ([datetimeoffset]::UtcNow.AddHours(-25).ToString('o')) 7 30 24
if ($staleWindow.fromDate -ne '20260808' -or -not $staleWindow.reconciliation) { throw 'Daily sales reconciliation was not scheduled' }
$fallback = Get-SalesRecordIdentity '' '20260905' 'SD/26-27/0099' 'City Lab'
if (-not $fallback.StartsWith('fallback:') -or $fallback -ne (Get-SalesRecordIdentity '' '20260905' 'SD/26-27/0099' 'City Lab')) { throw 'Fallback identity is not deterministic' }
if ($null -ne (Get-SalesRecordIdentity '' '20260905' '' 'City Lab')) { throw 'Incomplete fallback identity accepted' }
Write-Output 'PASS: historical retention, deleted window rows, moved IDs, cancellation replacement, empty window, invalid identity'
