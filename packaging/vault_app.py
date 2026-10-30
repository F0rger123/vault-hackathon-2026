"""The installed VAULT app (F12.12): one process, one window, no Python or Node.js on the computer.

The API serves the exported interface itself on a free port of 127.0.0.1, and a native window shows it at
http://localhost:<port> (passkeys accept the name localhost, not the number). Closing the window stops the server.

    VAULT.exe                 normal start
    VAULT.exe --smoke-test    open, check the interface and the server, close, confirm the port is free

There is no demo sign-in here: it is a real install. Data lives in the user's own app-data folder, outside the
install folder, so updates and uninstalling leave it alone. VAULT_DATA_DIR moves it, for tests.
"""

from __future__ import annotations

import argparse
import importlib
import io
import logging
import logging.handlers
import multiprocessing
import os
import pkgutil
import socket
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

TITLE = "VAULT"
SIZE = (1280, 860)
MIN_SIZE = (900, 600)
LOOPBACK = "127.0.0.1"
STARTUP_TIMEOUT_S = 30.0
SMOKE_TIMEOUT_S = 60.0
WINDOW_TIMEOUT_S = 60.0

log = logging.getLogger("vault.app")


def default_data_dir() -> Path:
    override = os.environ.get("VAULT_DATA_DIR")
    if override:
        return Path(override)
    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA")
        return Path(local) / "VAULT" if local else Path.home() / "AppData" / "Local" / "VAULT"
    base = os.environ.get("XDG_DATA_HOME")
    return (Path(base) if base else Path.home() / ".local" / "share") / "vault"


def ui_dir() -> Path:
    """The exported interface: next to the code in the built app, frontend/out when run from a checkout."""
    bundled = getattr(sys, "_MEIPASS", None)
    return Path(bundled) / "ui" if bundled else Path(__file__).resolve().parents[1] / "frontend" / "out"


def _exclusive(sock: socket.socket) -> None:
    # Without this, another program on Windows may bind the same port and intercept the traffic.
    if sys.platform == "win32":
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)


def bind_local_socket() -> socket.socket:
    """Reserve a free port on the loopback address only. Holding the socket means nothing can take the port first."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    _exclusive(sock)
    sock.bind((LOOPBACK, 0))
    return sock


def port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        _exclusive(probe)
        try:
            probe.bind((LOOPBACK, port))
        except OSError:
            return False
    return True


def app_url(port: int) -> str:
    return f"http://localhost:{port}"


def build_settings(port: int, data: Path, ui: Path):
    """Arguments beat the environment and .env, so nothing outside can switch on demo sign-in or widen access here.

    The only .env read is in the user's own data folder, never one in wherever the program was started from.
    """
    from backend.core.config import Settings

    return Settings(
        data_dir=data,
        ui_dir=ui,
        cors_origins=app_url(port),
        allowed_hosts="localhost",
        demo_login=False,
        _env_file=data / ".env",
    )


def take_instance_lock(data: Path):
    """Return an open lock file, or None if another VAULT is using this data. Two would run the same jobs twice."""
    handle = open(data / "app.lock", "a+b")  # held open for the life of the process
    try:
        if sys.platform == "win32":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    return handle


def show_message(text: str) -> None:
    print(text, file=sys.stderr, flush=True)
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, text, TITLE, 0x10)


def setup_logging(data: Path) -> None:
    """A windowed app has no console, so sys.stdout and sys.stderr are None and must point somewhere."""
    logs = data / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(
        logs / "vault-app.log", maxBytes=1_000_000, backupCount=2, encoding="utf-8"
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler])
    if sys.stdout is None or sys.stderr is None:
        fallback = open(logs / "vault-app-console.log", "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stdout or fallback
        sys.stderr = sys.stderr or fallback


def start_server(settings, sock: socket.socket):
    """Run uvicorn on a thread. Returns (server, thread) once it is accepting requests."""
    import uvicorn

    from backend.main import create_app

    config = uvicorn.Config(create_app(settings), log_config=None, access_log=False, timeout_graceful_shutdown=5)
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, name="vault-server", daemon=True)
    thread.start()
    deadline = time.monotonic() + STARTUP_TIMEOUT_S
    while not server.started:
        if not thread.is_alive() or time.monotonic() > deadline:
            raise RuntimeError("the VAULT server did not start")
        time.sleep(0.05)
    return server, thread


def stop_server(server, thread: threading.Thread) -> None:
    server.should_exit = True
    thread.join(timeout=15)
    if thread.is_alive():
        server.force_exit = True
        thread.join(timeout=5)


def check_bundle() -> str:
    """Import what a packaged build most often loses: every backend module, and the PDF libraries' data files."""
    from pypdf import PdfReader
    from reportlab.pdfgen import canvas

    import backend

    modules = [m.name for m in pkgutil.walk_packages(backend.__path__, "backend.")]
    for name in modules:
        importlib.import_module(name)
    pdf = io.BytesIO()
    page = canvas.Canvas(pdf)
    page.drawString(72, 720, "VAULT")
    page.save()
    pdf.seek(0)
    if "VAULT" not in PdfReader(pdf).pages[0].extract_text():
        raise RuntimeError("the PDF libraries did not round-trip")
    return f"{len(modules)} backend modules imported, PDF libraries work"


def smoke_check(window, url: str, result: dict) -> None:
    """Runs on pywebview's worker thread: wait for the page, report what shows, then close the window."""
    import httpx

    try:
        if not window.events.loaded.wait(SMOKE_TIMEOUT_S):
            result["error"] = "the page did not load in time"
            return
        # The interface renders its first screen only after asking the API how sign-in works, so wait for that.
        shown = False
        for _ in range(80):
            text = window.evaluate_js("document.body.innerText") or ""
            shown = "Sign in" in text or "Create" in text
            if shown:
                break
            time.sleep(0.25)
        result["title"] = window.evaluate_js("document.title")
        result["path"] = window.evaluate_js("location.pathname")
        result["ui_shown"] = shown
        page = httpx.get(url, timeout=10, trust_env=False)
        health = httpx.get(f"{url}/api/v1/health", timeout=10, trust_env=False)
        result["csp"] = page.headers.get("content-security-policy", "")
        result["health"] = health.status_code
        result["bundle"] = check_bundle()
    except Exception as exc:
        # A smoke test reports every failure instead of leaving the window open.
        result["error"] = repr(exc)
    finally:
        window.destroy()


def watch_window(window, data: Path) -> None:
    """pywebview only logs a WebView2 failure and leaves an empty window, so tell the person what happened."""
    if not window.events.loaded.wait(WINDOW_TIMEOUT_S):
        log.error("the window did not load the interface within %s s", WINDOW_TIMEOUT_S)
        show_message(f"VAULT could not show its window. Microsoft WebView2 may be missing. See {data / 'logs'}.")


def open_window(url: str, smoke_result: dict | None, data: Path) -> None:
    parts = urlsplit(url)
    if parts.scheme != "http" or parts.hostname != "localhost":
        raise ValueError("the window only ever shows the local VAULT interface")
    import webview

    window = webview.create_window(TITLE, url, width=SIZE[0], height=SIZE[1], min_size=MIN_SIZE, resizable=True)
    # debug=False keeps developer tools off. private_mode leaves no cookies, storage or cache on disk, so closing
    # the window ends the session. On Windows, name WebView2 so it can never fall back to an older browser engine.
    options: dict = {"debug": False, "private_mode": True}
    if sys.platform == "win32":
        options["gui"] = "edgechromium"
    if smoke_result is not None:
        webview.start(smoke_check, (window, url, smoke_result), **options)
    else:
        webview.start(watch_window, (window, data), **options)


def report_smoke(result: dict, url: str, port_free: bool, data: Path) -> bool:
    passed = (
        not result.get("error")
        and result.get("ui_shown") is True
        and result.get("health") == 200
        and "connect-src 'self'" in result.get("csp", "")
        and port_free
    )
    lines = [
        f"smoke test: url {url}{result.get('path', '')}",
        f"smoke test: title {result.get('title')!r}, interface shown: {result.get('ui_shown')}",
        f"smoke test: health status {result.get('health')}, CSP present: {bool(result.get('csp'))}",
        f"smoke test: {result.get('bundle', 'bundle not checked')}",
        f"smoke test: port free after close: {port_free}",
    ]
    if result.get("error"):
        lines.append(f"smoke test: error {result['error']}")
    lines.append(f"smoke test: {'PASS' if passed else 'FAIL'}")
    text = "\n".join(lines)
    print(text, flush=True)
    # A windowed program has no visible output when double-clicked or started from some shells, so keep a copy.
    (data / "logs" / "smoke-test.txt").write_text(text + "\n", encoding="utf-8")
    return passed


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="VAULT")
    ap.add_argument("--smoke-test", action="store_true", help="open, check, close and report; for build checks")
    args = ap.parse_args(argv)

    data = default_data_dir().resolve()
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    setup_logging(data)

    lock = take_instance_lock(data)
    if lock is None:
        show_message("VAULT is already open. Switch to its window, or close it first.")
        return 1

    sock = bind_local_socket()
    port = sock.getsockname()[1]
    url = app_url(port)
    server = thread = None
    smoke_result: dict | None = {} if args.smoke_test else None
    try:
        server, thread = start_server(build_settings(port, data, ui_dir()), sock)
        log.info("serving on %s", url)
        open_window(url, smoke_result, data)
    except Exception:
        log.exception("VAULT could not start")
        show_message(f"VAULT could not start. Details are in {data / 'logs' / 'vault-app.log'}")
        return 1
    finally:
        if server is not None and thread is not None:
            stop_server(server, thread)
        sock.close()
        lock.close()
    if smoke_result is not None:
        return 0 if report_smoke(smoke_result, url, port_is_free(port), data) else 1
    return 0


if __name__ == "__main__":
    multiprocessing.freeze_support()
    sys.exit(main())
