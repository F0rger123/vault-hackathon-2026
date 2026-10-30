# PyInstaller recipe for the VAULT app (F12.12). Run through packaging/build_windows.ps1.
# Onedir, not onefile: it starts faster, and it does not unpack itself to a temp folder on every launch.
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

ROOT = Path(SPECPATH).parent
UI = ROOT / "frontend" / "out"
if not (UI / "index.html").is_file():
    raise SystemExit("frontend/out is missing. Build it first with VAULT_STATIC_EXPORT=1 (see build_windows.ps1).")

ICON = UI / "favicon.ico"

a = Analysis(
    [str(ROOT / "packaging" / "vault_app.py")],
    pathex=[str(ROOT)],
    # Only named files ship: the exported interface and the libraries' own data. Never data/, .env or tokens.
    datas=[(str(UI), "ui"), *collect_data_files("reportlab"), *collect_data_files("webview")],
    hiddenimports=[*collect_submodules("backend"), *collect_submodules("uvicorn")],
    excludes=["generator", "evaluation", "cli", "pytest", "tkinter", "IPython", "bandit", "ruff"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="VAULT",
    # A desktop app: no black console window behind it.
    console=False,
    icon=str(ICON) if ICON.is_file() else None,
)
coll = COLLECT(exe, a.binaries, a.datas, name="VAULT")
