"""F10.11: password and demo sign-in, sign-out, and the Meta API key that is never shown again."""

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.security import login as signin
from backend.storage.db import connect
from tests.conftest import auth

API = "/api/v1"


@pytest.fixture(autouse=True)
def _clear_lockouts():
    signin._failures.clear()
    yield
    signin._failures.clear()


def test_password_login_issues_an_expiring_session(client, tokens, settings):
    with connect(settings.db_path) as conn:
        signin.set_password(conn, "analyst", "correct horse battery")
    assert client.get(f"{API}/auth/options").json() == {"demo_login": False, "password_login": True}
    r = client.post(f"{API}/auth/login", json={"username": "analyst", "password": "correct horse battery"})
    assert r.status_code == 200 and r.json()["role"] == "analyst" and r.json()["expires_at"]
    session = auth(r.json()["token"])
    assert client.get(f"{API}/me", headers=session).json()["username"] == "analyst"
    assert client.post(f"{API}/auth/logout", headers=session).json() == {"signed_out": True}
    assert client.get(f"{API}/me", headers=session).status_code == 401


def test_wrong_password_and_unknown_user_look_the_same_and_lock_out(client, tokens, settings):
    with connect(settings.db_path) as conn:
        signin.set_password(conn, "viewer", "a long enough password")
    wrong = client.post(f"{API}/auth/login", json={"username": "viewer", "password": "nope"})
    unknown = client.post(f"{API}/auth/login", json={"username": "nobody", "password": "nope"})
    assert wrong.status_code == unknown.status_code == 401 and wrong.json() == unknown.json()
    for _ in range(4):
        client.post(f"{API}/auth/login", json={"username": "viewer", "password": "nope"})
    good = client.post(f"{API}/auth/login", json={"username": "viewer", "password": "a long enough password"})
    assert good.status_code == 429  # locked even with the right password, until the minute passes


def test_short_passwords_are_refused(settings, tokens):
    with connect(settings.db_path) as conn, pytest.raises(ValueError):
        signin.set_password(conn, "admin", "short")


def test_demo_login_only_when_the_server_allows_it(client, tokens, settings):
    assert client.post(f"{API}/auth/demo-login", json={"role": "admin"}).status_code == 403
    demo = TestClient(create_app(settings.model_copy(update={"demo_login": True}), resume_jobs=False))
    assert demo.get(f"{API}/auth/options").json()["demo_login"] is True
    r = demo.post(f"{API}/auth/demo-login", json={"role": "viewer"})
    assert r.status_code == 200 and r.json()["role"] == "viewer"
    assert demo.post(f"{API}/auth/demo-login", json={"role": "root"}).status_code == 422


def test_meta_api_key_is_stored_but_never_returned(client, tokens, settings):
    admin, viewer = auth(tokens["admin"]), auth(tokens["viewer"])
    key = "LLM_" + "x" * 40
    assert client.put(f"{API}/settings/meta-api-key", json={"key": key}, headers=viewer).status_code == 403
    assert client.put(f"{API}/settings/meta-api-key", json={"key": "sk-wrong"}, headers=admin).status_code == 422
    r = client.put(f"{API}/settings/meta-api-key", json={"key": key}, headers=admin)
    assert r.json() == {"configured": True, "source": "vault"} and key not in r.text
    assert key not in client.get(f"{API}/settings/meta-api-key", headers=viewer).text
    assert key not in client.get(f"{API}/audit", headers=admin).text
    providers = client.get(f"{API}/system/providers", headers=admin).text
    assert key not in providers
    assert client.delete(f"{API}/settings/meta-api-key", headers=admin).json()["configured"] is False


def test_collections_can_be_demo_or_real(client, tokens):
    a = auth(tokens["analyst"])
    demo = client.post(f"{API}/collections", json={"name": "Fictional", "is_demo": True}, headers=a).json()
    real = client.post(f"{API}/collections", json={"name": "Ours"}, headers=a).json()
    assert (demo["is_demo"], real["is_demo"]) == (1, 0)
    listed = {c["name"]: c["is_demo"] for c in client.get(f"{API}/collections", headers=a).json()}
    assert listed == {"Fictional": 1, "Ours": 0}
