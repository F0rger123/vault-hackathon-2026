"""F03.6: how many copies of each installed local model fit on this machine."""

import httpx

from backend.core import local_models as lm
from backend.core.config import Settings
from backend.core.hardware import GpuInfo, HardwareProfile

GB = 2**30
HW = HardwareProfile("Windows", "cpu", 16, 32, 32768, 16384, 500000, [GpuInfo("RTX 5070 Laptop", 8192)])


class Reply:
    def __init__(self, data):
        self.data = data

    def json(self):
        return self.data


def _fake_ollama(monkeypatch, models, loaded=()):
    def get(url, timeout):
        if url.endswith("/api/tags"):
            return Reply({"models": models})
        return Reply({"models": [{"name": n} for n in loaded]})

    monkeypatch.setattr(lm.httpx, "get", get)
    lm._cache.clear()


def test_copies_and_origins(monkeypatch):
    _fake_ollama(
        monkeypatch,
        [
            {
                "name": "llama3:latest",
                "size": int(4.4 * GB),
                "digest": "aaa",
                "details": {"family": "llama", "parameter_size": "8.0B"},
            },
            {"name": "llama3:8b", "size": int(4.4 * GB), "digest": "aaa", "details": {"family": "llama"}},
            {"name": "nous-hermes:latest", "size": int(3.6 * GB), "digest": "bbb", "details": {"family": "llama"}},
            {"name": "qwen:7b", "size": int(4.4 * GB), "digest": "ccc", "details": {"family": "qwen2"}},
        ],
        loaded=["llama3:latest"],
    )
    r = lm.local_models(Settings(_env_file=None), HW)
    by = {m["name"]: m for m in r["models"]}
    assert (
        r["models"][0]["name"] == "llama3:latest"
        and by["llama3:latest"]["used_by_vault"]
        and by["llama3:latest"]["loaded"]
    )
    assert by["llama3:latest"]["origin"] == "meta" and by["nous-hermes:latest"]["origin"] == "llama-based"
    assert by["qwen:7b"]["origin"] == "other"
    # 4.4 GB weights need about 5.8 GB with working space: one copy in 8 GB of graphics memory.
    assert by["llama3:latest"]["copies_on_gpu"] == 1 and by["llama3:latest"]["requests_per_copy"] == 8
    # VAULT's model goes first; the same file under two tags counts once; nothing else fits beside it.
    assert r["fit_together"] == ["llama3:latest"] and r["different_models_on_gpu_together"] == 1


def test_ollama_not_running(monkeypatch):
    def down(url, timeout):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(lm.httpx, "get", down)
    lm._cache.clear()
    r = lm.local_models(Settings(_env_file=None), HW)
    assert r["reachable"] is False and "not running" in r["detail"] and r["models"] == []


def test_remote_ollama_url_is_never_contacted(monkeypatch):
    called = []
    monkeypatch.setattr(lm.httpx, "get", lambda *a, **k: called.append(a))
    lm._cache.clear()
    r = lm.local_models(Settings(ollama_url="http://gpu.example.com:11434", _env_file=None), HW)
    assert r["reachable"] is False and called == []
