"""VAULT command-line interface. Operates directly on the local database as the operator.

Examples:
  vault init --demo-users
  vault ingest data/synthetic/v1/files --collection demo
  vault estimate --collection demo --provider ollama
  vault process --collection demo --provider ollama
  vault search "PV-5595 psi"
  vault findings --collection demo
"""

import getpass
import json
import time
from pathlib import Path

import typer

from backend.core.config import get_settings
from backend.core.hardware import estimate_runtime, profile_hardware, recommend_workers
from backend.core.runtime import effective_settings
from backend.indexing.findings import analyse_collection
from backend.indexing.search import search as run_search
from backend.ingest.service import ensure_collection, ingest_bytes
from backend.providers import PROVIDER_NAMES, get_provider
from backend.providers.base import ProviderError
from backend.security import audit
from backend.security.auth import create_user, issue_token, list_tokens, revoke_token
from backend.security.files import FileRejected
from backend.storage.db import connect, migrate
from backend.workers.jobs import JobRunner, create_process_job
from backend.workers.processing import process_document

app = typer.Typer(help="VAULT local document intelligence", no_args_is_help=True)
ACTOR = f"cli:{getpass.getuser()}"


def _db():
    s = get_settings()
    migrate(s.db_path)
    return s, connect(s.db_path)


def _collection_id(conn, name: str) -> int:
    row = conn.execute("SELECT id FROM collections WHERE name = ?", (name,)).fetchone()
    if not row:
        raise typer.BadParameter(f"no collection named {name!r}")
    return row["id"]


@app.command()
def init(demo_users: bool = typer.Option(False, help="Create admin, analyst and viewer users with tokens")):
    """Create the database and (optionally) demo users. Tokens are written to a local, git-ignored file."""
    s, cm = _db()
    with cm as conn:
        typer.echo(f"database ready at {s.db_path}")
        if demo_users:
            tokens = {}
            for name, role in (("admin", "admin"), ("analyst", "analyst"), ("viewer", "viewer")):
                uid = create_user(conn, name, role)
                tokens[name] = issue_token(conn, uid, "demo")
            out = s.data_dir / "dev_tokens.json"
            out.write_text(json.dumps(tokens, indent=2))
            audit.record(conn, ACTOR, "users.create_demo", "allowed", detail={"users": list(tokens)})
            typer.echo(f"demo tokens written to {out} (local only, never commit)")


@app.command()
def token(
    username: str,
    role: str = typer.Option("analyst"),
    ttl_days: float = typer.Option(0, help="Days until the token expires; 0 means it never expires"),
):
    """Create a user if needed and issue a new API token."""
    _, cm = _db()
    with cm as conn:
        uid = create_user(conn, username, role)
        typer.echo(issue_token(conn, uid, "cli", ttl_days or None))
        audit.record(conn, ACTOR, "token.issue", "allowed", target=f"user:{username}", detail={"ttl_days": ttl_days})


@app.command()
def tokens():
    """List API tokens (metadata only; token values are never stored or shown)."""
    _, cm = _db()
    with cm as conn:
        for t in list_tokens(conn):
            state = "revoked" if t["revoked"] else "expired" if t["expired"] else "active"
            expires = time.strftime("%Y-%m-%d %H:%M", time.localtime(t["expires_at"])) if t["expires_at"] else "never"
            who = f"{t['username']:<12} {t['role']:<8}"
            typer.echo(f"{t['id']:>4}  {who} {state:<8} expires {expires}  {t['label'] or ''}")


@app.command()
def revoke(token_id: int):
    """Revoke an API token by id (see `vault tokens`). Takes effect on the next request."""
    _, cm = _db()
    with cm as conn:
        if not revoke_token(conn, token_id):
            typer.echo(f"token {token_id} not found or already revoked", err=True)
            raise typer.Exit(1)
        audit.record(conn, ACTOR, "token.revoke", "allowed", target=f"token:{token_id}")
        typer.echo(f"token {token_id} revoked")


@app.command()
def ingest(path: Path, collection: str = typer.Option("default")):
    """Import a file or every file under a directory. Originals are copied, never modified."""
    s, cm = _db()
    with cm as conn:
        cid = ensure_collection(conn, collection, None)
        paths = [path] if path.is_file() else sorted(p for p in path.rglob("*") if p.is_file())
        added = dup = 0
        for p in paths:
            try:
                r = ingest_bytes(conn, s, cid, p.name, p.read_bytes())
                dup += r.duplicate
                added += not r.duplicate
            except FileRejected as exc:
                typer.echo(f"rejected {p.name}: {exc}", err=True)
        audit.record(
            conn,
            ACTOR,
            "document.import_path",
            "allowed",
            target=f"collection:{cid}",
            detail={"accepted": added, "duplicates": dup},
        )
        typer.echo(f"collection {collection!r}: {added} added, {dup} duplicates skipped")


@app.command()
def hardware():
    """Show the measured hardware profile."""
    s = get_settings()
    typer.echo(json.dumps(profile_hardware(s.data_dir).to_dict(), indent=2))


@app.command()
def providers():
    """List model providers and whether each is usable right now."""
    s, cm = _db()
    with cm as conn:
        eff = effective_settings(conn, s)
    for name in PROVIDER_NAMES:
        try:
            i = get_provider(name, eff).info()
            mark = "ready" if i.available else "unavailable"
            typer.echo(f"{i.name:10} {i.model:28} {i.locality:6} ai={i.is_ai_model!s:5} {mark}: {i.detail}")
        except ProviderError as exc:
            typer.echo(f"{name:10} error: {exc}")


@app.command()
def estimate(collection: str = typer.Option("default"), provider: str | None = None, sample: int = 3):
    """Benchmark a real sample of documents and project total processing time."""
    s, cm = _db()
    with cm as conn:
        eff = effective_settings(conn, s)
        prov = get_provider(provider or eff.provider, eff)
        info = prov.info()
        if not info.available:
            raise typer.Exit(typer.echo(f"provider unavailable: {info.detail}", err=True) or 1)
        cid = _collection_id(conn, collection)
        total = conn.execute("SELECT COUNT(*) FROM documents WHERE collection_id = ?", (cid,)).fetchone()[0]
        docs = conn.execute(
            "SELECT id FROM documents WHERE collection_id = ? ORDER BY RANDOM() LIMIT ?", (cid, sample)
        ).fetchall()
        timings = [process_document(conn, prov, d["id"])["duration_ms"] for d in docs]
        hw = profile_hardware(s.data_dir)
        workers, reason = recommend_workers(hw, info.locality, info.name)
        est = estimate_runtime(timings, total, workers, 0.15 if info.name == "ollama" else 0.9)
        typer.echo(json.dumps({"provider": f"{info.name}:{info.model}", **est.to_dict(), "reason": reason}, indent=2))


@app.command()
def process(
    collection: str = typer.Option("default"),
    provider: str | None = None,
    workers: int | None = None,
    lane: list[str] = typer.Option(None, help="Model lane as provider:slots, repeatable, e.g. --lane ollama:2"),
    escalate: str | None = typer.Option(None, help="Provider for the review agent's escalations"),
    confirm_remote: bool = False,
):
    """Process a collection with the coordinator agent: security screening, model lanes, review."""
    s, cm = _db()
    with cm as conn:
        eff = effective_settings(conn, s)
        specs = []
        for item in lane or [f"{provider or eff.provider}:{workers or 0}"]:
            name, _, slots = item.partition(":")
            prov = get_provider(name, eff)
            info = prov.info()
            if info.locality == "remote" and not (confirm_remote and eff.allow_remote_inference):
                typer.echo(
                    f"{name} sends document text off this machine; needs VAULT_ALLOW_REMOTE_INFERENCE=true "
                    "and --confirm-remote",
                    err=True,
                )
                raise typer.Exit(2)
            if not info.available:
                typer.echo(f"provider {name} unavailable: {info.detail}", err=True)
                raise typer.Exit(1)
            n = int(slots or 0) or recommend_workers(profile_hardware(s.data_dir), info.locality, info.name)[0]
            specs.append({"provider": info.name, "concurrency": n})
        cid = _collection_id(conn, collection)
        job_id = create_process_job(
            conn, cid, specs[0]["provider"], specs[0]["concurrency"], None, lanes=specs, escalate_provider=escalate
        )
        audit.record(conn, ACTOR, "job.create", "allowed", target=f"job:{job_id}", detail={"lanes": specs})
        typer.echo("lanes: " + ", ".join(f"{x['provider']} x{x['concurrency']}" for x in specs))
    runner = JobRunner(s)
    runner.start(job_id)
    started = time.time()
    try:
        while True:
            with connect(s.db_path) as conn:
                j = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            typer.echo(
                f"\rjob {job_id} [{j['status']}] {j['done']}/{j['total']} done, {j['failed']} failed, "
                f"{time.time() - started:.0f}s",
                nl=False,
            )
            if j["status"] not in ("queued", "running"):
                break
            time.sleep(1)
    except KeyboardInterrupt:
        with connect(s.db_path) as conn:
            conn.execute("UPDATE jobs SET cancel_requested = 1 WHERE id = ?", (job_id,))
        typer.echo("\ncancel requested; waiting for running items to finish")
        runner.wait(job_id)
    typer.echo("")


@app.command()
def calibrate(provider: str | None = None, sample: int = 8, levels: str = "1,2,4,8"):
    """Measure this machine's real throughput at increasing concurrency and recommend lane slots."""
    from backend.core.capacity import CapacityPlan, static_ceiling
    from backend.core.capacity import calibrate as run_calibration
    from backend.workers.processing import load_pages

    s, cm = _db()
    with cm as conn:
        eff = effective_settings(conn, s)
        prov = get_provider(provider or eff.provider, eff)
        info = prov.info()
        if not info.available or info.locality == "remote":
            typer.echo("calibrate runs on local providers only from the CLI", err=True)
            raise typer.Exit(1)
        rows = conn.execute(
            "SELECT id, filename FROM documents WHERE media_type NOT LIKE 'image/%' ORDER BY RANDOM() LIMIT ?",
            (sample,),
        ).fetchall()
        docs = [(r["filename"], load_pages(conn, r["id"])) for r in rows]
    if len(docs) < 2:
        typer.echo("ingest at least 2 text documents first", err=True)
        raise typer.Exit(1)
    hw = profile_hardware(s.data_dir)
    ceiling, reason = static_ceiling(hw, info.model, info.locality)
    prov.extract(docs[0][1], docs[0][0], [])
    results, best = run_calibration(
        lambda i: prov.extract(docs[i][1], docs[i][0], []), len(docs), ceiling, tuple(int(x) for x in levels.split(","))
    )
    plan = CapacityPlan(
        info.name,
        info.model,
        info.locality,
        ceiling,
        reason,
        results,
        best,
        next(r.docs_per_minute for r in results if r.concurrency == best),
    )
    typer.echo(json.dumps(plan.to_dict(), indent=2))


@app.command()
def search(
    query: str, doc_type: str | None = None, project: str | None = None, part_number: str | None = None, limit: int = 10
):
    """Full-text and structured search with page references."""
    _, cm = _db()
    with cm as conn:
        for r in run_search(conn, query, None, doc_type, project, None, None, part_number, limit):
            typer.echo(f"{r['filename']} p{r['page']} [{r['doc_type']}/{r['project']}] {r['snippet'] or ''}")


@app.command()
def findings(collection: str = typer.Option("default"), refresh: bool = False):
    """Show cross-document discrepancies with evidence."""
    _, cm = _db()
    with cm as conn:
        cid = _collection_id(conn, collection)
        if refresh:
            analyse_collection(conn, cid)
        for f in conn.execute("SELECT * FROM findings WHERE collection_id = ?", (cid,)).fetchall():
            typer.echo(f"[{f['status']}] {f['summary']}")
            for e in json.loads(f["evidence"]):
                typer.echo(f"    {e['filename']} p{e['page']}: {e['quote']}")


@app.command()
def serve(host: str = "127.0.0.1", port: int = 8000):
    """Run the API server (binds to localhost by default)."""
    import uvicorn

    uvicorn.run("backend.main:create_app", factory=True, host=host, port=port)


if __name__ == "__main__":
    app()
