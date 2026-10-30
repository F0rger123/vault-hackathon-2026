"""Start VAULT with one command (F12.9).

    .\\start.ps1            (Windows)          ./start.sh            (macOS/Linux)
    .\\start.ps1 --real     your own documents, password sign-in, no demo buttons
    .\\start.ps1 --app      open VAULT in its own window instead of a browser tab (Windows and Linux)

What it does, printing each step in plain words:
1. Installs the Python and web dependencies the first time.
2. Checks for Ollama and the Meta Llama 3 model. Without them VAULT still runs, with the rules baseline.
   It never downloads a model by itself; it tells you the one command to run.
3. Demo (default): builds the fictional demo archive once, with one-click demo sign-in.
   Real (--real): uses data/runtime. The first time, the setup wizard creates the owner account.
4. Starts the API on 127.0.0.1:8000 and the interface on localhost:3000, then opens your browser,
   or with --app a native window. Press Ctrl+C (or close the window) to stop both.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
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
API_PORT = 8000
UI_PORT = 3000
DESKTOP_MISSING = (
    'The desktop window needs pywebview: run  .venv/{bin}/python -m pip install -e ".[desktop]"  '
    "(see docs/DEPLOYMENT.md). Opening your browser instead."
).format(bin="Scripts" if WIN else "bin")
# Next.js can send anonymous usage data during install, build and start. VAULT keeps everything on the machine, so
# every child process (npm ci, next build, next start) inherits this.
os.environ["NEXT_TELEMETRY_DISABLED"] = "1"


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


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Start VAULT")
    ap.add_argument("--real", action="store_true", help="use your own documents (password sign-in, no demo buttons)")
    ap.add_argument("--app", action="store_true", help="open VAULT in its own window instead of a browser tab")
    ap.add_argument("--no-browser", action="store_true", help="start the servers only")
    ap.add_argument(
        "--smoke-test",
        action="store_true",
        help="with --app: open the window, print the page title, close it and stop (checks the desktop app works)",
    )
    ap.add_argument("--api-port", type=int, default=API_PORT, help=f"API port on 127.0.0.1 (default {API_PORT})")
    ap.add_argument("--ui-port", type=int, default=UI_PORT, help=f"interface port on 127.0.0.1 (default {UI_PORT})")
    args = ap.parse_args(argv)
    if args.smoke_test:
        args.app = True
    for port in (args.api_port, args.ui_port):
        if not 1024 <= port <= 65535:
            ap.error(f"port {port} must be between 1024 and 65535")
    if args.api_port == args.ui_port:
        ap.error("the API and the interface need different ports")
    return args


def port_env(api_port: int, ui_port: int) -> dict[str, str]:
    """Settings for non-default ports. Empty for the defaults, so a normal start behaves exactly as before.

    The interface has the API address built in, so another API port gets its own build folder and never
    overwrites the normal build. The API only accepts the interface's own origin (CORS), so that follows the UI port.
    """
    env: dict[str, str] = {}
    if api_port != API_PORT:
        env["NEXT_PUBLIC_VAULT_API"] = f"http://127.0.0.1:{api_port}"
        env["VAULT_NEXT_DIST_DIR"] = f".next-api{api_port}"
    if ui_port != UI_PORT:
        env["VAULT_CORS_ORIGINS"] = f"http://localhost:{ui_port},http://127.0.0.1:{ui_port}"
    return env


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
    build_id = FRONTEND / os.environ.get("VAULT_NEXT_DIST_DIR", ".next") / "BUILD_ID"
    newest_src = max(p.stat().st_mtime for p in (FRONTEND / "src").rglob("*") if p.is_file())
    if not build_id.exists() or build_id.stat().st_mtime < newest_src:
        say("Building the interface (about a minute, only after updates).")
        # `next build` adds its build folder to tsconfig.json. For a build on another port that would leave a
        # port-specific change in the checkout, so put the file back as it was.
        tsconfig = FRONTEND / "tsconfig.json"
        before = tsconfig.read_bytes()
        try:
            run([NPM, "run", "build"], cwd=FRONTEND, stdout=subprocess.DEVNULL)
        finally:
            if tsconfig.read_bytes() != before:
                tsconfig.write_bytes(before)
    else:
        say("ready")


def desktop_ready() -> bool:
    """True when the native window can be opened. Installs pywebview the first time, like the other pieces."""
    step("Desktop window")
    check = [str(VENV_PY), "-c", "import webview"]
    if subprocess.run(check, capture_output=True).returncode == 0:  # noqa: S603
        say("ready")
        return True
    say("First run of the desktop app: installing the window component (pywebview).")
    install = [str(VENV_PY), "-m", "pip", "install", "-q", "-e", f"{ROOT}[desktop]"]
    if subprocess.run(install).returncode == 0 and subprocess.run(check, capture_output=True).returncode == 0:  # noqa: S603
        say("ready")
        return True
    say(DESKTOP_MISSING)
    return False


def open_window(url: str, smoke_test: bool) -> subprocess.Popen:
    cmd = [str(VENV_PY), str(ROOT / "scripts" / "desktop.py"), url]
    return subprocess.Popen(cmd + (["--smoke-test"] if smoke_test else []), cwd=ROOT)  # noqa: S603


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
        # With no account yet, the interface opens the setup wizard, which creates the owner.
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


def spawn(cmd: list[str], **kw) -> subprocess.Popen:
    # On Linux and macOS each server gets its own process group, so stop() can end npm, next and their children
    # together. Windows uses taskkill /T for the same job.
    return subprocess.Popen(cmd, start_new_session=not WIN, **kw)  # noqa: S603


def stop(p: subprocess.Popen) -> None:
    """Stop a server and every process it started. `npm run start` runs node under a shell, and ending only the
    shell would leave the interface running on its port."""
    if p.poll() is not None:
        return
    if WIN:
        subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True)  # noqa: S603, S607
    else:
        try:
            os.killpg(p.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        p.wait(timeout=10)
    except subprocess.TimeoutExpired:
        if not WIN:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        p.kill()
        p.wait(timeout=5)


def _exit_on_signal(signum, _frame) -> None:
    raise SystemExit(128 + signum)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    print("VAULT: private document intelligence, running on this computer.")

    for port in (args.api_port, args.ui_port):
        if not port_free(port):
            sys.exit(
                f"\n  Port {port} is already in use. Close the other VAULT window (or that program) and try again."
            )
    os.environ.update(port_env(args.api_port, args.ui_port))

    ensure_python()
    ensure_frontend()
    check_ollama()
    env = prepare_data(args.real)
    app = args.app and desktop_ready()

    # A closed terminal (SIGHUP) or `kill` (SIGTERM) must still stop both servers.
    for name in ("SIGTERM", "SIGHUP"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), _exit_on_signal)

    step("Starting")
    procs: list[subprocess.Popen] = []
    window: subprocess.Popen | None = None
    code = 0
    try:
        procs.append(
            spawn(
                [
                    str(VENV_PY),
                    "-m",
                    "uvicorn",
                    "backend.main:create_app",
                    "--factory",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(args.api_port),
                ],
                cwd=ROOT,
                env=env,
            )
        )
        # Bound to this computer only, like the API: never reachable from the local network.
        procs.append(
            spawn([NPM, "run", "start", "--", "-p", str(args.ui_port), "-H", "127.0.0.1"], cwd=FRONTEND, env=env)
        )
        for _ in range(60):
            if get_json(f"http://127.0.0.1:{args.api_port}/api/v1/health") and not port_free(args.ui_port):
                break
            time.sleep(1)
        else:
            say("VAULT did not start within a minute; see the messages above.")
        url = f"http://localhost:{args.ui_port}"
        say(f"VAULT is running at {url}")
        say(
            "Sign in with the Demo buttons."
            if not args.real
            else "Follow the setup wizard the first time, then sign in."
        )
        if app:
            window = open_window(url, args.smoke_test)
            say("Close the VAULT window (or press Ctrl+C here) to stop VAULT.")
        else:
            say("Press Ctrl+C here to stop VAULT.")
            if not args.no_browser:
                webbrowser.open(url)
        while all(p.poll() is None for p in procs):
            if window is not None and window.poll() is not None:
                if window.returncode == 0 or args.smoke_test:
                    code = window.returncode
                    break  # the window was closed: stop VAULT
                say("The VAULT window could not open (on Linux, see the system packages in docs/DEPLOYMENT.md).")
                say("Opening your browser instead. Press Ctrl+C here to stop VAULT.")
                window = None
                if not args.no_browser:
                    webbrowser.open(url)
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        for p in ([window] if window else []) + procs[::-1]:
            stop(p)
        print("\nVAULT stopped.")
    return code


if __name__ == "__main__":
    sys.exit(main())
