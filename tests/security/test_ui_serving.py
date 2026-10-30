"""F12.12: the API serves the exported interface. No path escapes the folder, and headers match the normal build."""

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.core.config import Settings
from backend.main import create_app
from backend.ui import CSP, UI_HEADERS, find_file

ROOT = Path(__file__).resolve().parents[2]
SECRET = "TOP-SECRET-OUTSIDE-THE-UI-FOLDER"


@pytest.fixture
def ui(tmp_path) -> Path:
    folder = tmp_path / "ui"
    (folder / "_next" / "static").mkdir(parents=True)
    (folder / "run").mkdir()
    (folder / "api" / "v1").mkdir(parents=True)
    (folder / "index.html").write_text("<h1>home</h1>")
    (folder / "run.html").write_text("<h1>run board</h1>")
    (folder / "run.txt").write_text("page data")
    (folder / "404.html").write_text("<h1>missing</h1>")
    (folder / "run" / "__next._tree.txt").write_text("segment data")
    (folder / "run" / "__next.run").mkdir()
    (folder / "run" / "__next.run" / "__PAGE__.txt").write_text("prefetched page")
    (folder / "_next" / "static" / "app.js").write_text("console.log(1)")
    (folder / "api" / "v1" / "health.html").write_text("shadowed")
    (tmp_path / "secret.txt").write_text(SECRET)
    return folder


@pytest.fixture
def ui_client(tmp_path, ui):
    settings = Settings(
        data_dir=tmp_path / "data",
        provider="heuristic",
        ui_dir=ui,
        cors_origins="http://localhost:5555",
        allowed_hosts="testserver,localhost",
        _env_file=None,
    )
    with TestClient(create_app(settings, resume_jobs=False)) as client:
        yield client


@pytest.mark.parametrize(
    ("url", "body"),
    [
        ("/", "home"),
        ("/run", "run board"),
        ("/run/", "run board"),
        ("/run?job=3", "run board"),
        ("/run.txt", "page data"),
        ("/run/__next._tree.txt", "segment data"),
        ("/run/__next.run.__PAGE__.txt?_rsc=abc", "prefetched page"),
        ("/_next/static/app.js", "console.log"),
    ],
)
def test_serves_exported_files(ui_client, url, body):
    res = ui_client.get(url)
    assert res.status_code == 200
    assert body in res.text


def test_media_types_do_not_come_from_the_windows_registry(ui_client):
    assert ui_client.get("/").headers["content-type"].startswith("text/html")
    assert ui_client.get("/_next/static/app.js").headers["content-type"].startswith("text/javascript")
    assert ui_client.get("/run.txt").headers["content-type"].startswith("text/plain")


@pytest.mark.parametrize(
    "url",
    [
        "/%2e%2e/secret.txt",
        "/..%2fsecret.txt",
        "/..%5csecret.txt",
        "/%2e%2e%2f%2e%2e%2fsecret.txt",
        "/run/..%2f..%2fsecret.txt",
        "/_next/%2e%2e/%2e%2e/%2e%2e/secret.txt",
        "/C:%5cWindows%5cwin.ini",
        "/index.html::$DATA",
        "/%00",
        "/index.html%00.txt",
        "/__next.%2e%2e%2fsecret.__PAGE__.txt",
    ],
)
def test_path_traversal_is_refused(ui_client, url):
    res = ui_client.get(url)
    assert res.status_code == 404
    assert SECRET not in res.text


def test_find_file_refuses_escapes_directly(ui):
    for path in ("../secret.txt", "..\\secret.txt", "run/../../secret.txt", "a//b", "C:\\Windows\\win.ini", "x\x00y"):
        assert find_file(ui, path) is None


def test_symlink_out_of_the_folder_is_refused(ui, tmp_path):
    link = ui / "link.txt"
    try:
        link.symlink_to(tmp_path / "secret.txt")
    except OSError:
        pytest.skip("this account may not create symbolic links")
    assert find_file(ui, "link.txt") is None


@pytest.mark.parametrize("url", ["/", "/run", "/_next/static/app.js", "/does-not-exist"])
def test_every_interface_response_has_the_security_headers(ui_client, url):
    headers = ui_client.get(url).headers
    for name, value in UI_HEADERS.items():
        assert headers[name] == value
    assert "connect-src 'self'" in headers["content-security-policy"]


def test_headers_match_the_normal_build():
    config = (ROOT / "frontend" / "next.config.ts").read_text(encoding="utf-8")
    plain = dict(re.findall(r'key: "([^"]+)", value: "([^"]+)"', config))
    assert plain, "the header list in next.config.ts moved"
    assert set(plain) | {"Content-Security-Policy"} == set(UI_HEADERS)
    for name, value in plain.items():
        assert UI_HEADERS[name] == value
    # The CSP differs only where the normal build names a separate API origin or allows eval in development.
    directives = re.findall(r'^\s*[`"]([a-z-]+ .*)[`"],$', config, re.M)
    assert len(directives) == len(CSP.split("; "))
    for directive in directives:
        expected = directive.replace(" ${apiOrigin}", "").replace("""${isDev ? " 'unsafe-eval'" : ""}""", "")
        assert expected in CSP.split("; ")


def test_export_policy_allows_no_eval_and_no_other_origin():
    assert "unsafe-eval" not in CSP
    assert "http" not in CSP


def test_api_is_not_shadowed(ui_client):
    res = ui_client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_unknown_api_address_is_an_api_error_not_a_page(ui_client):
    res = ui_client.get("/api/v1/no-such-route")
    assert res.status_code == 404
    assert res.json() == {"detail": "Not Found"}


def test_api_authorization_still_applies(ui_client):
    assert ui_client.get("/api/v1/stats").status_code == 401


def test_api_responses_cannot_run_anything(ui_client):
    policy = ui_client.get("/api/v1/health").headers["content-security-policy"]
    assert "default-src 'none'" in policy
    assert "sandbox" in policy


def test_api_docs_are_off_because_they_load_scripts_from_a_cdn(ui_client):
    # On the interface's origin those scripts could read the sign-in token.
    for url in ("/docs", "/redoc", "/openapi.json"):
        res = ui_client.get(url)
        assert res.status_code == 404
        assert "swagger" not in res.text.lower()


def test_sign_in_is_accepted_only_from_the_apps_own_origin(ui_client):
    body = {"username": "nobody", "password": "wrong-password"}
    own = ui_client.post("/api/v1/auth/login", json=body, headers={"Origin": "http://localhost:5555"})
    assert own.status_code == 401
    for origin in ("http://evil.test", "http://localhost:3000"):
        assert ui_client.post("/api/v1/auth/login", json=body, headers={"Origin": origin}).status_code == 403


def test_other_host_names_are_refused(ui_client):
    assert ui_client.get("/", headers={"Host": "evil.test"}).status_code == 400


def test_missing_export_stops_startup(tmp_path):
    settings = Settings(data_dir=tmp_path / "data", ui_dir=tmp_path / "empty", _env_file=None)
    with pytest.raises(RuntimeError, match="index.html"):
        create_app(settings, resume_jobs=False)


def test_normal_mode_serves_no_interface_and_keeps_its_docs(client):
    assert client.get("/").status_code == 404
    assert client.get("/docs").status_code == 200
    assert "content-security-policy" not in client.get("/api/v1/health").headers
