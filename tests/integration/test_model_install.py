"""F03.7: install Meta models from inside VAULT, sized to the machine, admin only, catalog only."""

import json
import time
from contextlib import contextmanager

from backend.core import local_models as lm
from backend.core import model_install as mi
from backend.core.hardware import GpuInfo, HardwareProfile
from tests.conftest import auth

API = "/api/v1"
GB = 2**30


def hw(vram_mb, ram_mb):
    gpus = [GpuInfo("GPU", vram_mb)] if vram_mb else []
    return HardwareProfile("Windows", "cpu", 8, 16, ram_mb, ram_mb // 2, 500000, gpus)


def test_recommendations_follow_the_hardware():
    laptop = mi.catalog_for(hw(8192, 32768), set())
    assert laptop["recommended"] == ["llama3:8b", "llama3.2-vision:11b"]
    assert {m["name"]: m["runs_on"] for m in laptop["models"]}["llama3.3:70b"] == "too_big"

    no_gpu = mi.catalog_for(hw(0, 16384), set())
    # Without a graphics card the reader is small, and the vision model does not fit in 60% of 16 GB.
    assert no_gpu["recommended"] == ["llama3.2:3b"]

    server = mi.catalog_for(hw(81920, 262144), {"llama3:latest"})
    assert server["recommended"] == ["llama3.3:70b", "llama3.2-vision:11b"]
    assert {m["name"]: m["installed"] for m in server["models"]}["llama3:8b"] is True


class FakeStream:
    status_code = 200

    def iter_lines(self):
        yield json.dumps({"status": "pulling manifest"})
        yield json.dumps({"status": "downloading", "total": 100, "completed": 40})
        yield json.dumps({"status": "downloading", "total": 100, "completed": 100})
        yield json.dumps({"status": "success"})


def _fake_ollama(monkeypatch, installed):
    pulled = []

    @contextmanager
    def stream(method, url, json, timeout):
        pulled.append(json["model"])
        installed.append(json["model"])
        yield FakeStream()

    class Reply:
        def __init__(self, data):
            self.data = data

        def json(self):
            return self.data

    def get(url, timeout):
        if url.endswith("/api/tags"):
            return Reply({"models": [{"name": n, "size": 4 * GB, "details": {"family": "llama"}} for n in installed]})
        return Reply({"models": []})

    monkeypatch.setattr(mi.httpx, "stream", stream)
    monkeypatch.setattr(lm.httpx, "get", get)
    lm._cache.clear()
    mi.INSTALLS._state.clear()
    return pulled


def test_admin_installs_a_catalog_model_and_switches_to_it(client, tokens, monkeypatch):
    installed = ["llama3:latest"]
    pulled = _fake_ollama(monkeypatch, installed)
    admin, analyst, viewer = (auth(tokens[r]) for r in ("admin", "analyst", "viewer"))

    catalog = client.get(f"{API}/system/model-catalog", headers=viewer).json()
    assert catalog["active_model"] == "llama3:latest" and catalog["recommended"]

    body = {"name": "llama3.2:3b"}
    assert client.post(f"{API}/system/models/install", json=body, headers=viewer).status_code == 403
    assert client.post(f"{API}/system/models/install", json=body, headers=analyst).status_code == 403
    assert client.post(f"{API}/system/models/install", json=body).status_code == 401
    # Only listed Meta models: anything else is refused before Ollama is asked.
    for name in ("qwen2.5-coder:7b", "evil/model:latest", "llama3.2:3b; rm -rf /"):
        r = client.post(f"{API}/system/models/install", json={"name": name}, headers=admin)
        assert r.status_code in (400, 422)
    assert pulled == []

    assert client.post(f"{API}/system/models/install", json=body, headers=admin).status_code == 202
    for _ in range(50):
        state = {i["name"]: i for i in client.get(f"{API}/system/model-catalog", headers=viewer).json()["installs"]}
        if state["llama3.2:3b"]["status"] == "installed":
            break
        time.sleep(0.05)
    assert state["llama3.2:3b"] == {**state["llama3.2:3b"], "status": "installed", "completed": 100, "total": 100}
    assert pulled == ["llama3.2:3b"]

    assert client.put(f"{API}/settings/local-model", json={"name": "llama3.3:70b"}, headers=admin).status_code == 400
    assert client.put(f"{API}/settings/local-model", json=body, headers=analyst).status_code == 403
    assert client.put(f"{API}/settings/local-model", json=body, headers=admin).json() == {"active_model": "llama3.2:3b"}
    assert client.get(f"{API}/system/model-catalog", headers=viewer).json()["active_model"] == "llama3.2:3b"

    log = client.get(f"{API}/audit", headers=admin).json()
    assert {(e["action"], e["outcome"]) for e in log} >= {
        ("model.install", "allowed"),
        ("model.install", "denied"),
        ("settings.local_model", "allowed"),
    }


def test_a_remote_ollama_address_is_refused(client, tokens, settings, monkeypatch):
    monkeypatch.setattr(settings, "ollama_url", "http://203.0.113.5:11434")
    r = client.post(f"{API}/system/models/install", json={"name": "llama3.2:3b"}, headers=auth(tokens["admin"]))
    assert r.status_code == 400 and "local" in r.json()["detail"]
