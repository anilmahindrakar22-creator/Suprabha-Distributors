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
$debitLedgers=ConvertFrom-TallyEconomicXml ($ledgers.OuterXml.Replace('</ENVELOPE>','<LEDGER NAME="Purchase"><GUID>purchase-guid-1</GUID><PARENT>Purchase Accounts</PARENT></LEDGER></ENVELOPE>'))
[xml]$purchaseDebit=$vouchers.OuterXml.Replace('<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>','<VOUCHERTYPENAME>Debit Note</VOUCHERTYPENAME>').Replace('<LEDGERNAME>Sales</LEDGERNAME>','<LEDGERNAME>Purchase</LEDGERNAME>')
$nativeDebit=Convert-TallyEconomicEvidence $company $debitLedgers $products $purchaseDebit $from $to
Assert-Economic ($nativeDebit.vouchers[0].amountStatus -eq 'verified' -and $nativeDebit.vouchers[0].kind -eq 'purchase_return') 'Native purchase Debit Note was not accepted as supplier stock return'
Assert-Economic ($nativeDebit.vouchers[0].lines[0].quantity -eq '-70' -and $nativeDebit.vouchers[0].lines[0].netSalesPaise -eq '-5000000' -and $nativeDebit.vouchers[0].taxPaise -eq '-900000') 'Supplier return lost recorded signed economics or included GST'
Assert-Economic ($nativeDebit.vouchers[0].nativeTradeSide -eq 'purchase' -and $nativeDebit.vouchers[0].lines[0].nativeInventoryAmountPaise -eq '5000000') 'Debit Note native classification/amount evidence missing'
Assert-Economic ($nativeDebit.vouchers[0].nativePartySourceId -eq 'customer-guid-1' -and -not $nativeDebit.vouchers[0].Contains('customerSourceId')) 'Supplier canonical identity was lost or misrepresented as customer revenue'
[xml]$salesDebit=$vouchers.OuterXml.Replace('<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>','<VOUCHERTYPENAME>Debit Note</VOUCHERTYPENAME>')
$nativeSalesDebit=Convert-TallyEconomicEvidence $company $ledgers $products $salesDebit $from $to
Assert-Economic ($nativeSalesDebit.vouchers[0].amountStatus -eq 'verified' -and $nativeSalesDebit.vouchers[0].kind -eq 'sale' -and $nativeSalesDebit.vouchers[0].lines[0].netSalesPaise -eq '5000000') 'Native sales Debit Note was incorrectly treated as supplier return'
[xml]$valueDebit=$salesDebit.OuterXml.Replace('70 pack','0 pack')
$nativeValueDebit=Convert-TallyEconomicEvidence $company $ledgers $products $valueDebit $from $to
Assert-Economic ($nativeValueDebit.vouchers[0].amountStatus -eq 'unverified' -and $nativeValueDebit.vouchers[0].error -match 'original-sale linkage') 'Sales value-only Debit Note guessed an original instrument or zero new cost'
[xml]$freeDebit=$purchaseDebit.OuterXml.Replace('50000.00','0.00').Replace('-59000.00','0.00').Replace('9000.00','0.00')
$nativeFreeDebit=Convert-TallyEconomicEvidence $company $debitLedgers $products $freeDebit $from $to
Assert-Economic ($nativeFreeDebit.vouchers[0].amountStatus -eq 'verified' -and $nativeFreeDebit.vouchers[0].lines[0].quantity -eq '-70' -and $nativeFreeDebit.vouchers[0].lines[0].netSalesPaise -eq '0') 'Zero-value supplier return lost its stock movement'
[xml]$mixedDebit=$purchaseDebit.OuterXml.Replace('</VOUCHER>','<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>1.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>')
$nativeMixed=Convert-TallyEconomicEvidence $company $debitLedgers $products $mixedDebit $from $to
Assert-Economic ($nativeMixed.vouchers[0].amountStatus -eq 'unverified' -and $nativeMixed.vouchers[0].date -eq '2026-09-15') 'Mixed Debit Note was guessed or lost its native date'
[xml]$clearedDebit='<ENVELOPE><VOUCHER><GUID>debit-cancel-guid</GUID><ALTERID>12</ALTERID><DATE>20260915</DATE><VOUCHERTYPENAME>Debit Note</VOUCHERTYPENAME><ISCANCELLED>Yes</ISCANCELLED></VOUCHER></ENVELOPE>'
$nativeCancelledDebit=Convert-TallyEconomicEvidence $company $ledgers $products $clearedDebit $from $to
Assert-Economic ($nativeCancelledDebit.vouchers[0].amountStatus -eq 'verified' -and $nativeCancelledDebit.vouchers[0].cancelled -and $nativeCancelledDebit.vouchers[0].lines.Count -eq 0) 'Cleared cancelled Debit Note required invented trade/stock entries'
Assert-Economic (@($result.customerLedgers | Where-Object {$_.name -ceq 'Customer A' -and $_.guid -ceq 'customer-guid-1'}).Count -eq 1) 'Canonical customer ledger identities were not exported'
[xml]$subgroupLedgers=$ledgers.OuterXml.Replace('<GUID>customer-guid-1</GUID>','<GUID>customer-guid-1</GUID><PARENT>Local Hospitals</PARENT>')
$subgroup=Convert-TallyEconomicEvidence $company $subgroupLedgers $products $vouchers $from $to
Assert-Economic (@($subgroup.customerLedgers | Where-Object {$_.guid -ceq 'customer-guid-1'}).Count -eq 1) 'Custom debtor subgroups lost canonical ledger references'
[xml]$missingLedger=$ledgers.OuterXml.Replace('</ENVELOPE>','<LEDGER NAME="Incomplete" /></ENVELOPE>')
$missingMaster=Convert-TallyEconomicEvidence $company $missingLedger $products $vouchers $from $to
Assert-Economic ($null -eq $missingMaster.customerLedgers -and $missingMaster.customerLedgerError -and $missingMaster.vouchers[0].amountStatus -eq 'verified') 'Incomplete master list was silently published or discarded verified vouchers'
[xml]$aliasLedger=$ledgers.OuterXml.Replace('</ENVELOPE>','<LEDGER NAME="Alias"><GUID>customer-guid-1</GUID></LEDGER></ENVELOPE>')
$aliasMaster=Convert-TallyEconomicEvidence $company $aliasLedger $products $vouchers $from $to
Assert-Economic ($null -eq $aliasMaster.customerLedgers -and $aliasMaster.customerLedgerError) 'Duplicate GUID names were exported as customer suggestions'
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
foreach($invalidName in @('release-company-before','202604Vouchers','Bad<Name','Bad"Name','', 'Company_Test')){
    $rejected=$false
    try { Get-TallyEconomicCollection 'SUPRABHA DISTRIBUTORS' $invalidName 'Company' 'Name,GUID' $from $to | Out-Null }
    catch { $rejected=$_.Exception.Message -eq 'Economic collection name must start with a letter and contain only letters and digits.' }
    Assert-Economic $rejected 'Invalid TDL collection name was allowed to reach request transport'
}
$safeCompanyRequest=[xml](Get-TallyEconomicCollection 'SUPRABHA DISTRIBUTORS' 'StockFlowReleaseCompanyBefore' 'Company' 'Name,GUID' $from $to)
Assert-Economic ($safeCompanyRequest.ENVELOPE.HEADER.ID -ceq 'StockFlowReleaseCompanyBefore' -and $safeCompanyRequest.ENVELOPE.BODY.DESC.TDL.TDLMESSAGE.COLLECTION.NAME -ceq $safeCompanyRequest.ENVELOPE.HEADER.ID) 'TDL definition and export identity differ'
Write-Output 'PASS: invalid TDL names fail before transport; safe collection identity matches its definition'
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

# Coverage uses an explicit IST clock, independent of the office/CI timezone.
$coverageNow=[datetimeoffset]'2026-10-30T22:00:00+05:30'
$window=Get-SalesCoverageWindow $coverageNow
Assert-Economic ($window.From.ToString('yyyy-MM-dd') -eq '2026-07-01' -and $window.To.ToString('yyyy-MM-dd') -eq '2026-10-01') 'Coverage window is not three complete IST months'
$request=Get-TallyEconomicCollection 'SUPRABHA DISTRIBUTORS' 'EconomicVouchers' 'Voucher' $script:EconomicVoucherFetch $window.From $window.To
Assert-Economic ($request -match '<SVTODATE TYPE="Date">20260930</SVTODATE>') 'Inclusive Tally end was not September 30'
$prior=@{lastSalesCoverageDate='2026-10-29'}
Assert-Economic (-not (Test-SalesCoverageDue $prior ([datetimeoffset]'2026-10-30T21:59:00+05:30'))) 'Coverage ran before 22:00'
Assert-Economic (Test-SalesCoverageDue $prior $coverageNow) 'Coverage did not run at 22:00'
Assert-Economic (-not (Test-SalesCoverageDue @{lastSalesCoverageDate='2026-10-30'} $coverageNow)) 'Coverage repeated on the same IST day'
Assert-Economic (Test-SalesCoverageDue $prior ([datetimeoffset]'2026-10-31T09:00:00+05:30')) 'Missed day did not catch up'
Assert-Economic (Test-SalesCoverageDue @{firstObservedDate='2026-10-30'} ([datetimeoffset]'2026-10-31T09:00:00+05:30')) 'First missed night did not catch up'
$stateTest=Join-Path ([IO.Path]::GetTempPath()) ('sales-coverage-'+[guid]::NewGuid().ToString('N')+'.json')
try{
    Save-ConnectorSnapshot $stateTest @{company='fixture';lastSalesCoverageDate='2026-10-29'}
    Save-ConnectorSnapshot $stateTest @{company='fixture';lastSalesCoverageDate='2026-10-30'}
    $persisted=Read-SalesCoverageState $stateTest 'fixture'
    Assert-Economic ($persisted.lastSalesCoverageDate -eq '2026-10-30' -and -not (Test-SalesCoverageDue $persisted $coverageNow)) 'Coverage state did not persist'
    Assert-Economic ($null -eq (Read-SalesCoverageState $stateTest 'other')) 'Coverage state crossed companies'
}finally{foreach($path in @($stateTest,"$stateTest.bak")){if([IO.File]::Exists($path)){[IO.File]::Delete($path)}}}
Write-Output 'PASS: IST coverage window, inclusive Tally end, daily schedule, catch-up and atomic state'

$controlLedger='<LEDGER NAME="Sales"><GUID>sales-guid</GUID><OPENINGBALANCE>1000000.00</OPENINGBALANCE><CLOSINGBALANCE>1250000.00</CLOSINGBALANCE></LEDGER>'
$control=Convert-TallySalesControlMonth ([xml]('<ENVELOPE><COLLECTION>'+$controlLedger+'</COLLECTION></ENVELOPE>')) $window.From
Assert-Economic ($control.month -eq '2026-07' -and $control.salesLedgers[0].openingPaise -eq 100000000 -and $control.salesLedgers[0].closingPaise -eq 125000000 -and $control.salesLedgers[0].netPaise -eq 25000000) 'Sales movement sign or opening subtraction is incorrect'
$reversed=Convert-TallySalesControlMonth ([xml]('<ENVELOPE><COLLECTION>'+$controlLedger.Replace('1250000.00','750000.00')+'</COLLECTION></ENVELOPE>')) $window.From
Assert-Economic ($reversed.salesLedgers[0].netPaise -eq -25000000) 'Returns were made positive by absolute value'
$tooManyLedgers='<ENVELOPE><COLLECTION>'+($controlLedger*501)+'</COLLECTION></ENVELOPE>'
$rejected=$false;try{Convert-TallySalesControlMonth ([xml]$tooManyLedgers) $window.From | Out-Null}catch{$rejected=$_.Exception.Message -eq 'Sales control month exceeds 500 ledgers'}
Assert-Economic $rejected 'Sales control bound was not enforced'
Write-Output 'PASS: July native control movement, sign and 500-ledger bound'

$script:coverageVoucherXml=$vouchers.ENVELOPE.InnerXml
$script:coverageVoucherXml+=$vouchers.ENVELOPE.InnerXml.Replace('voucher-guid-1','cancelled').Replace('<VOUCHER>','<VOUCHER><ISCANCELLED>Yes</ISCANCELLED>')
$script:coverageVoucherXml+='<VOUCHER><GUID>banking</GUID><ALTERID>1</ALTERID><DATE>20260701</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME></VOUCHER>'
$script:coverageVoucherXml+='<VOUCHER><GUID>optional</GUID><ALTERID>1</ALTERID><DATE>20260930</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><ISOPTIONAL>Yes</ISOPTIONAL></VOUCHER>'
$script:tallyRequests.Clear()
function Invoke-Tally([string]$Body,[int]$TimeoutSeconds,[string]$MetricName){
    Assert-Economic ($TimeoutSeconds -eq 30 -and $MetricName -eq 'sales_coverage') 'Coverage request lost timeout or metric'
    $script:tallyRequests.Add($Body)
    $content=''
    if($Body -match '<TYPE>Company</TYPE>'){$content='<COMPANY NAME="SUPRABHA DISTRIBUTORS"><GUID>company-guid-1</GUID></COMPANY>'}
    elseif($Body -match '<ID>SalesCoverageLedgers</ID>'){$content=$controlLedger}
    elseif($Body -match '<TYPE>Ledger</TYPE>'){$content=$ledgers.ENVELOPE.InnerXml}
    elseif($Body -match '<TYPE>StockItem</TYPE>'){$content=$products.ENVELOPE.InnerXml}
    elseif($Body -match '<ID>EconomicVouchers</ID>'){$content=$script:coverageVoucherXml}
    return '<ENVELOPE><COLLECTION>'+$content+'</COLLECTION></ENVELOPE>'
}
$coverage=Read-TallySalesCoverage 'SUPRABHA DISTRIBUTORS' @{} @{} $coverageNow
Assert-Economic ($coverage.economicEvidence.purpose -eq 'sales_coverage' -and $coverage.economicEvidence.completeWindow -and $coverage.economicEvidence.vouchers.Count -eq 3) 'Coverage dropped non-economic or cancelled vouchers, or retained an optional voucher'
Assert-Economic (@($coverage.economicEvidence.vouchers | Where-Object sourceId -eq 'optional').Count -eq 0) 'Coverage retained an optional voucher'
$coverageVersion=[datetimeoffset]::MinValue
Assert-Economic ([datetimeoffset]::TryParseExact($coverage.economicEvidence.sourceVersion,'o',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$coverageVersion)) 'Coverage sourceVersion is not an ISO timestamp'
Assert-Economic (@($coverage.economicEvidence.vouchers | Where-Object {$_.date -lt '2026-07-01' -or $_.date -ge '2026-10-01'}).Count -eq 0) 'Coverage included dates outside its window'
Assert-Economic (@($coverage.economicEvidence.vouchers | Where-Object cancelled).Count -eq 1 -and @($coverage.economicEvidence.vouchers | Where-Object amountStatus -eq 'unverified').Count -eq 1) 'Coverage lost cancellation or unverified evidence'
Assert-Economic ($coverage.salesControlTotals.months.Count -eq 3 -and $coverage.salesControlTotals.sourceVersion -eq $coverage.economicEvidence.sourceVersion -and -not $coverage.salesControlTotals.months[0].Contains('customers')) 'Controls lost generation binding or guessed customer controls'
$controlRequests=@($script:tallyRequests | Where-Object {$_ -match '<ID>SalesCoverageLedgers</ID>'})
Assert-Economic ($controlRequests.Count -eq 3 -and $controlRequests[0] -match '<SVFROMDATE TYPE="Date">20260701</SVFROMDATE>' -and $controlRequests[0] -match '<SVTODATE TYPE="Date">20260731</SVTODATE>' -and $controlRequests[0] -match '<CHILDOF>Sales Accounts</CHILDOF><BELONGSTO>Yes</BELONGSTO>') 'Monthly controls did not request the native group and period'
foreach($badDate in @('20260630','20261001')){
    $script:coverageVoucherXml=$vouchers.ENVELOPE.InnerXml.Replace('20260915',$badDate)
    $rejected=$false;try{Read-TallySalesCoverage 'SUPRABHA DISTRIBUTORS' @{} @{} $coverageNow | Out-Null}catch{$rejected=$_.Exception.Message -eq 'Tally ignored the sales coverage date window.'}
    Assert-Economic $rejected 'Coverage accepted out-of-window source vouchers'
}
$script:coverageVoucherXml=$vouchers.ENVELOPE.InnerXml*1801
$rejected=$false;try{Read-TallySalesCoverage 'SUPRABHA DISTRIBUTORS' @{} @{} $coverageNow | Out-Null}catch{$rejected=$_.Exception.Message -eq 'Sales coverage window exceeds 1800 vouchers'}
Assert-Economic $rejected 'Coverage truncated or accepted more than 1800 vouchers'
Write-Output 'PASS: ISO coverage version bound to controls; optional vouchers skipped; accounting-only and cancelled vouchers retained; bounds and dates'

# Extract only the real transport function; never start the dashboard or contact Tally.
$dashboardPath=Join-Path $PSScriptRoot '../desktop-connector/dashboard.ps1'
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($dashboardPath,[ref]$tokens,[ref]$parseErrors)
Assert-Economic ($parseErrors.Count -eq 0) 'Dashboard parser errors'
$economicAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../desktop-connector/economics.ps1'),[ref]$tokens,[ref]$parseErrors)
Assert-Economic ($parseErrors.Count -eq 0) 'Economics parser errors'
$transport=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-Tally'},$true)
Invoke-Expression $transport.Extent.Text
$script:networkCalls=0;$script:healthLines=@();$script:tallyFailures=@{}
function Write-ConnectorHealth([string]$Line){$script:healthLines+=,$Line}
function Invoke-WebRequest { $script:networkCalls++;return @{Content='fixture';RawContentLength=7} }
foreach($unsafe in @('<TALLYREQUEST>Import</TALLYREQUEST>','<TALLYREQUEST>Export</TALLYREQUEST><VOUCHER ACTION="Create"/>','<TALLYREQUEST>Export</TALLYREQUEST><TALLYREQUEST>Export</TALLYREQUEST>','<TALLYREQUEST>Export</TALLYREQUEST><IMPORTDATA/>')){
    $rejected=$false;try{Invoke-Tally $unsafe | Out-Null}catch{$rejected=$_.Exception.Message -eq 'Refused: StockFlow only reads from Tally'}
    Assert-Economic $rejected 'Read-only transport accepted a write or ambiguous request'
}
Assert-Economic ($script:networkCalls -eq 0 -and $script:healthLines.Count -eq 4) 'Refused request reached transport or lacked health line'
Assert-Economic ($request -match 'AlterID' -and (Invoke-Tally $request) -eq 'fixture' -and $script:networkCalls -eq 1) 'Read-only guard rejected real AlterID export'
Assert-Economic ((Invoke-Tally '<TALLYREQUEST>  eXpOrT </TALLYREQUEST>') -eq 'fixture') 'Guard rejected case-insensitive trimmed Export'
Write-Output 'PASS: both PowerShell parsers; read-only guard rejects before network and accepts AlterID exports'

# Exercise the real acknowledgement path with an in-memory HTTP stub.
$publisher=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Publish-CloudSnapshot'},$true)
Invoke-Expression $publisher.Extent.Text
$dropper=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Remove-PendingSalesCoverage'},$true)
Invoke-Expression $dropper.Extent.Text
$salesCoverageStatePath=Join-Path ([IO.Path]::GetTempPath()) ('coverage-receipt-'+[guid]::NewGuid().ToString('N')+'.json')
$uploadStatePath=$salesCoverageStatePath+'.upload'
$companyName='fixture';$cloudSyncUrl='https://fixture.invalid';$cloudUploadKey='fixture'
$script:uploadState=@{company='fixture';rejectedPayloadHash=$null;blockedKeyHash=$null}
$script:cloudUploadFailures=0;$script:salesCoverageState=$null;$script:failCloud=$true
function Invoke-WebRequest { if($script:failCloud){throw 'fixture offline'};return @{Content='ok';RawContentLength=2} }
$uploadJson=@{economicEvidence=$coverage.economicEvidence;salesControlTotals=$coverage.salesControlTotals;salesCoverageDate='2026-10-30'} | ConvertTo-Json -Depth 12 -Compress
try{
    Assert-Economic (-not (Publish-CloudSnapshot $uploadJson)) 'Failed cloud upload was accepted'
    Assert-Economic (-not [IO.File]::Exists($salesCoverageStatePath) -and $null -eq $script:salesCoverageState) 'Failed cloud upload advanced coverage state'
    $script:failCloud=$false
    Assert-Economic (Publish-CloudSnapshot $uploadJson) 'Successful coverage upload was not acknowledged'
    $acknowledged=Read-SalesCoverageState $salesCoverageStatePath 'fixture'
    Assert-Economic ($acknowledged.lastSalesCoverageDate -eq '2026-10-30') 'Cloud acceptance did not persist daily coverage state'
    Assert-Economic (Publish-CloudSnapshot '{"economicEvidence":{"purpose":"normal"}}') 'Normal upload failed after coverage'
    Assert-Economic ((Read-SalesCoverageState $salesCoverageStatePath 'fixture').lastSalesCoverageDate -eq '2026-10-30') 'Normal upload changed coverage state'
}finally{
    foreach($path in @($salesCoverageStatePath,"$salesCoverageStatePath.bak",$uploadStatePath,"$uploadStatePath.bak")){if([IO.File]::Exists($path)){[IO.File]::Delete($path)}}
}
Write-Output 'PASS: coverage success persists only after cloud acceptance; failed and normal uploads do not advance it'

# Exercise fresh reads and retries through the real queue and publisher functions.
$getter=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-ReorderData'},$true)
Invoke-Expression $getter.Extent.Text
# Evaluate the production schedule expression with a deterministic IST clock.
$dueAssignment=$ast.Find({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$coverageDue'},$true)
$script:testCoverageNow=[datetimeoffset]'2026-10-30T22:00:00+05:30'
function Get-SalesCoverageClock([datetimeoffset]$Now=$script:testCoverageNow){return $Now.ToOffset([timespan]::FromMinutes(330))}
function Read-ReorderData {
    $script:freshStock++
    return [ordered]@{company='fixture';fetchedAtIso=[datetimeoffset]::UtcNow.ToString('o');tallyInvoices=@();stock=$script:freshStock;catalog=@('fresh catalog');pricingHistory=@{price=$script:freshStock};economicEvidence=@{purpose='normal'};salesControlTotals=$null;salesCoverageDate=$null;economicSyncError=$script:economicSyncError}
}
$snapshotPath=$salesCoverageStatePath+'.snapshot'
$SyncMinutes=15;$DisableSalesCoverage=$false
try {
    foreach($mode in @('three_failures','rejection','saved_rejection')) {
        $script:pendingUpload=$uploadJson | ConvertFrom-Json
        $script:pendingUploadJson=$uploadJson
        $script:uploadState=@{company='fixture';rejectedPayloadHash=$null;blockedKeyHash=$null}
        $script:salesCoverageUploadFailures=0;$script:salesCoverageUploadAttemptDate=$null
        $script:salesCoverageAttemptDate=$null;$script:salesCoverageState=@{lastSalesCoverageDate='2026-10-29'}
        $script:healthLines=@();$script:freshStock=10;$script:failCloud=$true
        $script:lastReorderData=$null;$script:nextReorderRead=Get-Date
        $fresh=Get-ReorderData
        $saved=Read-ConnectorSnapshot $snapshotPath 'fixture'
        $queued=$script:pendingUploadJson | ConvertFrom-Json
        Assert-Economic ($fresh.stock -eq 11 -and $saved.stock -eq 11 -and $queued.stock -eq 11 -and $queued.catalog[0] -eq 'fresh catalog' -and $queued.pricingHistory.price -eq 11) 'Pending coverage held back fresh stock, catalog or prices'
        Assert-Economic ($queued.economicEvidence.sourceVersion -eq $coverage.economicEvidence.sourceVersion -and $saved.economicEvidence.purpose -eq 'sales_coverage' -and $queued.salesControlTotals.sourceVersion -eq $coverage.economicEvidence.sourceVersion -and $queued.salesCoverageDate -eq '2026-10-30') 'Fresh snapshot did not carry the complete coverage generation'
        if($mode -eq 'three_failures') {
            foreach($attempt in 1..3) {
                Assert-Economic (-not (Publish-CloudSnapshot $script:pendingUploadJson)) 'Offline upload succeeded'
                Assert-Economic ($script:salesCoverageUploadFailures -eq $attempt -and $script:salesCoverageUploadAttemptDate -eq '2026-10-30') 'Coverage failure count or date was lost'
                if($attempt -lt 3) {
                    $script:nextReorderRead=Get-Date
                    $fresh=Get-ReorderData
                    Assert-Economic ($fresh.stock -eq (11+$attempt) -and $fresh.economicEvidence.purpose -eq 'sales_coverage') 'Retry froze stock or lost coverage'
                }
            }
        } elseif($mode -eq 'rejection') {
            function Get-ConnectorUploadFailureCode { return 'http_400' }
            Assert-Economic (-not (Publish-CloudSnapshot $script:pendingUploadJson)) 'Rejected upload succeeded'
            Assert-Economic ($script:salesCoverageUploadFailures -eq 1) 'Rejection required more than one attempt'
        } else {
            $script:uploadState.rejectedPayloadHash=Get-StableEvidenceVersion $script:pendingUploadJson
            Assert-Economic (-not (Publish-CloudSnapshot $script:pendingUploadJson)) 'Previously rejected payload was accepted'
        }
        $queued=$script:pendingUploadJson | ConvertFrom-Json
        foreach($key in @('economicEvidence','salesControlTotals','salesCoverageDate')) {
            Assert-Economic ($null -eq $queued.PSObject.Properties[$key]) "Dropped payload retained $key"
        }
        Assert-Economic ($queued.stock -eq $script:freshStock -and -not $script:uploadPayloadBlocked) 'Dropping coverage lost stock or kept uploads blocked'
        Assert-Economic (@($script:healthLines | Where-Object {$_ -match 'request=sales_coverage status=dropped reason='}).Count -eq 1) 'Coverage drop health line missing or duplicated'
        Assert-Economic ($script:economicSyncError -eq 'Sales coverage upload dropped after repeated failure' -and $script:salesCoverageAttemptDate -eq '2026-10-30') 'Drop did not set error and daily attempt gate'
        $coverageNow=$script:testCoverageNow;$istDate=(Get-SalesCoverageClock $coverageNow).ToString('yyyy-MM-dd')
        Invoke-Expression $dueAssignment.Extent.Text
        Assert-Economic (-not $coverageDue) 'Dropped coverage ran again on the same IST day'
        $coverageNow=$script:testCoverageNow.AddDays(1);$istDate=(Get-SalesCoverageClock $coverageNow).ToString('yyyy-MM-dd')
        Invoke-Expression $dueAssignment.Extent.Text
        Assert-Economic $coverageDue 'Dropped coverage did not become due the next IST day'
        $script:failCloud=$false
        Assert-Economic (Publish-CloudSnapshot $script:pendingUploadJson) 'Stock could not upload after coverage was dropped'
        Write-Output "PASS: fresh stock and carried coverage; $mode drops coverage, logs health, unblocks stock and gates until next IST day"
    }
} finally {
    foreach($path in @($snapshotPath,"$snapshotPath.bak",$uploadStatePath,"$uploadStatePath.bak")){if([IO.File]::Exists($path)){[IO.File]::Delete($path)}}
}
