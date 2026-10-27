# Reset the demo environment (F12.6). Arguments pass through, e.g. -- --provider ollama.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
& .\.venv\Scripts\python.exe scripts\demo_reset.py @args
exit $LASTEXITCODE
