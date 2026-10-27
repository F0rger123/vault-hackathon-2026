"""Capacity planning: how many model lanes this machine can run, measured rather than assumed.

Two inputs decide parallelism:
1. Static limits from the hardware profile (VRAM, RAM, cores) and the model's memory footprint.
2. A calibration run that sends the same sample to the provider at increasing concurrency and keeps
   the level where throughput stops improving. GPUs and inference servers batch requests, so the
   only honest way to know the best level is to measure it.
"""

import statistics
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field

from backend.core.hardware import HardwareProfile

# Approximate resident memory per loaded model instance (GB), used only for the static ceiling.
# Calibration, not this table, decides the final number.
MODEL_MEMORY_GB = {
    "llama3:latest": 5.5,
    "llama3.2-vision:11b": 8.0,
    "muse-glimmer:30b": 18.0,
}


@dataclass
class LevelResult:
    concurrency: int
    documents: int
    seconds: float
    docs_per_minute: float
    p50_ms: float
    errors: int


@dataclass
class CapacityPlan:
    provider: str
    model: str
    locality: str
    static_ceiling: int
    static_reason: str
    levels: list[LevelResult] = field(default_factory=list)
    recommended_concurrency: int = 1
    docs_per_minute: float = 0.0

    def projected_hours(self, documents: int) -> float | None:
        if not self.docs_per_minute:
            return None
        return round(documents / self.docs_per_minute / 60, 2)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["projections"] = {str(n): self.projected_hours(n) for n in (1_000, 10_000, 100_000, 1_000_000)}
        return d


def static_ceiling(hw: HardwareProfile, model: str, locality: str, remote_rpm: int = 3000) -> tuple[int, str]:
    """Upper bound on concurrent lanes before measuring anything."""
    if model.startswith("regex-"):
        return min(64, hw.logical_cores * 2), "rule-based baseline (not a model); limited by CPU cores"
    if locality == "remote":
        # Assume ~10 s per request; stay well under the provider's requests-per-minute limit.
        cap = max(1, min(64, remote_rpm // 6 // 10))
        return cap, f"remote API; capped at {cap} in-flight requests to stay under {remote_rpm} RPM"
    mem = MODEL_MEMORY_GB.get(model, 6.0)
    vram = sum((g.memory_mb or 0) for g in hw.gpus) / 1024
    if vram:
        instances = max(1, int(vram // mem))
        # One instance can serve several requests at once (server-side batching); allow up to 8 per instance.
        cap = instances * 8
        return cap, f"{vram:.0f} GB VRAM fits {instances} instance(s) of {model} (~{mem} GB); up to 8 requests each"
    instances = max(1, int((hw.ram_available_mb / 1024) // (mem * 1.5)))
    return min(instances, hw.logical_cores), f"no GPU detected; {instances} CPU instance(s) fit in free RAM"


def _timed(fn: Callable[[int], None], i: int) -> float | None:
    """Run fn(i); return elapsed milliseconds, or None if it raised."""
    t = time.perf_counter()
    try:
        fn(i)
    except Exception:
        return None
    return (time.perf_counter() - t) * 1000


def calibrate(
    run_one: Callable[[int], None],
    sample_size: int,
    ceiling: int,
    levels: tuple[int, ...] = (1, 2, 4, 8, 16, 32),
    min_gain: float = 0.10,
) -> tuple[list[LevelResult], int]:
    """Measure throughput at increasing concurrency. `run_one(i)` processes sample item i.

    Stops when a level improves throughput by less than `min_gain` (10%) over the best so far.
    """
    results: list[LevelResult] = []
    best = None
    for level in [lv for lv in levels if lv <= ceiling] or [1]:
        n = max(sample_size, level)
        start = time.perf_counter()
        with ThreadPoolExecutor(max_workers=level) as pool:
            outcomes = list(pool.map(lambda i: _timed(run_one, i % sample_size), range(n)))
        secs = time.perf_counter() - start
        timings = [ms for ms in outcomes if ms is not None]
        errors = n - len(timings)
        ok = len(timings)
        res = LevelResult(
            level,
            n,
            round(secs, 2),
            round(ok / secs * 60, 1) if secs else 0.0,
            round(statistics.median(timings), 1) if timings else 0.0,
            errors,
        )
        results.append(res)
        if best is None or res.docs_per_minute > best.docs_per_minute * (1 + min_gain):
            best = res
        else:
            break
    return results, best.concurrency if best else 1
