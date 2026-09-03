param([int]$Port = 8765, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$dashboardRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$indexPath = Join-Path $dashboardRoot 'index.html'
$companyName = 'SUPRABHA DISTRIBUTORS'
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
    } catch {
        # The local dashboard must remain usable even when the internet is down.
        Write-Host "Cloud sync will retry on the next refresh: $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
}

function Get-Number([string]$Text) {
    if ($Text -match '-?[0-9,]+(?:\.[0-9]+)?') { return [double]($matches[0] -replace ',', '') }
    return 0
}

function Invoke-Tally([string]$Body) {
    return (Invoke-WebRequest -Uri 'http://127.0.0.1:9000' -Method Post -ContentType 'application/xml' -Body $Body -UseBasicParsing -TimeoutSec 15).Content
}

function Get-TallyCustomers {
    $ledgerXml = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>COLLECTION</TYPE><ID>DashboardCustomerLedgers</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SUPRABHA DISTRIBUTORS</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="DashboardCustomerLedgers"><TYPE>Ledger</TYPE><CHILDOF>Sundry Debtors</CHILDOF><BELONGSTO>Yes</BELONGSTO><FETCH>Name,MailingName,LedgerPhone,LedgerMobile,Address,StateName,PinCode</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
    [xml]$ledgerDoc = Invoke-Tally $ledgerXml
    $customers = foreach ($ledger in $ledgerDoc.SelectNodes('//LEDGER')) {
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
    }
    return @($customers | Sort-Object name)
}

function Get-TallySalesData {
    $result = @{}
    $invoices = @()
    try {
        $today = (Get-Date).Date
        $invoiceFromDate = $today.AddDays(-180).ToString('yyyyMMdd')
        $financialYear = if ($today.Month -ge 4) { $today.Year } else { $today.Year - 1 }
        $fromDate = [datetime]::new($financialYear - 5, 4, 1).ToString('yyyyMMdd')
        $toDate = $today.ToString('yyyyMMdd')
        $salesXml = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>COLLECTION</TYPE><ID>DashboardSalesVouchers</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SUPRABHA DISTRIBUTORS</SVCURRENTCOMPANY><SVFROMDATE>__FROM_DATE__</SVFROMDATE><SVTODATE>__TO_DATE__</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="DashboardSalesVouchers" ISINITIALIZE="Yes"><TYPE>Voucher</TYPE><CHILDOF>Sales</CHILDOF><BELONGSTO>Yes</BELONGSTO><FETCH>Date,VoucherNumber,Reference,MasterID,PartyLedgerName,PartyName,BasicBuyerName,IsCancelled,IsOptional,AllInventoryEntries.StockItemName,AllInventoryEntries.BilledQty,AllInventoryEntries.ActualQty</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
        $salesXml = $salesXml.Replace('__FROM_DATE__', $fromDate).Replace('__TO_DATE__', $toDate)
        $salesContent = Invoke-Tally $salesXml
        # Some Tally releases emit UDF-prefixed nodes without declaring the XML
        # namespace. Rename only that prefix so the voucher payload remains valid XML.
        $salesContent = [regex]::Replace($salesContent, '(<\/?)(?i:UDF):', '$1UDF_')
        $salesContent = [regex]::Replace($salesContent, '(\s)(?i:UDF):([A-Za-z0-9_.-]+)=', '$1UDF_$2=')
        [xml]$salesDoc = $salesContent
        foreach ($voucher in $salesDoc.SelectNodes('//VOUCHER')) {
            $cancelled = $voucher.SelectSingleNode('./ISCANCELLED')
            $optional = $voucher.SelectSingleNode('./ISOPTIONAL')
            if (($cancelled -and $cancelled.InnerText -eq 'Yes') -or ($optional -and $optional.InnerText -eq 'Yes')) { continue }
            $dateNode = $voucher.SelectSingleNode('./DATE')
            if (-not $dateNode) { continue }
            $dateKey = ($dateNode.InnerText -replace '[^0-9]', '')
            if ($dateKey.Length -ne 8) { continue }
            $partyNode = $voucher.SelectSingleNode('./PARTYLEDGERNAME | ./PARTYNAME | ./BASICBUYERNAME')
            $party = if ($partyNode) { $partyNode.InnerText.Trim() } else { '' }
            $voucherNumberNode = $voucher.SelectSingleNode('./VOUCHERNUMBER')
            $voucherNumber = if ($voucherNumberNode) { $voucherNumberNode.InnerText.Trim() } else { '' }
            if ($voucherNumber -and $dateKey -ge $invoiceFromDate) {
                $referenceNode = $voucher.SelectSingleNode('./REFERENCE')
                $masterIdNode = $voucher.SelectSingleNode('./MASTERID')
                $invoices += [ordered]@{ voucherNumber = $voucherNumber; reference = if ($referenceNode) { $referenceNode.InnerText.Trim() } else { $null }; party = $party; date = $dateKey; masterId = if ($masterIdNode) { $masterIdNode.InnerText.Trim() } else { $null } }
            }
            foreach ($entry in $voucher.SelectNodes('.//ALLINVENTORYENTRIES.LIST | .//INVENTORYENTRIES.LIST')) {
                $itemNode = $entry.SelectSingleNode('./STOCKITEMNAME')
                if (-not $itemNode) { continue }
                $itemName = $itemNode.InnerText.Trim()
                if (-not $itemName) { continue }
                $existing = $result[$itemName]
                if ($existing -and $existing.dateKey -gt $dateKey) { continue }
                $quantityNode = $entry.SelectSingleNode('./BILLEDQTY | ./ACTUALQTY')
                $quantity = if ($quantityNode) { [Math]::Abs((Get-Number $quantityNode.InnerText)) } else { 0 }
                $displayDate = $dateKey
                try { $displayDate = [datetime]::ParseExact($dateKey, 'yyyyMMdd', $null).ToString('dd MMM yyyy') } catch { }
                $result[$itemName] = [ordered]@{ dateKey = $dateKey; party = $party; quantity = $quantity; date = $displayDate }
            }
        }
    } catch {
        Write-Host "Last supplied details were not available in this refresh: $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
    return [ordered]@{ lastSupply = $result; invoices = @($invoices) }
}

function Get-ReorderData {
    $today = (Get-Date).Date
    $financialYear = if ($today.Month -ge 4) { $today.Year } else { $today.Year - 1 }
    $historyFrom = [datetime]::new($financialYear - 5, 4, 1)
    $stockXml = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>COLLECTION</TYPE><ID>DashboardItems</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SUPRABHA DISTRIBUTORS</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="DashboardItems"><TYPE>StockItem</TYPE><FETCH>Name,Parent,BaseUnits,ClosingBalance</FETCH></COLLECTION><COLLECTION NAME="DashboardGroups"><TYPE>StockGroup</TYPE><FETCH>Name,Parent</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
    $reportXml = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>DATA</TYPE><ID>Reorder Status</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SUPRABHA DISTRIBUTORS</SVCURRENTCOMPANY></STATICVARIABLES></DESC></BODY></ENVELOPE>'
    [xml]$stockDoc = Invoke-Tally $stockXml
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
                    Publish-CloudSnapshot $cloudJson
                } catch {
                    Write-Host "Automatic sync will retry in five minutes." -ForegroundColor DarkYellow
                }
                $nextCloudSync = (Get-Date).AddMinutes(5)
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
                    $json = (Get-ReorderData | ConvertTo-Json -Depth 6 -Compress)
                    Publish-CloudSnapshot $json
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
} finally { $listener.Stop() }
