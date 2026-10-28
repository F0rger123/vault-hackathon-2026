"""Reset the demo environment to a known state so the demo can be rehearsed again and again (F12.6).

Steps: wipe the demo data directory, create the database and demo users, import the synthetic dataset,
process it, and leave one organization proposal waiting for an administrator. Uses the real `vault` CLI
for each step, so a rehearsal exercises the same code as the demo.

    python scripts/demo_reset.py                       # heuristic provider, data/demo, about 10 seconds
    python scripts/demo_reset.py --provider ollama     # local Llama 3, several minutes

Safety: the script only deletes a directory it created itself (marked with a `.vault-demo` file), an empty
directory, or one that does not exist yet. It refuses anything else, including `data/runtime`.
Tokens are written to `<data-dir>/dev_tokens.json` and never printed.
"""

from __future__ import annotations

import argparse
import os
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "data" / "synthetic" / "v1" / "files"
MARKER = ".vault-demo"
COLLECTION = "Halvern Engineering Archive"


def _vault() -> list[str]:
    exe = Path(sys.executable).with_name("vault.exe" if os.name == "nt" else "vault")
    return [str(exe)] if exe.exists() else [sys.executable, "-m", "cli.main"]


def _safe_to_wipe(path: Path) -> bool:
    if not path.exists():
        return True
    if not path.is_dir():
        return False
    return (path / MARKER).exists() or not any(path.iterdir())


def _run(step: str, args: list[str], env: dict) -> float:
    started = time.perf_counter()
    print(f"-> {step}", flush=True)
    proc = subprocess.run([*_vault(), *args], cwd=ROOT, env=env, capture_output=True, text=True)  # noqa: S603
    # Show the CLI's last line, but never a line that could carry a token.
    tail = [ln for ln in (proc.stdout + proc.stderr).strip().splitlines() if "vlt_" not in ln][-1:]
    for ln in tail:
        print(f"   {ln.strip()[-160:]}")
    if proc.returncode != 0:
        raise SystemExit(f"step failed: {step} (exit {proc.returncode})")
    return time.perf_counter() - started


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data-dir", default=str(ROOT / "data" / "demo"))
    ap.add_argument("--provider", default="heuristic", choices=["heuristic", "ollama"])
    ap.add_argument("--workers", type=int, default=0, help="0 = hardware recommendation")
    ap.add_argument("--no-proposal", action="store_true", help="skip the pending organization proposal")
    args = ap.parse_args()

    data_dir = Path(args.data_dir).resolve()
    if not _safe_to_wipe(data_dir):
        print(
            f"refusing to wipe {data_dir}: it was not created by this script (no {MARKER} file). "
            "Choose another --data-dir or empty it yourself.",
            file=sys.stderr,
        )
        return 2
    if not DATASET.is_dir():
        print(f"dataset not found at {DATASET}", file=sys.stderr)
        return 1

    started = time.perf_counter()
    data_dir.mkdir(parents=True, exist_ok=True)
    # Wipe everything except the marker, so a wipe that fails halfway still leaves the directory re-runnable.
    for child in data_dir.iterdir():
        if child.name == MARKER:
            continue
        if child.is_dir():
            # Stored originals are read-only on purpose; clear the flag so the wipe can remove them.
            shutil.rmtree(child, onerror=lambda fn, path, _: (os.chmod(path, stat.S_IWRITE), fn(path)))
        else:
            child.unlink()
    (data_dir / MARKER).write_text("Created by scripts/demo_reset.py; safe for it to delete.\n", encoding="utf-8")
    env = {**os.environ, "VAULT_DATA_DIR": str(data_dir), "VAULT_ALLOW_REMOTE_INFERENCE": "false"}

    timings = {
        "init": _run("create database and demo users", ["init", "--demo-users"], env),
        "ingest": _run(
            f"import {DATASET.relative_to(ROOT)}", ["ingest", str(DATASET), "--collection", COLLECTION], env
        ),
    }
    process = ["process", "--collection", COLLECTION, "--provider", args.provider]
    if args.workers:
        process += ["--workers", str(args.workers)]
    timings["process"] = _run(f"process with {args.provider}", process, env)

    sys.path.insert(0, str(ROOT))
    os.environ["VAULT_DATA_DIR"] = str(data_dir)
    from backend.core.config import Settings
    from backend.security import audit
    from backend.storage.db import connect
    from backend.workers.proposals import create_proposal

    with connect(Settings(data_dir=data_dir, _env_file=None).db_path) as conn:
        cid = conn.execute("SELECT id FROM collections WHERE name = ?", (COLLECTION,)).fetchone()["id"]
        # Fictional data: shown in Demo mode, kept out of Real mode (F10.11).
        conn.execute("UPDATE collections SET is_demo = 1 WHERE id = ?", (cid,))
        if not args.no_proposal:
            analyst = conn.execute("SELECT id FROM users WHERE username = 'analyst'").fetchone()["id"]
            pid = create_proposal(conn, cid, analyst, "Organize by project, document type and year")
            audit.record(
                conn, "analyst", "proposal.create", "allowed", target=f"proposal:{pid}", detail={"seeded": True}
            )
        docs = conn.execute("SELECT COUNT(*) n FROM documents WHERE collection_id = ?", (cid,)).fetchone()["n"]
        done = conn.execute(
            "SELECT COUNT(*) n FROM documents WHERE collection_id = ? AND status = 'processed'", (cid,)
        ).fetchone()["n"]
        findings = conn.execute("SELECT COUNT(*) n FROM findings WHERE collection_id = ?", (cid,)).fetchone()["n"]
        pending = conn.execute("SELECT COUNT(*) n FROM proposals WHERE status = 'pending'").fetchone()["n"]

    total = time.perf_counter() - started
    print(
        f"\ndemo ready in {total:.1f}s ({', '.join(f'{k} {v:.1f}s' for k, v in timings.items())})\n"
        f"  collection: {COLLECTION} (id {cid}), {done}/{docs} documents processed, {findings} findings, "
        f"{pending} proposal(s) pending\n"
        f"  tokens: {data_dir / 'dev_tokens.json'} (never share or commit)\n"
        f"  serve:  VAULT_DATA_DIR={data_dir} VAULT_DEMO_LOGIN=true vault serve\n"
        f"  sign in with the Demo buttons (VAULT_DEMO_LOGIN=true), or a token from the file above"
    )
    return 0 if done == docs and docs > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
