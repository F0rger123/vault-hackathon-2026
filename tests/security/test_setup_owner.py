"""F10.14: the first account is created once, only on this computer, and only while nobody can sign in."""

from fastapi.testclient import TestClient

from backend.main import create_app
from backend.security import login as signin
from backend.storage.db import connect

API = "/api/v1"
OWNER = {"username": "owner", "password": "a long enough password"}


def local(app):
    return TestClient(app, client=("127.0.0.1", 50000))


def test_owner_is_created_once_and_can_sign_in(settings):
    c = local(create_app(settings, resume_jobs=False))
    assert c.get(f"{API}/auth/options").json()["needs_owner"] is True
    r = c.post(f"{API}/setup/owner", json=OWNER)
    assert r.status_code == 201 and r.json()["role"] == "admin" and r.json()["token"]
    assert c.get(f"{API}/me", headers={"Authorization": f"Bearer {r.json()['token']}"}).json()["role"] == "admin"
    assert c.get(f"{API}/auth/options").json()["needs_owner"] is False
    # Second attempt: refused, and the first password still works.
    again = c.post(f"{API}/setup/owner", json={"username": "thief", "password": "another long password"})
    assert again.status_code == 409
    assert c.post(f"{API}/auth/login", json=OWNER).status_code == 200
    with connect(settings.db_path) as conn:
        assert conn.execute("SELECT 1 FROM users WHERE username = 'thief'").fetchone() is None


def test_refused_from_elsewhere_with_a_short_password_or_in_demo_mode(settings):
    app = create_app(settings, resume_jobs=False)
    remote = TestClient(app, client=("203.0.113.9", 50000))
    assert remote.post(f"{API}/setup/owner", json=OWNER).status_code == 403
    c = local(app)
    assert c.post(f"{API}/setup/owner", json=OWNER, headers={"Origin": "http://evil.example"}).status_code == 403
    short = c.post(f"{API}/setup/owner", json={"username": "owner", "password": "short"})
    assert short.status_code == 422
    assert c.get(f"{API}/auth/options").json()["needs_owner"] is True
    settings.demo_login = True
    assert c.get(f"{API}/auth/options").json()["needs_owner"] is False
    assert c.post(f"{API}/setup/owner", json=OWNER).status_code == 403


def test_an_existing_password_or_passkey_means_no_owner_is_needed(settings, client, tokens):
    with connect(settings.db_path) as conn:
        assert signin.needs_owner(conn) is True
        signin.set_password(conn, "viewer", "correct horse battery")
        assert signin.needs_owner(conn) is False
