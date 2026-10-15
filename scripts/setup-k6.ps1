$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$toolDirectory = Join-Path $repoRoot '.tools/k6'
$version = 'v1.8.2'
$archiveName = "k6-$version-windows-amd64.zip"
New-Item -ItemType Directory -Force -Path $toolDirectory | Out-Null
$archivePath = Join-Path $toolDirectory $archiveName
$checksumsPath = Join-Path $toolDirectory "k6-$version-checksums.txt"
$releaseUrl = "https://github.com/grafana/k6/releases/download/$version"
Invoke-WebRequest -Uri "$releaseUrl/$archiveName" -OutFile $archivePath -TimeoutSec 120
Invoke-WebRequest -Uri "$releaseUrl/k6-$version-checksums.txt" -OutFile $checksumsPath -TimeoutSec 30
$checksumLine = Get-Content -LiteralPath $checksumsPath | Where-Object { $_ -match "\s+\*?$([regex]::Escape($archiveName))$" }
if (@($checksumLine).Count -ne 1) { throw 'Expected exactly one archive checksum' }
$expectedHash = ($checksumLine.Trim() -split '\s+')[0]
$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if ($expectedHash -notmatch '^[a-fA-F0-9]{64}$' -or $actualHash -ne $expectedHash) {
    throw 'k6 archive checksum mismatch'
}
Expand-Archive -LiteralPath $archivePath -DestinationPath $toolDirectory -Force
$executable = Join-Path $toolDirectory "k6-$version-windows-amd64/k6.exe"
& $executable version
if ($LASTEXITCODE -ne 0) { throw 'k6 executable failed' }
Write-Output "Verified SHA256: $actualHash"
