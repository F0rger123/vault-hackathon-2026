<#
.SYNOPSIS
  Builds the VAULT Windows app (F12.12): static interface, portable folder and zip, then the installer if it can.
.DESCRIPTION
  Writes to dist\ (git-ignored). Each deliverable gets a .sha256 file next to it.
  If Inno Setup is not installed, the script stops after the portable zip and says so.
.PARAMETER SkipSmoke
  Do not open the built app to check it.
.PARAMETER RequireInstaller
  Fail, rather than stop cleanly, when Inno Setup is missing. CI uses this.
#>
[CmdletBinding()]
param(
    [switch]$SkipSmoke,
    [switch]$RequireInstaller
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root "dist"
$App = Join-Path $Dist "VAULT"
$Py = Join-Path $Root ".venv\Scripts\python.exe"

function Step([string]$Text) { Write-Host "`n== $Text" -ForegroundColor Cyan }

# PowerShell 5.1 does not stop on a failing program by itself.
function Invoke-Checked([string]$What, [scriptblock]$Command) {
    # Local to this function: warnings a program writes to stderr must not stop the script. Its exit code decides.
    $ErrorActionPreference = "Continue"
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}

function Write-Sha256([string]$Path) {
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
    $name = Split-Path -Leaf $Path
    # Same layout as sha256sum, and written without a BOM so `sha256sum -c` also accepts it.
    [IO.File]::WriteAllText("$Path.sha256", "$hash  $name`n", (New-Object Text.UTF8Encoding $false))
    Write-Host "  $name  SHA-256 $hash"
}

Step "Python packages"
if (-not (Test-Path $Py)) {
    Invoke-Checked "Creating .venv" { python -m venv (Join-Path $Root ".venv") }
}
Push-Location $Root
try {
    $ErrorActionPreference = "Continue"
    & $Py -m pip --version *> $null
    $HasPip = $LASTEXITCODE -eq 0
    $ErrorActionPreference = "Stop"
    if ($HasPip) {
        Invoke-Checked "pip install" { & $Py -m pip install -q -e ".[installer]" }
    } else {
        # A venv made by uv has no pip.
        Invoke-Checked "uv pip install" { uv pip install -q --python $Py -e ".[installer]" }
    }
    $Version = (& $Py -c "import tomllib; print(tomllib.load(open('pyproject.toml', 'rb'))['project']['version'])").Trim()
    Write-Host "  version $Version"

    Step "Web interface (static export)"
    Push-Location (Join-Path $Root "frontend")
    try {
        if (-not (Test-Path "node_modules")) { Invoke-Checked "npm ci" { npm ci --no-audit --no-fund } }
        if (Test-Path "out") { Remove-Item -Recurse -Force "out" }
        $env:VAULT_STATIC_EXPORT = "1"
        Invoke-Checked "next build" { npx next build }
    } finally {
        Remove-Item Env:\VAULT_STATIC_EXPORT -ErrorAction SilentlyContinue
        Pop-Location
    }

    Step "Portable folder"
    if (Test-Path $App) { Remove-Item -Recurse -Force $App }
    Invoke-Checked "PyInstaller" {
        & $Py -m PyInstaller (Join-Path $PSScriptRoot "vault.spec") --noconfirm --clean `
            --distpath $Dist --workpath (Join-Path $Root "build\pyinstaller")
    }
    Invoke-Checked "Bundle check" { & $Py (Join-Path $PSScriptRoot "check_bundle.py") $App }

    if (-not $SkipSmoke) {
        Step "Smoke test (opens the app window for a few seconds)"
        $SmokeData = Join-Path ([IO.Path]::GetTempPath()) ("vault-smoke-" + [guid]::NewGuid())
        $env:VAULT_DATA_DIR = $SmokeData
        try {
            $smoke = Start-Process -FilePath (Join-Path $App "VAULT.exe") -ArgumentList "--smoke-test" -Wait -PassThru
            $report = Join-Path $SmokeData "logs\smoke-test.txt"
            if (Test-Path $report) { Get-Content $report | Write-Host }
            if ($smoke.ExitCode -ne 0) { throw "The smoke test failed with exit code $($smoke.ExitCode)" }
        } finally {
            Remove-Item Env:\VAULT_DATA_DIR -ErrorAction SilentlyContinue
            Remove-Item -Recurse -Force $SmokeData -ErrorAction SilentlyContinue
        }
    }

    Step "Portable zip"
    $Zip = Join-Path $Dist "VAULT-$Version-windows-portable.zip"
    if (Test-Path $Zip) { Remove-Item -Force $Zip }
    Compress-Archive -Path $App -DestinationPath $Zip -CompressionLevel Optimal
    Write-Sha256 $Zip

    Step "Installer"
    $Iscc = @(
        (Get-Command iscc.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source),
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $Iscc) {
        $Message = "Inno Setup 6 is not installed, so no installer was made. The portable app is ready: $Zip. " +
            "To make the installer, install Inno Setup 6 from https://jrsoftware.org/isinfo.php and run this again."
        if ($RequireInstaller) { throw $Message }
        Write-Host "`n$Message" -ForegroundColor Yellow
        exit 0
    }
    Invoke-Checked "Inno Setup" { & $Iscc "/DAppVersion=$Version" (Join-Path $PSScriptRoot "installer.iss") }
    $Setup = Join-Path $Dist "VAULT-Setup-$Version.exe"
    Write-Sha256 $Setup
    Write-Host "`nDone: $Setup (not code-signed; see docs/DEPLOYMENT.md)" -ForegroundColor Green
} finally {
    Pop-Location
}
