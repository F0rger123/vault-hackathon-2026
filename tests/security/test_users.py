"""F09.17: people with their own logins, and a sign-in log that cannot be edited or deleted."""

import sqlite3

import pytest

from backend.security import login as signin
from backend.security import signin_log
from backend.storage.db import connect
from tests.conftest import auth

API = "/api/v1"
PASS = "a long enough password"
OTHER = "another long password"


@pytest.fixture(autouse=True)
def _clear_lockouts():
    signin.clear_attempts()
    yield
    signin.clear_attempts()


def _add(client, tokens, name="dana", role="analyst"):
    r = client.post(
        f"{API}/users", headers=auth(tokens["admin"]), json={"username": name, "role": role, "password": PASS}
    )
    assert r.status_code == 201
    return r.json()


def _login(client, name, password=PASS):
    return client.post(f"{API}/auth/login", json={"username": name, "password": password})


def test_only_admins_manage_people_and_read_the_log(client, tokens):
    new = {"username": "x1", "role": "admin", "password": PASS}
    for who in ("analyst", "viewer"):
        h = auth(tokens[who])
        assert client.get(f"{API}/users", headers=h).status_code == 403
        assert client.post(f"{API}/users", headers=h, json=new).status_code == 403
        assert client.patch(f"{API}/users/1", headers=h, json={"role": "admin"}).status_code == 403
        assert client.put(f"{API}/users/1/password", headers=h, json={"password": PASS}).status_code == 403
        assert client.get(f"{API}/signin-log", headers=h).status_code == 403
        assert client.get(f"{API}/signin-log/verify", headers=h).status_code == 403
    assert client.get(f"{API}/users").status_code == 401


def test_new_person_signs_in_and_the_log_says_who_when_how(client, tokens):
    user = _add(client, tokens)
    assert user["role"] == "analyst" and user["has_password"] and "password_hash" not in user
    assert _login(client, "dana", "wrong password here").status_code == 401
    assert _login(client, "nobody", PASS).status_code == 401
    assert _login(client, "dana").status_code == 200
    log = client.get(f"{API}/signin-log", headers=auth(tokens["admin"])).json()
    assert [(e["username"], e["method"], e["outcome"]) for e in log[:3]] == [
        ("dana", "password", "allowed"),
        ("unknown-user", "password", "denied"),
        ("dana", "password", "denied"),
    ]
    assert log[0]["ts"] > 0 and log[0]["ip"]
    listed = {u["username"]: u for u in client.get(f"{API}/users", headers=auth(tokens["admin"])).json()}
    assert listed["dana"]["last_sign_in"]["method"] == "password"
    # What was typed as a username or password never reaches the log.
    assert PASS not in str(log) and "nobody" not in str(log)


def test_the_log_cannot_be_changed_or_deleted(client, tokens, settings):
    _add(client, tokens)
    _login(client, "dana")
    with connect(settings.db_path) as conn:
        for sql in (
            "DELETE FROM signin_log",
            "UPDATE signin_log SET username = 'someone-else'",
            "DELETE FROM audit_log",
            "UPDATE audit_log SET actor = 'someone-else'",
            "DELETE FROM users WHERE username = 'dana'",
        ):
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute(sql)
    for path in ("/signin-log", "/users/1", "/audit"):
        assert client.delete(f"{API}{path}", headers=auth(tokens["admin"])).status_code == 405
    assert client.get(f"{API}/signin-log/verify", headers=auth(tokens["admin"])).json()["intact"] is True


def test_edit_behind_the_triggers_breaks_the_chain(client, tokens, settings):
    _add(client, tokens)
    _login(client, "dana")
    _login(client, "dana")
    with connect(settings.db_path) as conn:
        assert signin_log.verify(conn)["intact"] is True
        conn.execute("DROP TRIGGER signin_log_no_update")
        target = conn.execute("SELECT MIN(id) FROM signin_log").fetchone()[0]
        conn.execute("UPDATE signin_log SET username = 'someone-else' WHERE id = ?", (target,))
        got = signin_log.verify(conn)
    assert got == {"intact": False, "entries": 0, "first_bad_id": target}


def test_removed_row_behind_the_triggers_is_noticed(client, tokens, settings):
    _add(client, tokens)
    for _ in range(3):
        _login(client, "dana")
    with connect(settings.db_path) as conn:
        conn.execute("DROP TRIGGER signin_log_no_delete")
        ids = [r[0] for r in conn.execute("SELECT id FROM signin_log ORDER BY id")]
        conn.execute("DELETE FROM signin_log WHERE id = ?", (ids[1],))
        assert signin_log.verify(conn)["first_bad_id"] == ids[2]


def test_disabled_person_is_out_at_once_but_stays_on_record(client, tokens):
    user = _add(client, tokens)
    session = auth(_login(client, "dana").json()["token"])
    assert client.get(f"{API}/me", headers=session).status_code == 200
    admin = auth(tokens["admin"])
    assert client.patch(f"{API}/users/{user['id']}", headers=admin, json={"disabled": True}).json()["disabled"] is True
    assert client.get(f"{API}/me", headers=session).status_code == 401
    bad = _login(client, "dana")
    assert bad.status_code == 401 and bad.json() == _login(client, "nobody").json()
    client.patch(f"{API}/users/{user['id']}", headers=admin, json={"disabled": False})
    assert client.get(f"{API}/me", headers=session).status_code == 401  # old sessions stay ended
    assert _login(client, "dana").status_code == 200


def test_last_admin_cannot_be_removed_and_nobody_disables_themselves(client, tokens):
    admin = auth(tokens["admin"])
    me = client.get(f"{API}/me", headers=admin).json()
    uid = next(u["id"] for u in client.get(f"{API}/users", headers=admin).json() if u["username"] == me["username"])
    assert client.patch(f"{API}/users/{uid}", headers=admin, json={"role": "viewer"}).status_code == 409
    assert client.patch(f"{API}/users/{uid}", headers=admin, json={"disabled": True}).status_code == 409
    _add(client, tokens, "second-admin", "admin")
    assert client.patch(f"{API}/users/{uid}", headers=admin, json={"disabled": True}).status_code == 409


def test_bad_input_is_refused(client, tokens):
    admin = auth(tokens["admin"])
    cases = [
        ({"username": "../etc", "role": "viewer", "password": PASS}, 422),
        ({"username": "ok-name", "role": "root", "password": PASS}, 422),
        ({"username": "ok-name", "role": "viewer", "password": "short"}, 422),
        ({"username": "analyst", "role": "admin", "password": PASS}, 409),
    ]
    for body, code in cases:
        assert client.post(f"{API}/users", headers=admin, json=body).status_code == code
    # A taken name never changes that person's password or role.
    assert client.get(f"{API}/me", headers=auth(tokens["analyst"])).json()["role"] == "analyst"


def test_admin_reset_ends_sessions(client, tokens):
    user = _add(client, tokens)
    session = auth(_login(client, "dana").json()["token"])
    r = client.put(f"{API}/users/{user['id']}/password", headers=auth(tokens["admin"]), json={"password": OTHER})
    assert r.json()["sessions_ended"] == 1
    assert client.get(f"{API}/me", headers=session).status_code == 401
    assert _login(client, "dana").status_code == 401
    assert _login(client, "dana", OTHER).status_code == 200


def test_changing_your_own_password_needs_the_current_one(client, tokens):
    _add(client, tokens)
    session = auth(_login(client, "dana").json()["token"])
    bad = client.post(f"{API}/auth/password", headers=session, json={"current": "wrong", "password": OTHER})
    assert bad.status_code == 403
    ok = client.post(f"{API}/auth/password", headers=session, json={"current": PASS, "password": OTHER})
    assert ok.status_code == 200
    assert client.get(f"{API}/me", headers=session).status_code == 401
    assert _login(client, "dana", OTHER).status_code == 200


def test_locked_account_does_not_flood_the_permanent_log(client, tokens):
    _add(client, tokens)
    for _ in range(12):
        _login(client, "dana", "wrong password here")
    log = client.get(f"{API}/signin-log", headers=auth(tokens["admin"])).json()
    assert sum(e["reason"] == "locked" for e in log) == 1
