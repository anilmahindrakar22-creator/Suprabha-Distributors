# No network or startup side effects: these helpers are also exercised by fixtures.
function Get-SalesRecordIdentity([string]$MasterId, [string]$Date, [string]$VoucherNumber, [string]$Party) {
    if (-not [string]::IsNullOrWhiteSpace($MasterId)) { return "master:$($MasterId.Trim())" }
    if ([string]::IsNullOrWhiteSpace($Date) -or [string]::IsNullOrWhiteSpace($VoucherNumber) -or [string]::IsNullOrWhiteSpace($Party)) { return $null }
    $bytes = [Text.Encoding]::UTF8.GetBytes("$($Date.Trim())|$($VoucherNumber.Trim().ToLowerInvariant())|$($Party.Trim().ToLowerInvariant())")
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return 'fallback:' + ([BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()) }
    finally { $hash.Dispose() }
}

function Merge-SalesRecords($Previous, $Incoming, [string]$FromDate) {
    # A complete window replaces prior rows, including deleted/omitted vouchers.
    $ids = @{}
    foreach ($voucher in @($Incoming)) {
        $id = [string]$voucher.masterId
        if (-not $id) { throw 'Sales voucher has no stable identity; refusing incremental merge.' }
        if ($ids.ContainsKey($id)) { throw 'Duplicate sales voucher identity.' }
        $ids[$id] = $true
    }
    $merged = [Collections.Generic.List[object]]::new()
    foreach ($voucher in @($Previous)) {
        if ([string]$voucher.date -lt $FromDate -and -not $ids.ContainsKey([string]$voucher.masterId)) { $merged.Add($voucher) }
    }
    foreach ($voucher in @($Incoming)) { $merged.Add($voucher) }
    return $merged.ToArray()
}

function Convert-LegacySalesRecords([string]$Document) {
    [xml]$sales = $Document
    return @($sales.SelectNodes('//VOUCHER') | ForEach-Object {
        $voucher = $_
        $masterIdNode = $voucher.SelectSingleNode('./MASTERID')
        $dateNode = $voucher.SelectSingleNode('./DATE')
        $voucherNumberNode = $voucher.SelectSingleNode('./VOUCHERNUMBER')
        $voucherTypeNode = $voucher.SelectSingleNode('./VOUCHERTYPENAME')
        $partyNode = $voucher.SelectSingleNode('./PARTYLEDGERNAME | ./PARTYNAME | ./BASICBUYERNAME')
        $id = Get-SalesRecordIdentity $(if ($masterIdNode) { $masterIdNode.InnerText } else { '' }) $(if ($dateNode) { $dateNode.InnerText } else { '' }) $(if ($voucherNumberNode) { $voucherNumberNode.InnerText } else { '' }) $(if ($partyNode) { $partyNode.InnerText } else { '' })
        if (-not $id) { return }
        $lines = @($voucher.SelectNodes('.//ALLINVENTORYENTRIES.LIST | .//INVENTORYENTRIES.LIST') | ForEach-Object {
            $itemNode = $_.SelectSingleNode('./STOCKITEMNAME')
            if (-not $itemNode -or -not $itemNode.InnerText.Trim()) { return }
            $quantityNode = $_.SelectSingleNode('./BILLEDQTY | ./ACTUALQTY')
            $quantity = 0
            if ($quantityNode -and $quantityNode.InnerText -match '-?[0-9,]+(?:\.[0-9]+)?') { $quantity = [Math]::Abs([double]($matches[0] -replace ',', '')) }
            [ordered]@{ itemName = $itemNode.InnerText.Trim(); quantity = $quantity }
        })
        [ordered]@{
            masterId = $id; date = if ($dateNode) { $dateNode.InnerText.Trim() } else { '' }; voucherNumber = if ($voucherNumberNode) { $voucherNumberNode.InnerText.Trim() } else { '' }
            voucherType = if ($voucherTypeNode) { $voucherTypeNode.InnerText.Trim() } else { '' }
            reference = if ($voucher.REFERENCE) { $voucher.REFERENCE.InnerText.Trim() } else { $null }
            party = if ($partyNode) { $partyNode.InnerText.Trim() } else { '' }
            cancelled = $voucher.ISCANCELLED.InnerText -eq 'Yes'; optional = $voucher.ISOPTIONAL.InnerText -eq 'Yes'
            lineItems = $lines
        }
    })
}

function Get-TrustedSalesSnapshot($Snapshot, [string]$Company) {
    if ($null -eq $Snapshot -or $Snapshot.company -ne $Company -or $Snapshot.sourceScope -ne 'sales_vouchers_v1') { return $null }
    if ($null -eq $Snapshot.records) { return $null }
    return $Snapshot
}

function Get-SalesWindow([datetime]$Today, [string]$ReconciledAt, [int]$RecentDays = 7, [int]$ReconcileDays = 30, [int]$ReconcileHours = 24) {
    $requiresReconciliation = $true
    if (-not [string]::IsNullOrWhiteSpace($ReconciledAt)) {
        try {
            $stamp = [datetimeoffset]::Parse($ReconciledAt)
            $requiresReconciliation = $stamp -gt [datetimeoffset]::UtcNow.AddMinutes(5) -or $stamp -le [datetimeoffset]::UtcNow.AddHours(-$ReconcileHours)
        } catch { $requiresReconciliation = $true }
    }
    $days = if ($requiresReconciliation) { $ReconcileDays } else { $RecentDays }
    return [pscustomobject]@{ fromDate = $Today.AddDays(-$days).ToString('yyyyMMdd'); reconciliation = $requiresReconciliation }
}

function Convert-RowsToLastSupplyBaseline($Rows) {
    $baseline = @{}
    foreach ($row in @($Rows)) {
        $item = ([string]$row.item).Trim()
        $suppliedDate = ([string]$row.lastSuppliedDate).Trim()
        if (-not $item -or -not $suppliedDate) { continue }
        $dateKey = $suppliedDate -replace '[^0-9]', ''
        if ($dateKey.Length -ne 8) {
            try { $dateKey = ([datetime]::Parse($suppliedDate)).ToString('yyyyMMdd') } catch { continue }
        }
        $baseline[$item] = [ordered]@{
            dateKey = $dateKey
            party = [string]$row.lastSuppliedParty
            quantity = if ($null -eq $row.lastSuppliedQty) { 0 } else { [double]$row.lastSuppliedQty }
            date = $suppliedDate
        }
    }
    return $baseline
}

function Save-ConnectorSnapshot([string]$Path, $Snapshot) {
    $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        $json = @{ schemaVersion = 1; snapshot = $Snapshot } | ConvertTo-Json -Depth 12 -Compress
        [IO.File]::WriteAllText($temporary, $json, [Text.UTF8Encoding]::new($false))
        if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temporary, $Path, "$Path.bak") }
        else { [IO.File]::Move($temporary, $Path) }
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

function Read-ConnectorSnapshot([string]$Path, [string]$Company) {
    try {
        $saved = [IO.File]::ReadAllText($Path) | ConvertFrom-Json
        if ($saved.schemaVersion -ne 1 -or $saved.snapshot.company -ne $Company) { return $null }
        $stamp = [datetimeoffset]::Parse($saved.snapshot.fetchedAtIso)
        if ($stamp -gt [datetimeoffset]::UtcNow.AddMinutes(5)) { return $null }
        if ($null -eq $saved.snapshot.catalog -or $null -eq $saved.snapshot.tallyInvoices) { return $null }
        return $saved.snapshot
    } catch { return $null }
}

function Read-CustomerSnapshot([string]$Path, [string]$Company) {
    try {
        $saved = [IO.File]::ReadAllText($Path) | ConvertFrom-Json
        if ($saved.schemaVersion -ne 1 -or $saved.snapshot.company -ne $Company) { return $null }
        $stamp = [datetimeoffset]::Parse($saved.snapshot.fetchedAtIso)
        if ($stamp -gt [datetimeoffset]::UtcNow.AddMinutes(5) -or $null -eq $saved.snapshot.customers -or @($saved.snapshot.customers).Count -eq 0) { return $null }
        return $saved.snapshot
    } catch { return $null }
}

function Read-CatalogSnapshot([string]$Path, [string]$Company) {
    try {
        $saved = [IO.File]::ReadAllText($Path) | ConvertFrom-Json
        if ($saved.schemaVersion -ne 1 -or $saved.snapshot.company -ne $Company -or [string]::IsNullOrWhiteSpace([string]$saved.snapshot.document)) { return $null }
        $stamp = [datetimeoffset]::Parse($saved.snapshot.fetchedAtIso)
        if ($stamp -gt [datetimeoffset]::UtcNow.AddMinutes(5)) { return $null }
        [xml]$document = [string]$saved.snapshot.document
        if (-not $document.SelectSingleNode('//STOCKITEM')) { return $null }
        return $saved.snapshot
    } catch { return $null }
}

function Assert-TallyCompanyIdentity([xml]$Document, [string]$ExpectedCompany) {
    $expected = $ExpectedCompany.Trim()
    if (-not $expected) { throw 'Expected Tally company is not configured.' }
    $companies = @($Document.SelectNodes('//COMPANY') | ForEach-Object {
        $name = ([string]$_.GetAttribute('NAME')).Trim()
        if (-not $name) {
            $nameNode = $_.SelectSingleNode('./NAME')
            if ($nameNode) { $name = $nameNode.InnerText.Trim() }
        }
        if ($name) { $name }
    })
    if ($companies.Count -ne 1 -or -not [string]::Equals($companies[0], $expected, [StringComparison]::OrdinalIgnoreCase)) {
        $actual = if ($companies.Count) { $companies -join ', ' } else { 'not reported' }
        throw "Tally company check failed. Expected '$expected'; received '$actual'. No data was merged or uploaded."
    }
}
