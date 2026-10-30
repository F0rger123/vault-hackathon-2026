"""F12.9 desktop mode: argument parsing, the pywebview fallback and the window settings, without opening a window."""

import importlib.util
import subprocess
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def load(name: str):
    spec = importlib.util.spec_from_file_location(f"vault_{name}", ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def start():
    return load("start")


def test_default_start_is_unchanged(start):
    args = start.parse_args([])
    assert (args.app, args.smoke_test, args.api_port, args.ui_port) == (False, False, 8000, 3000)
    # Default ports add no settings, so a normal start builds and serves exactly as before.
    assert start.port_env(8000, 3000) == {}


def test_app_and_smoke_test_flags(start):
    assert start.parse_args(["--app"]).app is True
    smoke = start.parse_args(["--smoke-test"])
    assert smoke.app is True and smoke.smoke_test is True


@pytest.mark.parametrize(
    "argv", [["--api-port", "80"], ["--ui-port", "70000"], ["--api-port", "3100", "--ui-port", "3100"]]
)
def test_bad_ports_are_refused(start, argv):
    with pytest.raises(SystemExit):
        start.parse_args(argv)


def test_other_ports_get_their_own_build_and_cors(start):
    env = start.port_env(8100, 3100)
    assert env["NEXT_PUBLIC_VAULT_API"] == "http://127.0.0.1:8100"
    assert env["VAULT_NEXT_DIST_DIR"] == ".next-api8100"  # never overwrites the normal .next build
    assert env["VAULT_CORS_ORIGINS"] == "http://localhost:3100,http://127.0.0.1:3100"


def _fake_run(results):
    calls = []

    def run(cmd, **_kw):
        calls.append(cmd)
        return subprocess.CompletedProcess(cmd, results.pop(0))

    return run, calls


def test_desktop_ready_when_pywebview_is_installed(start, monkeypatch):
    run, calls = _fake_run([0])
    monkeypatch.setattr(start.subprocess, "run", run)
    assert start.desktop_ready() is True
    assert len(calls) == 1  # nothing installed


def test_desktop_installs_pywebview_the_first_time(start, monkeypatch):
    run, calls = _fake_run([1, 0, 0])
    monkeypatch.setattr(start.subprocess, "run", run)
    assert start.desktop_ready() is True
    assert calls[1][-1].endswith("[desktop]")


def test_desktop_falls_back_to_the_browser_with_one_clear_line(start, monkeypatch, capsys):
    run, _ = _fake_run([1, 1])  # not importable, and the install fails (no network, no pip)
    monkeypatch.setattr(start.subprocess, "run", run)
    assert start.desktop_ready() is False
    out = capsys.readouterr().out
    assert 'pip install -e ".[desktop]"' in out and "browser instead" in out


def test_window_settings_and_no_devtools(monkeypatch):
    created, started = {}, {}
    fake = types.ModuleType("webview")
    fake.create_window = lambda title, url, **kw: created.update(title=title, url=url, **kw) or types.SimpleNamespace()
    fake.start = lambda **kw: started.update(kw)
    monkeypatch.setitem(sys.modules, "webview", fake)
    assert load("desktop").main(["http://localhost:3000"]) == 0
    assert created["title"] == "VAULT" and created["url"] == "http://localhost:3000"
    assert created["resizable"] is True and created["min_size"] == (900, 600)
    assert started["debug"] is False and started["private_mode"] is True


@pytest.mark.parametrize("url", ["https://example.com", "http://localhost:3000@example.com/", "file:///C:/x"])
def test_window_refuses_anything_but_the_local_interface(monkeypatch, url):
    monkeypatch.setitem(sys.modules, "webview", types.ModuleType("webview"))  # would fail if it were used
    assert load("desktop").main([url]) == 2
