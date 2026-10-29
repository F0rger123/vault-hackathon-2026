# Start VAULT (F12.9). Usage: .\start.ps1   or   .\start.ps1 --real
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = (Get-Command python -ErrorAction SilentlyContinue).Source }
if (-not $py) { Write-Host "Python 3.11 or newer is needed: https://www.python.org/downloads/"; exit 1 }
& $py scripts\start.py @args
exit $LASTEXITCODE
