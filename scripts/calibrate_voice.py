"""F09.20 calibration: distances between key-phrase recordings, to check VAULT's voice thresholds.

    node scripts/voice_features.mts <folder-of-wavs> > features.json
    python scripts/calibrate_voice.py features.json

Files are named <voice>-<phrase>-<take>. Prints the distance range for the same phrase in the same voice, the
same phrase in another voice, and a different phrase, next to the thresholds in backend/security/voice.py.
"""

import json
import sys
from itertools import combinations

from backend.security import voice


def main(path: str) -> None:
    data = json.loads(open(path, encoding="utf-8").read())  # noqa: SIM115
    feats = {k: voice._normalise(v["frames"]) for k, v in data.items()}
    groups: dict[str, list[float]] = {"same phrase, same voice": [], "same phrase, other voice": [], "other phrase": []}
    for a, b in combinations(sorted(feats), 2):
        va, pa, _ = a.split("-")
        vb, pb, _ = b.split("-")
        kind = "other phrase" if pa != pb else "same phrase, same voice" if va == vb else "same phrase, other voice"
        groups[kind].append(voice.distance(feats[a], feats[b]))
    for kind, ds in groups.items():
        print(f"{kind:28} min {min(ds):.3f}  max {max(ds):.3f}  n={len(ds)}")
    print(f"enroll max {voice.ENROLL_MAX}, threshold {voice.THRESHOLD_MIN} to {voice.THRESHOLD_MAX}")


if __name__ == "__main__":
    main(sys.argv[1])
