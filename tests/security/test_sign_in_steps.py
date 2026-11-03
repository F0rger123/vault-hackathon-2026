"""F09.20: sign-in steps each person picks, the spoken key phrase, and camera quality checks.

The key-phrase fixture holds the features VAULT's browser code computes (scripts/voice_features.mts) for Windows'
two built-in speech voices saying three made-up phrases at five speeds. No real person's voice is in the repo.
"""

import json
from pathlib import Path

import pytest

from backend.security import login as signin
from backend.security import steps, voice
from backend.storage.db import connect
from tests.conftest import auth
from tests.security.test_face_unlock import ME, STRANGER, _person

API = "/api/v1"
PASS = "a long enough password"
VOICES = json.loads((Path(__file__).parents[1] / "fixtures" / "voice_features.json").read_text())


def take(name: str) -> list[list[float]]:
    return VOICES[name]["frames"]


@pytest.fixture(autouse=True)
def _clean():
    signin.clear_attempts()
    steps._tickets.clear()
    yield
    signin.clear_attempts()
    steps._tickets.clear()


def _voice(client, h, phrase="v0-a"):
    body = {"samples": [take(f"{phrase}-r{i}") for i in (0, 2, 4)], "snr_db": 30}
    r = client.post(f"{API}/auth/voice", headers=h, json=body)
    assert r.status_code == 201, r.text
    return r


def test_key_phrase_matches_only_the_same_phrase_and_voice(client, tokens, settings):
    uid, h = _person(client, tokens)
    _voice(client, h)
    with connect(settings.db_path) as conn:
        assert voice.match(conn, uid, take("v0-a-r1"), 30) < voice.THRESHOLD_MAX
        assert voice.match(conn, uid, take("v0-a-r3"), 30) < voice.THRESHOLD_MAX
        for other in ("v0-b-r1", "v0-c-r3", "v1-a-r1", "v1-a-r2"):
            with pytest.raises(voice.VoiceError):
                voice.match(conn, uid, take(other), 30)


def test_key_phrase_setup_refuses_bad_recordings(client, tokens):
    _, h = _person(client, tokens)
    good = [take(f"v0-a-r{i}") for i in (0, 2, 4)]
    noisy = client.post(f"{API}/auth/voice", headers=h, json={"samples": good, "snr_db": 5})
    assert noisy.status_code == 422 and "noise" in noisy.json()["detail"]
    mixed = client.post(f"{API}/auth/voice", headers=h, json={"samples": [*good[:2], take("v0-b-r2")], "snr_db": 30})
    assert mixed.status_code == 422 and "same phrase" in mixed.json()["detail"]
    silent = client.post(f"{API}/auth/voice", headers=h, json={"samples": [[[0.0] * 13] * 60] * 3, "snr_db": 30})
    assert silent.status_code == 422
    short = client.post(f"{API}/auth/voice", headers=h, json={"samples": [g[:20] for g in good], "snr_db": 30})
    assert short.status_code == 422
    assert client.post(f"{API}/auth/voice", json={"samples": good, "snr_db": 30}).status_code == 401


def test_steps_need_setting_up_first(client, tokens):
    _, h = _person(client, tokens)
    assert client.get(f"{API}/auth/steps", headers=h).json() == {
        "required": [],
        "set_up": {"password": True, "passkey": False, "face": False, "voice": False},
        "requested": [],
    }
    for wanted in (["voice"], ["passkey"], ["face"], ["fingerprint"]):
        assert client.put(f"{API}/auth/steps", headers=h, json={"steps": wanted}).status_code == 409
    _voice(client, h)
    r = client.put(f"{API}/auth/steps", headers=h, json={"steps": ["password", "voice"]})
    assert r.status_code == 200 and r.json()["required"] == ["password", "voice"]
    assert client.put(f"{API}/auth/steps", json={"steps": []}).status_code == 401


def test_three_steps_in_a_row(client, tokens):
    """Password, then face, then key phrase: a session only after the last one."""
    _, h = _person(client, tokens)
    client.post(f"{API}/auth/face", headers=h, json={"samples": ME[:3], "live": 0.9, "real": 0.9})
    _voice(client, h)
    assert client.put(f"{API}/auth/steps", headers=h, json={"steps": ["password", "face", "voice"]}).status_code == 200

    first = client.post(f"{API}/auth/login", json={"username": "dana", "password": PASS}).json()
    assert first["step"] == "face" and first["remaining"] == ["face", "voice"] and "token" not in first
    handle = first["handle"]

    early = client.post(f"{API}/auth/voice-step", json={"handle": handle, "frames": take("v0-a-r1"), "snr_db": 30})
    assert early.status_code == 409  # steps keep their order

    face_ok = client.post(
        f"{API}/auth/face-step", json={"handle": handle, "embedding": ME[3], "live": 0.9, "real": 0.9}
    ).json()
    assert face_ok["step"] == "voice" and face_ok["done"] == ["password", "face"] and "token" not in face_ok

    wrong = client.post(f"{API}/auth/voice-step", json={"handle": handle, "frames": take("v0-b-r1"), "snr_db": 30})
    assert wrong.status_code == 401
    ok = client.post(f"{API}/auth/voice-step", json={"handle": handle, "frames": take("v0-a-r3"), "snr_db": 30})
    assert ok.status_code == 200 and ok.json()["token"].startswith("vlt_")

    log = client.get(f"{API}/signin-log", headers=auth(tokens["admin"])).json()
    methods = [(e["method"], e["outcome"]) for e in log if e["username"] == "dana"]
    assert ("password+face+voice", "allowed") in methods and ("password+face+voice", "denied") in methods


def test_face_step_refuses_a_poor_camera(client, tokens):
    _, h = _person(client, tokens)
    body = {"samples": ME[:3], "live": 0.9, "real": 0.9}
    low = client.post(f"{API}/auth/face", headers=h, json={**body, "quality": {"width": 320, "height": 240}})
    assert low.status_code == 422 and "camera picture" in low.json()["detail"]
    dark = client.post(f"{API}/auth/face", headers=h, json={**body, "quality": {"brightness": 20}})
    assert dark.status_code == 422 and "dark" in dark.json()["detail"]
    good = {"width": 1280, "height": 720, "fps": 30, "brightness": 120, "sharpness": 40, "face_px": 260}
    assert client.post(f"{API}/auth/face", headers=h, json={**body, "quality": good}).status_code == 201


def test_wrong_steps_end_the_attempt_and_a_stranger_cannot_skip(client, tokens):
    _, h = _person(client, tokens)
    client.post(f"{API}/auth/face", headers=h, json={"samples": ME[:3], "live": 0.9, "real": 0.9})
    client.put(f"{API}/auth/steps", headers=h, json={"steps": ["face"]})
    handle = client.post(f"{API}/auth/login", json={"username": "dana", "password": PASS}).json()["handle"]
    # A step the person did not choose is refused rather than counted.
    r = client.post(f"{API}/auth/password-step", json={"handle": handle, "password": PASS})
    assert r.status_code == 409
    for _ in range(steps.WRONG_TRIES):
        r = client.post(
            f"{API}/auth/face-step", json={"handle": handle, "embedding": STRANGER, "live": 0.9, "real": 0.9}
        )
        assert r.status_code == 401
    r = client.post(f"{API}/auth/face-step", json={"handle": handle, "embedding": ME[0], "live": 0.9, "real": 0.9})
    assert r.status_code == 401 and "start again" in r.json()["detail"]


def test_admin_sets_steps_for_someone(client, tokens):
    uid, h = _person(client, tokens)
    a = auth(tokens["admin"])
    assert client.patch(f"{API}/users/{uid}", headers=a, json={"steps": ["voice"]}).status_code == 409
    _voice(client, h)
    r = client.patch(f"{API}/users/{uid}", headers=a, json={"steps": ["password", "voice"]})
    assert r.status_code == 200 and r.json()["steps"] == ["password", "voice"] and r.json()["voice_set_up"]
    assert client.patch(f"{API}/users/{uid}", headers=auth(tokens["analyst"]), json={"steps": []}).status_code == 403
    # Deleting the key phrase drops it from the steps, so nobody is locked out.
    client.delete(f"{API}/auth/voice", headers=h)
    assert client.get(f"{API}/auth/steps", headers=h).json()["required"] == ["password"]


def test_passkey_only_still_refuses_a_password():
    row = {f"require_{f}": f == "passkey" for f in steps.FACTORS}
    assert not steps.can_start_with(row, "password") and steps.can_start_with(row, "passkey")
    both = {f"require_{f}": f in ("password", "passkey") for f in steps.FACTORS}
    assert steps.can_start_with(both, "password") and steps.remaining(both, ["passkey"]) == ["password"]
    assert steps.remaining({f"require_{f}": False for f in steps.FACTORS}, ["password"]) == []
