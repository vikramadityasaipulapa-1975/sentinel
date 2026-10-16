$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$toolDirectory = Join-Path $repoRoot '.tools/postgres'
$archivePath = Join-Path $toolDirectory 'postgresql-17.11-1-windows-x64-binaries.zip'
$expectedHash = '6EABDF00D2893713B75DB4336A23C3FDF505F056E217EC6E2E95D901750CFEA3'
New-Item -ItemType Directory -Force -Path $toolDirectory | Out-Null
if (-not (Test-Path -LiteralPath $archivePath)) {
    Invoke-WebRequest -Uri 'https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip' -OutFile $archivePath -TimeoutSec 180
}
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $expectedHash) {
    throw 'Archive differs from the official HTTPS download measured for this project'
}
# Extract only server/client runtime files, not pgAdmin/StackBuilder.
@'
import pathlib, sys, zipfile
root = pathlib.Path(sys.argv[1]).resolve()
with zipfile.ZipFile(root / 'postgresql-17.11-1-windows-x64-binaries.zip') as archive:
    for entry in archive.infolist():
        if entry.filename.startswith(('pgsql/bin/', 'pgsql/lib/', 'pgsql/share/')) or entry.filename == 'pgsql/server_license.txt':
            if not (root / entry.filename).resolve().is_relative_to(root):
                raise RuntimeError('Unsafe archive path')
            archive.extract(entry, root)
'@ | & (Join-Path $repoRoot '.venv/Scripts/python.exe') - $toolDirectory
if ($LASTEXITCODE -ne 0) { throw 'Server extraction failed' }
& (Join-Path $toolDirectory 'pgsql/bin/postgres.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL runtime check failed' }
