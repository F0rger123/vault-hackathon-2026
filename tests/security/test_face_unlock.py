"""F09.19: face check by webcam as a second sign-in step, and sign-in levels an admin can set."""

import random

import pytest

from backend.security import face, steps
from backend.security import login as signin
from tests.conftest import auth

API = "/api/v1"
PASS = "a long enough password"


@pytest.fixture(autouse=True)
def _clean():
    signin.clear_attempts()
    steps._tickets.clear()
    yield
    signin.clear_attempts()
    steps._tickets.clear()


def vec(seed: int, noise: float = 0.0, base: int | None = None) -> list[float]:
    """A face fingerprint: a fixed person (base) plus a little camera noise."""
    rb = random.Random(base if base is not None else seed)
    v = [rb.gauss(0, 0.3) for _ in range(face.EMBED_LEN)]
    rn = random.Random(seed * 7919 + 1)
    return [x + rn.gauss(0, noise) for x in v]


ME = [vec(i, 0.02, base=1) for i in range(1, 5)]  # four readings of the same person
STRANGER = vec(99, 0.02, base=2)


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
    body = {"samples": ME[:3], "live": 0.9, "real": 0.9}
    assert client.post(f"{API}/auth/face", headers=h, json={**body, "live": 0.1}).status_code == 422
    photo = client.post(f"{API}/auth/face", headers=h, json={**body, "real": 0.1})
    assert photo.status_code == 422 and "photo" in photo.json()["detail"]
    mixed = client.post(f"{API}/auth/face", headers=h, json={**body, "samples": [ME[0], ME[1], STRANGER]})
    assert mixed.status_code == 422
    assert client.post(f"{API}/auth/face", headers=h, json={**body, "samples": ME[:2]}).status_code == 422
    assert client.post(f"{API}/auth/face", headers=h, json={**body, "samples": [[0.1] * 10] * 3}).status_code == 422
    ok = client.post(f"{API}/auth/face", headers=h, json=body)
    assert ok.status_code == 201 and ok.json()["enrolled"] and ok.json()["samples"] == 3
    assert client.post(f"{API}/auth/face", json=body).status_code == 401


def test_face_step_decides_the_sign_in(client, tokens):
    _, h = _person(client, tokens)
    assert client.put(f"{API}/auth/face/required", headers=h, json={"required": True}).status_code == 409
    client.post(f"{API}/auth/face", headers=h, json={"samples": ME[:3], "live": 0.9, "real": 0.9})
    assert client.put(f"{API}/auth/face/required", headers=h, json={"required": True}).json()["required"]

    first = client.post(f"{API}/auth/login", json={"username": "dana", "password": PASS}).json()
    assert first["step"] == "face" and "token" not in first  # a right password alone gives no session

    def step(embedding, live=0.9, real=0.9, handle=None):
        return client.post(
            f"{API}/auth/face-step",
            json={"handle": handle or first["handle"], "embedding": embedding, "live": live, "real": real},
        )

    assert step(STRANGER).status_code == 401
    assert step(ME[3], real=0.2).status_code == 401
    ok = step(ME[3])
    assert ok.status_code == 200 and ok.json()["token"].startswith("vlt_")
    assert client.get(f"{API}/me", headers=auth(ok.json()["token"])).json()["username"] == "dana"
    assert step(ME[3]).status_code == 401  # the ticket is single use

    log = client.get(f"{API}/signin-log", headers=auth(tokens["admin"])).json()
    methods = [(e["method"], e["outcome"]) for e in log if e["username"] == "dana"]
    assert ("password+face", "allowed") in methods and ("password+face", "denied") in methods


def test_three_wrong_faces_end_the_attempt(client, tokens):
    _, h = _person(client, tokens)
    client.post(f"{API}/auth/face", headers=h, json={"samples": ME[:3], "live": 0.9, "real": 0.9})
    client.put(f"{API}/auth/face/required", headers=h, json={"required": True})
    handle = client.post(f"{API}/auth/login", json={"username": "dana", "password": PASS}).json()["handle"]
    for _ in range(3):
        r = client.post(
            f"{API}/auth/face-step", json={"handle": handle, "embedding": STRANGER, "live": 0.9, "real": 0.9}
        )
        assert r.status_code == 401
    r = client.post(f"{API}/auth/face-step", json={"handle": handle, "embedding": ME[0], "live": 0.9, "real": 0.9})
    assert r.status_code == 401 and "start again" in r.json()["detail"]


def test_admin_sets_levels_only_once_people_have_set_them_up(client, tokens):
    uid, h = _person(client, tokens)
    a = auth(tokens["admin"])
    assert client.patch(f"{API}/users/{uid}", headers=a, json={"require_face": True}).status_code == 409
    assert client.patch(f"{API}/users/{uid}", headers=a, json={"require_passkey": True}).status_code == 409
    client.post(f"{API}/auth/face", headers=h, json={"samples": ME[:3], "live": 0.9, "real": 0.9})
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
