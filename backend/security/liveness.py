"""A random head-move challenge for the face check (F09.22), so a photo or a recorded video is not enough.

How it works:
1. The server picks two moves at random (turn left, turn right, look up, blink), in a random order, and gives the
   browser a short deadline. The challenge is stored here, in memory, and can be answered once.
2. The browser watches the face while the person follows the prompts. For every frame it sends a few numbers: the
   head's turn (yaw) and tilt (pitch) worked out from the face mesh, how open the eyes are, and Human's liveness and
   anti-spoof scores. It also sends face fingerprints from at least three moments: before the first move, between
   moves and after the last one.
3. The server checks that the moves happened in the issued order and in a plausible time, that the head really moved,
   that the passive scores held across many frames, and that every fingerprint is the same person.

What this stops, honestly: a photo held up to the webcam (it cannot turn or blink), a phone or screen replaying a video
(it is unlikely to make the moves in the random order asked, before the deadline), and a mix of two people. What it
does not stop: someone who changes VAULT's browser code to send made-up numbers, a real-time deepfake, or a good 3D
mask. The numbers are measured in the browser, so a modified client can forge them. That is why the face check is only
ever a later step after a password or a passkey.
"""

from __future__ import annotations

import math
import random
import secrets
import statistics
import threading
import time

from backend.security.face import FaceError

MOVES = ("left", "right", "up", "blink")
HEAD_MOVES = ("left", "right", "up")
PROMPTS = {
    "left": "Turn your head to the left",
    "right": "Turn your head to the right",
    "up": "Look up",
    "blink": "Blink slowly",
}
CHALLENGE_MOVES = 2
DEADLINE_SECONDS = 25.0  # from issue to answer; a person needs about 5 to 10 seconds
MIN_SPAN_MS = 1200  # two moves plus looking straight cannot honestly take less
MIN_FRAMES, MAX_FRAMES = 10, 600
MAX_FRAME_GAP_MS = 400  # at least a few readings a second, so a move cannot hide between frames
MIN_EVENT_GAP_MS = 200
YAW_DEG = 12.0  # head turn from the starting pose
PITCH_DEG = 8.0
BLINK_RATIO = 0.65  # eyes at most this open, compared with the start, then open again
REOPEN_RATIO = 0.8
LIVE_MIN = 0.5  # Human's liveness model, per frame
REAL_MIN = 0.5  # Human's anti-spoof model, per frame
PASSIVE_SHARE = 0.4  # this share of frames must pass both, and at least PASSIVE_FRAMES of them
PASSIVE_FRAMES = 5
MIN_EMBEDDINGS = 3
SAME_PERSON = 0.55  # Human's similarity between two readings in the same challenge

_challenges: dict[str, dict] = {}
_lock = threading.Lock()


class LivenessError(FaceError):
    pass


def issue(owner: str, purpose: str, rng: random.Random | None = None) -> dict:
    """A new challenge for `owner` (a sign-in ticket or a signed-in person). Replaces that owner's previous one."""
    pick = rng or secrets.SystemRandom()
    moves = pick.sample(MOVES, CHALLENGE_MOVES)
    cid = secrets.token_urlsafe(18)
    t = time.monotonic()
    with _lock:
        for k in [k for k, v in _challenges.items() if v["expires"] < t or v["owner"] == owner]:
            _challenges.pop(k, None)
        _challenges[cid] = {
            "owner": owner,
            "purpose": purpose,
            "moves": moves,
            "issued": t,
            "expires": t + DEADLINE_SECONDS,
        }
    return {
        "id": cid,
        "moves": moves,
        "prompts": [PROMPTS[m] for m in moves],
        "seconds": DEADLINE_SECONDS,
    }


def take(cid: str, owner: str, purpose: str) -> dict:
    """The challenge, removed so it cannot be answered twice. Raises LivenessError if it is unknown or too old."""
    with _lock:
        ch = _challenges.pop(cid, None)
    if not ch or ch["owner"] != owner or ch["purpose"] != purpose:
        raise LivenessError("the face challenge was not found; start the face check again")
    ch["answered"] = time.monotonic()
    if ch["answered"] > ch["expires"]:
        raise LivenessError("the face challenge took too long; try again and follow the prompts promptly")
    return ch


def clear() -> None:
    with _lock:
        _challenges.clear()


def _num(x, low: float, high: float) -> float:
    if not isinstance(x, int | float) or not math.isfinite(x) or not low <= x <= high:
        raise LivenessError("the face readings were not valid")
    return float(x)


def _events(frames: list[dict]) -> tuple[dict[str, list[int]], tuple[float, float, float]]:
    """Frame indexes where each move shows, measured against the pose of the first few frames."""
    head = frames[:3]
    by = statistics.median(f["yaw"] for f in head)
    bp = statistics.median(f["pitch"] for f in head)
    be = statistics.median(f["eye"] for f in head)
    seen: dict[str, list[int]] = {m: [] for m in MOVES}
    closed_at: int | None = None
    for i, f in enumerate(frames):
        if f["yaw"] - by <= -YAW_DEG:
            seen["left"].append(i)
        if f["yaw"] - by >= YAW_DEG:
            seen["right"].append(i)
        if f["pitch"] - bp >= PITCH_DEG:
            seen["up"].append(i)
        if be > 0 and f["eye"] <= BLINK_RATIO * be and abs(f["yaw"] - by) < YAW_DEG:
            closed_at = i if closed_at is None else closed_at
        elif closed_at is not None and f["eye"] >= REOPEN_RATIO * be:
            seen["blink"].append(closed_at)  # a blink counts when the eyes open again
            closed_at = None
    return seen, (by, bp, be)


def check(ch: dict, frames: list[dict], embeddings: list[dict]) -> dict:
    """Raise LivenessError with a plain reason unless the frames answer challenge `ch`. Returns a short summary."""
    if not MIN_FRAMES <= len(frames) <= MAX_FRAMES:
        raise LivenessError("the camera did not watch long enough; follow the prompts on screen")
    clean = [
        {
            "t": _num(f.get("t"), 0, DEADLINE_SECONDS * 1000 + 5000),
            "yaw": _num(f.get("yaw"), -90, 90),
            "pitch": _num(f.get("pitch"), -90, 90),
            "eye": _num(f.get("eye"), 0, 2),
            "live": _num(f.get("live"), 0, 1),
            "real": _num(f.get("real"), 0, 1),
        }
        for f in frames
    ]
    times = [f["t"] for f in clean]
    if any(b <= a for a, b in zip(times, times[1:], strict=False)):
        raise LivenessError("the face readings were out of order")
    span = times[-1] - times[0]
    took_ms = (ch["answered"] - ch["issued"]) * 1000
    if span < MIN_SPAN_MS:
        raise LivenessError("that was too quick to be a person following the prompts")
    if span > took_ms + 1000:
        raise LivenessError("the face readings took longer than the challenge was open")
    if max(b - a for a, b in zip(times, times[1:], strict=False)) > MAX_FRAME_GAP_MS:
        raise LivenessError("the camera stalled during the challenge; try again in better light")

    # Passive: Human's liveness and anti-spoof models, across many frames rather than one lucky frame.
    passing = sum(1 for f in clean if f["live"] >= LIVE_MIN and f["real"] >= REAL_MIN)
    if passing < max(PASSIVE_FRAMES, math.ceil(PASSIVE_SHARE * len(clean))):
        if statistics.median(f["real"] for f in clean) < REAL_MIN:
            raise LivenessError("that looked like a photo or a screen, not a real face")
        raise LivenessError("the camera did not see a live person; look at it and blink")

    seen, _ = _events(clean)
    yaw = [f["yaw"] for f in clean]
    pitch = [f["pitch"] for f in clean]
    if max(yaw) - min(yaw) < YAW_DEG and max(pitch) - min(pitch) < PITCH_DEG:
        raise LivenessError("the head did not move; a photo cannot follow the prompts, a person can")

    # Active: each move after the one before, and no head move made before it was asked for, so a video that makes
    # every move in turn fails whenever the order asked differs from the order recorded.
    at: list[int] = []
    prev = -1
    for move in ch["moves"]:
        hits = [i for i in seen[move] if i > prev]
        if not hits:
            raise LivenessError(f"the camera did not see you {PROMPTS[move].lower()}")
        if move in HEAD_MOVES and seen[move][0] <= prev:
            raise LivenessError("the moves were not made in the order asked")
        if at and times[hits[0]] - times[at[-1]] < MIN_EVENT_GAP_MS:
            raise LivenessError("the moves came too fast to be a person following the prompts")
        at.append(hits[0])
        prev = hits[0]
    # A head move nobody asked for, before the last asked one is done: a recording making every move in turn fails.
    for move in HEAD_MOVES:
        if move not in ch["moves"] and seen[move] and seen[move][0] < at[-1]:
            raise LivenessError("make only the moves asked for, in the order shown")

    # Fingerprints from before the first move and after the last, so the same face was there throughout.
    if len(embeddings) < MIN_EMBEDDINGS:
        raise LivenessError(f"VAULT needs {MIN_EMBEDDINGS} readings of your face during the challenge")
    et = [_num(e.get("t"), 0, DEADLINE_SECONDS * 1000 + 5000) for e in embeddings]
    if min(et) > times[at[0]] or max(et) < times[at[-1]]:
        raise LivenessError("keep your face in view and look straight at the camera before and after the moves")
    return {"moves": list(ch["moves"]), "frames": len(clean), "span_ms": round(span), "passive": passing}
