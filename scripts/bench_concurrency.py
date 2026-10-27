"""Measure provider throughput at increasing concurrency on real dataset files.

Usage: python -m scripts.bench_concurrency --provider ollama --sample 12
Writes evaluation/results/capacity-<provider>-<timestamp>.json
"""

import argparse
import json
import time
from pathlib import Path

from backend.core.capacity import CapacityPlan, calibrate, static_ceiling
from backend.core.config import get_settings
from backend.core.hardware import profile_hardware
from backend.ingest.service import extract_pages
from backend.providers import get_provider
from backend.security.files import sniff_media_type


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", default="ollama")
    ap.add_argument("--sample", type=int, default=12)
    ap.add_argument("--files", type=Path, default=Path("data/synthetic/v1/files"))
    ap.add_argument("--levels", default="1,2,4,8")
    args = ap.parse_args()

    s = get_settings()
    provider = get_provider(args.provider, s)
    info = provider.info()
    if not info.available:
        raise SystemExit(f"provider unavailable: {info.detail}")
    docs = []
    for p in sorted(args.files.iterdir()):
        if p.suffix in (".pdf", ".txt", ".csv", ".md"):
            data = p.read_bytes()
            docs.append((p.name, extract_pages(data, sniff_media_type(data[:4096]), 50)))
        if len(docs) >= args.sample:
            break

    hw = profile_hardware(s.data_dir)
    ceiling, reason = static_ceiling(hw, info.model, info.locality)
    provider.extract(*docs[0], [])  # warm-up: load the model so level 1 is not penalised
    levels, best = calibrate(
        lambda i: provider.extract(docs[i][1], docs[i][0], []),
        len(docs),
        ceiling,
        tuple(int(x) for x in args.levels.split(",")),
    )
    plan = CapacityPlan(
        info.name,
        info.model,
        info.locality,
        ceiling,
        reason,
        levels,
        best,
        next(lv.docs_per_minute for lv in levels if lv.concurrency == best),
    )
    out = plan.to_dict() | {"hardware": hw.to_dict(), "measured_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    print(json.dumps(out, indent=2))
    dest = Path("evaluation/results") / f"capacity-{info.name}-{time.strftime('%Y%m%d-%H%M%S')}.json"
    dest.write_text(json.dumps(out, indent=2), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
