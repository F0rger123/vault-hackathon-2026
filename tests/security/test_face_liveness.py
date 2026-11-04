"""F09.22: the face check's random head-move challenge, so a photo or a recorded video is not enough.

The frames here are the numbers VAULT's browser sends (head turn, tilt, eye openness, Human's two scores), made up for
a fictional person. No face picture is in the repo.
"""

import itertools
import random

import pytest

from backend.security import liveness, steps
from backend.security import login as signin
from tests.security.test_face_unlock import ME, PASS, STRANGER, _person, answer, challenge, enroll, performed

API = "/api/v1"


@pytest.fixture(autouse=True)
def _clean():
    signin.clear_attempts()
    steps._tickets.clear()
    liveness.clear()
    yield
    signin.clear_attempts()
    steps._tickets.clear()
    liveness.clear()


@pytest.fixture
def ticket(client, tokens):
    """dana, with face unlock set up and required: a correct password leaves the face step to go."""
    _, h = _person(client, tokens)
    assert enroll(client, h).status_code == 201
    client.put(f"{API}/auth/steps", headers=h, json={"steps": ["password", "face"]})
    first = client.post(f"{API}/auth/login", json={"username": "dana", "password": PASS}).json()
    assert first["step"] == "face"
    return first["handle"]


def _step(client, handle, c, body):
    return client.post(f"{API}/auth/face-step", json={"handle": handle, **body})


def _forced(c, moves):
    liveness._challenges[c["id"]]["moves"] = list(moves)


def test_happy_path_signs_in(client, ticket):
    c = challenge(client, handle=ticket)
    assert len(c["moves"]) == 2 and set(c["moves"]) <= set(liveness.MOVES) and c["seconds"] > 0
    r = _step(client, ticket, c, answer(c, ME[1:4]))
    assert r.status_code == 200 and r.json()["token"].startswith("vlt_")


def test_wrong_challenge_order_is_refused(client, ticket):
    c = challenge(client, handle=ticket)
    _forced(c, ["left", "right"])
    r = _step(client, ticket, c, answer(c, ME[1:4], moves=["right", "left", "right"]))
    assert r.status_code == 401 and "order" in r.json()["detail"]
    c = challenge(client, handle=ticket)
    _forced(c, ["left", "right"])
    r = _step(client, ticket, c, answer(c, ME[1:4], moves=["right", "left"]))
    assert r.status_code == 401 and "turn your head to the right" in r.json()["detail"]


def test_no_pose_change_is_refused(client, ticket):
    """A photo held up to the camera: good scores, the same face, but the head never moves and the eyes never close."""
    c = challenge(client, handle=ticket)
    frames = [{"t": i * 66.0, "yaw": 1.0, "pitch": -2.0, "eye": 0.3, "live": 0.9, "real": 0.9} for i in range(40)]
    embeds = [{"t": t, "v": v} for t, v in zip((0.0, 1300.0, 2574.0), ME[1:4], strict=True)]
    r = _step(client, ticket, c, {"challenge": c["id"], "frames": frames, "embeddings": embeds})
    assert r.status_code == 401 and "did not move" in r.json()["detail"]


def test_a_different_face_partway_through_is_refused(client, ticket):
    c = challenge(client, handle=ticket)
    r = _step(client, ticket, c, answer(c, [ME[1], STRANGER, ME[2]]))
    assert r.status_code == 401 and "did not agree" in r.json()["detail"]


def test_an_expired_challenge_is_refused(client, ticket):
    c = challenge(client, handle=ticket)
    liveness._challenges[c["id"]]["expires"] -= liveness.DEADLINE_SECONDS + 1
    r = _step(client, ticket, c, answer(c, ME[1:4]))
    assert r.status_code == 401 and "too long" in r.json()["detail"]


@pytest.mark.parametrize(("live", "real", "words"), [(0.2, 0.9, "live person"), (0.9, 0.2, "photo or a screen")])
def test_low_liveness_scores_are_refused(client, ticket, live, real, words):
    c = challenge(client, handle=ticket)
    r = _step(client, ticket, c, answer(c, ME[1:4], live=live, real=real))
    assert r.status_code == 401 and words in r.json()["detail"]


def test_a_challenge_answers_once(client, ticket):
    c = challenge(client, handle=ticket)
    _forced(c, ["up", "blink"])
    body = answer(c, ME[1:4], moves=["up", "blink"], live=0.2)
    assert _step(client, ticket, c, body).status_code == 401
    replay = _step(client, ticket, c, answer(c, ME[1:4], moves=["up", "blink"]))
    assert replay.status_code == 401 and "not found" in replay.json()["detail"]


def test_too_fast_or_impossible_timing_is_refused(client, ticket):
    c = challenge(client, handle=ticket)
    quick = answer(c, ME[1:4], gap=20)
    r = _step(client, ticket, c, quick)
    assert r.status_code == 401 and "too quick" in r.json()["detail"]
    # Frames spanning longer than the challenge was open were recorded beforehand.
    c = challenge(client, handle=ticket, took=0.0)
    r = _step(client, ticket, c, answer(c, ME[1:4]))
    assert r.status_code == 401 and "longer than the challenge" in r.json()["detail"]


def test_challenges_per_sign_in_are_limited(client, ticket):
    for _ in range(steps.MAX_CHALLENGES):
        assert client.post(f"{API}/auth/face-challenge", json={"handle": ticket}).status_code == 200
    r = client.post(f"{API}/auth/face-challenge", json={"handle": ticket})
    assert r.status_code == 401 and "start again" in r.json()["detail"]


def test_challenge_needs_a_face_step_and_own_origin(client, tokens):
    _person(client, tokens)
    handle = client.post(f"{API}/auth/login", json={"username": "dana", "password": PASS}).json().get("handle")
    assert handle is None  # no face step chosen: the password alone signs in
    assert client.post(f"{API}/auth/face-challenge", json={"handle": "nope"}).status_code == 401
    other = client.post(f"{API}/auth/face-challenge", json={"handle": "x"}, headers={"Origin": "https://evil.test"})
    assert other.status_code == 403


def test_a_recorded_video_rarely_matches_a_random_challenge():
    """A video of someone making every move in turn passes only the one order it happens to show (1 in 12)."""
    recorded = ["left", "right", "up", "blink"]
    passed = 0
    orders = list(itertools.permutations(liveness.MOVES, 2))
    for moves in orders:
        frames, embeds = performed(recorded, ME[:3])
        ch = {"moves": list(moves), "issued": 0.0, "answered": 30.0}
        try:
            liveness.check(ch, frames, embeds)
            passed += 1
        except liveness.LivenessError:
            pass
    assert len(orders) == 12 and passed == 1


def test_issued_orders_are_random():
    rng = random.Random(7)
    seen = {tuple(liveness.issue(f"o{i}", "signin", rng=rng)["moves"]) for i in range(200)}
    assert len(seen) == 12


def test_test_my_face_reports_numbers_without_signing_in(client, tokens):
    _, h = _person(client, tokens)
    assert enroll(client, h).status_code == 201
    c = challenge(client, h, purpose="test")
    r = client.post(f"{API}/auth/face/test", headers=h, json=answer(c, ME[1:4]))
    body = r.json()
    assert r.status_code == 200 and body["match"] and body["best"] >= body["threshold"] and "token" not in body
    c = challenge(client, h, purpose="test")
    bad = client.post(f"{API}/auth/face/test", headers=h, json=answer(c, [STRANGER] * 3)).json()
    assert not bad["match"] and bad["best"] < bad["threshold"] and "did not match" in bad["reason"]
    # An enrollment challenge cannot be spent on a test, nor the other way round.
    c = challenge(client, h, purpose="enroll")
    wrong = client.post(f"{API}/auth/face/test", headers=h, json=answer(c, ME[1:4])).json()
    assert not wrong["match"] and "not found" in wrong["reason"]
    assert client.post(f"{API}/auth/face/test", json=answer(c, ME[1:4])).status_code == 401
