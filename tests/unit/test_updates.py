"""F12.14: VAULT asks GitHub for the newest release, keeps only this project's links, and can be switched off."""

import httpx
import pytest

from backend.core import updates
from tests.conftest import auth

API = "/api/v1"
RELEASE = {
    "tag_name": "v0.3.0",
    "html_url": "https://github.com/F0rger123/vault-hackathon-2026/releases/tag/v0.3.0",
    "published_at": "2026-11-03T12:00:00Z",
    "assets": [
        {
            "name": "VAULT-Setup-0.3.0.exe",
            "size": 40 * 2**20,
            "browser_download_url": "https://github.com/F0rger123/vault-hackathon-2026/releases/download/v0.3.0/VAULT-Setup-0.3.0.exe",
        },
        {"name": "evil.exe", "size": 1, "browser_download_url": "https://example.com/evil.exe"},
        {
            "name": "notes.txt",
            "size": 1,
            "browser_download_url": "https://github.com/F0rger123/vault-hackathon-2026/releases/download/v0.3.0/notes.txt",
        },
    ],
}


@pytest.fixture(autouse=True)
def fresh():
    updates._cache.clear()
    yield
    updates._cache.clear()


def fake(monkeypatch, status=200, body=None, error=None):
    calls = []

    def get(url, **kw):
        calls.append(url)
        if error:
            raise error
        return httpx.Response(status, json=body or {}, request=httpx.Request("GET", url))

    monkeypatch.setattr(updates.httpx, "get", get)
    return calls


def test_newer_release_is_offered_with_only_our_own_files(monkeypatch):
    calls = fake(monkeypatch, body=RELEASE)
    out = updates.check("0.2.0", True)
    assert out["newer"] is True and out["latest"] == "v0.3.0"
    assert [f["name"] for f in out["files"]] == ["VAULT-Setup-0.3.0.exe"]
    assert out["files"][0]["size_mb"] == 40.0
    assert calls == [updates.LATEST]
    updates.check("0.2.0", True)
    assert len(calls) == 1  # answered from memory for hours


def test_same_or_older_release_is_not_offered(monkeypatch):
    fake(monkeypatch, body={**RELEASE, "tag_name": "v0.2.0"})
    assert updates.check("0.2.0", True)["newer"] is False
    updates._cache.clear()
    fake(monkeypatch, body={**RELEASE, "tag_name": "nightly"})
    assert updates.check("0.2.0", True)["newer"] is False


def test_no_release_yet_and_offline(monkeypatch):
    fake(monkeypatch, status=404)
    assert updates.check("0.2.0", True)["latest"] is None
    updates._cache.clear()
    fake(monkeypatch, error=httpx.ConnectError("offline"))
    out = updates.check("0.2.0", True)
    assert out["newer"] is False and "could not" in out["error"]


def test_switched_off_never_goes_online(monkeypatch):
    calls = fake(monkeypatch, body=RELEASE)
    assert updates.check("0.2.0", False) == {
        "current": "0.2.0",
        "enabled": False,
        "newer": False,
        "releases": updates.RELEASES,
    }
    assert calls == []


def test_route_needs_sign_in(client, tokens, monkeypatch):
    fake(monkeypatch, body=RELEASE)
    assert client.get(f"{API}/system/update").status_code == 401
    r = client.get(f"{API}/system/update", headers=auth(tokens["admin"]))
    assert r.status_code == 200 and r.json()["current"] == "0.2.0"


def test_rate_limited_api_falls_back_to_the_latest_page(monkeypatch):
    fake(monkeypatch, status=403, body={"message": "API rate limit exceeded"})

    def head(url, **kw):
        assert url == f"{updates.RELEASES}/latest"
        loc = f"{updates.RELEASES}/tag/v0.4.1"
        return httpx.Response(302, headers={"location": loc}, request=httpx.Request("HEAD", url))

    monkeypatch.setattr(updates.httpx, "head", head)
    out = updates.check("0.2.0", True)
    assert out["newer"] is True and out["latest"] == "v0.4.1"
    assert out["files"][0]["url"].endswith("/releases/download/v0.4.1/VAULT-Setup-0.4.1.exe")
