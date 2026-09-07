param([int]$Port = 8765, [switch]$NoBrowser, [ValidateRange(5, 120)][int]$SyncMinutes = 15, [ValidateRange(15, 1440)][int]$CustomerSyncMinutes = 240, [switch]$RebuildSalesHistory)

$ErrorActionPreference = 'Stop'
$dashboardRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$indexPath = Join-Path $dashboardRoot 'index.html'
$companyName = 'SUPRABHA DISTRIBUTORS'
. (Join-Path $dashboardRoot 'recovery.ps1')
$stateDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'SuprabhaStockFlow'
[IO.Directory]::CreateDirectory($stateDirectory) | Out-Null
$snapshotPath = Join-Path $stateDirectory 'snapshot-v1.json'
$salesPath = Join-Path $stateDirectory 'sales-history-v1.json'
$customerPath = Join-Path $stateDirectory 'customer-master-v1.json'
$healthLogPath = Join-Path $stateDirectory 'connector-health.log'
# A held file handle prevents duplicate extraction across launches and ports.
try {
    $instanceLock = [IO.File]::Open((Join-Path $stateDirectory 'connector.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch {
    Write-Host 'StockFlow connector is already running.'
    exit 0
}
$script:lastReorderData = Read-ConnectorSnapshot $snapshotPath $companyName
$script:lastCustomerData = Read-CustomerSnapshot $customerPath $companyName
if (-not $script:lastCustomerData) { $script:lastCustomerData = Read-CustomerSnapshot "$customerPath.bak" $companyName }
$script:nextCustomerRead = Get-Date
if ($script:lastCustomerData) {
    $script:nextCustomerRead = ([datetimeoffset]::Parse($script:lastCustomerData.fetchedAtIso)).LocalDateTime.AddMinutes($CustomerSyncMinutes)
}
$script:nextReorderRead = Get-Date
if ($script:lastReorderData) {
    $script:nextReorderRead = ([datetimeoffset]::Parse($script:lastReorderData.fetchedAtIso)).LocalDateTime.AddMinutes($SyncMinutes)
}
if ($RebuildSalesHistory) {
    # An administrator-requested repair must not be suppressed by a fresh operational snapshot.
    $script:nextReorderRead = Get-Date
}
$script:pendingUpload = $script:lastReorderData
$script:nextUpload = Get-Date
$diasysGroup = 'Diasys Diagnostic India Pvt Ltd'
$allowedGroups = @($diasysGroup, 'SYS 480', 'SYS Aurora', 'Sysmex')
$cloudSyncUrl = 'https://aormuidjbdqruglmyseh.supabase.co/functions/v1/stockflow-sync'
$cloudUploadKey = [Environment]::GetEnvironmentVariable('STOCKFLOW_UPLOAD_KEY', 'User')
if ([string]::IsNullOrWhiteSpace($cloudUploadKey)) {
    throw 'StockFlow cloud sync is not configured. Ask the administrator to set STOCKFLOW_UPLOAD_KEY for this Windows user.'
}

function Publish-CloudSnapshot([string]$Json) {
    try {
        Invoke-WebRequest -Uri $cloudSyncUrl -Method Post -ContentType 'application/json' -Headers @{ 'x-upload-key' = $cloudUploadKey } -Body $Json -UseBasicParsing -TimeoutSec 15 | Out-Null
        Write-Host "Cloud snapshot updated." -ForegroundColor DarkGreen
        return $true
    } catch {
        # The local dashboard must remain usable even when the internet is down.
        Write-Host 'Cloud upload pending; the saved snapshot will be retried.' -ForegroundColor DarkYellow
        return $false
    }
}

function Get-Number([string]$Text) {
    if ($Text -match '-?[0-9,]+(?:\.[0-9]+)?') { return [double]($matches[0] -replace ',', '') }
    return 0
}

function Invoke-Tally([string]$Body, [int]$TimeoutSeconds = 15) {
    $requestName = if ($Body -match 'DashboardSalesVouchers') { 'sales' } elseif ($Body -match 'DashboardCustomerLedgers') { 'customers' } elseif ($Body -match 'DashboardItems') { 'catalog' } else { 'reorder' }
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:9000' -Method Post -ContentType 'application/xml' -Body $Body -UseBasicParsing -TimeoutSec $TimeoutSeconds
        $watch.Stop()
        Add-Content -LiteralPath $healthLogPath -Value "$([datetimeoffset]::Now.ToString('o')) request=$requestName durationMs=$($watch.ElapsedMilliseconds) bytes=$($response.RawContentLength) status=ok"
        return $response.Content
    } catch {
        $watch.Stop()
        Add-Content -LiteralPath $healthLogPath -Value "$([datetimeoffset]::Now.ToString('o')) request=$requestName durationMs=$($watch.ElapsedMilliseconds) bytes=0 status=failed"
        throw
    }
}

function Get-TallyCustomers {
    if ($script:lastCustomerData -and (Get-Date) -lt $script:nextCustomerRead) {
        return @($script:lastCustomerData.customers)
    }
    $script:nextCustomerRead = (Get-Date).AddMinutes($CustomerSyncMinutes)
    $ledgerXml = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>COLLECTION</TYPE><ID>DashboardCustomerLedgers</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SUPRABHA DISTRIBUTORS</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="DashboardCustomerLedgers"><TYPE>Ledger</TYPE><CHILDOF>Sundry Debtors</CHILDOF><BELONGSTO>Yes</BELONGSTO><FETCH>Name,MailingName,LedgerPhone,LedgerMobile,Address,StateName,PinCode</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
    try {
        [xml]$ledgerDoc = Invoke-Tally $ledgerXml
        if ($ledgerDoc.SelectSingleNode('//LINEERROR') -or -not $ledgerDoc.SelectSingleNode('//COLLECTION')) {
            throw 'Customer export did not contain a successful collection.'
        }
        $customers = @(foreach ($ledger in $ledgerDoc.SelectNodes('//LEDGER')) {
            $name = ([string]$ledger.GetAttribute('NAME')).Trim()
            if (-not $name) { continue }
            $phone = ([string]$ledger.LEDGERMOBILE.'#text').Trim()
            if (-not $phone) { $phone = ([string]$ledger.LEDGERPHONE.'#text').Trim() }
            $addressLines = @($ledger.SelectNodes('./ADDRESS.LIST/ADDRESS') | ForEach-Object { $_.InnerText.Trim() } | Where-Object { $_ })
            $city = if ($addressLines.Count) { $addressLines[$addressLines.Count - 1] } else { '' }
            [ordered]@{
                tallyKey = $name
                name = $name
                phone = if ($phone) { $phone } else { $null }
                city = if ($city) { $city } else { $null }
                state = ([string]$ledger.STATENAME.'#text').Trim()
                pinCode = ([string]$ledger.PINCODE.'#text').Trim()
                active = $true
            }
        })
        $customers = @($customers | Sort-Object name)
        if (-not $customers.Count) { throw 'Customer export was empty; retaining the last successful customer directory.' }
        $fresh = @{ company = $companyName; fetchedAtIso = [datetimeoffset]::UtcNow.ToString('o'); customers = $customers }
        Save-ConnectorSnapshot $customerPath $fresh
        $script:lastCustomerData = $fresh
        return $customers
    } catch {
        $script:nextCustomerRead = (Get-Date).AddMinutes($SyncMinutes)
        if ($script:lastCustomerData) {
            Write-Host 'Customer refresh failed; retaining the saved customer directory.' -ForegroundColor DarkYellow
            return @($script:lastCustomerData.customers)
        }
        throw
    }
}

function Get-TallySalesData {
    $result = @{}
    $invoices = @()
    try {
        $today = (Get-Date).Date
        $invoiceFromDate = $today.AddDays(-180).ToString('yyyyMMdd')
        $financialYear = if ($today.Month -ge 4) { $today.Year } else { $today.Year - 1 }
        $fromDate = [datetime]::new($financialYear - 5, 4, 1).ToString('yyyyMMdd')
        $cachedSales = Get-TrustedSalesSnapshot (Read-ConnectorSnapshot $salesPath $companyName) $companyName
        if ($cachedSales -and $null -eq $cachedSales.records -and $cachedSales.document) {
            $cachedSales = @{
                company = $companyName; fetchedAtIso = [string]$cachedSales.fetchedAtIso; sourceScope = 'sales_vouchers_v1'
                catalog = @(); tallyInvoices = @(); records = @(Convert-LegacySalesRecords ([string]$cachedSales.document))
                fullScannedAt = [string]$cachedSales.fullScannedAt
            }
            Save-ConnectorSnapshot $salesPath $cachedSales
        }
        $fullScan = [bool]$RebuildSalesHistory
        if (-not $cachedSales) {
            $cachedSales = @{ company = $companyName; sourceScope = 'sales_vouchers_v1'; records = @(); fullScannedAt = $null }
        }
        $baseline = @{}
        if ($cachedSales.baselineLastSupply) {
            foreach ($property in $cachedSales.baselineLastSupply.psobject.Properties) { $baseline[$property.Name] = $property.Value }
        }
        if (-not $fullScan) { $fromDate = $today.AddDays(-30).ToString('yyyyMMdd') }
        foreach ($item in $baseline.Keys) {
            if ([string]$baseline[$item].dateKey -lt $fromDate) { $result[$item] = $baseline[$item] }
        }
        $toDate = $today.ToString('yyyyMMdd')
        $salesXml = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>COLLECTION</TYPE><ID>DashboardSalesVouchers</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SUPRABHA DISTRIBUTORS</SVCURRENTCOMPANY><SVFROMDATE>__FROM_DATE__</SVFROMDATE><SVTODATE>__TO_DATE__</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="DashboardSalesVouchers" ISINITIALIZE="Yes"><TYPE>Voucher</TYPE><CHILDOF>Sales</CHILDOF><BELONGSTO>Yes</BELONGSTO><FETCH>Date,VoucherNumber,VoucherTypeName,Reference,MasterID,PartyLedgerName,PartyName,BasicBuyerName,IsCancelled,IsOptional,AllInventoryEntries.StockItemName,AllInventoryEntries.BilledQty,AllInventoryEntries.ActualQty</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
        $salesXml = $salesXml.Replace('__FROM_DATE__', $fromDate).Replace('__TO_DATE__', $toDate)
        $salesXml = $salesXml.Replace('<SVFROMDATE>', '<SVFROMDATE TYPE="Date">').Replace('<SVTODATE>', '<SVTODATE TYPE="Date">')
        $salesXml = $salesXml.Replace('</COLLECTION>', '<FILTER>StockFlowSalesPeriod</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="StockFlowSalesPeriod">$Date &gt;= ##SVFromDate AND $Date &lt;= ##SVToDate</SYSTEM>')
        $salesContent = Invoke-Tally $salesXml -TimeoutSeconds $(if ($fullScan) { 60 } else { 15 })
        # Some Tally releases emit UDF-prefixed nodes without declaring the XML
        # namespace. Rename only that prefix so the voucher payload remains valid XML.
        $salesContent = [regex]::Replace($salesContent, '(<\/?)(?i:UDF):', '$1UDF_')
        $salesContent = [regex]::Replace($salesContent, '(\s)(?i:UDF):([A-Za-z0-9_.-]+)=', '$1UDF_$2=')
        [xml]$salesDoc = $salesContent
        if ($salesDoc.SelectSingleNode('//LINEERROR') -or -not $salesDoc.SelectSingleNode('//COLLECTION')) {
            throw 'Sales export did not contain a successful collection.'
        }
        foreach ($dateNode in $salesDoc.SelectNodes('//VOUCHER/DATE')) {
            if ($dateNode.InnerText -lt $fromDate -or $dateNode.InnerText -gt $toDate) {
                throw 'Tally ignored the sales date window; refusing to merge an unbounded export.'
            }
        }
        $incomingRecords = @(Convert-LegacySalesRecords $salesDoc.OuterXml)
        $skippedIdentity = $salesDoc.SelectNodes('//VOUCHER').Count - $incomingRecords.Count
        if ($skippedIdentity) {
            Add-Content -LiteralPath $healthLogPath -Value "$([datetimeoffset]::Now.ToString('o')) request=sales_identity skipped=$skippedIdentity status=warning"
        }
        $salesRecords = if ($fullScan) { @($incomingRecords) } else { @(Merge-SalesRecords $cachedSales.records $incomingRecords $fromDate) }
        foreach ($voucher in $salesRecords) {
            if ($voucher.cancelled -or $voucher.optional) { continue }
            $dateKey = ([string]$voucher.date -replace '[^0-9]', '')
            if ($dateKey.Length -ne 8) { continue }
            $party = [string]$voucher.party
            $voucherNumber = [string]$voucher.voucherNumber
            if ($voucherNumber -and $dateKey -ge $invoiceFromDate) {
                $invoices += [ordered]@{ voucherNumber = $voucherNumber; reference = $voucher.reference; party = $party; date = $dateKey; masterId = $voucher.masterId }
            }
            foreach ($entry in @($voucher.lineItems)) {
                $itemName = [string]$entry.itemName
                if (-not $itemName) { continue }
                $existing = $result[$itemName]
                if ($existing -and $existing.dateKey -gt $dateKey) { continue }
                $quantity = [double]$entry.quantity
                $displayDate = $dateKey
                try { $displayDate = [datetime]::ParseExact($dateKey, 'yyyyMMdd', $null).ToString('dd MMM yyyy') } catch { }
                $result[$itemName] = [ordered]@{ dateKey = $dateKey; party = $party; quantity = $quantity; date = $displayDate }
            }
        }
    } catch {
        Write-Host "Last supplied details were not available in this refresh: $($_.Exception.Message)" -ForegroundColor DarkYellow
        throw # Do not replace a complete snapshot with empty invoice history.
    }
    Save-ConnectorSnapshot $salesPath @{
        company = $companyName; fetchedAtIso = [datetimeoffset]::UtcNow.ToString('o'); sourceScope = 'sales_vouchers_v1'
        catalog = @(); tallyInvoices = @(); records = @($salesRecords); baselineLastSupply = $baseline
        fullScannedAt = if ($fullScan) { [datetimeoffset]::UtcNow.ToString('o') } else { $cachedSales.fullScannedAt }
    }
    $script:RebuildSalesHistory = $false
    return [ordered]@{ lastSupply = $result; invoices = @($invoices) }
}

function Get-ReorderData {
    # Share the same snapshot across automatic and browser refresh requests.
    # Never advance fetchedAt when returning cached data.
    if ($script:lastReorderData -and (Get-Date) -lt $script:nextReorderRead) {
        return $script:lastReorderData
    }
    $script:nextReorderRead = (Get-Date).AddMinutes($SyncMinutes)
    try {
        $fresh = Read-ReorderData
        Save-ConnectorSnapshot $snapshotPath $fresh
        $script:lastReorderData = $fresh
        $script:pendingUpload = $fresh
        return $fresh
    } catch {
        if ($script:lastReorderData) {
            Write-Host 'Tally refresh failed; retaining the last successful snapshot and its timestamp.' -ForegroundColor DarkYellow
            return $script:lastReorderData
        }
        throw
    }
}

function Read-ReorderData {
    $today = (Get-Date).Date
    $financialYear = if ($today.Month -ge 4) { $today.Year } else { $today.Year - 1 }
    $historyFrom = [datetime]::new($financialYear - 5, 4, 1)
    $stockXml = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>COLLECTION</TYPE><ID>DashboardItems</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SUPRABHA DISTRIBUTORS</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="StockFlowCompanyIdentity"><TYPE>Company</TYPE><FETCH>Name</FETCH><FILTER>StockFlowTargetCompany</FILTER></COLLECTION><COLLECTION NAME="DashboardItems"><TYPE>StockItem</TYPE><FETCH>Name,Parent,BaseUnits,ClosingBalance</FETCH></COLLECTION><COLLECTION NAME="DashboardGroups"><TYPE>StockGroup</TYPE><FETCH>Name,Parent</FETCH></COLLECTION><SYSTEM TYPE="Formulae" NAME="StockFlowTargetCompany">$Name = ##SVCurrentCompany</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
    $reportXml = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>DATA</TYPE><ID>Reorder Status</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SUPRABHA DISTRIBUTORS</SVCURRENTCOMPANY></STATICVARIABLES></DESC></BODY></ENVELOPE>'
    [xml]$stockDoc = Invoke-Tally $stockXml
    Assert-TallyCompanyIdentity $stockDoc $companyName
    [xml]$reportDoc = Invoke-Tally $reportXml
    $salesData = Get-TallySalesData
    $lastSupplyMap = $salesData.lastSupply
    $customers = Get-TallyCustomers
    $groupMap = @{}
    foreach ($item in $stockDoc.SelectNodes('//STOCKITEM')) { $groupMap[$item.GetAttribute('NAME')] = [string]$item.PARENT.'#text' }
    $groupParents = @{}
    foreach ($stockGroup in $stockDoc.SelectNodes('//STOCKGROUP')) { $groupParents[$stockGroup.GetAttribute('NAME')] = [string]$stockGroup.PARENT.'#text' }
    function Resolve-TrackedGroup([string]$GroupName) {
        if ($GroupName -in @('SYS 480', 'SYS Aurora', 'Sysmex')) { return $GroupName }
        $cursor = $GroupName
        $seen = @{}
        while ($cursor -and -not $seen.ContainsKey($cursor)) {
            if ($cursor -eq $diasysGroup) { return $diasysGroup }
            $seen[$cursor] = $true
            $cursor = $groupParents[$cursor]
        }
        return $null
    }
    $names = @($reportDoc.ENVELOPE.ROSNAME)
    $reportByItem = @{}
    for ($i = 0; $i -lt $names.Count; $i++) {
        $reportName = ([string]$names[$i]).Trim()
        if ($reportName) {
            $reportByItem[$reportName] = [ordered]@{
                purchaseOrder = Get-Number ([string]$reportDoc.ENVELOPE.ROSONPURCORDER[$i])
                salesOrder = Get-Number ([string]$reportDoc.ENVELOPE.ROSONSALEORDER[$i])
            }
        }
    }
    $rows = for ($i = 0; $i -lt $names.Count; $i++) {
        $name = [string]$names[$i]
        $group = Resolve-TrackedGroup $groupMap[$name]
        if ($null -ne $group) {
            $order = Get-Number ([string]$reportDoc.ENVELOPE.ROSREQDQTY[$i])
            if ($order -gt 0) {
                $lastSupply = $lastSupplyMap[$name]
                [ordered]@{
                    group = $group; item = $name
                    closing = Get-Number ([string]$reportDoc.ENVELOPE.ROSCLSTOCK[$i])
                    purchaseOrder = Get-Number ([string]$reportDoc.ENVELOPE.ROSONPURCORDER[$i])
                    salesOrder = Get-Number ([string]$reportDoc.ENVELOPE.ROSONSALEORDER[$i])
                    reorderLevel = Get-Number ([string]$reportDoc.ENVELOPE.ROSORDLVL[$i])
                    minimumOrder = Get-Number ([string]$reportDoc.ENVELOPE.ROSMINQTY[$i])
                    shortfall = Get-Number ([string]$reportDoc.ENVELOPE.ROSSHORTFALL[$i])
                    orderToBePlaced = $order
                    lastSuppliedParty = if ($lastSupply) { $lastSupply.party } else { $null }
                    lastSuppliedQty = if ($lastSupply) { $lastSupply.quantity } else { $null }
                    lastSuppliedDate = if ($lastSupply) { $lastSupply.date } else { $null }
                }
            }
        }
    }
    $sorted = @($rows | Sort-Object group, item)
    $catalog = foreach ($item in $stockDoc.SelectNodes('//STOCKITEM')) {
        $itemName = ([string]$item.GetAttribute('NAME')).Trim()
        if (-not $itemName) { continue }
        # Orders must use the complete Tally stock-item ledger. Reorder rows
        # remain restricted to the explicitly tracked diagnostic groups above.
        $group = ([string]$groupMap[$itemName]).Trim()
        if (-not $group) { $group = 'Uncategorised' }
        $orderState = $reportByItem[$itemName]
        [ordered]@{
            tallyKey = $itemName
            item = $itemName
            group = $group
            baseUnit = ([string]$item.BASEUNITS.'#text').Trim()
            closing = Get-Number ([string]$item.CLOSINGBALANCE.'#text')
            purchaseOrder = if ($orderState) { $orderState.purchaseOrder } else { 0 }
            salesOrder = if ($orderState) { $orderState.salesOrder } else { 0 }
            active = $true
        }
    }
    $catalog = @($catalog | Sort-Object group, item)
    return [ordered]@{
        company = $companyName
        fetchedAt = (Get-Date).ToString('dd MMM yyyy, hh:mm:ss tt')
        fetchedAtShort = (Get-Date).ToString('dd MMM, hh:mm tt')
        fetchedAtIso = (Get-Date).ToUniversalTime().ToString('o')
        supplyHistoryFrom = $historyFrom.ToString('dd MMM yyyy')
        supplyHistoryTo = $today.ToString('dd MMM yyyy')
        supplyHistoryRange = "$($historyFrom.ToString('dd MMM yyyy')) to $($today.ToString('dd MMM yyyy'))"
        operationsDate = $today.ToString('dd MMM yyyy')
        operationsSource = 'Operations source not connected'
        operations = [ordered]@{
            phoneOrdersToday = $null
            awaitingConfirmation = $null
            purchaseOrdersPending = $null
            awaitingApproval = $null
            awaitingStock = $null
            readyForPicking = $null
            packed = $null
            awaitingTallyBilling = $null
            billedNotDispatched = $null
            dispatchedToday = $null
            delayedFailedDeliveries = $null
            installationsPending = $null
            returnsPending = $null
            urgentExceptions = $null
        }
        groups = $allowedGroups
        rows = $sorted
        catalog = $catalog
        customers = $customers
        tallyInvoices = @($salesData.invoices)
    }
}

function Send-Response($Client, [int]$Status, [string]$ContentType, [byte[]]$Body) {
    $statusText = if ($Status -eq 200) { 'OK' } else { 'Service Unavailable' }
    $header = "HTTP/1.1 $Status $statusText`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
    $stream = $Client.GetStream()
    $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    $stream.Write($Body, 0, $Body.Length)
    $stream.Flush()
}

$existingUrl = "http://localhost:$Port"
try {
    $existing = Invoke-WebRequest -Uri $existingUrl -UseBasicParsing -TimeoutSec 5
    if ($existing.Content -match 'Suprabha.*Tally Reorder Dashboard') {
        Write-Host "The dashboard is already running. Opening it now." -ForegroundColor Green
        if (-not $NoBrowser) { Start-Process $existingUrl }
        exit 0
    }
} catch { }

$listener = $null
foreach ($candidatePort in $Port..($Port + 9)) {
    try {
        $candidate = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Any, $candidatePort)
        $candidate.Start()
        $listener = $candidate
        $Port = $candidatePort
        break
    } catch { }
}
if ($null -eq $listener) { Write-Host "Could not find an available local port. Restart the computer and try again." -ForegroundColor Red; exit 1 }
Write-Host "Tally Reorder Dashboard is running." -ForegroundColor Green
Write-Host "Keep TallyPrime open with $companyName loaded." -ForegroundColor Cyan
Write-Host "Open: http://localhost:$Port" -ForegroundColor Yellow
try {
    $lanAddress = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1 -ExpandProperty IPAddress
    if ($lanAddress) { Write-Host "Phone on same Wi-Fi: http://${lanAddress}:$Port" -ForegroundColor Yellow }
} catch { }
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray
if (-not $NoBrowser) { Start-Process "http://localhost:$Port" }

$nextCloudSync = Get-Date
try {
    while ($true) {
        if (-not $listener.Pending()) {
            if ((Get-Date) -ge $nextCloudSync) {
                try {
                    $cloudJson = (Get-ReorderData | ConvertTo-Json -Depth 6 -Compress)
                } catch {
                    Write-Host "Automatic sync will retry in $SyncMinutes minutes." -ForegroundColor DarkYellow
                }
                $nextCloudSync = (Get-Date).AddMinutes($SyncMinutes)
            }
            if ($script:pendingUpload -and (Get-Date) -ge $script:nextUpload) {
                if (Publish-CloudSnapshot ($script:pendingUpload | ConvertTo-Json -Depth 6 -Compress)) {
                    $script:pendingUpload = $null
                }
                $script:nextUpload = (Get-Date).AddMinutes(5)
            }
            Start-Sleep -Milliseconds 250
            continue
        }
        $client = $listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 5000
            $client.GetStream().ReadTimeout = 5000
            $reader = [IO.StreamReader]::new($client.GetStream(), [Text.Encoding]::ASCII, $false, 1024, $true)
            try {
                $requestLine = $reader.ReadLine()
                if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }
                while ($true) {
                    $headerLine = $reader.ReadLine()
                    if ([string]::IsNullOrEmpty($headerLine)) { break }
                }
            } catch [System.IO.IOException] {
                # Chrome may open a speculative connection and close it without
                # completing an HTTP request. This is normal and can be ignored.
                continue
            }
            $path = if ($requestLine -match '^GET\s+([^\s]+)') { $matches[1] } else { '/' }
            if ($path -like '/api/reorder*') {
                try {
                    if (-not $script:lastReorderData) { throw 'First stock snapshot is not ready.' }
                    $json = ($script:lastReorderData | ConvertTo-Json -Depth 6 -Compress)
                    Send-Response $client 200 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($json))
                } catch {
                    $json = @{ error = 'TallyPrime is not reachable. Open TallyPrime, load SUPRABHA DISTRIBUTORS, and try Refresh.'; detail = $_.Exception.Message } | ConvertTo-Json -Compress
                    Send-Response $client 503 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($json))
                }
            } elseif ($path -eq '/manifest.webmanifest') {
                Send-Response $client 200 'application/manifest+json; charset=utf-8' ([IO.File]::ReadAllBytes((Join-Path $dashboardRoot 'manifest.webmanifest')))
            } elseif ($path -eq '/sw.js') {
                Send-Response $client 200 'application/javascript; charset=utf-8' ([IO.File]::ReadAllBytes((Join-Path $dashboardRoot 'sw.js')))
            } elseif ($path -eq '/app-icon.svg') {
                Send-Response $client 200 'image/svg+xml; charset=utf-8' ([IO.File]::ReadAllBytes((Join-Path $dashboardRoot 'app-icon.svg')))
            } else {
                Send-Response $client 200 'text/html; charset=utf-8' ([IO.File]::ReadAllBytes($indexPath))
            }
        } finally { $client.Close() }
    }
} finally { $listener.Stop(); $instanceLock.Dispose() }
