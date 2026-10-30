# Start VAULT (F12.9). Usage: .\start.ps1   or   .\start.ps1 --real   or   .\start.ps1 -App (own window)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = (Get-Command python -ErrorAction SilentlyContinue).Source }
if (-not $py) { Write-Host "Python 3.11 or newer is needed: https://www.python.org/downloads/"; exit 1 }
# PowerShell-style switches work too: -App, -Real, -NoBrowser.
$map = @{ '-app' = '--app'; '-real' = '--real'; '-nobrowser' = '--no-browser' }
$pass = @($args | ForEach-Object { if ($map.ContainsKey("$_".ToLower())) { $map["$_".ToLower()] } else { $_ } })
& $py scripts\start.py @pass
exit $LASTEXITCODE
