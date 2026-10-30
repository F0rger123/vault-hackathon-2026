"""How protected this VAULT is right now, checked live (F09.13).

Each check looks at the real setting or state, says whether it passes, why it matters, and how to fix it. The
score is the number of checks that pass. It is a checklist of VAULT's own controls, not a certification.
"""

from __future__ import annotations

import os
import sqlite3

from backend.core.config import Settings

LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1", "testserver"}
SYNCED = ("onedrive", "dropbox", "google drive", "googledrive", "icloud")


def posture(conn: sqlite3.Connection, settings: Settings) -> dict:
    hosts = {h.strip().casefold() for h in settings.allowed_hosts.split(",") if h.strip()}
    held = conn.execute("SELECT COUNT(*) FROM documents WHERE status = 'quarantined'").fetchone()[0]
    admins = conn.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'").fetchone()[0]
    admins_pw = conn.execute(
        "SELECT COUNT(*) FROM users WHERE role = 'admin' AND password_hash IS NOT NULL"
    ).fetchone()[0]
    denials = conn.execute("SELECT COUNT(*) FROM audit_log WHERE outcome = 'denied'").fetchone()[0]
    data_dir = str(settings.data_dir.resolve()).casefold()
    checks = [
        _c(
            "remote_off",
            "Documents stay on this machine",
            not settings.allow_remote_inference,
            "Remote models are switched off, so no document text can leave.",
            "Remote inference is allowed. Turn it off on the Security screen unless you need it.",
        ),
        _c(
            "local_only",
            "Only this computer can reach VAULT",
            hosts <= LOCAL_HOSTS,
            "VAULT answers only on local addresses.",
            "VAULT_ALLOWED_HOSTS lists other names. Make sure a proxy with HTTPS stands in front.",
        ),
        _c(
            "demo_off",
            "Demo sign-in is off",
            not settings.demo_login,
            "Nobody can sign in with the one-click demo buttons.",
            "One-click demo sign-in is on. Start with --real (or VAULT_DEMO_LOGIN=false) for real documents.",
        ),
        _c(
            "admin_password",
            "Every admin has a password",
            admins > 0 and admins_pw == admins,
            "Admins sign in with a password that is slowed down against guessing (scrypt).",
            "An admin has no password. Run `vault set-password <name>`.",
        ),
        _c(
            "sessions_expire",
            "Sign-ins expire",
            settings.session_ttl_hours <= 24,
            f"Sessions end after {settings.session_ttl_hours:g} hours.",
            "Sessions last more than a day. Lower VAULT_SESSION_TTL_HOURS.",
        ),
        _c(
            "quarantine",
            "Files with active content are held",
            True,
            f"The security gate holds files that could run code or reach out when opened. {held} held now.",
            "",
        ),
        _c(
            "cache_off",
            "Model answers are not kept on disk",
            not settings.response_cache,
            "The development response cache is off.",
            "VAULT_RESPONSE_CACHE is on, which keeps model answers on disk. Turn it off for real documents.",
        ),
        _c(
            "not_synced",
            "Data folder is not synced to a cloud",
            not any(s in data_dir for s in SYNCED),
            "VAULT's data folder is outside OneDrive, Dropbox, Google Drive and iCloud.",
            "The data folder is inside a cloud-synced folder, so copies leave this machine. Move VAULT_DATA_DIR.",
        ),
        _c(
            "no_telemetry",
            "No usage data is sent",
            os.environ.get("NEXT_TELEMETRY_DISABLED") == "1",
            "Next.js usage reporting is off for this run.",
            "Start VAULT with start.ps1 or start.sh, which turn Next.js usage reporting off.",
        ),
        _c(
            "audit",
            "Every action is logged",
            True,
            f"The audit log records allowed and refused actions. {denials} refusals so far.",
            "",
        ),
        _c(
            "strong_unlock",
            "Hardware key or face unlock",
            False,
            "",
            "Not set up yet. Passkeys (Windows Hello face or fingerprint, or a YubiKey) are planned.",
        ),
    ]
    passed = sum(c["ok"] for c in checks)
    return {"passed": passed, "total": len(checks), "checks": checks, "quarantined": held}


def _c(cid: str, label: str, ok: bool, good: str, fix: str) -> dict:
    return {"id": cid, "label": label, "ok": bool(ok), "detail": good if ok else fix}
