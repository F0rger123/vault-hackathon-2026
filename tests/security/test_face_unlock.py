"""F09.19: face check by webcam as a second sign-in step, and sign-in levels an admin can set."""

import random

import pytest

from backend.security import face, liveness, steps
from backend.security import login as signin
from tests.conftest import auth

API = "/api/v1"
PASS = "a long enough password"


@pytest.fixture(autouse=True)
def _clean():
    signin.clear_attempts()
    steps._tickets.clear()
    liveness.clear()
    yield
    signin.clear_attempts()
    steps._tickets.clear()
    liveness.clear()


def vec(seed: int, noise: float = 0.0, base: int | None = None) -> list[float]:
    """A face fingerprint: a fixed person (base) plus a little camera noise."""
    rb = random.Random(base if base is not None else seed)
    v = [rb.gauss(0, 0.3) for _ in range(face.EMBED_LEN)]
    rn = random.Random(seed * 7919 + 1)
    return [x + rn.gauss(0, noise) for x in v]


ME = [vec(i, 0.02, base=1) for i in range(1, 5)]  # four readings of the same person
STRANGER = vec(99, 0.02, base=2)


POSE = {"left": (-20.0, 0.0), "right": (20.0, 0.0), "up": (0.0, 14.0)}


def performed(moves, readings, gap=66.0, live=0.9, real=0.9, eye=0.3):
    """The numbers VAULT's browser sends for a person making `moves` in turn (F09.22): a frame every `gap` ms, and a
    face reading while looking straight before the first move, after each move and at the end."""
    frames: list[dict] = []
    embeds: list[dict] = []
    t = 0.0

    def add(n, yaw=0.0, pitch=0.0, e=eye):
        nonlocal t
        for _ in range(n):
            frames.append({"t": t, "yaw": yaw, "pitch": pitch, "eye": e, "live": live, "real": real})
            t += gap

    def reading():
        if len(embeds) < len(readings):
            embeds.append({"t": frames[-1]["t"], "v": readings[len(embeds)]})

    add(5)
    reading()
    for m in moves:
        if m == "blink":
            add(3, e=eye * 0.3)
            add(4)
        else:
            add(4, *POSE[m])
            add(5)
        reading()
    while len(embeds) < len(readings):
        add(2)
        reading()
    add(3)
    return frames, embeds


def challenge(client, h=None, handle=None, purpose="enroll", took=10.0):
    """Ask for a challenge, as if the person then took `took` seconds to follow it."""
    if handle:
        r = client.post(f"{API}/auth/face-challenge", json={"handle": handle})
    else:
        r = client.post(f"{API}/auth/face/challenge", headers=h, json={"purpose": purpose})
    assert r.status_code == 200, r.text
    c = r.json()
    liveness._challenges[c["id"]]["issued"] -= took
    return c


def answer(c, readings, moves=None, **kw):
    frames, embeds = performed(c["moves"] if moves is None else moves, readings, **kw)
    return {"challenge": c["id"], "frames": frames, "embeddings": embeds}


def enroll(client, h, readings=None, quality=None, **kw):
    body = answer(challenge(client, h), ME[:3] if readings is None else readings, **kw)
    return client.post(f"{API}/auth/face", headers=h, json={**body, **({"quality": quality} if quality else {})})


def face_step(client, handle, readings, moves=None, **kw):
    c = challenge(client, handle=handle)
    return client.post(f"{API}/auth/face-step", json={"handle": handle, **answer(c, readings, moves, **kw)})


def _person(client, tokens, name="dana", role="analyst"):
    r = client.post(
        f"{API}/users", headers=auth(tokens["admin"]), json={"username": name, "role": role, "password": PASS}
    )
    assert r.status_code == 201
    token = client.post(f"{API}/auth/login", json={"username": name, "password": PASS}).json()["token"]
    return r.json()["id"], auth(token)


def test_similarity_is_humans_measure():
    a = vec(1)
    assert face.similarity(a, a) == 1.0
    assert face.similarity(ME[0], ME[1]) >= face.MATCH
    assert face.similarity(ME[0], STRANGER) < face.MATCH


def test_enrolling_checks_readings_and_liveness(client, tokens):
    _, h = _person(client, tokens)
    assert enroll(client, h, live=0.1).status_code == 422
    photo = enroll(client, h, real=0.1)
    assert photo.status_code == 422 and "photo" in photo.json()["detail"]
    mixed = enroll(client, h, [ME[0], ME[1], STRANGER])
    assert mixed.status_code == 422
    assert enroll(client, h, ME[:2]).status_code == 422
    assert enroll(client, h, [[0.1] * 10] * 3).status_code == 422
    still = enroll(client, h, moves=[], gap=150)  # a photo: never moves
    assert still.status_code == 422 and "did not move" in still.json()["detail"]
    ok = enroll(client, h)
    assert ok.status_code == 201 and ok.json()["enrolled"] and ok.json()["samples"] == 3
    c = challenge(client, h)
    assert client.post(f"{API}/auth/face", json=answer(c, ME[:3])).status_code == 401


def test_face_step_decides_the_sign_in(client, tokens):
    _, h = _person(client, tokens)
    assert client.put(f"{API}/auth/face/required", headers=h, json={"required": True}).status_code == 409
    enroll(client, h)
    assert client.put(f"{API}/auth/face/required", headers=h, json={"required": True}).json()["required"]

    first = client.post(f"{API}/auth/login", json={"username": "dana", "password": PASS}).json()
    assert first["step"] == "face" and "token" not in first  # a right password alone gives no session

    handle = first["handle"]
    assert face_step(client, handle, [STRANGER] * 3).status_code == 401
    assert face_step(client, handle, ME[1:4], real=0.2).status_code == 401
    ok = face_step(client, handle, ME[1:4])
    assert ok.status_code == 200 and ok.json()["token"].startswith("vlt_")
    assert client.get(f"{API}/me", headers=auth(ok.json()["token"])).json()["username"] == "dana"
    assert client.post(f"{API}/auth/face-challenge", json={"handle": handle}).status_code == 401  # single use

    log = client.get(f"{API}/signin-log", headers=auth(tokens["admin"])).json()
    methods = [(e["method"], e["outcome"]) for e in log if e["username"] == "dana"]
    assert ("password+face", "allowed") in methods and ("password+face", "denied") in methods


def test_three_wrong_faces_end_the_attempt(client, tokens):
    _, h = _person(client, tokens)
    enroll(client, h)
    client.put(f"{API}/auth/face/required", headers=h, json={"required": True})
    handle = client.post(f"{API}/auth/login", json={"username": "dana", "password": PASS}).json()["handle"]
    for _ in range(3):
        assert face_step(client, handle, [STRANGER] * 3).status_code == 401
    r = client.post(f"{API}/auth/face-challenge", json={"handle": handle})
    assert r.status_code == 401 and "start again" in r.json()["detail"]


def test_admin_sets_levels_only_once_people_have_set_them_up(client, tokens):
    uid, h = _person(client, tokens)
    a = auth(tokens["admin"])
    assert client.patch(f"{API}/users/{uid}", headers=a, json={"require_face": True}).status_code == 409
    assert client.patch(f"{API}/users/{uid}", headers=a, json={"require_passkey": True}).status_code == 409
    enroll(client, h)
    r = client.patch(f"{API}/users/{uid}", headers=a, json={"require_face": True})
    assert r.status_code == 200 and r.json()["require_face"] and r.json()["face_set_up"]
    assert (
        client.patch(f"{API}/users/{uid}", headers=auth(tokens["analyst"]), json={"require_face": False}).status_code
        == 403
    )
    # Removing face unlock also drops the requirement, so nobody is locked out by a deleted setup.
    client.delete(f"{API}/auth/face", headers=h)
    assert client.get(f"{API}/auth/face", headers=h).json() | {} == {
        **client.get(f"{API}/auth/face", headers=h).json(),
        "enrolled": False,
        "required": False,
    }
