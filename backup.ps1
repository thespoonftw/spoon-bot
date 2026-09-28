param([string]$Dest = "F:\spoon-bot-backup", [int]$KeepWeeks = 8)

$ErrorActionPreference = "Stop"
$plink = "C:\Program Files\PuTTY\plink.exe"
$pscp = "C:\Program Files\PuTTY\pscp.exe"
$password = (Get-Content (Join-Path $PSScriptRoot ".server-password") -Raw).Trim()
$auth = @("-batch", "-pw", $password, "-hostkey", "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0")
$server = "spoon@192.168.1.50"

function Remote([string]$cmd) {
    $out = & $plink @auth $server $cmd
    if ($LASTEXITCODE -ne 0) { throw "Remote command failed: $cmd" }
    $out
}

$stamp = Get-Date -Format "yyyy-MM-dd"
$dataDir = Join-Path $Dest "data"
$photosDir = Join-Path $Dest "photos"
New-Item -ItemType Directory -Force $dataDir, $photosDir | Out-Null
Start-Transcript -Append (Join-Path $Dest "backup.log") | Out-Null

try {
    # Copy the DB with SQLite's backup API so a write mid-copy can't corrupt it, then bundle it
    # with the JSON state files. Prints the photo folder (PHOTO_STORAGE_PATH or data-snek/photos).
    # No double quotes: PowerShell 5.1 strips them when passing args to plink, so JS strings use backticks.
    Write-Host "Snapshotting data on server..."
    $photoDir = (Remote ('cd /home/spoon/spoon-bot && set -a && . ./.env.snek && set +a && rm -rf /tmp/snek-backup && mkdir -p /tmp/snek-backup && ' +
        'node -e ''require(`better-sqlite3`)(`data-snek/snek.db`,{readonly:true}).backup(`/tmp/snek-backup/snek.db`).then(()=>{},e=>{console.error(e);process.exit(1)})'' && ' +
        'find data-snek -maxdepth 1 -type f ! -name snek.db\* -exec cp {} /tmp/snek-backup/ \; && ' +
        'tar czf /tmp/snek-data.tar.gz -C /tmp/snek-backup . && rm -rf /tmp/snek-backup && ' +
        'node -e ''console.log(require(`path`).resolve(process.env.PHOTO_STORAGE_PATH ?? `data-snek/photos`))''') | Select-Object -Last 1).Trim()

    Write-Host "Downloading data..."
    & $pscp @auth -q "${server}:/tmp/snek-data.tar.gz" (Join-Path $dataDir "snek-data-$stamp.tar.gz")
    if ($LASTEXITCODE -ne 0) { throw "Data download failed" }
    Remote "rm -f /tmp/snek-data.tar.gz" | Out-Null

    Get-ChildItem $dataDir -Filter "snek-data-*.tar.gz" | Sort-Object Name -Descending |
        Select-Object -Skip $KeepWeeks | Remove-Item

    # Photos: only fetch files missing locally (or with a different size), bundled into one tar.
    Write-Host "Checking photos in $photoDir..."
    $missing = foreach ($line in (Remote "cd '$photoDir' && find . -type f -printf '%P\t%s\n'")) {
        $rel, $size = $line -split "`t"
        $local = Join-Path $photosDir $rel
        if (-not (Test-Path -LiteralPath $local) -or (Get-Item -LiteralPath $local).Length -ne [long]$size) { $rel }
    }

    if ($missing) {
        Write-Host "Downloading $(@($missing).Count) new photo(s)..."
        $list = Join-Path $env:TEMP "snek-photo-list.txt"
        $tarFile = Join-Path $env:TEMP "snek-photos.tar"
        [IO.File]::WriteAllText($list, (($missing -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false))
        & $pscp @auth -q $list "${server}:/tmp/snek-photo-list.txt"
        if ($LASTEXITCODE -ne 0) { throw "Photo list upload failed" }
        Remote "tar cf /tmp/snek-photos.tar -C '$photoDir' -T /tmp/snek-photo-list.txt" | Out-Null
        & $pscp @auth -q "${server}:/tmp/snek-photos.tar" $tarFile
        if ($LASTEXITCODE -ne 0) { throw "Photo download failed" }
        Remote "rm -f /tmp/snek-photos.tar /tmp/snek-photo-list.txt" | Out-Null
        & "$env:SystemRoot\System32\tar.exe" -xf $tarFile -C $photosDir
        if ($LASTEXITCODE -ne 0) { throw "Photo extract failed" }
        Remove-Item $list, $tarFile
    } else {
        Write-Host "No new photos."
    }

    Write-Host "Backup done: $stamp"
} finally {
    Stop-Transcript | Out-Null
}
