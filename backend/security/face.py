"""Face check by webcam, as an extra sign-in step (F09.19).

The browser runs the open-source Human library (MIT) on this computer: it finds the face, checks that it is a live
person and not a photo or screen (its liveness and anti-spoof models), and turns the face into a fingerprint of
1,024 numbers. Only those numbers reach the server. No picture is sent or stored. The server compares them with
the fingerprints saved when the person set up face unlock, using Human's own similarity measure.

How strong this is, honestly: the comparison is real, but the camera and the models run in the browser, so someone
who controls that computer could feed in a recorded face. That is why a face check is only ever a second step,
after a password or a passkey, never a way in by itself. Windows Hello with an infrared camera, or a security key,
checks liveness in hardware and is stronger; VAULT supports both as passkeys.
"""

from __future__ import annotations

import json
import math
import secrets
import sqlite3
import threading
import time

from backend.storage.db import now

MODEL = "human-faceres-3.3"
EMBED_LEN = 1024
MATCH = 0.6  # Human's similarity, 0 to 1. Its face-ID demo treats about 0.5 as a match; VAULT asks more.
LIVE_MIN = 0.5  # liveness model: blinking, moving person rather than a still
REAL_MIN = 0.5  # anti-spoof model: a real face rather than a photo or screen
MIN_SAMPLES, MAX_SAMPLES = 3, 5
STEP_SECONDS = 120
STEP_TRIES = 3

_steps: dict[str, dict] = {}
_lock = threading.Lock()


class FaceError(ValueError):
    pass


def _clean(vector: list[float]) -> list[float]:
    if len(vector) != EMBED_LEN or not all(
        isinstance(x, int | float) and math.isfinite(x) and abs(x) < 10 for x in vector
    ):
        raise FaceError("that is not a face fingerprint from VAULT's face check")
    return [float(x) for x in vector]


def similarity(a: list[float], b: list[float]) -> float:
    """Human's match.similarity with its defaults (order 2, multiplier 25, min 0.2, max 0.8), so its thresholds hold."""
    dist = 25 * sum((x - y) ** 2 for x, y in zip(a, b, strict=True))
    if dist == 0:
        return 1.0
    norm = (1 - math.sqrt(dist) / 100 - 0.2) / (0.8 - 0.2)
    return max(min(norm, 1.0), 0.0)


def _live(live: float, real: float) -> None:
    if live < LIVE_MIN:
        raise FaceError("the camera did not see a live person; look at it and blink")
    if real < REAL_MIN:
        raise FaceError("that looked like a photo or a screen, not a real face")


def enroll(conn: sqlite3.Connection, user_id: int, samples: list[list[float]], live: float, real: float) -> int:
    """Save new face fingerprints, replacing any old ones. The samples must agree with each other."""
    _live(live, real)
    vectors = [_clean(s) for s in samples[:MAX_SAMPLES]]
    if len(vectors) < MIN_SAMPLES:
        raise FaceError(f"hold still for a moment so VAULT can take {MIN_SAMPLES} readings")
    for i, a in enumerate(vectors):
        for b in vectors[i + 1 :]:
            if similarity(a, b) < MATCH:
                raise FaceError("the readings did not agree; keep one face in view and try again")
    conn.execute("DELETE FROM face_templates WHERE user_id = ?", (user_id,))
    for v in vectors:
        conn.execute(
            "INSERT INTO face_templates (user_id, embedding, model, created_at) VALUES (?, ?, ?, ?)",
            (user_id, json.dumps(v), MODEL, now()),
        )
    return len(vectors)


def status(conn: sqlite3.Connection, user_id: int) -> dict:
    row = conn.execute(
        "SELECT COUNT(*) AS n, MAX(created_at) AS at FROM face_templates WHERE user_id = ?", (user_id,)
    ).fetchone()
    req = conn.execute("SELECT require_face FROM users WHERE id = ?", (user_id,)).fetchone()
    return {"enrolled": row["n"] > 0, "samples": row["n"], "set_up_at": row["at"], "required": bool(req and req[0])}


def remove(conn: sqlite3.Connection, user_id: int) -> None:
    conn.execute("DELETE FROM face_templates WHERE user_id = ?", (user_id,))
    conn.execute("UPDATE users SET require_face = 0 WHERE id = ?", (user_id,))


def match(conn: sqlite3.Connection, user_id: int, embedding: list[float], live: float, real: float) -> float:
    """The best similarity to this person's saved fingerprints. Raises FaceError if it is not a live match."""
    _live(live, real)
    v = _clean(embedding)
    saved = [
        json.loads(r[0]) for r in conn.execute("SELECT embedding FROM face_templates WHERE user_id = ?", (user_id,))
    ]
    if not saved:
        raise FaceError("face unlock is not set up for this account")
    best = max(similarity(v, s) for s in saved)
    if best < MATCH:
        raise FaceError("the face did not match")
    return best


# ---------- the pending second step ----------


def start_step(user_id: int, method: str) -> str:
    """After a correct password or passkey, a short-lived ticket for the face step. No session exists yet."""
    handle = secrets.token_urlsafe(24)
    t = time.monotonic()
    with _lock:
        for k in [k for k, v in _steps.items() if v["expires"] < t]:
            _steps.pop(k, None)
        _steps[handle] = {"user_id": user_id, "method": method, "expires": t + STEP_SECONDS, "tries": 0}
    return handle


def use_step(handle: str) -> dict:
    """Count one try on a ticket. Raises FaceError when it is unknown, expired or used up."""
    with _lock:
        step = _steps.get(handle)
        if not step or step["expires"] < time.monotonic():
            _steps.pop(handle, None)
            raise FaceError("this sign-in took too long; start again")
        step["tries"] += 1
        if step["tries"] > STEP_TRIES:
            _steps.pop(handle, None)
            raise FaceError("too many face attempts; start again")
        return dict(step)


def finish_step(handle: str) -> None:
    with _lock:
        _steps.pop(handle, None)
