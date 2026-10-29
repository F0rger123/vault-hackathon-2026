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
    signin.clear_attempts()
    yield
    signin.clear_attempts()


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


# F09.11 hardening, from the independent security review.
def test_requests_for_another_host_are_refused(client, tokens):
    """DNS rebinding: a hostile page reaching 127.0.0.1 still sends its own hostname."""
    assert client.get(f"{API}/health", headers={"Host": "evil.example"}).status_code == 400
    assert (
        client.post(
            f"{API}/auth/login", json={"username": "a", "password": "b"}, headers={"Host": "evil.example"}
        ).status_code
        == 400
    )
    assert client.get(f"{API}/health", headers={"Host": "127.0.0.1:8000"}).status_code == 200


def test_sign_in_from_a_foreign_page_is_refused(client, tokens):
    body = {"username": "admin", "password": "anything at all"}
    r = client.post(f"{API}/auth/login", json=body, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    r = client.post(f"{API}/auth/login", json=body, headers={"Origin": "http://localhost:3000"})
    assert r.status_code == 401


def test_parallel_guesses_cannot_beat_the_limit(client, tokens, settings):
    from concurrent.futures import ThreadPoolExecutor

    with connect(settings.db_path) as conn:
        signin.set_password(conn, "analyst", "correct horse battery")

    def guess(i):
        return client.post(f"{API}/auth/login", json={"username": "analyst", "password": f"guess {i}"}).status_code

    with ThreadPoolExecutor(max_workers=20) as pool:
        codes = list(pool.map(guess, range(20)))
    assert codes.count(401) <= signin.MAX_ATTEMPTS and codes.count(429) >= 20 - signin.MAX_ATTEMPTS - codes.count(503)


def test_unknown_usernames_are_not_written_to_the_audit_log(client, tokens):
    pasted = "my-secret-password-typed-in-the-wrong-box"
    client.post(f"{API}/auth/login", json={"username": pasted, "password": "x"})
    log = client.get(f"{API}/audit", headers=auth(tokens["admin"])).text
    assert pasted not in log and "unknown-user" in log


def test_unknown_and_passwordless_users_cost_a_full_hash(settings, tokens):
    import time

    with connect(settings.db_path) as conn:
        signin.set_password(conn, "admin", "a long enough password")
        times = {}
        for name in ("admin", "viewer", "nobody"):  # has a password, has none, does not exist
            signin.clear_attempts()
            t = time.perf_counter()
            assert signin.password_login(conn, name, "wrong guess", 1) is None
            times[name] = time.perf_counter() - t
    fastest, slowest = min(times.values()), max(times.values())
    assert fastest > slowest / 3, times  # all three run scrypt; none returns instantly


def test_changing_a_password_ends_existing_sessions(client, tokens, settings):
    with connect(settings.db_path) as conn:
        signin.set_password(conn, "analyst", "first password here")
    r = client.post(f"{API}/auth/login", json={"username": "analyst", "password": "first password here"})
    session = auth(r.json()["token"])
    assert client.get(f"{API}/me", headers=session).status_code == 200
    with connect(settings.db_path) as conn:
        assert signin.set_password(conn, "analyst", "second password here") == 1
    assert client.get(f"{API}/me", headers=session).status_code == 401
    assert client.get(f"{API}/me", headers=auth(tokens["analyst"])).status_code == 200  # other tokens untouched


def test_session_lifetime_must_be_positive():
    from pydantic import ValidationError

    from backend.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(session_ttl_hours=0, _env_file=None)


def test_rejected_api_key_is_not_echoed(client, tokens):
    long_key = "LLM_" + "y" * 900
    r = client.put(f"{API}/settings/meta-api-key", json={"key": long_key}, headers=auth(tokens["admin"]))
    assert r.status_code == 422 and long_key not in r.text


def test_sql_in_the_password_is_just_a_wrong_password(client, tokens, settings):
    """ZAP flagged /auth/login 'password' for boolean SQL injection; the two answers differed only because
    the lockout started part-way through its attempts. The password never reaches SQL."""
    with connect(settings.db_path) as conn:
        signin.set_password(conn, "admin", "a long enough password")
    for payload in ("ZAP' AND '1'='1' -- ", "ZAP' AND '1'='2' -- ", "' OR 1=1 --"):
        signin.clear_attempts()
        r = client.post(f"{API}/auth/login", json={"username": "admin", "password": payload})
        assert r.status_code == 401 and r.json() == {"detail": "wrong username or password"}
    signin.clear_attempts()
    r = client.post(f"{API}/auth/login", json={"username": "admin' OR '1'='1", "password": "x"})
    assert r.status_code == 401
