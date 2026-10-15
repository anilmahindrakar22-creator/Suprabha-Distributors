# Pure extraction helpers plus an explicit read-only Tally export. No startup effects.
function ConvertFrom-TallyEconomicXml([string]$Raw) {
    if ([string]::IsNullOrWhiteSpace($Raw) -or $Raw.Length -gt 32000000) { throw 'Economic XML is empty or exceeds the bounded export size.' }
    # Tally emits UDF-prefixed fields without declaring the prefix and numeric
    # character references such as &#4;. Preserve those values rather than strip them.
    $settings=[Xml.XmlReaderSettings]::new()
    $settings.CheckCharacters=$false
    $settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver=$null
    $settings.MaxCharactersInDocument=32000000
    $names=[Xml.NameTable]::new()
    $namespaces=[Xml.XmlNamespaceManager]::new($names)
    $namespaces.AddNamespace('UDF','TallyUDF')
    $context=[Xml.XmlParserContext]::new($names,$namespaces,$null,[Xml.XmlSpace]::None)
    $reader=$null
    try {
        $reader=[Xml.XmlReader]::Create([IO.StringReader]::new($Raw),$settings,$context)
        $document=[Xml.XmlDocument]::new()
        $document.XmlResolver=$null
        $document.Load($reader)
        return $document
    } catch { throw 'Economic Tally XML could not be parsed. No economic evidence was imported.' }
    finally { if($reader){$reader.Dispose()} }
}
function Get-EconomicXmlText($Node, [string]$Path) {
    $selected = $Node.SelectSingleNode($Path)
    if ($null -eq $selected) { return '' }
    return $selected.InnerText.Trim()
}
function Convert-EconomicAmount([string]$Value) {
    $text = $Value.Trim() -replace ',', ''
    if ($text -notmatch '^-?\d+(?:\.\d{1,2})?$') { throw 'Economic amount is not exact decimal currency.' }
    return [long]([decimal]$text * 100)
}
function Get-EconomicVoucherEntries($Voucher,[string]$Type) {
    # Tally may emit both aliases for the same collection. ALL is authoritative;
    # concatenating aliases doubles inventory, taxes and party balances.
    $all=$Voucher.SelectNodes('./ALL'+$Type+'ENTRIES.LIST')
    if($all.Count -gt 0){return $all}
    return $Voucher.SelectNodes('./'+$Type+'ENTRIES.LIST')
}
function Get-EconomicMasterIndex([xml]$Document, [string]$Type) {
    $index = @{}
    foreach ($node in $Document.SelectNodes("//$Type")) {
        $name = $node.GetAttribute('NAME').Trim()
        if (-not $name) { $name = Get-EconomicXmlText $node './NAME' }
        $guid = Get-EconomicXmlText $node './GUID'
        if (-not $name -or -not $guid) { continue }
        if ($index.ContainsKey($name) -and $index[$name].guid -ne $guid) { throw "Ambiguous $Type master identity." }
        $index[$name] = @{ guid=$guid; unit=(Get-EconomicXmlText $node './BASEUNITS'); tax=(Get-EconomicXmlText $node './TAXTYPE'); parent=(Get-EconomicXmlText $node './PARENT') }
    }
    return $index
}
function Convert-TallyEconomicItemCatalog([xml]$ProductDocument,[xml]$GroupDocument) {
    $groups=Get-EconomicMasterIndex $GroupDocument 'STOCKGROUP'
    $products=Get-EconomicMasterIndex $ProductDocument 'STOCKITEM'
    # CMPINFO also contains numeric STOCKGROUP/STOCKITEM counts, not masters.
    if($GroupDocument.SelectNodes('//STOCKGROUP[@NAME or NAME or GUID]').Count -ne $groups.Count -or $ProductDocument.SelectNodes('//STOCKITEM[@NAME or NAME or GUID]').Count -ne $products.Count){throw 'Item-group catalog contains missing or duplicate canonical master identities.'}
    if($groups.Count -gt 2000 -or $products.Count -gt 10000){throw 'Item-group catalog exceeds supported master limits.'}
    $seenGroups=@{};$seenProducts=@{}
    foreach($name in $groups.Keys){
        if($seenGroups.ContainsKey($groups[$name].guid)){throw 'Duplicate canonical item-group GUID.'}
        $seenGroups[$groups[$name].guid]=$true;$cursor=$name;$parents=@{}
        while($cursor -and $cursor -notmatch '^[\x04\s]*(?:Primary)?$'){
            if($parents.ContainsKey($cursor) -or $parents.Count -ge 64){throw 'Item-group hierarchy is cyclic or exceeds 64 levels.'}
            if(-not $groups.ContainsKey($cursor)){throw 'Canonical parent item-group is missing.'}
            $parents[$cursor]=$true;$cursor=$groups[$cursor].parent
        }
    }
    foreach($name in $products.Keys){
        if($seenProducts.ContainsKey($products[$name].guid) -or -not $products[$name].unit){throw 'Product GUID or base-unit catalog evidence is incomplete.'}
        $seenProducts[$products[$name].guid]=$true
    }
    $groupRows=[Collections.Generic.List[object]]::new();$productRows=[Collections.Generic.List[object]]::new()
    foreach($name in @($groups.Keys | Sort-Object)){
        $parent=$groups[$name].parent;$parentId=$null
        if($parent -and $parent -notmatch '^[\x04\s]*(?:Primary)?$'){
            if(-not $groups.ContainsKey($parent)){throw 'Canonical parent item-group is missing.'}
            $parentId=$groups[$parent].guid
        }
        $groupRows.Add(@{id=$groups[$name].guid;name=$name;parentId=$parentId})
    }
    foreach($name in @($products.Keys | Sort-Object)){
        $parent=$products[$name].parent;$groupId=$null
        if($parent -and $parent -notmatch '^[\x04\s]*(?:Primary)?$'){
            if(-not $groups.ContainsKey($parent)){throw 'Canonical product item-group is missing.'}
            $groupId=$groups[$parent].guid
        }
        $productRows.Add(@{id=$products[$name].guid;name=$name;groupId=$groupId;unit=$products[$name].unit})
    }
    return @{groups=@($groupRows | Sort-Object id);products=@($productRows | Sort-Object id)}
}
function Convert-TallyEconomicEvidence([xml]$CompanyDocument,[xml]$LedgerDocument,[xml]$ProductDocument,[xml]$VoucherDocument,[datetime]$From,[datetime]$To,[hashtable]$LedgerRoles=@{},[hashtable]$VoucherRoles=@{},[xml]$ZeroAmountDocument=$null,[xml]$GroupDocument=$null) {
    foreach($role in $LedgerRoles.GetEnumerator()){
        if(-not $role.Key -or $role.Value -notin @('gst','discount','rounding','charge','trade')){throw 'Economic ledger role configuration is invalid.'}
    }
    foreach($role in $VoucherRoles.GetEnumerator()){
        if(-not $role.Key -or $role.Value -notin @('sale','purchase','return','non_economic')){throw 'Economic voucher role configuration is invalid.'}
    }
    # Tally's CMPINFO also contains a COMPANY count; it is not a company master.
    if ($CompanyDocument.SelectNodes('//COMPANY[GUID or @NAME or NAME]').Count -ne 1) { throw 'Exactly one canonical Tally company must be selected.' }
    $company = Get-EconomicXmlText $CompanyDocument '//COMPANY/GUID'
    if (-not $company) { throw 'Tally company GUID unavailable; economic attribution is disabled.' }
    $ledgers = Get-EconomicMasterIndex $LedgerDocument 'LEDGER'
    $products = Get-EconomicMasterIndex $ProductDocument 'STOCKITEM'
    $zeroRows=@{}
    if($ZeroAmountDocument){
        foreach($row in $ZeroAmountDocument.SelectNodes('//COLLECTION/*')){
            $owner=Get-EconomicXmlText $row './ECONOMICVOUCHERID'
            $ownerRevision=Get-EconomicXmlText $row './ECONOMICVOUCHERREVISION'
            if(-not $owner -or $ownerRevision -notmatch '^\d+$'){throw 'Numeric amount evidence lacks canonical voucher revision.'}
            $ownerKey=$owner+'|'+$ownerRevision
            if(-not $zeroRows.ContainsKey($ownerKey)){$zeroRows[$ownerKey]=[Collections.Generic.List[object]]::new()}
            $zeroRows[$ownerKey].Add($row)
        }
    }
    $vouchers = [Collections.Generic.List[object]]::new()
    $seen = @{}
    foreach ($voucher in $VoucherDocument.SelectNodes('//VOUCHER')) {
        $type = Get-EconomicXmlText $voucher './VOUCHERTYPENAME'
        if ((Get-EconomicXmlText $voucher './ISOPTIONAL') -eq 'Yes') { continue }
        $kind = switch ($type) { 'Sales' {'sale'} 'GST SALE' {'sale'} 'Purchase' {'purchase'} 'Credit Note' {'return'} default {$VoucherRoles[$type]} }
        # Ordinary non-stock banking/accounting documents are outside this ledger.
        # Unknown stock documents must be visible exceptions, never silently omitted.
        $inventoryEntries=@(Get-EconomicVoucherEntries $voucher 'INVENTORY' | Where-Object { $_.SelectSingleNode('./STOCKITEMNAME | ./AMOUNT | ./ACTUALQTY | ./BILLEDQTY') })
        if (-not $kind -and $inventoryEntries.Count -eq 0) { continue }
        $id = Get-EconomicXmlText $voucher './GUID'
        $revision = Get-EconomicXmlText $voucher './ALTERID'
        $dateText = Get-EconomicXmlText $voucher './DATE'
        $cancelled = (Get-EconomicXmlText $voucher './ISCANCELLED') -eq 'Yes'
        $entry = [ordered]@{ sourceId=$id; revision=$revision; date=''; kind=$kind; cancelled=$cancelled; amountStatus='unverified'; lines=@(); sourceReference=(Get-EconomicXmlText $voucher './VOUCHERNUMBER') }
        $entry.voucherType=$type
        $entry.classificationPolicy=if($type -in @('Sales','GST SALE','Purchase','Credit Note')){'native_economic_v1'}else{'configured_economic_v1'}
        try {
            if ($kind -notin @('sale','purchase','return','non_economic')) { throw 'Unclassified inventory voucher type; configure its verified voucher role.' }
            if (-not $id -or $revision -notmatch '^\d+$') { throw 'Voucher GUID or AlterID unavailable.' }
            if ($seen.ContainsKey($id)) { throw 'Duplicate voucher GUID in economic export.' }
            $seen[$id] = $true
            $date = [datetime]::ParseExact($dateText,'yyyyMMdd',[Globalization.CultureInfo]::InvariantCulture)
            if ($date -lt $From.Date -or $date -ge $To.Date) { throw 'Tally ignored the economic date window.' }
            $entry.date = $date.ToString('yyyy-MM-dd')
            if($kind -eq 'non_economic'){
                $entry.classificationPolicy='explicit_non_economic_v1'
                $entry.exclusionReason='Explicitly configured non-economic document; excluded from revenue, GP and supply.'
                $entry.inventoryEntryCount=$inventoryEntries.Count
                $entry.amountStatus='verified';$vouchers.Add($entry);continue
            }
            # Cancelled vouchers can have their party and inventory cleared by Tally.
            # Their canonical identity/revision still reverses the prior economic event.
            if ($cancelled) { $entry.amountStatus='verified';$vouchers.Add($entry);continue }
            $party = Get-EconomicXmlText $voucher './PARTYLEDGERNAME'
            if ($entry.kind -ne 'purchase') {
                if (-not $ledgers.ContainsKey($party)) { throw 'Canonical customer GUID unavailable in the master export.' }
                $entry.customerSourceId = $ledgers[$party].guid
            }
            $direction = if ($entry.kind -eq 'purchase') { -1 } else { 1 }
            $lineNumber=0; $totalInventory=[long]0; $discount=[long]0; $rounding=[long]0; $tax=[long]0; $charges=[long]0; $partyTotal=[long]0
            $lines=[Collections.Generic.List[object]]::new()
            foreach ($line in $inventoryEntries) {
                $lineNumber++
                $name=Get-EconomicXmlText $line './STOCKITEMNAME'
                if (-not $products.ContainsKey($name)) { throw 'Canonical product GUID unavailable in the master export.' }
                $master=$products[$name]
                $qtyText=Get-EconomicXmlText $line './ACTUALQTY'
                if (-not $qtyText) { $qtyText=Get-EconomicXmlText $line './BILLEDQTY' }
                if ($qtyText -notmatch '^\s*(-?[\d,]+(?:\.\d{1,6})?)\s+(.+?)\s*$') { throw 'Quantity/base-unit evidence unavailable.' }
                $qty=[decimal]($matches[1] -replace ',','');$unit=$matches[2].Trim()
                if ($unit -ne $master.unit) { throw 'Alternative or composite unit requires a verified conversion.' }
                $nativeAmount=Get-EconomicXmlText $line './AMOUNT'
                $zeroEvidence=$null
                if(-not $nativeAmount -and $ZeroAmountDocument){
                    $ownerKey=$id+'|'+$revision
                    $rows=$zeroRows[$ownerKey]
                    if(-not $rows -or $rows.Count -ne $inventoryEntries.Count -or -not $line.SelectSingleNode('./AMOUNT')){throw 'Zero-value amount evidence does not match the voucher revision and inventory line.'}
                    $row=$rows[$lineNumber-1]
                    foreach($field in @('STOCKITEMNAME','ACTUALQTY','BILLEDQTY','AMOUNT')){
                        if((Get-EconomicXmlText $row ('./'+$field)) -ne (Get-EconomicXmlText $line ('./'+$field))){throw 'Zero-value amount evidence does not match the voucher revision and inventory line.'}
                    }
                    if((Get-EconomicXmlText $row './ECONOMICAMOUNTNUMBER') -ne '0'){throw 'Tally did not verify a zero-valued inventory amount.'}
                    $nativeAmount='0.00'
                    $zeroEvidence=[ordered]@{method='tally_numeric_zero_v1';voucherId=$id;revision=$revision;inventoryOrdinal=$lineNumber;sourceNumeric='0'}
                }
                $amount=(Convert-EconomicAmount $nativeAmount)*$direction
                if ($entry.kind -eq 'return') { $qty=-[Math]::Abs($qty) } else { $qty=[Math]::Abs($qty) }
                if (($entry.kind -in @('sale','purchase') -and $amount -lt 0) -or ($entry.kind -eq 'return' -and $amount -gt 0)) { throw 'Mixed economic signs require review.' }
                $totalInventory+=$amount
                $lines.Add([ordered]@{ lineKey=[string]$lineNumber; productId=$master.guid; quantity=$qty.ToString([Globalization.CultureInfo]::InvariantCulture); unit=$unit; netSalesPaise=[string]$amount; batchId=$(if($line.SelectNodes('./BATCHALLOCATIONS.LIST').Count -eq 1){Get-EconomicXmlText $line './BATCHALLOCATIONS.LIST/BATCHNAME'}else{$null}); focReason=$(if($amount -eq 0 -and $qty -gt 0){'UNKNOWN'}else{$null}); label=$name })
                if($zeroEvidence){$lines[$lines.Count-1].amountEvidence=$zeroEvidence}
            }
            if ($lines.Count -eq 0) { throw 'Accounting-only credit or voucher needs verified product/original-sale linkage.' }
            foreach ($ledgerLine in (Get-EconomicVoucherEntries $voucher 'LEDGER')) {
                $name=Get-EconomicXmlText $ledgerLine './LEDGERNAME'
                $amount=(Convert-EconomicAmount (Get-EconomicXmlText $ledgerLine './AMOUNT'))*$direction
                if ((Get-EconomicXmlText $ledgerLine './ISPARTYLEDGER') -eq 'Yes' -or $name -eq $party) { $partyTotal-=$amount;continue }
                if (-not $ledgers.ContainsKey($name)) { throw 'Ledger classification evidence unavailable.' }
                $master=$ledgers[$name]
                $role=$LedgerRoles[$master.guid]
                if (-not $role -and $master.tax -eq 'GST') { $role='gst' }
                if (-not $role -and $master.parent -in @('Sales Accounts','Purchase Accounts')) { $role='trade' }
                switch ($role) {
                    'gst' { $tax+=$amount }
                    'discount' { $discount+=$amount }
                    'rounding' { $rounding+=$amount }
                    'charge' { $charges+=$amount }
                    'trade' { }
                    default { if ($amount -ne 0) { throw 'Unclassified document adjustment; configure its canonical ledger role.' } }
                }
            }
            if ($partyTotal -ne $totalInventory+$tax+$discount+$rounding+$charges) { throw 'Inventory, GST, adjustments and party value do not reconcile.' }
            foreach($adjustment in @(@{amount=$discount;field='discountPaise'},@{amount=$rounding;field='roundingPaise'})) {
                if($adjustment.amount -eq 0){continue}
                if ($totalInventory -eq 0) { throw 'Cannot allocate a document adjustment over zero inventory value.' }
                $weights=@();$lastWeighted=-1
                for($i=0;$i -lt $lines.Count;$i++){
                    $weight=[long]$lines[$i].netSalesPaise
                    if($lines[$i].Contains('discountPaise')){$weight-=[long]$lines[$i].discountPaise}
                    $weights+=,$weight
                    if($weight -ne 0){$lastWeighted=$i}
                }
                $allocated=[long]0
                for ($i=0;$i -lt $lines.Count;$i++) {
                    $share=if($i -eq $lastWeighted){$adjustment.amount-$allocated}else{[long][Math]::Truncate([decimal]$adjustment.amount*[decimal]$weights[$i]/[decimal]$totalInventory)}
                    $allocated+=$share;$lines[$i][$adjustment.field]=[string]$share;$lines[$i].netSalesPaise=[string]([long]$lines[$i].netSalesPaise+$share)
                }
            }
            $entry.lines=$lines.ToArray();$entry.amountStatus='verified';$entry.taxPaise=[string]$tax;$entry.excludedChargesPaise=[string]$charges
        } catch { $entry.error=$_.Exception.Message }
        $vouchers.Add($entry)
    }
    if ($vouchers.Count -gt 2000) { throw 'Economic window exceeds 2000 vouchers; reduce EconomicHistoryMonths.' }
    $result=[ordered]@{ schemaVersion=1;companyId=$company;sourceVersion=[datetimeoffset]::UtcNow.ToString('o');completeWindow=$true;windowFrom=$From.ToString('yyyy-MM-dd');windowTo=$To.ToString('yyyy-MM-dd');vouchers=$vouchers.ToArray() }
    # Reuse the same canonical master index; active app customers and an explicit
    # person confirmation determine eligibility, never a ledger's display group.
    # Custom debtor subgroups must not disappear from the reference list.
    try {
        if($LedgerDocument.SelectNodes('//LEDGER[@NAME or NAME or GUID]').Count -ne $ledgers.Count -or $ledgers.Count -gt 10000){throw 'Incomplete customer ledger identities.'}
        $seenLedgerGuids=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        $customerLedgers=@(foreach($name in ($ledgers.Keys | Sort-Object -CaseSensitive)){
            $guid=[string]$ledgers[$name].guid
            if($name.Length -gt 240 -or $guid.Length -gt 240 -or -not $seenLedgerGuids.Add($guid)){throw 'Ambiguous customer ledger identities.'}
            [ordered]@{guid=$guid;name=$name}
        })
        $result.customerLedgers=$customerLedgers
    } catch {
        # A bad optional master list does not discard otherwise valid voucher facts.
        # Explicit null is imported as a rejected list, with an auditable exception.
        $result.customerLedgers=$null
        $result.customerLedgerError='Canonical Tally ledger list is incomplete, ambiguous or exceeds the supported limit.'
    }
    if($GroupDocument){$result.itemCatalog=Convert-TallyEconomicItemCatalog $ProductDocument $GroupDocument}
    return $result
}
function Get-TallyEconomicCollection([string]$Company,[string]$Name,[string]$Type,[string]$Fetch,[datetime]$From,[datetime]$To) {
    $escaped=[Security.SecurityElement]::Escape($Company)
    $filter=if($Type -eq 'Voucher'){'<FILTER>EconomicPeriod</FILTER>'}else{''}
    $formula=if($Type -eq 'Voucher'){'<SYSTEM TYPE="Formulae" NAME="EconomicPeriod">$Date &gt;= ##SVFromDate AND $Date &lt;= ##SVToDate</SYSTEM>'}else{''}
    if($Type -eq 'Company'){$filter='<FILTER>EconomicCompany</FILTER>';$formula='<SYSTEM TYPE="Formulae" NAME="EconomicCompany">$Name = ##SVCurrentCompany</SYSTEM>'}
    return '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>COLLECTION</TYPE><ID>'+ $Name +'</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>'+ $escaped +'</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">'+$From.ToString('yyyyMMdd')+'</SVFROMDATE><SVTODATE TYPE="Date">'+$To.AddDays(-1).ToString('yyyyMMdd')+'</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="'+$Name+'"><TYPE>'+$Type+'</TYPE><FETCH>'+$Fetch+'</FETCH>'+$filter+'</COLLECTION>'+$formula+'</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
}
$script:EconomicVoucherFetch='GUID,AlterID,Date,VoucherNumber,VoucherTypeName,PartyLedgerName,IsCancelled,IsOptional,AllInventoryEntries.StockItemName,AllInventoryEntries.ActualQty,AllInventoryEntries.BilledQty,AllInventoryEntries.Amount,AllInventoryEntries.BatchAllocations.BatchName,AllLedgerEntries.LedgerName,AllLedgerEntries.Amount,AllLedgerEntries.IsPartyLedger'
function Read-TallyEconomicEvidence([string]$Company,[int]$HistoryMonths=3,[hashtable]$LedgerRoles=@{},[hashtable]$VoucherRoles=@{},[int]$PurchaseHistoryMonths=0) {
    $from=[datetime]::new((Get-Date).Year,(Get-Date).Month,1).AddMonths(-$HistoryMonths)
    $to=(Get-Date).Date.AddDays(1)
    $documents=@{}
    foreach($definition in @(
        @('Company','Company','Name,GUID'),@('Ledgers','Ledger','Name,GUID,Parent,TaxType'),@('Products','StockItem','Name,GUID,BaseUnits,Parent'),@('Groups','StockGroup','Name,GUID,Parent'),
        @('Vouchers','Voucher',$script:EconomicVoucherFetch)
    )) {
        $raw=Invoke-Tally (Get-TallyEconomicCollection $Company ('Economic'+$definition[0]) $definition[1] $definition[2] $from $to) -TimeoutSeconds 30 -MetricName 'instrument_economics'
        $document=ConvertFrom-TallyEconomicXml $raw
        if($document.SelectSingleNode('//LINEERROR') -or -not $document.SelectSingleNode('//COLLECTION')){throw 'Economic Tally export was unsuccessful.'}
        $documents[$definition[0]]=$document
    }
    Assert-TallyCompanyIdentity $documents.Company $Company
    $zeroRaw=Invoke-Tally (Get-TallyEconomicNumericAmountCollection $Company $from $to) -TimeoutSeconds 30 -MetricName 'instrument_economics'
    $zeroDocument=ConvertFrom-TallyEconomicXml $zeroRaw
    if($zeroDocument.SelectSingleNode('//LINEERROR') -or -not $zeroDocument.SelectSingleNode('//COLLECTION')){throw 'Economic numeric amount export was unsuccessful.'}
    $result=Convert-TallyEconomicEvidence $documents.Company $documents.Ledgers $documents.Products $documents.Vouchers $from $to $LedgerRoles $VoucherRoles $zeroDocument $documents.Groups
    if($PurchaseHistoryMonths -gt $HistoryMonths){
        # Retain older stock movements only for items sold in the current window.
        # All customers' earlier consumption of those items matters for costing.
        # Keep whole vouchers to preserve their canonical revision/content, and
        # keep cancellations/unverified evidence rather than hide a source gap.
        $costProducts=[System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
        foreach($sale in $result.vouchers){
            if($sale.kind -in @('sale','return','credit')){
                foreach($line in $sale.lines){if($line.productId){[void]$costProducts.Add([string]$line.productId)}}
            }
        }
        $history=New-Object System.Collections.Generic.List[object]
        $monthStart=[datetime]::new((Get-Date).Year,(Get-Date).Month,1).AddMonths(-$PurchaseHistoryMonths)
        while($monthStart -lt $from){
            $monthEnd=$monthStart.AddMonths(1)
            $monthRaw=Invoke-Tally (Get-TallyEconomicCollection $Company 'EconomicVouchers' 'Voucher' $script:EconomicVoucherFetch $monthStart $monthEnd) -TimeoutSeconds 30 -MetricName 'instrument_economics'
            $monthDocument=ConvertFrom-TallyEconomicXml $monthRaw
            if($monthDocument.SelectSingleNode('//LINEERROR') -or -not $monthDocument.SelectSingleNode('//COLLECTION')){throw 'Economic purchase history export was unsuccessful.'}
            $monthZeroRaw=Invoke-Tally (Get-TallyEconomicNumericAmountCollection $Company $monthStart $monthEnd) -TimeoutSeconds 30 -MetricName 'instrument_economics'
            $monthZero=ConvertFrom-TallyEconomicXml $monthZeroRaw
            if($monthZero.SelectSingleNode('//LINEERROR') -or -not $monthZero.SelectSingleNode('//COLLECTION')){throw 'Economic purchase history amount export was unsuccessful.'}
            $month=Convert-TallyEconomicEvidence $documents.Company $documents.Ledgers $documents.Products $monthDocument $monthStart $monthEnd $LedgerRoles $VoucherRoles $monthZero
            foreach($voucher in $month.vouchers){
                $needed=$voucher.cancelled -or $voucher.amountStatus -eq 'unverified'
                foreach($line in $voucher.lines){if($costProducts.Contains([string]$line.productId)){$needed=$true;break}}
                if($needed){$history.Add($voucher)}
            }
            $monthStart=$monthEnd
        }
        $result.vouchers=@($history.ToArray())+@($result.vouchers)
        $result.purchaseHistoryFrom=[datetime]::new((Get-Date).Year,(Get-Date).Month,1).AddMonths(-$PurchaseHistoryMonths).ToString('yyyy-MM-dd')
    }
    if(@($result.vouchers).Count -gt 2000){throw 'Combined economic cost history exceeds 2000 vouchers; narrow the history window.'}
    return $result
}
function Get-TallyEconomicNumericAmountCollection([string]$Company,[datetime]$From,[datetime]$To){
    # $$Number is evaluated by Tally against the native inventory Amount, rather
    # than treating an empty XML string as zero in this connector. Bind the second
    # export to the voucher revision and exact ordered inventory fields.
    $body=Get-TallyEconomicCollection $Company 'EconomicAmountVouchers' 'Voucher' 'GUID,AlterID,AllInventoryEntries.StockItemName,AllInventoryEntries.Amount,AllInventoryEntries.ActualQty,AllInventoryEntries.BilledQty' $From $To
    return $body.Replace('<ID>EconomicAmountVouchers</ID>','<ID>EconomicNumericAmounts</ID>').Replace('</TDLMESSAGE>','<COLLECTION NAME="EconomicNumericAmounts"><SOURCECOLLECTION>EconomicAmountVouchers</SOURCECOLLECTION><WALK>AllInventoryEntries</WALK><FETCH>StockItemName,Amount,ActualQty,BilledQty</FETCH><COMPUTE>EconomicAmountNumber : $$Number:$Amount</COMPUTE><COMPUTE>EconomicVoucherId : $$Owner:$GUID</COMPUTE><COMPUTE>EconomicVoucherRevision : $$Owner:$AlterID</COMPUTE></COLLECTION></TDLMESSAGE>')
}
function Get-EconomicPreflightSummary($Evidence) {
    $verified=0;$cancelled=0;$excluded=0;$exceptions=@{};$kinds=@{}
    $safeReasons=@(
        'Economic amount is not exact decimal currency.',
        'Unclassified inventory voucher type; configure its verified voucher role.',
        'Voucher GUID or AlterID unavailable.','Duplicate voucher GUID in economic export.',
        'Tally ignored the economic date window.','Canonical customer GUID unavailable in the master export.',
        'Canonical product GUID unavailable in the master export.','Quantity/base-unit evidence unavailable.',
        'Alternative or composite unit requires a verified conversion.','Mixed economic signs require review.',
        'Accounting-only credit or voucher needs verified product/original-sale linkage.',
        'Ledger classification evidence unavailable.',
        'Unclassified document adjustment; configure its canonical ledger role.',
        'Inventory, GST, adjustments and party value do not reconcile.',
        'Cannot allocate a document adjustment over zero inventory value.',
        'Zero-value amount evidence does not match the voucher revision and inventory line.',
        'Tally did not verify a zero-valued inventory amount.'
    )
    foreach($voucher in $Evidence.vouchers){
        $kind=if($voucher.kind){[string]$voucher.kind}else{'unclassified'}
        if(-not $kinds.ContainsKey($kind)){$kinds[$kind]=0};$kinds[$kind]++
        if($voucher.amountStatus -eq 'verified'){
            if($voucher.kind -eq 'non_economic'){$excluded++}elseif($voucher.cancelled){$cancelled++}else{$verified++}
        }else{
            $reason=if($voucher.error -in $safeReasons){[string]$voucher.error}else{'Other invalid or unverified economic evidence.'}
            if(-not $exceptions.ContainsKey($reason)){$exceptions[$reason]=0};$exceptions[$reason]++
        }
    }
    $exceptionCount=$Evidence.vouchers.Count-$verified-$cancelled-$excluded
    return [ordered]@{
        checkedAt=[datetimeoffset]::UtcNow.ToString('o');readOnly=$true
        windowFrom=$Evidence.windowFrom;windowTo=$Evidence.windowTo
        relevantVouchers=$Evidence.vouchers.Count;verifiedActiveVouchers=$verified
        verifiedCancellations=$cancelled;unverifiedVouchers=$exceptionCount
        explicitlyExcludedDocuments=$excluded
        extractionEvidenceComplete=($exceptionCount -eq 0 -and $verified -gt 0)
        financialReleaseCertified=$false
        voucherKinds=@($kinds.GetEnumerator() | Sort-Object Name | ForEach-Object { [ordered]@{kind=$_.Name;count=$_.Value} })
        exceptions=@($exceptions.GetEnumerator() | Sort-Object Name | ForEach-Object { [ordered]@{reason=$_.Name;count=$_.Value} })
    }
}
function Convert-EconomicPolicyDraft([string]$Raw,[string]$Company){
    try{$draft=$Raw | ConvertFrom-Json -ErrorAction Stop}catch{throw 'Economic policy draft is not valid JSON.'}
    if($draft.state -ne 'proposed_requires_accounts_approval' -or $draft.companyName -cne $Company){throw 'Economic policy draft must be proposed and match the selected company.'}
    $result=@{LedgerRoles=@{};VoucherRoles=@{}}
    foreach($pair in @(@('ledgerRoles','LedgerRoles'),@('voucherRoles','VoucherRoles'))){
        $roles=$draft.($pair[0])
        if($null -eq $roles -or $roles -is [array] -or $roles -is [string] -or $roles -is [ValueType]){throw 'Economic policy draft role maps must be JSON objects.'}
        foreach($property in $roles.PSObject.Properties){
            if($property.Value -isnot [string]){throw 'Economic policy draft role values must be strings.'}
            $result[$pair[1]][$property.Name]=$property.Value
        }
    }
    return $result
}
