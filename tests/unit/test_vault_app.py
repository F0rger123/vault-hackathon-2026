"""F12.12: the installed app's entry point and the bundle check, without opening a window."""

import importlib.util
import socket
import threading
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def load(name: str):
    spec = importlib.util.spec_from_file_location(f"vault_packaging_{name}", ROOT / "packaging" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def app():
    return load("vault_app")


def test_binds_loopback_only_and_port_is_free_afterwards(app):
    sock = app.bind_local_socket()
    host, port = sock.getsockname()
    assert host == "127.0.0.1"
    assert port > 0
    assert not app.port_is_free(port)
    sock.close()
    assert app.port_is_free(port)


def test_window_address_uses_the_name_passkeys_need(app):
    assert app.app_url(5000) == "http://localhost:5000"


def test_settings_cannot_be_widened_from_outside(app, tmp_path, monkeypatch):
    monkeypatch.setenv("VAULT_DEMO_LOGIN", "true")
    monkeypatch.setenv("VAULT_CORS_ORIGINS", "http://evil.test")
    monkeypatch.setenv("VAULT_ALLOWED_HOSTS", "evil.test")
    settings = app.build_settings(5000, tmp_path, tmp_path / "ui")
    assert settings.demo_login is False
    assert settings.cors_origins == "http://localhost:5000"
    assert settings.allowed_hosts == "localhost"
    assert settings.data_dir == tmp_path


def test_data_dir_override_and_platform_defaults(app, tmp_path, monkeypatch):
    monkeypatch.setenv("VAULT_DATA_DIR", str(tmp_path))
    assert app.default_data_dir() == tmp_path
    monkeypatch.delenv("VAULT_DATA_DIR")
    monkeypatch.setattr(app.sys, "platform", "win32")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    assert app.default_data_dir() == tmp_path / "VAULT"
    monkeypatch.setattr(app.sys, "platform", "linux")
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    assert app.default_data_dir() == tmp_path / "vault"


def test_only_one_app_per_data_folder(app, tmp_path):
    first = app.take_instance_lock(tmp_path)
    assert first is not None
    assert app.take_instance_lock(tmp_path) is None
    first.close()
    second = app.take_instance_lock(tmp_path)
    assert second is not None
    second.close()


@pytest.mark.parametrize("url", ["http://evil.test", "https://localhost:1", "http://127.0.0.1:1", "file:///c:/x"])
def test_window_refuses_anything_but_the_local_app(app, url, tmp_path):
    with pytest.raises(ValueError, match="local VAULT"):
        app.open_window(url, None, tmp_path)


def test_only_the_data_folders_env_file_is_read(app, tmp_path, monkeypatch):
    started_from = tmp_path / "downloads"
    started_from.mkdir()
    (started_from / ".env").write_text("VAULT_ALLOW_REMOTE_INFERENCE=true\nVAULT_DEMO_LOGIN=true\n")
    monkeypatch.chdir(started_from)
    monkeypatch.delenv("VAULT_ALLOW_REMOTE_INFERENCE", raising=False)
    data = tmp_path / "data"
    data.mkdir()
    assert app.build_settings(5000, data, tmp_path).allow_remote_inference is False
    (data / ".env").write_text("VAULT_OLLAMA_MODEL=my-model\nVAULT_DEMO_LOGIN=true\nVAULT_ALLOWED_HOSTS=evil.test\n")
    settings = app.build_settings(5000, data, tmp_path)
    assert settings.ollama_model == "my-model"
    assert settings.demo_login is False
    assert settings.allowed_hosts == "localhost"


def test_a_window_that_never_loads_is_reported(app, tmp_path, monkeypatch):
    messages = []
    monkeypatch.setattr(app, "show_message", messages.append)
    monkeypatch.setattr(app, "WINDOW_TIMEOUT_S", 0.01)
    window = types.SimpleNamespace(events=types.SimpleNamespace(loaded=threading.Event()))
    app.watch_window(window, tmp_path)
    assert "WebView2" in messages[0]
    messages.clear()
    window.events.loaded.set()
    app.watch_window(window, tmp_path)
    assert messages == []


def test_server_starts_and_stops_on_the_socket(app, tmp_path):
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<title>VAULT</title>")
    sock = app.bind_local_socket()
    port = sock.getsockname()[1]
    server, thread = app.start_server(app.build_settings(port, tmp_path / "data", ui), sock)
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=5):
            pass
    finally:
        app.stop_server(server, thread)
    sock.close()
    assert not thread.is_alive()
    assert app.port_is_free(port)


def test_bundle_check_finds_what_must_not_ship(tmp_path):
    check = load("check_bundle")
    good = tmp_path / "good"
    (good / "_internal" / "ui").mkdir(parents=True)
    (good / "VAULT.exe").write_text("x")
    assert check.problems(good) == []
    for bad in ("dev_tokens.json", ".env", ".env.local", "vault.db", "_internal/data/synthetic/x.pdf"):
        path = good / bad
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("x")
    found = " ".join(check.problems(good))
    for bad in ("dev_tokens.json", ".env.local", "vault.db", "synthetic"):
        assert bad in found
    assert check.main(["check_bundle.py", str(good)]) == 1
