"""F09.14: passkey routes refuse anything unverified, and "require my passkey" turns password-only sign-in off.

The full ceremony with a real (virtual) authenticator runs in the browser tests: tests/e2e/specs/07-passkeys.spec.ts.
"""

from backend.security import login as signin
from backend.storage.db import connect, now
from tests.conftest import auth

API = "/api/v1"


def test_options_need_sign_in_and_name_the_relying_party(client, tokens):
    assert client.post(f"{API}/auth/passkeys/register/options").status_code == 401
    r = client.post(f"{API}/auth/passkeys/register/options", headers=auth(tokens["analyst"])).json()
    opts = r["options"]
    assert r["handle"] and opts["rp"] == {"id": "localhost", "name": "VAULT"} and opts["user"]["name"] == "analyst"
    assert opts["authenticatorSelection"]["userVerification"] == "required"


def test_unverified_answers_and_reused_challenges_are_refused(client, tokens):
    a = auth(tokens["analyst"])
    handle = client.post(f"{API}/auth/passkeys/register/options", headers=a).json()["handle"]
    bad = {
        "id": "AAAA",
        "rawId": "AAAA",
        "type": "public-key",
        "response": {"clientDataJSON": "e30", "attestationObject": "oA"},
    }
    r = client.post(f"{API}/auth/passkeys/register", json={"handle": handle, "credential": bad}, headers=a)
    assert r.status_code == 400
    r = client.post(f"{API}/auth/passkeys/register", json={"handle": handle, "credential": bad}, headers=a)
    assert r.status_code == 400 and "expired" in r.json()["detail"], "a challenge is used once"
    # Another person's challenge cannot be used.
    other = client.post(f"{API}/auth/passkeys/register/options", headers=auth(tokens["viewer"])).json()["handle"]
    r = client.post(f"{API}/auth/passkeys/register", json={"handle": other, "credential": bad}, headers=a)
    assert r.status_code == 400 and "someone else" in r.json()["detail"]


def test_login_options_do_not_reveal_accounts_and_bad_logins_fail(client, tokens):
    real = client.post(f"{API}/auth/passkey-login/options", json={"username": "analyst"}).json()
    fake = client.post(f"{API}/auth/passkey-login/options", json={"username": "nobody-here"}).json()
    assert set(real["options"]) == set(fake["options"]) and fake["options"].get("allowCredentials", []) == []
    r = client.post(f"{API}/auth/passkey-login", json={"handle": fake["handle"], "credential": {"id": "nope"}})
    assert r.status_code == 401
    r = client.post(
        f"{API}/auth/passkey-login/options", json={"username": "analyst"}, headers={"Origin": "http://evil.example"}
    )
    assert r.status_code == 403


def test_require_passkey_blocks_password_only_sign_in(client, tokens, settings):
    a = auth(tokens["analyst"])
    assert client.put(f"{API}/auth/passkeys/required", json={"required": True}, headers=a).status_code == 409
    with connect(settings.db_path) as conn:
        signin.set_password(conn, "analyst", "correct horse battery")
        uid = conn.execute("SELECT id FROM users WHERE username = 'analyst'").fetchone()[0]
        conn.execute(
            "INSERT INTO passkeys (user_id, credential_id, public_key, sign_count, name, created_at) "
            "VALUES (?, 'cred', x'00', 0, 'Laptop', ?)",
            (uid, now()),
        )
    assert client.put(f"{API}/auth/passkeys/required", json={"required": True}, headers=a).json() == {"required": True}
    wrong = client.post(f"{API}/auth/login", json={"username": "analyst", "password": "wrong password!"})
    assert wrong.status_code == 401, "a wrong password still looks like a wrong password"
    right = client.post(f"{API}/auth/login", json={"username": "analyst", "password": "correct horse battery"})
    assert right.status_code == 403 and "passkey" in right.json()["detail"]
    mine = client.get(f"{API}/auth/passkeys", headers=a).json()
    assert mine["required"] is True and [p["name"] for p in mine["passkeys"]] == ["Laptop"]
    # Removing the last passkey turns the requirement off, so nobody is locked out.
    assert client.delete(f"{API}/auth/passkeys/{mine['passkeys'][0]['id']}", headers=a).status_code == 200
    assert client.get(f"{API}/auth/passkeys", headers=a).json()["required"] is False
    signin.clear_attempts()
    assert (
        client.post(f"{API}/auth/login", json={"username": "analyst", "password": "correct horse battery"}).status_code
        == 200
    )
