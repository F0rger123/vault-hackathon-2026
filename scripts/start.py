"""Start VAULT with one command (F12.9).

    .\\start.ps1            (Windows)          ./start.sh            (macOS/Linux)
    .\\start.ps1 --real     your own documents, password sign-in, no demo buttons

What it does, printing each step in plain words:
1. Installs the Python and web dependencies the first time.
2. Checks for Ollama and the Meta Llama 3 model. Without them VAULT still runs, with the rules baseline.
   It never downloads a model by itself; it tells you the one command to run.
3. Demo (default): builds the fictional demo archive once, with one-click demo sign-in.
   Real (--real): uses data/runtime and asks you to set an administrator password the first time.
4. Starts the API on 127.0.0.1:8000 and the interface on localhost:3000, then opens your browser.
   Press Ctrl+C to stop both.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
WIN = os.name == "nt"
VENV_PY = ROOT / ".venv" / ("Scripts/python.exe" if WIN else "bin/python")
VAULT = ROOT / ".venv" / ("Scripts/vault.exe" if WIN else "bin/vault")
NPM = "npm.cmd" if WIN else "npm"
OLLAMA = "http://127.0.0.1:11434"
MODEL = os.environ.get("VAULT_OLLAMA_MODEL", "llama3:latest")


def say(msg: str) -> None:
    print(f"  {msg}", flush=True)


def step(msg: str) -> None:
    print(f"\n> {msg}", flush=True)


def run(cmd: list[str], **kw) -> None:
    subprocess.run(cmd, check=True, **kw)  # noqa: S603


def port_free(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def get_json(url: str, timeout: float = 2) -> dict | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310 - fixed local URLs only
            return json.loads(r.read())
    except (OSError, ValueError):
        return None


def ensure_python() -> None:
    step("Python packages")
    if not VENV_PY.exists():
        say("First run: creating .venv and installing VAULT (a minute or two).")
        run([sys.executable, "-m", "venv", str(ROOT / ".venv")])
        run([str(VENV_PY), "-m", "pip", "install", "-q", "-e", str(ROOT)])
    else:
        say("ready")


def ensure_frontend() -> None:
    step("Web interface")
    if not shutil.which(NPM):
        sys.exit("  Node.js is not installed. Get version 20 or newer from https://nodejs.org, then run this again.")
    if not (FRONTEND / "node_modules").exists():
        say("First run: installing the interface's packages (a minute or two).")
        run([NPM, "ci", "--no-audit", "--no-fund"], cwd=FRONTEND)
    build_id = FRONTEND / ".next" / "BUILD_ID"
    newest_src = max(p.stat().st_mtime for p in (FRONTEND / "src").rglob("*") if p.is_file())
    if not build_id.exists() or build_id.stat().st_mtime < newest_src:
        say("Building the interface (about a minute, only after updates).")
        run([NPM, "run", "build"], cwd=FRONTEND, stdout=subprocess.DEVNULL)
    else:
        say("ready")


def check_ollama() -> str:
    step("Local AI (Meta Llama 3 through Ollama)")
    tags = get_json(f"{OLLAMA}/api/tags")
    if tags is None:
        say("Ollama is not running. VAULT will still work with the rules baseline (labelled 'not AI').")
        say("For real AI reading: install Ollama from https://ollama.com/download, start it, then:")
        say(f"    ollama pull {MODEL.split(':')[0]}      (about 4.7 GB, once)")
        return "heuristic"
    names = {m.get("name") for m in tags.get("models", [])}
    if MODEL not in names:
        say(f"Ollama is running, but {MODEL} is not downloaded. Run this once (about 4.7 GB):")
        say(f"    ollama pull {MODEL.split(':')[0]}")
        say("Until then VAULT uses the rules baseline.")
        return "heuristic"
    say(f"{MODEL} is ready. Documents are read by Meta Llama 3 on this computer.")
    return "ollama"


def prepare_data(real: bool) -> dict:
    env = {**os.environ}
    if real:
        step("Your data (Real mode)")
        data = ROOT / "data" / "runtime"
        env.update(VAULT_DATA_DIR=str(data), VAULT_DEMO_LOGIN="false")
        if not (data / "vault.db").exists():
            run([str(VAULT), "init"], env=env, stdout=subprocess.DEVNULL)
        users = subprocess.run(  # noqa: S603
            [str(VENV_PY), "-c", _ADMIN_READY_SCRIPT], env=env, capture_output=True, text=True, check=True
        ).stdout.strip()
        if users == "no":
            say("Create the administrator account (you will sign in with it).")
            run([str(VAULT), "token", "admin", "--role", "admin"], env=env, stdout=subprocess.DEVNULL)
            while subprocess.run([str(VAULT), "set-password", "admin"], env=env).returncode != 0:  # noqa: S603
                say("Try again (at least 10 characters, typed the same twice).")
        say(f"data folder: {data}")
    else:
        step("Demo archive (fictional documents)")
        data = ROOT / "data" / "demo"
        env.update(VAULT_DATA_DIR=str(data), VAULT_DEMO_LOGIN="true")
        if not (data / "vault.db").exists():
            say("First run: building the demo archive (about 15 seconds).")
            run(
                [str(VENV_PY), str(ROOT / "scripts" / "demo_reset.py"), "--data-dir", str(data)],
                stdout=subprocess.DEVNULL,
            )
        else:
            say("ready. Reset it any time with scripts/demo_reset.ps1 (or .sh).")
    env.setdefault("VAULT_ALLOW_REMOTE_INFERENCE", "false")
    return env


_ADMIN_READY_SCRIPT = (
    "from backend.core.config import get_settings;from backend.storage.db import connect;"
    "c=connect(get_settings().db_path).__enter__();"
    "print('yes' if c.execute('SELECT 1 FROM users WHERE password_hash IS NOT NULL').fetchone() else 'no')"
)


def main() -> int:
    ap = argparse.ArgumentParser(description="Start VAULT")
    ap.add_argument("--real", action="store_true", help="use your own documents (password sign-in, no demo buttons)")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    print("VAULT: private document intelligence, running on this computer.")

    for port in (8000, 3000):
        if not port_free(port):
            sys.exit(
                f"\n  Port {port} is already in use. Close the other VAULT window (or that program) and try again."
            )

    ensure_python()
    ensure_frontend()
    check_ollama()
    env = prepare_data(args.real)

    step("Starting")
    api = subprocess.Popen(  # noqa: S603
        [
            str(VENV_PY),
            "-m",
            "uvicorn",
            "backend.main:create_app",
            "--factory",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
        ],
        cwd=ROOT,
        env=env,
    )
    # Bound to this computer only, like the API: never reachable from the local network.
    web = subprocess.Popen([NPM, "run", "start", "--", "-p", "3000", "-H", "127.0.0.1"], cwd=FRONTEND, env=env)  # noqa: S603
    for _ in range(60):
        if get_json("http://127.0.0.1:8000/api/v1/health") and not port_free(3000):
            break
        time.sleep(1)
    else:
        say("VAULT did not start within a minute; see the messages above.")
    url = "http://localhost:3000"
    say(f"VAULT is running at {url}")
    say("Sign in with the Demo buttons." if not args.real else "Sign in as admin with the password you set.")
    say("Press Ctrl+C here to stop VAULT.")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        while api.poll() is None and web.poll() is None:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        for p in (web, api):
            if p.poll() is None:
                p.terminate()
                try:
                    p.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    p.kill()
        print("\nVAULT stopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
