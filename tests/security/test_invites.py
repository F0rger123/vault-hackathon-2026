"""F09.21: an admin invites someone with a one-time link, and that person picks their own password."""

import pytest

from backend.security import invites
from backend.security import login as signin
from backend.security.auth import PERMISSION_LABELS, ROLE_PERMISSIONS, hash_token
from backend.storage.db import connect
from tests.conftest import auth
from tests.security.test_sign_in_steps import _voice

API = "/api/v1"
PASS = "a long enough password"


@pytest.fixture(autouse=True)
def _clear_lockouts():
    signin.clear_attempts()
    yield
    signin.clear_attempts()


def _invite(client, tokens, name="erin", role="analyst", steps=None):
    r = client.post(
        f"{API}/users/invites",
        headers=auth(tokens["admin"]),
        json={"username": name, "role": role, "note": "site engineer", "steps": steps or []},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _audit(settings, action):
    with connect(settings.db_path) as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM audit_log WHERE action = ? ORDER BY id", (action,))]


def test_roles_endpoint_reads_the_enforced_table_in_plain_words(client, tokens):
    assert set(PERMISSION_LABELS) == set().union(*ROLE_PERMISSIONS.values())
    roles = client.get(f"{API}/users/roles", headers=auth(tokens["admin"])).json()
    assert [r["role"] for r in roles] == ["viewer", "analyst", "admin"]
    for r in roles:
        assert {p["id"] for p in r["allowed"]} == ROLE_PERMISSIONS[r["role"]]
        assert all(p["label"] and ":" not in p["label"] for p in r["allowed"] + r["not_allowed"])
        assert r["summary"]
    assert roles[0]["not_allowed"] and not roles[2]["not_allowed"]


def test_only_admins_create_list_or_withdraw_invites(client, tokens):
    body = {"username": "mallory", "role": "admin"}
    for who in ("analyst", "viewer"):
        h = auth(tokens[who])
        assert client.get(f"{API}/users/roles", headers=h).status_code == 403
        assert client.get(f"{API}/users/invites", headers=h).status_code == 403
        assert client.post(f"{API}/users/invites", headers=h, json=body).status_code == 403
        assert client.delete(f"{API}/users/invites/1", headers=h).status_code == 403
    assert client.post(f"{API}/users/invites", json=body).status_code == 401
    assert client.get(f"{API}/users/invites").status_code == 401


def test_invite_is_accepted_once_and_signs_the_person_in(client, tokens, settings):
    made = _invite(client, tokens)
    code = made["code"]
    assert len(code.replace("-", "")) == invites.CODE_LENGTH and made["expires_at"] - made["created_at"] == 48 * 3600
    # Only a hash is stored, and the admin's listing never carries the code.
    with connect(settings.db_path) as conn:
        row = conn.execute("SELECT * FROM invites").fetchone()
        assert row["code_hash"] == hash_token(code.replace("-", "")) and code not in str(dict(row))
    listed = client.get(f"{API}/users/invites", headers=auth(tokens["admin"])).json()
    assert [i["username"] for i in listed] == ["erin"] and "code" not in listed[0]

    seen = client.post(
        f"{API}/auth/invite/preview", json={"code": code.lower()}
    ).json()  # typed in lower case still works
    assert seen == {
        "username": "erin",
        "role": "analyst",
        "invited_by": "admin",
        "expires_at": made["expires_at"],
        "min_password": signin.MIN_PASSWORD,
    }
    assert client.post(f"{API}/auth/invite/accept", json={"code": code, "password": "short"}).status_code == 422
    r = client.post(f"{API}/auth/invite/accept", json={"code": code, "password": PASS})
    assert r.status_code == 200
    session = r.json()
    assert session["username"] == "erin" and session["role"] == "analyst"
    me = client.get(f"{API}/me", headers=auth(session["token"])).json()
    assert me["username"] == "erin" and me["role"] == "analyst"
    # Their own password works from now on; the invite does not, for anyone.
    assert client.post(f"{API}/auth/login", json={"username": "erin", "password": PASS}).status_code == 200
    assert client.post(f"{API}/auth/invite/accept", json={"code": code, "password": PASS}).status_code == 404
    assert client.post(f"{API}/auth/invite/preview", json={"code": code}).status_code == 404
    assert client.get(f"{API}/users/invites", headers=auth(tokens["admin"])).json() == []
    assert [a["outcome"] for a in _audit(settings, "auth.invite_accept")] == ["allowed", "denied"]
    assert _audit(settings, "user.invite")[0]["actor"] == "admin"
    log = client.get(f"{API}/signin-log?username=erin", headers=auth(tokens["admin"])).json()
    assert ("invite", "allowed") in [(e["method"], e["outcome"]) for e in log]
    # Nothing in the audit trail carries the code or the password.
    with connect(settings.db_path) as conn:
        trail = " ".join(r[0] for r in conn.execute("SELECT detail FROM audit_log"))
    assert code.replace("-", "") not in trail and PASS not in trail


def test_expired_and_withdrawn_invites_answer_like_unknown_ones(client, tokens, settings):
    old = _invite(client, tokens, "frank")
    with connect(settings.db_path) as conn:
        conn.execute("UPDATE invites SET expires_at = created_at - 1 WHERE username = 'frank'")
    gone = _invite(client, tokens, "gwen")
    h = auth(tokens["admin"])
    assert client.delete(f"{API}/users/invites/{gone['id']}", headers=h).status_code == 200
    assert client.delete(f"{API}/users/invites/{gone['id']}", headers=h).status_code == 404
    answers = [
        client.post(f"{API}/auth/invite/accept", json={"code": c, "password": PASS})
        for c in (old["code"], gone["code"], "ABCD-EFGH-JKMN-PQRS-TVWX")
    ]
    assert {r.status_code for r in answers} == {404}
    assert len({r.json()["detail"] for r in answers}) == 1
    with connect(settings.db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM users WHERE username IN ('frank', 'gwen')").fetchone()[0] == 0
    assert [a["detail"] for a in _audit(settings, "user.invite_revoke")] == [f'{{"invite_id":{gone["id"]}}}']
    # An expired name can be invited again; an open invite or a real account blocks a second one.
    _invite(client, tokens, "frank")
    dup = {"username": "frank", "role": "viewer"}
    assert client.post(f"{API}/users/invites", headers=h, json=dup).status_code == 409
    taken = {"username": "viewer", "role": "viewer"}
    assert client.post(f"{API}/users/invites", headers=h, json=taken).status_code == 409
    assert client.post(f"{API}/users", headers=h, json={**dup, "password": PASS}).status_code == 409
    bad = {"username": "x y", "role": "viewer"}
    assert client.post(f"{API}/users/invites", headers=h, json=bad).status_code == 422
    assert client.post(f"{API}/users/invites", headers=h, json={**dup, "role": "root"}).status_code == 422
    assert client.post(f"{API}/users/invites", headers=h, json={**dup, "steps": ["sms"]}).status_code == 422


def test_public_invite_routes_refuse_other_sites_and_are_rate_limited(client, tokens):
    code = _invite(client, tokens)["code"]
    # The code only ever travels in a request body, so no route takes it in the URL (or an access log).
    assert client.get(f"{API}/auth/invite/{code}").status_code == 404
    assert client.post(f"{API}/auth/invite/{code}", json={"password": PASS}).status_code in (404, 405)
    evil = {"Origin": "https://evil.example"}
    assert client.post(f"{API}/auth/invite/preview", headers=evil, json={"code": code}).status_code == 403
    assert (
        client.post(f"{API}/auth/invite/accept", headers=evil, json={"code": code, "password": PASS}).status_code == 403
    )
    for _ in range(signin.MAX_ATTEMPTS):
        assert client.post(f"{API}/auth/invite/preview", json={"code": "WRONG-WRONG-WRONG-WRONG"}).status_code == 404
    locked = client.post(f"{API}/auth/invite/preview", json={"code": code})
    assert locked.status_code == 429
    assert client.post(f"{API}/auth/invite/accept", json={"code": code, "password": PASS}).status_code == 429
    signin.clear_attempts()
    assert client.post(f"{API}/auth/invite/accept", json={"code": code, "password": PASS}).status_code == 200


def test_requested_steps_switch_on_once_the_person_sets_them_up(client, tokens, settings):
    code = _invite(client, tokens, "hana", steps=["voice", "face", "face"])["code"]
    session = client.post(f"{API}/auth/invite/accept", json={"code": code, "password": PASS}).json()
    h = auth(session["token"])
    status = client.get(f"{API}/auth/steps", headers=h).json()
    assert status["requested"] == ["face", "voice"] and status["required"] == ["password"]
    people = {u["username"]: u for u in client.get(f"{API}/users", headers=auth(tokens["admin"])).json()}
    assert people["hana"]["requested_steps"] == ["face", "voice"]
    # Setting up the key phrase through the real route turns that step on, and the request for it is cleared.
    _voice(client, h)
    assert _audit(settings, "signin.steps")[-1]["detail"] == '{"requested_by_admin":["voice"]}'
    status = client.get(f"{API}/auth/steps", headers=h).json()
    assert status["requested"] == ["face"] and status["required"] == ["password", "voice"]


def test_temporary_password_can_carry_requested_steps(client, tokens):
    h = auth(tokens["admin"])
    body = {"username": "ivan", "role": "viewer", "password": PASS, "requested_steps": ["passkey"]}
    made = client.post(f"{API}/users", headers=h, json=body).json()
    assert made["requested_steps"] == ["passkey"] and made["steps"] == ["password"]
    bad = {**body, "username": "ivan2", "requested_steps": ["password"]}
    assert client.post(f"{API}/users", headers=h, json=bad).status_code == 422


def test_codes_are_normalised_and_hard_to_guess():
    code = invites.new_code()
    assert len(code) == 20 and set(code) <= set(invites.ALPHABET)
    assert invites.normalize(invites.grouped(code).lower()) == code
    assert invites.normalize("o0il-" * 4 + "ABCD") == "0011" * 4 + "ABCD"
    assert invites.normalize("short") is None and invites.normalize("U" * 20) is None
    assert len({invites.new_code() for _ in range(200)}) == 200
