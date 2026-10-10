$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../desktop-connector/economics.ps1')
function Assert-Economic($Condition,[string]$Message){if(-not $Condition){throw $Message}}
$tallyXml=ConvertFrom-TallyEconomicXml '<ENVELOPE><UDF:PRIVATEFIELD>Value&#4;</UDF:PRIVATEFIELD><COLLECTION /></ENVELOPE>'
Assert-Economic ($tallyXml.DocumentElement.FirstChild.InnerText -eq ('Value'+[char]4)) 'Tally character-reference value was silently stripped'
Assert-Economic ($tallyXml.DocumentElement.FirstChild.NamespaceURI -eq 'TallyUDF') 'Undeclared Tally UDF prefix was not parsed'
foreach($invalid in @('<!DOCTYPE ENVELOPE [<!ENTITY secret SYSTEM "file:///not-read">]><ENVELOPE>&secret;</ENVELOPE>','<ENVELOPE><BROKEN></ENVELOPE>')) {
    $rejected=$false
    try { ConvertFrom-TallyEconomicXml $invalid | Out-Null } catch { $rejected=$true;Assert-Economic ($_.Exception.Message -notmatch 'PRIVATEFIELD|not-read|BROKEN') 'XML failure leaked raw exported data' }
    Assert-Economic $rejected 'Unsafe or malformed XML accepted'
}
[xml]$company='<ENVELOPE><COMPANY NAME="SUPRABHA DISTRIBUTORS"><GUID>company-guid-1</GUID></COMPANY></ENVELOPE>'
[xml]$ledgers='<ENVELOPE><LEDGER NAME="Customer A"><GUID>customer-guid-1</GUID></LEDGER><LEDGER NAME="Sales"><GUID>sales-guid-1</GUID><PARENT>Sales Accounts</PARENT></LEDGER><LEDGER NAME="GST"><GUID>gst-guid-1</GUID><TAXTYPE>GST</TAXTYPE></LEDGER><LEDGER NAME="Discount"><GUID>discount-guid-1</GUID></LEDGER></ENVELOPE>'
[xml]$products='<ENVELOPE><STOCKITEM NAME="Reagent A"><GUID>product-guid-1</GUID><BASEUNITS>pack</BASEUNITS></STOCKITEM></ENVELOPE>'
[xml]$vouchers='<ENVELOPE><VOUCHER><GUID>voucher-guid-1</GUID><ALTERID>10</ALTERID><DATE>20260915</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>Customer A</PARTYLEDGERNAME><ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Reagent A</STOCKITEMNAME><ACTUALQTY>70 pack</ACTUALQTY><AMOUNT>50000.00</AMOUNT></ALLINVENTORYENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Customer A</LEDGERNAME><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-59000.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>50000.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>GST</LEDGERNAME><AMOUNT>9000.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></ENVELOPE>'
$from=[datetime]'2026-09-01';$to=[datetime]'2026-10-01'
$result=Convert-TallyEconomicEvidence $company $ledgers $products $vouchers $from $to
[xml]$companyWithCounts=$company.OuterXml.Replace('<ENVELOPE>','<ENVELOPE><HEADER><CMPINFO><COMPANY>0</COMPANY><LEDGER>0</LEDGER></CMPINFO></HEADER>')
$counted=Convert-TallyEconomicEvidence $companyWithCounts $ledgers $products $vouchers $from $to
Assert-Economic ($counted.companyId -eq 'company-guid-1' -and $counted.vouchers.Count -eq 1) 'Tally CMPINFO company count was treated as a second company'
Assert-Economic ($result.vouchers.Count -eq 1 -and $result.vouchers[0].amountStatus -eq 'verified') 'Valid voucher not accepted'
Assert-Economic ($result.vouchers[0].customerSourceId -eq 'customer-guid-1' -and $result.vouchers[0].lines[0].productId -eq 'product-guid-1') 'Names used instead of canonical GUIDs'
Assert-Economic ($result.vouchers[0].lines[0].netSalesPaise -eq '5000000' -and $result.vouchers[0].taxPaise -eq '900000') 'GST included in reagent net sales'
[xml]$aliased=$vouchers.OuterXml.Replace('</VOUCHER>',($vouchers.VOUCHER.InnerXml -replace 'ALLINVENTORYENTRIES','INVENTORYENTRIES' -replace 'ALLLEDGERENTRIES','LEDGERENTRIES')+'</VOUCHER>')
$aliases=Convert-TallyEconomicEvidence $company $ledgers $products $aliased $from $to
Assert-Economic ($aliases.vouchers[0].amountStatus -eq 'verified' -and $aliases.vouchers[0].lines.Count -eq 1 -and $aliases.vouchers[0].taxPaise -eq '900000') 'Tally collection aliases double-counted economics'
[xml]$banking='<ENVELOPE><VOUCHER><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><ALLINVENTORYENTRIES.LIST /></VOUCHER></ENVELOPE>'
$bank=Convert-TallyEconomicEvidence $company $ledgers $products $banking $from $to
Assert-Economic ($bank.vouchers.Count -eq 0) 'Empty inventory placeholder treated as a stock document'
[xml]$discounted=$vouchers.OuterXml.Replace('-59000.00','-58000.00').Replace('</VOUCHER>','<ALLLEDGERENTRIES.LIST><LEDGERNAME>Discount</LEDGERNAME><AMOUNT>-1000.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>')
$bad=Convert-TallyEconomicEvidence $company $ledgers $products $discounted $from $to
Assert-Economic ($bad.vouchers[0].amountStatus -eq 'unverified') 'Unknown document adjustment silently accepted'
$good=Convert-TallyEconomicEvidence $company $ledgers $products $discounted $from $to @{'discount-guid-1'='discount'}
Assert-Economic ($good.vouchers[0].lines[0].netSalesPaise -eq '4900000') 'Document discount was not apportioned exactly'
[xml]$rounded=$vouchers.OuterXml.Replace('-59000.00','-59000.01').Replace('</VOUCHER>','<ALLLEDGERENTRIES.LIST><LEDGERNAME>Discount</LEDGERNAME><AMOUNT>0.01</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>')
$round=Convert-TallyEconomicEvidence $company $ledgers $products $rounded $from $to @{'discount-guid-1'='rounding'}
Assert-Economic ($round.vouchers[0].amountStatus -eq 'verified' -and $round.vouchers[0].lines[0].netSalesPaise -eq '5000001' -and $round.vouchers[0].lines[0].roundingPaise -eq '1') 'Configured invoice rounding was lost from net economics'
[xml]$roundWithFree=$rounded.OuterXml.Replace('</VOUCHER>','<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Reagent A</STOCKITEMNAME><ACTUALQTY>1 pack</ACTUALQTY><AMOUNT>0.00</AMOUNT></ALLINVENTORYENTRIES.LIST></VOUCHER>')
$freeRounding=Convert-TallyEconomicEvidence $company $ledgers $products $roundWithFree $from $to @{'discount-guid-1'='rounding'}
Assert-Economic ($freeRounding.vouchers[0].lines[0].netSalesPaise -eq '5000001' -and $freeRounding.vouchers[0].lines[1].netSalesPaise -eq '0' -and $freeRounding.vouchers[0].lines[1].focReason -eq 'UNKNOWN') 'Rounding residual invented revenue on a free line'
$configRejected=$false
try{Convert-TallyEconomicEvidence $company $ledgers $products $vouchers $from $to @{'discount-guid-1'='rouding'} | Out-Null}catch{$configRejected=$true}
Assert-Economic $configRejected 'Invalid ledger role silently ignored'
[xml]$renamedLedgers=$ledgers.OuterXml.Replace('Customer A','Customer Renamed')
[xml]$renamedVoucher=$vouchers.OuterXml.Replace('Customer A','Customer Renamed')
$renamed=Convert-TallyEconomicEvidence $company $renamedLedgers $products $renamedVoucher $from $to
Assert-Economic ($renamed.vouchers[0].customerSourceId -eq 'customer-guid-1') 'Customer rename changed identity'
[xml]$badUnits=$vouchers.OuterXml.Replace('70 pack','70 bottle')
$units=Convert-TallyEconomicEvidence $company $ledgers $products $badUnits $from $to
Assert-Economic ($units.vouchers[0].amountStatus -eq 'unverified') 'Unverified unit conversion accepted'
[xml]$cancelled=$vouchers.OuterXml.Replace('<DATE>','<ISCANCELLED>Yes</ISCANCELLED><DATE>')
$cancel=Convert-TallyEconomicEvidence $company $ledgers $products $cancelled $from $to
Assert-Economic ($cancel.vouchers[0].cancelled -and $cancel.vouchers[0].amountStatus -eq 'verified' -and $cancel.vouchers[0].lines.Count -eq 0) 'Cancellation did not preserve source revision'
[xml]$clearedCancellation='<ENVELOPE><VOUCHER><GUID>voucher-guid-1</GUID><ALTERID>11</ALTERID><DATE>20260915</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><ISCANCELLED>Yes</ISCANCELLED></VOUCHER></ENVELOPE>'
$cleared=Convert-TallyEconomicEvidence $company $ledgers $products $clearedCancellation $from $to
Assert-Economic ($cleared.vouchers[0].amountStatus -eq 'verified' -and $cleared.vouchers[0].lines.Count -eq 0) 'Cleared cancellation incorrectly required customer or amount evidence'
[xml]$foc=$vouchers.OuterXml.Replace('50000.00','0.00').Replace('-59000.00','0.00').Replace('9000.00','0.00')
$free=Convert-TallyEconomicEvidence $company $ledgers $products $foc $from $to
Assert-Economic ($free.vouchers[0].amountStatus -eq 'verified' -and $free.vouchers[0].lines[0].quantity -eq '70' -and $free.vouchers[0].lines[0].focReason -eq 'UNKNOWN') 'FOC quantity or reason was lost'
# Keep party/tax/trade amounts explicit: only native inventory blanks are rescued.
[xml]$blankFree=$foc.Clone()
$blankFree.SelectSingleNode('//ALLINVENTORYENTRIES.LIST/AMOUNT').InnerText=''
[xml]$numericZero='<ENVELOPE><COLLECTION><ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Reagent A</STOCKITEMNAME><AMOUNT /><ACTUALQTY>70 pack</ACTUALQTY><ECONOMICAMOUNTNUMBER>0</ECONOMICAMOUNTNUMBER><ECONOMICVOUCHERID>voucher-guid-1</ECONOMICVOUCHERID><ECONOMICVOUCHERREVISION>10</ECONOMICVOUCHERREVISION></ALLINVENTORYENTRIES.LIST></COLLECTION></ENVELOPE>'
$zeroVerified=Convert-TallyEconomicEvidence $company $ledgers $products $blankFree $from $to @{} @{} $numericZero
Assert-Economic ($zeroVerified.vouchers[0].amountStatus -eq 'verified' -and $zeroVerified.vouchers[0].lines[0].netSalesPaise -eq '0' -and $zeroVerified.vouchers[0].lines[0].amountEvidence.method -eq 'tally_numeric_zero_v1') 'Tally numeric zero evidence was not retained'
$zeroMissing=Convert-TallyEconomicEvidence $company $ledgers $products $blankFree $from $to
Assert-Economic ($zeroMissing.vouchers[0].amountStatus -eq 'unverified') 'Blank amount guessed to be zero without Tally evidence'
foreach($changed in @($numericZero.OuterXml.Replace('REVISION>10','REVISION>11'),$numericZero.OuterXml.Replace('70 pack','71 pack'),$numericZero.OuterXml.Replace('NUMBER>0','NUMBER>1'))){
    [xml]$mismatch=$changed
    $zeroRejected=Convert-TallyEconomicEvidence $company $ledgers $products $blankFree $from $to @{} @{} $mismatch
    Assert-Economic ($zeroRejected.vouchers[0].amountStatus -eq 'unverified') 'Changed or nonzero Tally amount evidence accepted'
}
Assert-Economic ((Get-TallyEconomicNumericAmountCollection 'SUPRABHA DISTRIBUTORS' $from $to) -match 'EconomicVoucherRevision : \$\$Owner:\$AlterID') 'Numeric evidence export lacks revision binding'
Assert-Economic ((Get-TallyEconomicCollection 'SUPRABHA DISTRIBUTORS' 'CompanyTest' 'Company' 'Name,GUID' $from $to) -match 'EconomicCompany') 'Company export lacks canonical company filter'
[xml]$custom=$vouchers.OuterXml.Replace('<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>','<VOUCHERTYPENAME>Lab Sales</VOUCHERTYPENAME>')
$unknown=Convert-TallyEconomicEvidence $company $ledgers $products $custom $from $to
Assert-Economic ($unknown.vouchers.Count -eq 1 -and $unknown.vouchers[0].amountStatus -eq 'unverified') 'Custom stock voucher silently omitted'
$mapped=Convert-TallyEconomicEvidence $company $ledgers $products $custom $from $to @{} @{'Lab Sales'='sale'}
Assert-Economic ($mapped.vouchers[0].amountStatus -eq 'verified' -and $mapped.vouchers[0].kind -eq 'sale') 'Verified custom voucher role was not applied'
$excluded=Convert-TallyEconomicEvidence $company $ledgers $products $custom $from $to @{} @{'Lab Sales'='non_economic'}
Assert-Economic ($excluded.vouchers.Count -eq 1 -and $excluded.vouchers[0].kind -eq 'non_economic' -and $excluded.vouchers[0].lines.Count -eq 0 -and $excluded.vouchers[0].classificationPolicy -eq 'explicit_non_economic_v1' -and $excluded.vouchers[0].voucherType -eq 'Lab Sales') 'Explicit non-economic document was lost or produced financial lines'
$excludedSummary=Get-EconomicPreflightSummary $excluded
Assert-Economic ($excludedSummary.explicitlyExcludedDocuments -eq 1 -and $excludedSummary.verifiedActiveVouchers -eq 0 -and -not $excludedSummary.extractionEvidenceComplete) 'Excluded-only evidence counted as verified economic supply'
$standardSale=Convert-TallyEconomicEvidence $company $ledgers $products $vouchers $from $to @{} @{'Sales'='non_economic'}
Assert-Economic ($standardSale.vouchers[0].kind -eq 'sale' -and $standardSale.vouchers[0].lines.Count -eq 1) 'Configuration silently excluded a standard economic sale'
$summary=Get-EconomicPreflightSummary $result
Assert-Economic ($summary.verifiedActiveVouchers -eq 1 -and $summary.extractionEvidenceComplete -and -not $summary.financialReleaseCertified) 'Extraction preflight incorrectly certified financial release'
$summaryJson=$summary | ConvertTo-Json -Depth 5
Assert-Economic ($summaryJson -notmatch 'customer-guid|product-guid|voucher-guid|5000000|Customer A') 'Aggregate preflight leaked financial source data'
$unknownSummary=Get-EconomicPreflightSummary $unknown
Assert-Economic ($unknownSummary.unverifiedVouchers -eq 1 -and -not $unknownSummary.extractionEvidenceComplete) 'Unverified preflight reported complete evidence'
$unknown.vouchers[0].error='Unexpected private invoice value 12345.67 for Customer A'
$privateSummary=Get-EconomicPreflightSummary $unknown | ConvertTo-Json -Depth 5
Assert-Economic ($privateSummary -notmatch '12345.67|Customer A') 'Unexpected exception text leaked into aggregate preflight'
$cancelSummary=Get-EconomicPreflightSummary $cleared
Assert-Economic ($cancelSummary.verifiedCancellations -eq 1 -and -not $cancelSummary.extractionEvidenceComplete) 'Cancellation-only preflight reported usable sales evidence'
$draftRoles=Convert-EconomicPolicyDraft '{"state":"proposed_requires_accounts_approval","companyName":"SUPRABHA DISTRIBUTORS","ledgerRoles":{"round-guid":"rounding"},"voucherRoles":{"Quote":"non_economic"}}' 'SUPRABHA DISTRIBUTORS'
Assert-Economic ($draftRoles.LedgerRoles['round-guid'] -eq 'rounding' -and $draftRoles.VoucherRoles['Quote'] -eq 'non_economic') 'Read-only draft roles were not parsed'
foreach($badDraft in @('{"state":"active","companyName":"SUPRABHA DISTRIBUTORS","ledgerRoles":{},"voucherRoles":{}}','{"state":"proposed_requires_accounts_approval","companyName":"Other Company","ledgerRoles":{},"voucherRoles":{}}','{"state":"proposed_requires_accounts_approval","companyName":"SUPRABHA DISTRIBUTORS","ledgerRoles":[],"voucherRoles":{}}')){
    $draftRejected=$false
    try{Convert-EconomicPolicyDraft $badDraft 'SUPRABHA DISTRIBUTORS' | Out-Null}catch{$draftRejected=$true}
    Assert-Economic $draftRejected 'Foreign, activated or invalid policy draft accepted'
}
Write-Output 'PASS: economic connector GUIDs, net GST-free amounts, discounts, renames, units, cancellation and FOC'


[xml]$groupMasters='<ENVELOPE><STOCKGROUP NAME="Chemistry"><GUID>group-chem</GUID><PARENT>Primary</PARENT></STOCKGROUP><STOCKGROUP NAME="Reagents"><GUID>group-reagents</GUID><PARENT>Chemistry</PARENT></STOCKGROUP><STOCKGROUP NAME="Other"><GUID>group-other</GUID><PARENT>Primary</PARENT></STOCKGROUP></ENVELOPE>'
[xml]$groupProducts='<ENVELOPE><STOCKITEM NAME="Reagent A"><GUID>product-a</GUID><PARENT>Reagents</PARENT><BASEUNITS>pack</BASEUNITS></STOCKITEM><STOCKITEM NAME="Outside"><GUID>product-outside</GUID><PARENT>Other</PARENT><BASEUNITS>pack</BASEUNITS></STOCKITEM></ENVELOPE>'
$groupMasters=ConvertFrom-TallyEconomicXml $groupMasters.OuterXml.Replace('<ENVELOPE>','<ENVELOPE><CMPINFO><STOCKGROUP>3</STOCKGROUP></CMPINFO>')
$groupProducts=ConvertFrom-TallyEconomicXml $groupProducts.OuterXml.Replace('<ENVELOPE>','<ENVELOPE><CMPINFO><STOCKITEM>2</STOCKITEM></CMPINFO>')
$groupCatalog=Convert-TallyEconomicItemCatalog $groupProducts $groupMasters
Assert-Economic ($groupCatalog.groups.Count -eq 3 -and $groupCatalog.products.Count -eq 2) 'Group catalog omitted masters without a sale'
Assert-Economic (($groupCatalog.groups | Where-Object id -eq 'group-reagents').parentId -eq 'group-chem') 'Group parent did not resolve to canonical GUID'
Assert-Economic (($groupCatalog.products | Where-Object id -eq 'product-a').groupId -eq 'group-reagents') 'Product membership did not resolve to canonical GUID'
foreach($badGroups in @($groupMasters.OuterXml.Replace('<GUID>group-other</GUID>','<GUID>group-chem</GUID>'),$groupMasters.OuterXml.Replace('<PARENT>Primary</PARENT>','<PARENT>Reagents</PARENT>'),$groupMasters.OuterXml.Replace('<GUID>group-chem</GUID>',''))){
    $rejected=$false;try{Convert-TallyEconomicItemCatalog $groupProducts ([xml]$badGroups) | Out-Null}catch{$rejected=$true}
    Assert-Economic $rejected 'Invalid canonical group identity or hierarchy accepted'
}
$rejected=$false;try{Convert-TallyEconomicItemCatalog ([xml]$groupProducts.OuterXml.Replace('<PARENT>Reagents</PARENT>','<PARENT>Unknown</PARENT>')) $groupMasters | Out-Null}catch{$rejected=$true}
Assert-Economic $rejected 'Unknown product-group membership was silently ignored'
Write-Output 'PASS: canonical item-group catalog and parent/product identity guards'

# Cost history needs older sales as well as purchases, so consumed stock is not reused.
. (Join-Path $PSScriptRoot '../desktop-connector/recovery.ps1')
$script:tallyRequests=New-Object System.Collections.Generic.List[string]
function Invoke-Tally([string]$Body,[int]$TimeoutSeconds,[string]$MetricName){
    $script:tallyRequests.Add($Body)
    $collection='<COLLECTION></COLLECTION>'
    if($Body -match '<TYPE>Company</TYPE>'){ return '<ENVELOPE>'+$collection+'<COMPANY NAME="SUPRABHA DISTRIBUTORS"><GUID>company-guid-1</GUID></COMPANY></ENVELOPE>' }
    if($Body -match '<TYPE>Ledger</TYPE>'){ return '<ENVELOPE>'+$collection+$ledgers.ENVELOPE.InnerXml+'</ENVELOPE>' }
    if($Body -match '<TYPE>StockItem</TYPE>'){ return '<ENVELOPE>'+$collection+$products.ENVELOPE.InnerXml+'<STOCKITEM NAME="Unrelated"><GUID>unrelated-product</GUID><BASEUNITS>pack</BASEUNITS></STOCKITEM></ENVELOPE>' }
    if($Body -match '<ID>EconomicVouchers</ID>' -and $Body -match '<SVFROMDATE TYPE="Date">(\d{8})</SVFROMDATE>'){
        $date=$Matches[1]
        $sale=$vouchers.ENVELOPE.InnerXml.Replace('<DATE>20260915</DATE>','<DATE>'+$date+'</DATE>').Replace('voucher-guid-1','sale-'+$date)
        $purchase=$sale.Replace('<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>','<VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>').Replace('sale-'+$date,'purchase-'+$date)
        $purchase=$purchase.Replace('<AMOUNT>50000.00</AMOUNT>','<AMOUNT>-50000.00</AMOUNT>').Replace('<AMOUNT>-59000.00</AMOUNT>','<AMOUNT>59000.00</AMOUNT>').Replace('<AMOUNT>9000.00</AMOUNT>','<AMOUNT>-9000.00</AMOUNT>')
        $unrelated=''
        if($date -lt [datetime]::new((Get-Date).Year,(Get-Date).Month,1).AddMonths(-1).ToString('yyyyMMdd')){
            $unrelated=($sale+$purchase).Replace('Reagent A','Unrelated').Replace('sale-'+$date,'unrelated-sale-'+$date).Replace('purchase-'+$date,'unrelated-purchase-'+$date)
        }
        return '<ENVELOPE>'+$collection+$sale+$purchase+$unrelated+'</ENVELOPE>'
    }
    return '<ENVELOPE>'+$collection+'</ENVELOPE>'
}
$history=Read-TallyEconomicEvidence 'SUPRABHA DISTRIBUTORS' 1 @{} @{} 3
$monthStart=[datetime]::new((Get-Date).Year,(Get-Date).Month,1)
$older=@($history.vouchers | Where-Object { [string]$_.sourceId -match '^(sale|purchase)-(\d{8})$' -and [datetime]::ParseExact($Matches[2],'yyyyMMdd',$null) -lt $monthStart.AddMonths(-1) })
Assert-Economic ($older.Count -eq 4 -and @($older | Where-Object kind -eq 'purchase').Count -eq 2 -and @($older | Where-Object kind -eq 'sale').Count -eq 2) 'Cost history omitted earlier stock consumption or purchases'
Assert-Economic (@($history.vouchers | Where-Object { $_.sourceId -like 'sale-*' }).Count -eq 3) 'Older sales were discarded from cost history'
Assert-Economic (@($history.vouchers | Where-Object { $_.sourceId -like 'unrelated-*' }).Count -eq 0) 'Unrelated older sales or purchases were retained unnecessarily'
Assert-Economic ($history.purchaseHistoryFrom -eq $monthStart.AddMonths(-3).ToString('yyyy-MM-dd') -and $history.windowFrom -eq $monthStart.AddMonths(-1).ToString('yyyy-MM-dd')) 'Purchase history window not recorded separately from the main window'
Assert-Economic (@($script:tallyRequests | Where-Object { $_ -match '<ID>EconomicVouchers</ID>' }).Count -eq 3) 'Purchase history was not exported one month at a time'
$script:tallyRequests.Clear()
$plain=Read-TallyEconomicEvidence 'SUPRABHA DISTRIBUTORS' 1 @{} @{}
Assert-Economic (-not $plain.Contains('purchaseHistoryFrom') -and @($script:tallyRequests | Where-Object { $_ -match '<ID>EconomicVouchers</ID>' }).Count -eq 1) 'Purchase history ran when it was not requested'
Write-Output 'PASS: cost history retains relevant purchases and earlier consumption, excluding unrelated history'

# Each month's bounded export must not bypass the combined upload bound.
$savedConverter=${function:Convert-TallyEconomicEvidence}
try{
    function Convert-TallyEconomicEvidence {
        [ordered]@{vouchers=@(1..700 | ForEach-Object { [ordered]@{kind='sale';amountStatus='verified';lines=@(@{productId='product-guid-1'})} });windowFrom='2026-09-01';windowTo='2026-10-01'}
    }
    $bounded=$false
    try{Read-TallyEconomicEvidence 'SUPRABHA DISTRIBUTORS' 1 @{} @{} 3 | Out-Null}catch{$bounded=$_.Exception.Message -eq 'Combined economic cost history exceeds 2000 vouchers; narrow the history window.'}
    Assert-Economic $bounded 'Separate monthly exports bypassed the combined voucher bound'
}finally{Set-Item Function:Convert-TallyEconomicEvidence $savedConverter}
Write-Output 'PASS: combined monthly history fails explicitly above the upload bound'
