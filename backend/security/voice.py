"""Spoken key phrase, as an extra sign-in step (F09.20).

The person picks a phrase only they know and says it into the microphone three times. The browser turns each
recording into a short series of numbers describing how it sounds (13 MFCC values every 20 ms, the standard
speech features) and sends only those numbers; no recording leaves the page and none is stored. At sign-in the
phrase is said once more and the server compares it with the saved ones by dynamic time warping, which lines up
two utterances spoken at different speeds. A different phrase, or the same phrase in a clearly different voice,
lines up badly and is refused.

How strong this is, honestly: it checks that the right phrase was said in a voice like the one set up. It is not
a bank-grade voiceprint, and a recording of the person saying the phrase would pass, so it is only ever an extra
step after a password or passkey, never a way in by itself.
"""

from __future__ import annotations

import json
import math
import sqlite3

from backend.storage.db import now

DIMS = 13
MIN_FRAMES, MAX_FRAMES = 40, 300  # 0.8 to 6 seconds at one frame per 20 ms
SAMPLES = 3
MIN_SNR_DB = 12.0  # speech must stand clearly above the room noise
# Distances are per aligned frame, on features scaled to unit variance. Measured with scripts/calibrate_voice.py on
# Windows' two built-in voices saying three phrases at three speeds, with room noise added: the same phrase in the
# same voice scored 0.18 to 0.27; the same phrase in the other voice 0.57 to 0.69; a different phrase 0.56 to 0.73.
# People repeat themselves less exactly than a speech engine, so the bar sits above the first group, below the rest.
ENROLL_MAX = 0.5  # three takes further apart than this were not the same phrase said the same way
THRESHOLD_MIN, THRESHOLD_MAX = 0.32, 0.48
THRESHOLD_SLACK = 1.35


class VoiceError(ValueError):
    pass


def _normalise(frames: list[list[float]]) -> list[list[float]]:
    """Check the shape, then scale each feature to zero mean and unit variance over the utterance."""
    if not MIN_FRAMES <= len(frames) <= MAX_FRAMES:
        raise VoiceError("say the phrase in one go, between one and six seconds")
    for f in frames:
        if len(f) != DIMS or not all(isinstance(x, int | float) and math.isfinite(x) and abs(x) < 1e4 for x in f):
            raise VoiceError("that is not a recording from VAULT's key phrase check")
    cols = list(zip(*frames, strict=True))
    means = [sum(c) / len(c) for c in cols]
    sds = [math.sqrt(sum((x - m) ** 2 for x in c) / len(c)) for c, m in zip(cols, means, strict=True)]
    if sum(1 for s in sds if s < 1e-6) > DIMS // 2:
        raise VoiceError("VAULT heard silence or a steady noise, not speech")
    return [[(x - m) / s if s >= 1e-6 else 0.0 for x, m, s in zip(f, means, sds, strict=True)] for f in frames]


def distance(a: list[list[float]], b: list[list[float]]) -> float:
    """Dynamic time warping with a band, as the average distance per aligned step."""
    n, m = len(a), len(b)
    band = max(abs(n - m), int(max(n, m) * 0.3)) + 1
    inf = math.inf
    prev = [inf] * (m + 1)
    prev[0] = 0.0
    for i in range(1, n + 1):
        cur = [inf] * (m + 1)
        ai = a[i - 1]
        for j in range(max(1, i - band), min(m, i + band) + 1):
            best = min(prev[j], cur[j - 1], prev[j - 1])
            if best != inf:
                cur[j] = math.dist(ai, b[j - 1]) + best
        prev = cur
    if prev[m] == inf:
        return inf
    return prev[m] / (n + m) / math.sqrt(DIMS)


def _quality(snr_db: float) -> None:
    if snr_db < MIN_SNR_DB:
        raise VoiceError(
            f"the microphone picked up too much background noise ({snr_db:.0f} dB above it; VAULT needs "
            f"{MIN_SNR_DB:.0f}). Move somewhere quieter or closer to the microphone"
        )


def enroll(conn: sqlite3.Connection, user_id: int, samples: list[list[list[float]]], snr_db: float) -> dict:
    """Save three takes of the phrase, replacing old ones. The takes must agree with each other."""
    _quality(snr_db)
    if len(samples) != SAMPLES:
        raise VoiceError(f"say the phrase {SAMPLES} times")
    takes = [_normalise(s) for s in samples]
    pairs = [distance(takes[i], takes[j]) for i in range(SAMPLES) for j in range(i + 1, SAMPLES)]
    if max(pairs) > ENROLL_MAX:
        raise VoiceError("the three takes did not sound like the same phrase; say it the same way each time")
    threshold = min(max(max(pairs) * THRESHOLD_SLACK, THRESHOLD_MIN), THRESHOLD_MAX)
    conn.execute("DELETE FROM voice_templates WHERE user_id = ?", (user_id,))
    for t in takes:
        conn.execute(
            "INSERT INTO voice_templates (user_id, features, threshold, created_at) VALUES (?, ?, ?, ?)",
            (user_id, json.dumps([[round(x, 4) for x in f] for f in t]), threshold, now()),
        )
    return status(conn, user_id)


def status(conn: sqlite3.Connection, user_id: int) -> dict:
    row = conn.execute(
        "SELECT COUNT(*) AS n, MAX(created_at) AS at FROM voice_templates WHERE user_id = ?", (user_id,)
    ).fetchone()
    return {"enrolled": row["n"] > 0, "set_up_at": row["at"]}


def remove(conn: sqlite3.Connection, user_id: int) -> None:
    conn.execute("DELETE FROM voice_templates WHERE user_id = ?", (user_id,))
    conn.execute("UPDATE users SET require_voice = 0 WHERE id = ?", (user_id,))


def match(conn: sqlite3.Connection, user_id: int, frames: list[list[float]], snr_db: float) -> float:
    """The closest saved take. Raises VoiceError unless it is close enough."""
    _quality(snr_db)
    said = _normalise(frames)
    rows = conn.execute("SELECT features, threshold FROM voice_templates WHERE user_id = ?", (user_id,)).fetchall()
    if not rows:
        raise VoiceError("a key phrase is not set up for this account")
    saved = [json.loads(r["features"]) for r in rows]
    mean_len = sum(len(s) for s in saved) / len(saved)
    if not 0.5 <= len(said) / mean_len <= 2.0:
        raise VoiceError("that was not the key phrase")
    best = min(distance(said, s) for s in saved)
    if best > rows[0]["threshold"]:
        raise VoiceError("that was not the key phrase")
    return best
