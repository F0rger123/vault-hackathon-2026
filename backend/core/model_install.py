"""Download Meta models into the local Ollama from inside VAULT, sized to this machine (F03.7).

The person sees what their hardware can run, picks a model, or takes the recommended set, and VAULT asks the
local Ollama to download it. Ollama fetches the weights from its own registry: that is the only outbound traffic,
it carries no document data, and it happens only when an admin clicks Install.

Only models in CATALOG can be installed, so the API cannot be used to pull arbitrary images. Sizes are the
download sizes Ollama lists, used for the "fits on this machine" estimate before the download starts. The real
size comes from Ollama once the download begins.
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from backend.core.config import Settings
from backend.core.hardware import HardwareProfile
from backend.core.local_models import LOCAL_HOSTS, OVERHEAD_FRACTION, OVERHEAD_GB, cache_clear


@dataclass(frozen=True)
class CatalogModel:
    name: str
    title: str
    size_gb: float
    reads: str  # "text" or "text and images"
    good_for: str


CATALOG: tuple[CatalogModel, ...] = (
    CatalogModel("llama3.2:1b", "Llama 3.2 1B", 1.3, "text", "Very fast first pass on laptops; lower accuracy"),
    CatalogModel("llama3.2:3b", "Llama 3.2 3B", 2.0, "text", "Fast reading on laptops with little graphics memory"),
    CatalogModel("llama3:8b", "Llama 3 8B", 4.7, "text", "VAULT's measured default: best accuracy on 8 GB cards"),
    CatalogModel("llama3.1:8b", "Llama 3.1 8B", 4.9, "text", "Like Llama 3 8B, with room for much longer documents"),
    CatalogModel(
        "llama3.2-vision:11b", "Llama 3.2 Vision 11B", 7.8, "text and images", "Reads photos, stamps and scanned pages"
    ),
    CatalogModel("llama3.3:70b", "Llama 3.3 70B", 43.0, "text", "Server-class accuracy for large archives"),
    CatalogModel("llama4:scout", "Llama 4 Scout", 67.0, "text and images", "Server-class, reads text and images"),
)
BY_NAME = {m.name: m for m in CATALOG}
VISION = "llama3.2-vision:11b"
GPU_PREFERENCE = ("llama3.3:70b", "llama3:8b", "llama3.1:8b", "llama3.2:3b", "llama3.2:1b")
CPU_PREFERENCE = ("llama3.2:3b", "llama3:8b", "llama3.2:1b")
# Ollama sends a progress line every few seconds while downloading; five quiet minutes means it stalled.
PULL_TIMEOUT = httpx.Timeout(30.0, read=300.0)
# Ollama names a model's default tag ":latest"; treat these as the same model when checking what is installed.
ALIASES = {"llama3:latest": "llama3:8b", "llama3.1:latest": "llama3.1:8b", "llama3.2:latest": "llama3.2:3b"}


def memory_gb(size_gb: float) -> float:
    return round(size_gb * (1 + OVERHEAD_FRACTION) + OVERHEAD_GB, 1)


def catalog_for(hw: HardwareProfile, installed: set[str]) -> dict:
    """Each catalog model with where it would run here, plus the recommended set to install in one click."""
    vram = sum(g.memory_mb or 0 for g in hw.gpus) / 1024 * 0.95
    ram = hw.ram_total_mb / 1024 * 0.6
    have = {ALIASES.get(n, n) for n in installed}
    rows = []
    for m in CATALOG:
        need = memory_gb(m.size_gb)
        where = "gpu" if need <= vram else "cpu" if need <= ram else "too_big"
        rows.append({**m.__dict__, "memory_gb": need, "runs_on": where, "installed": m.name in have})
    # One strong text reader plus the vision model covers every file type VAULT accepts. The reader is the
    # most accurate one that fits on the graphics card; without a card, a small one, because the CPU is slow.
    where = {r["name"]: r["runs_on"] for r in rows}
    reader = next((n for n in GPU_PREFERENCE if where[n] == "gpu"), None) or next(
        (n for n in CPU_PREFERENCE if where[n] == "cpu"), None
    )
    picks = [reader] if reader else []
    if where[VISION] != "too_big":
        picks.append(VISION)
    return {
        "models": rows,
        "recommended": picks,
        "vram_gb": round(vram / 0.95, 1),
        "ram_gb": round(hw.ram_total_mb / 1024, 1),
    }


class Installs:
    """Downloads in progress, one background thread each. State lives in memory: a restart simply shows
    the finished models as installed and lets a person retry anything that was cut off."""

    def __init__(self):
        self._lock = threading.Lock()
        self._state: dict[str, dict] = {}
        self._cancel: set[str] = set()

    def snapshot(self) -> list[dict]:
        with self._lock:
            return [dict(v) for v in self._state.values()]

    def start(self, settings: Settings, name: str) -> dict:
        if name not in BY_NAME:
            raise ValueError("only the Meta models VAULT lists can be installed")
        url = settings.ollama_url.rstrip("/")
        if (urlparse(url).hostname or "") not in LOCAL_HOSTS:
            raise ValueError("VAULT_OLLAMA_URL is not a local address")
        with self._lock:
            current = self._state.get(name)
            if current and current["status"] in ("starting", "downloading"):
                return dict(current)
            self._state[name] = {"name": name, "status": "starting", "completed": 0, "total": 0, "detail": ""}
            self._cancel.discard(name)
        threading.Thread(target=self._pull, args=(url, name), daemon=True, name=f"pull-{name}").start()
        return self.get(name)

    def cancel(self, name: str) -> None:
        with self._lock:
            self._cancel.add(name)

    def get(self, name: str) -> dict:
        with self._lock:
            return dict(self._state.get(name, {"name": name, "status": "idle", "completed": 0, "total": 0}))

    def _set(self, name: str, **kw) -> None:
        with self._lock:
            self._state[name].update(kw, updated_at=time.time())

    def _pull(self, url: str, name: str) -> None:
        try:
            body = {"model": name, "stream": True}
            with httpx.stream("POST", f"{url}/api/pull", json=body, timeout=PULL_TIMEOUT) as r:
                if r.status_code != 200:
                    self._set(name, status="failed", detail=f"Ollama answered {r.status_code}")
                    return
                for line in r.iter_lines():
                    if name in self._cancel:
                        self._set(name, status="cancelled", detail="Stopped. Install again to resume.")
                        return
                    if not line:
                        continue
                    msg = json.loads(line)
                    if msg.get("error"):
                        self._set(name, status="failed", detail=str(msg["error"])[:200])
                        return
                    update = {"status": "downloading", "detail": str(msg.get("status", ""))[:80]}
                    if msg.get("total"):
                        update.update(total=int(msg["total"]), completed=int(msg.get("completed", 0)))
                    self._set(name, **update)
            self._set(name, status="installed", detail="Ready")
            cache_clear()
        except (httpx.HTTPError, ValueError) as exc:
            # Messages only: no URLs or paths from the exception reach the client.
            self._set(name, status="failed", detail=f"Could not reach Ollama ({type(exc).__name__})")


INSTALLS = Installs()
