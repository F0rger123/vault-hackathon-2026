"""Passkeys: sign in with Windows Hello face or fingerprint, Touch ID, or a hardware security key (F09.14).

Uses the WebAuthn standard. The face, fingerprint or PIN never leaves the person's device: the device only proves
that it holds a private key, and VAULT stores the matching public key. A copied database cannot be used to sign in.

- A signed-in person registers one or more passkeys (a laptop's Windows Hello, a YubiKey, a phone).
- Signing in with a passkey needs the device and user verification (biometric or PIN), so it is two factors in one.
- "Require my passkey" turns password-only sign-in off for that account.
- Each challenge is random, used once, tied to its purpose and expires after two minutes.
"""

from __future__ import annotations

import hmac
import json
import secrets
import sqlite3
import threading
import time

from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.exceptions import InvalidAuthenticationResponse, InvalidRegistrationResponse
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from backend.storage.db import now

RP_NAME = "VAULT"
CHALLENGE_SECONDS = 120
_challenges: dict[str, tuple[bytes, str, int | None, float]] = {}
_lock = threading.Lock()


_DECOY_KEY = secrets.token_bytes(32)


class PasskeyError(ValueError):
    """Safe to show: never a key, a challenge or a credential."""


def rp_id(origins: list[str]) -> str:
    """WebAuthn needs a domain name, not an IP address, so VAULT's interface must be opened at a name."""
    from urllib.parse import urlparse

    hosts = [urlparse(o).hostname for o in origins]
    return next((h for h in hosts if h and not h.replace(".", "").isdigit() and ":" not in h), "localhost")


def _remember(purpose: str, challenge: bytes, user_id: int | None) -> str:
    handle = secrets.token_urlsafe(16)
    with _lock:
        t = time.monotonic()
        for k in [k for k, v in _challenges.items() if t - v[3] > CHALLENGE_SECONDS]:
            _challenges.pop(k, None)
        _challenges[handle] = (challenge, purpose, user_id, t)
    return handle


def _take(handle: str, purpose: str) -> tuple[bytes, int | None]:
    with _lock:
        item = _challenges.pop(handle, None)
    if not item or item[1] != purpose or time.monotonic() - item[3] > CHALLENGE_SECONDS:
        raise PasskeyError("this passkey request expired; try again")
    return item[0], item[2]


def _creds(conn: sqlite3.Connection, user_id: int) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM passkeys WHERE user_id = ? ORDER BY id", (user_id,)).fetchall()


def registration_options(conn: sqlite3.Connection, user_id: int, username: str, origins: list[str]) -> dict:
    opts = generate_registration_options(
        rp_id=rp_id(origins),
        rp_name=RP_NAME,
        user_name=username,
        user_id=str(user_id).encode(),
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED, user_verification=UserVerificationRequirement.REQUIRED
        ),
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(c["credential_id"])) for c in _creds(conn, user_id)
        ],
    )
    return {"handle": _remember("register", opts.challenge, user_id), "options": json.loads(options_to_json(opts))}


def register(
    conn: sqlite3.Connection, user_id: int, handle: str, credential: dict, name: str, origins: list[str]
) -> dict:
    challenge, owner = _take(handle, "register")
    if owner != user_id:
        raise PasskeyError("this passkey request belongs to someone else")
    try:
        v = verify_registration_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id(origins),
            expected_origin=origins,
            require_user_verification=True,
        )
    except InvalidRegistrationResponse as exc:
        raise PasskeyError("the device's answer could not be verified") from exc
    cred_id = bytes_to_base64url(v.credential_id)
    if conn.execute("SELECT 1 FROM passkeys WHERE credential_id = ?", (cred_id,)).fetchone():
        raise PasskeyError("this passkey is already registered")
    cur = conn.execute(
        "INSERT INTO passkeys (user_id, credential_id, public_key, sign_count, name, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, cred_id, v.credential_public_key, v.sign_count, (name or "Passkey")[:60], now()),
    )
    return {"id": cur.lastrowid, "name": (name or "Passkey")[:60]}


def login_options(conn: sqlite3.Connection, username: str, origins: list[str]) -> dict:
    row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    creds = _creds(conn, row["id"]) if row else []
    allow = [PublicKeyCredentialDescriptor(id=base64url_to_bytes(c["credential_id"])) for c in creds]
    # A name with no passkey gets a made-up credential that is the same each time, so the answer does not reveal which
    # accounts exist or have passkeys. Verification then fails like a wrong key.
    if not allow:
        allow = [PublicKeyCredentialDescriptor(id=hmac.digest(_DECOY_KEY, username.encode(), "sha256"))]
    opts = generate_authentication_options(
        rp_id=rp_id(origins), allow_credentials=allow, user_verification=UserVerificationRequirement.REQUIRED
    )
    return {
        "handle": _remember("login", opts.challenge, row["id"] if row else None),
        "options": json.loads(options_to_json(opts)),
    }


def login(conn: sqlite3.Connection, handle: str, credential: dict, origins: list[str]) -> sqlite3.Row:
    """The user row for a verified passkey sign-in, or PasskeyError."""
    challenge, user_id = _take(handle, "login")
    cred_id = str(credential.get("id", ""))[:512]
    stored = conn.execute("SELECT * FROM passkeys WHERE credential_id = ?", (cred_id,)).fetchone()
    if not stored or user_id is None or stored["user_id"] != user_id:
        raise PasskeyError("this passkey is not registered for that account")
    if conn.execute("SELECT disabled FROM users WHERE id = ?", (user_id,)).fetchone()["disabled"]:
        raise PasskeyError("this passkey is not registered for that account")
    try:
        v = verify_authentication_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id(origins),
            expected_origin=origins,
            credential_public_key=stored["public_key"],
            credential_current_sign_count=stored["sign_count"],
            require_user_verification=True,
        )
    except InvalidAuthenticationResponse as exc:
        raise PasskeyError("the device's answer could not be verified") from exc
    conn.execute(
        "UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?", (v.new_sign_count, now(), stored["id"])
    )
    return conn.execute("SELECT id, username, role FROM users WHERE id = ?", (user_id,)).fetchone()


def list_passkeys(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    return [
        {"id": c["id"], "name": c["name"], "created_at": c["created_at"], "last_used_at": c["last_used_at"]}
        for c in _creds(conn, user_id)
    ]


def remove(conn: sqlite3.Connection, user_id: int, passkey_id: int) -> bool:
    removed = conn.execute("DELETE FROM passkeys WHERE id = ? AND user_id = ?", (passkey_id, user_id)).rowcount == 1
    if removed and not _creds(conn, user_id):
        # With no passkey left, "require passkey" would lock the person out; turn it off.
        conn.execute("UPDATE users SET require_passkey = 0 WHERE id = ?", (user_id,))
    return removed


def set_required(conn: sqlite3.Connection, user_id: int, required: bool) -> None:
    if required and not _creds(conn, user_id):
        raise PasskeyError("register a passkey before requiring it")
    conn.execute("UPDATE users SET require_passkey = ? WHERE id = ?", (int(required), user_id))
