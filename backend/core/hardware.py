"""Hardware and collection profiling.

Everything reported here is measured on the running machine. Runtime estimates come from
timing a real sample of documents, never from fixed constants.
"""

import os
import platform
import shutil
import statistics
import subprocess  # noqa: S404 - fixed argv, no shell
from dataclasses import asdict, dataclass, field
from pathlib import Path

import psutil


@dataclass
class GpuInfo:
    name: str
    memory_mb: int | None


@dataclass
class HardwareProfile:
    os: str
    cpu_model: str
    physical_cores: int | None
    logical_cores: int
    ram_total_mb: int
    ram_available_mb: int
    disk_free_mb: int
    gpus: list[GpuInfo] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _detect_nvidia() -> list[GpuInfo]:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return []
    try:
        out = subprocess.run(  # noqa: S603 - absolute path from which(), fixed arguments
            [exe, "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        ).stdout
    except (subprocess.SubprocessError, OSError):
        return []
    gpus = []
    for line in out.strip().splitlines():
        name, _, mem = line.partition(",")
        try:
            gpus.append(GpuInfo(name.strip(), int(float(mem.strip()))))
        except ValueError:
            gpus.append(GpuInfo(name.strip(), None))
    return gpus


def profile_hardware(data_dir: Path) -> HardwareProfile:
    vm = psutil.virtual_memory()
    data_dir.mkdir(parents=True, exist_ok=True)
    return HardwareProfile(
        os=f"{platform.system()} {platform.release()}",
        cpu_model=platform.processor() or platform.machine(),
        physical_cores=psutil.cpu_count(logical=False),
        logical_cores=os.cpu_count() or 1,
        ram_total_mb=vm.total // 2**20,
        ram_available_mb=vm.available // 2**20,
        disk_free_mb=shutil.disk_usage(data_dir).free // 2**20,
        gpus=_detect_nvidia(),
    )


def recommend_workers(hw: HardwareProfile, provider_locality: str, provider_name: str) -> tuple[int, str]:
    """Pick a safe concurrency limit and explain why."""
    cpu_cap = max(1, hw.logical_cores - 1)
    ram_cap = max(1, hw.ram_available_mb // 512)  # ~512 MB headroom per worker for parsing
    if provider_name == "ollama":
        # One local model instance serialises generation; extra workers only overlap parsing and I/O.
        cap = min(cpu_cap, ram_cap, 2)
        return cap, "local Ollama model serves one generation at a time; 2 workers overlap parsing with inference"
    if provider_locality == "remote":
        cap = min(cpu_cap, ram_cap, 8)
        return cap, "remote API calls are I/O bound; capped at 8 to respect provider rate limits"
    cap = min(cpu_cap, ram_cap, 16)
    return cap, "CPU-bound local processing; one worker per spare core, limited by free RAM"


@dataclass
class Estimate:
    documents: int
    sample_size: int
    per_doc_ms_median: float
    per_doc_ms_p90: float
    workers: int
    est_seconds_low: float
    est_seconds_high: float
    basis: str

    def to_dict(self) -> dict:
        return asdict(self)


def estimate_runtime(sample_ms: list[float], documents: int, workers: int, overlap: float) -> Estimate:
    """Project total runtime from measured per-document timings.

    `overlap` is the fraction of per-document time that can run in parallel (1.0 = fully parallel).
    The low bound uses the median, the high bound the 90th percentile.
    """
    if not sample_ms:
        raise ValueError("benchmark produced no timings")
    med = statistics.median(sample_ms)
    p90 = sorted(sample_ms)[max(0, int(round(0.9 * len(sample_ms))) - 1)]
    speedup = 1 + (workers - 1) * overlap

    def project(ms: float) -> float:
        return documents * ms / 1000 / speedup

    return Estimate(
        documents=documents,
        sample_size=len(sample_ms),
        per_doc_ms_median=round(med, 1),
        per_doc_ms_p90=round(p90, 1),
        workers=workers,
        est_seconds_low=round(project(med), 1),
        est_seconds_high=round(project(p90), 1),
        basis=f"measured {len(sample_ms)} sample document(s) on this machine",
    )
