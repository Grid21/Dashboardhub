# Dashboard Hub - downloads the official Node.js LTS as a plain zip and unpacks it into your own folder (Windows).
# Started by ENSURE-NODE.bat only when Node.js is missing or too old. Exit code 0 means it is ready.
# This does NOT run the Node.js installer: nothing is installed system-wide, no administrator permission is
# needed, and no drivers or services are touched. It is only a download and a folder.

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
$ProgressPreference = 'SilentlyContinue'      # makes downloads much faster in Windows PowerShell 5

$dist = if ($env:NODE_DIST_URL) { $env:NODE_DIST_URL } else { 'https://nodejs.org/dist' }
$dest = if ($env:HUB_NODE_DIR) { $env:HUB_NODE_DIR } else { Join-Path $env:LOCALAPPDATA 'dashboard-hub-node' }
$work = Join-Path $env:TEMP ('dashboard-hub-node-' + [guid]::NewGuid().ToString('N'))

try {
    Write-Host 'Looking up the current Node.js LTS version...'
    $list = Invoke-RestMethod -Uri "$dist/index.json" -UseBasicParsing
    $ver = ($list | Where-Object { $_.lts } | Select-Object -First 1).version
    if (-not $ver) { throw 'Could not read the Node.js version list.' }

    $arch = 'x64'
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { $arch = 'arm64' }
    $name = "node-$ver-win-$arch"
    $file = "$name.zip"
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    $zip = Join-Path $work $file

    Write-Host "Downloading Node.js $ver ($arch). This is about 35 MB..."
    Invoke-WebRequest -Uri "$dist/$ver/$file" -OutFile $zip -UseBasicParsing

    # make sure the download is exactly what nodejs.org published
    $sums = (Invoke-WebRequest -Uri "$dist/$ver/SHASUMS256.txt" -UseBasicParsing).Content
    $line = ($sums -split "`n") | Where-Object { $_.Trim().EndsWith($file) } | Select-Object -First 1
    if (-not $line) { throw 'Could not find the checksum for this download, so it was not used.' }
    $want = ($line.Trim() -split '\s+')[0].ToLower()
    $got = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLower()
    if ($want -ne $got) { throw 'The downloaded file did not pass its safety check, so it was NOT used.' }
    Write-Host 'Download checked: OK.'

    Write-Host "Unpacking into $dest ..."
    $tmpOut = Join-Path $work 'unpacked'
    Expand-Archive -Path $zip -DestinationPath $tmpOut -Force
    $inner = Join-Path $tmpOut $name
    if (-not (Test-Path (Join-Path $inner 'node.exe'))) { throw 'The download did not contain node.exe.' }
    if (Test-Path $dest) { Remove-Item -Path $dest -Recurse -Force }
    New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
    Move-Item -Path $inner -Destination $dest
    exit 0
}
catch {
    Write-Host ''
    Write-Host ('Problem: ' + $_.Exception.Message)
    Write-Host 'You can also install it by hand from https://nodejs.org (the LTS button).'
    exit 1
}
finally {
    if (Test-Path $work) { Remove-Item -Path $work -Recurse -Force -ErrorAction SilentlyContinue }
}
