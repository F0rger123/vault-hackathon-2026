"""Face check by webcam, as an extra sign-in step (F09.19).

The browser runs the open-source Human library (MIT) on this computer: it finds the face, checks that it is a live
person and not a photo or screen (its liveness and anti-spoof models), and turns the face into a fingerprint of
1,024 numbers. Only those numbers reach the server. No picture is sent or stored. The server compares them with
the fingerprints saved when the person set up face unlock, using Human's own similarity measure.

F09.22 adds a random head-move challenge (backend/security/liveness.py) and checks Human's liveness and anti-spoof
scores across many frames, so a photo, a phone video or a screen held up to the webcam fails.

How strong this is, honestly: the comparison is real, but the camera and the models run in the browser, so someone
who controls that computer could feed in a recorded face or made-up numbers. That is why a face check is only ever a
second step, after a password or a passkey, never a way in by itself. Windows Hello with an infrared camera, or a
security key, checks liveness in hardware and is stronger; VAULT supports both as passkeys.
"""

from __future__ import annotations

import json
import math
import sqlite3

from backend.storage.db import now

MODEL = "human-faceres-3.3"
EMBED_LEN = 1024
MATCH = 0.6  # Human's similarity, 0 to 1. Its face-ID demo treats about 0.5 as a match; VAULT asks more.
MATCH_EACH = 0.55  # F09.22: no reading in a challenge may fall below this (a face swapped in partway fails)
SAME_PERSON = 0.55  # readings from one setup or one challenge must agree with each other at least this much
MIN_SAMPLES, MAX_SAMPLES = 3, 5


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


def _same_person(vectors: list[list[float]]) -> None:
    for i, a in enumerate(vectors):
        for b in vectors[i + 1 :]:
            if similarity(a, b) < SAME_PERSON:
                raise FaceError("the readings did not agree; keep one face in view and try again")


def enroll(conn: sqlite3.Connection, user_id: int, samples: list[list[float]]) -> int:
    """Save new face fingerprints, replacing any old ones. Call after the liveness challenge passed (F09.22)."""
    vectors = [_clean(s) for s in samples[:MAX_SAMPLES]]
    if len(vectors) < MIN_SAMPLES:
        raise FaceError(f"hold still for a moment so VAULT can take {MIN_SAMPLES} readings")
    _same_person(vectors)
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


class FaceMismatch(FaceError):
    def __init__(self, best: float, worst: float):
        super().__init__("the face did not match")
        self.best, self.worst = best, worst


def compare(conn: sqlite3.Connection, user_id: int, embeddings: list[list[float]]) -> dict:
    """How close each reading is to this person's saved fingerprints, and whether that is a match."""
    vectors = [_clean(e) for e in embeddings]
    saved = [
        json.loads(r[0]) for r in conn.execute("SELECT embedding FROM face_templates WHERE user_id = ?", (user_id,))
    ]
    if not saved:
        raise FaceError("face unlock is not set up for this account")
    each = [max(similarity(v, s) for s in saved) for v in vectors]
    return {"best": max(each), "worst": min(each), "match": max(each) >= MATCH and min(each) >= MATCH_EACH}


def match(conn: sqlite3.Connection, user_id: int, embeddings: list[list[float]]) -> float:
    """F09.22: every reading from one challenge must be this person, and all of them the same face.

    The best reading must reach MATCH and none may fall below MATCH_EACH, so a different face swapped in partway
    through fails. Raises FaceError (FaceMismatch for a different face). Call after the liveness challenge passed.
    """
    vectors = [_clean(e) for e in embeddings]
    _same_person(vectors)
    result = compare(conn, user_id, vectors)
    if not result["match"]:
        raise FaceMismatch(result["best"], result["worst"])
    return result["best"]


# F09.20: the browser refuses a poor camera or picture before it reads a face; the server re-checks what it reports.
QUALITY_MIN = {"width": 640, "height": 360, "fps": 12, "face_px": 120, "sharpness": 8}
BRIGHTNESS = (45, 215)


def check_quality(q: dict[str, float]) -> None:
    if not q:
        return
    for key, low in QUALITY_MIN.items():
        if key in q and q[key] < low:
            raise FaceError(f"the camera picture is not good enough ({key} {q[key]:.0f}, VAULT needs {low})")
    if "brightness" in q and not BRIGHTNESS[0] <= q["brightness"] <= BRIGHTNESS[1]:
        raise FaceError("the picture is too dark or too bright; face a window or a lamp")
