"""Which local models are installed, and how many of them this machine can run at once (F03.6).

Ollama reports each installed model and its size on disk. A loaded model needs roughly that much memory
plus working space for its context, so VAULT estimates:
- how many copies fit in GPU memory at the same time (fast);
- how many more would fit in free system RAM instead (much slower, on the CPU);
- how many requests each copy serves at once, the same 8 the capacity planner uses.

These are estimates from sizes, labelled as such. The measured numbers come from the capacity check on
Set up a run.
"""

from __future__ import annotations

import time
from urllib.parse import urlparse

import httpx

from backend.core.config import Settings
from backend.core.hardware import HardwareProfile

LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", "host.docker.internal"}
# Context cache and runtime buffers on top of the weights, as a fraction of the file size plus a fixed part.
OVERHEAD_FRACTION, OVERHEAD_GB = 0.2, 0.5
REQUESTS_PER_COPY = 8
META_FAMILIES = ("llama", "mllama")


def _origin(name: str, family: str | None) -> str:
    """'meta' for Meta's own models, 'llama-based' for third-party fine-tunes of Llama, else 'other'."""
    if name.casefold().startswith(("llama", "muse")):
        return "meta"
    return "llama-based" if (family or "").casefold() in META_FAMILIES else "other"


_cache: dict[tuple[str, str], tuple[float, dict]] = {}
CACHE_SECONDS = 30


def cache_clear() -> None:
    """After an install or a model change, so the next screen shows it at once."""
    _cache.clear()


def local_models(settings: Settings, hw: HardwareProfile) -> dict:
    """Cached for half a minute: Ollama takes about a second to answer, and several screens ask."""
    key = (settings.ollama_url, settings.ollama_model)
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    result = _local_models(settings, hw)
    _cache[key] = (time.monotonic(), result)
    return result


def _local_models(settings: Settings, hw: HardwareProfile) -> dict:
    url = settings.ollama_url.rstrip("/")
    if (urlparse(url).hostname or "") not in LOCAL_HOSTS:
        return {"reachable": False, "detail": "VAULT_OLLAMA_URL is not a local address", "models": []}
    try:
        tags = httpx.get(f"{url}/api/tags", timeout=3).json().get("models", [])
        loaded = {m.get("name") for m in httpx.get(f"{url}/api/ps", timeout=3).json().get("models", [])}
    except (httpx.HTTPError, ValueError):
        return {
            "reachable": False,
            "detail": "Ollama is not running. Start it, then reload this page.",
            "models": [],
            **_machine(hw),
        }

    vram_gb = sum(g.memory_mb or 0 for g in hw.gpus) / 1024
    ram_gb = hw.ram_available_mb / 1024
    models = []
    for m in tags:
        name = m.get("name", "")
        details = m.get("details") or {}
        size_gb = (m.get("size") or 0) / 2**30
        need = size_gb * (1 + OVERHEAD_FRACTION) + OVERHEAD_GB
        models.append(
            {
                "name": name,
                "size_gb": round(size_gb, 1),
                "memory_gb": round(need, 1),
                "parameters": details.get("parameter_size"),
                "quantization": details.get("quantization_level"),
                "family": details.get("family"),
                "origin": _origin(name, details.get("family")),
                "digest": (m.get("digest") or "")[:12],
                "used_by_vault": name == settings.ollama_model,
                "loaded": name in loaded,
                "copies_on_gpu": int(vram_gb * 0.95 // need) if vram_gb and need else 0,
                "copies_in_ram": int(ram_gb // (need * 1.5)) if need else 0,
                "requests_per_copy": REQUESTS_PER_COPY,
            }
        )
    models.sort(key=lambda x: (not x["used_by_vault"], x["origin"] != "meta", x["name"]))
    return {"reachable": True, "detail": "ready", "models": models, **_machine(hw), **_together(models, vram_gb)}


def _machine(hw: HardwareProfile) -> dict:
    return {
        "gpu": ", ".join(g.name for g in hw.gpus) or None,
        "vram_gb": round(sum(g.memory_mb or 0 for g in hw.gpus) / 1024, 1),
        "ram_free_gb": round(hw.ram_available_mb / 1024, 1),
    }


def _together(models: list[dict], vram_gb: float) -> dict:
    """How many different installed models fit in GPU memory together: VAULT's model first, then smallest.

    Tags that point at the same file (same digest, e.g. llama3:8b and llama3:latest) count once.
    """
    budget, names, seen = vram_gb * 0.95, [], set()
    for m in sorted(models, key=lambda x: (not x["used_by_vault"], x["memory_gb"])):
        if m["digest"] and m["digest"] in seen:
            continue
        seen.add(m["digest"])
        if m["memory_gb"] <= budget:
            budget -= m["memory_gb"]
            names.append(m["name"])
    return {"different_models_on_gpu_together": len(names), "fit_together": names}
