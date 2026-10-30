"""Refuse a build that contains secrets, runtime data or demo data (F12.12).

python packaging/check_bundle.py dist/VAULT
"""

from __future__ import annotations

import fnmatch
import sys
from pathlib import Path

FORBIDDEN_NAMES = ("dev_tokens.json", ".env", ".env.*", "*.db", "*.db-wal", "*.db-shm")
FORBIDDEN_FOLDERS = (("data", "runtime"), ("data", "synthetic"), ("data", "demo"), ("data", "e2e"))


def problems(root: Path) -> list[str]:
    found = []
    for path in root.rglob("*"):
        rel = path.relative_to(root)
        if path.is_file() and any(fnmatch.fnmatch(path.name.lower(), pat) for pat in FORBIDDEN_NAMES):
            found.append(str(rel))
        parts = tuple(p.lower() for p in rel.parts)
        if path.is_dir() and any(parts[-len(folder) :] == folder for folder in FORBIDDEN_FOLDERS):
            found.append(str(rel))
    return sorted(found)


def main(argv: list[str]) -> int:
    if len(argv) != 2 or not Path(argv[1]).is_dir():
        print("usage: check_bundle.py <built app folder>", file=sys.stderr)
        return 2
    found = problems(Path(argv[1]))
    if found:
        print("The build contains files that must never ship:", file=sys.stderr)
        for item in found:
            print(f"  {item}", file=sys.stderr)
        return 1
    print("bundle check: no secrets, runtime data or demo data found")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
