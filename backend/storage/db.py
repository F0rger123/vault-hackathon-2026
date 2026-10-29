"""SQLite storage with ordered, versioned migrations.

Each thread opens its own short-lived connection through `connect()`. WAL mode lets worker
threads write job progress while API requests read.
"""

import json
import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

MIGRATIONS: list[str] = [
    # 1: core schema
    """
    CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK (role IN ('viewer', 'analyst', 'admin')),
        created_at REAL NOT NULL
    );
    CREATE TABLE api_tokens (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        token_hash TEXT NOT NULL UNIQUE,
        label TEXT,
        created_at REAL NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE collections (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at REAL NOT NULL
    );
    CREATE TABLE documents (
        id INTEGER PRIMARY KEY,
        collection_id INTEGER NOT NULL REFERENCES collections(id),
        filename TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        media_type TEXT NOT NULL,
        page_count INTEGER NOT NULL DEFAULT 0,
        stored_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ingested',
        error TEXT,
        created_at REAL NOT NULL,
        UNIQUE (collection_id, sha256)
    );
    CREATE TABLE pages (
        id INTEGER PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES documents(id),
        page_no INTEGER NOT NULL,
        text TEXT NOT NULL,
        UNIQUE (document_id, page_no)
    );
    CREATE VIRTUAL TABLE pages_fts USING fts5(
        text, content='pages', content_rowid='id', tokenize='porter unicode61'
    );
    CREATE TRIGGER pages_ai AFTER INSERT ON pages BEGIN
        INSERT INTO pages_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER pages_ad AFTER DELETE ON pages BEGIN
        INSERT INTO pages_fts(pages_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;
    CREATE TABLE extractions (
        id INTEGER PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES documents(id),
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        locality TEXT NOT NULL,
        policy_version INTEGER NOT NULL DEFAULT 1,
        doc_type TEXT,
        project TEXT,
        doc_date TEXT,
        title TEXT,
        summary TEXT,
        data TEXT NOT NULL,
        evidence TEXT NOT NULL,
        verified_ratio REAL NOT NULL DEFAULT 0,
        injection_flags TEXT NOT NULL DEFAULT '[]',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at REAL NOT NULL
    );
    CREATE INDEX extractions_doc ON extractions(document_id, created_at);
    CREATE TABLE jobs (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        collection_id INTEGER REFERENCES collections(id),
        params TEXT NOT NULL DEFAULT '{}',
        total INTEGER NOT NULL DEFAULT 0,
        done INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        workers INTEGER NOT NULL DEFAULT 1,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at REAL NOT NULL,
        started_at REAL,
        finished_at REAL
    );
    CREATE TABLE job_items (
        id INTEGER PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES jobs(id),
        document_id INTEGER NOT NULL REFERENCES documents(id),
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        duration_ms INTEGER,
        UNIQUE (job_id, document_id)
    );
    CREATE TABLE findings (
        id INTEGER PRIMARY KEY,
        collection_id INTEGER NOT NULL REFERENCES collections(id),
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        evidence TEXT NOT NULL,
        created_at REAL NOT NULL
    );
    CREATE TABLE proposals (
        id INTEGER PRIMARY KEY,
        collection_id INTEGER NOT NULL REFERENCES collections(id),
        kind TEXT NOT NULL,
        instruction TEXT,
        plan TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_by INTEGER REFERENCES users(id),
        decided_by INTEGER REFERENCES users(id),
        created_at REAL NOT NULL,
        decided_at REAL,
        result TEXT
    );
    CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY,
        ts REAL NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        outcome TEXT NOT NULL CHECK (outcome IN ('allowed', 'denied', 'error')),
        detail TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX audit_ts ON audit_log(ts);
    CREATE TABLE settings_kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """,
    # 2: teach-by-example corrections and versioned extraction policies
    """
    CREATE TABLE corrections (
        id INTEGER PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES documents(id),
        field TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT NOT NULL,
        note TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at REAL NOT NULL
    );
    CREATE TABLE policies (
        version INTEGER PRIMARY KEY,
        rules TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at REAL NOT NULL
    );
    """,
    # 3: multi-agent orchestration, security screening, teach-by-example
    """
    CREATE TABLE agent_events (
        id INTEGER PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES jobs(id),
        ts REAL NOT NULL,
        agent TEXT NOT NULL,
        document_id INTEGER,
        action TEXT NOT NULL,
        outcome TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX agent_events_job ON agent_events(job_id, id);
    CREATE TABLE screenings (
        document_id INTEGER PRIMARY KEY REFERENCES documents(id),
        sensitivity TEXT NOT NULL CHECK (sensitivity IN ('none', 'internal', 'restricted')),
        markings TEXT NOT NULL DEFAULT '[]',
        injection TEXT NOT NULL DEFAULT '[]',
        pii TEXT NOT NULL DEFAULT '[]',
        route TEXT NOT NULL CHECK (route IN ('any', 'local_only')),
        screened_at REAL NOT NULL
    );
    CREATE TABLE examples (
        id INTEGER PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES documents(id),
        labels TEXT NOT NULL,
        note TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at REAL NOT NULL,
        UNIQUE (document_id)
    );
    ALTER TABLE extractions ADD COLUMN review_status TEXT NOT NULL DEFAULT 'unreviewed';
    ALTER TABLE extractions ADD COLUMN lane TEXT;
    """,
    # 4: token lifecycle (F09.8). NULL expires_at means the token never expires (existing tokens keep working).
    """
    ALTER TABLE api_tokens ADD COLUMN expires_at REAL;
    ALTER TABLE api_tokens ADD COLUMN revoked_at REAL;
    ALTER TABLE api_tokens ADD COLUMN last_used_at REAL;
    """,
    # 5: easy start (F10.11): optional password sign-in, and demo collections kept apart from real ones.
    """
    ALTER TABLE users ADD COLUMN password_hash TEXT;
    ALTER TABLE collections ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
    """,
    # 6: the collection brain (F07.7): meanings and instructions people teach, one set per collection.
    # Additive only: no existing table or row changes.
    """
    CREATE TABLE knowledge (
        id INTEGER PRIMARY KEY,
        collection_id INTEGER NOT NULL REFERENCES collections(id),
        kind TEXT NOT NULL CHECK (kind IN ('meaning', 'instruction')),
        term TEXT,
        text TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'person',
        created_by INTEGER REFERENCES users(id),
        created_at REAL NOT NULL,
        retired_at REAL
    );
    CREATE INDEX knowledge_collection ON knowledge(collection_id, kind, retired_at);
    """,
]


def _configure(conn: sqlite3.Connection) -> None:
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")


@contextmanager
def connect(db_path: Path) -> Iterator[sqlite3.Connection]:
    # check_same_thread=False: FastAPI may resolve a dependency and run an async route on different
    # threads. A connection is still only used by one request at a time.
    conn = sqlite3.connect(db_path, timeout=10, isolation_level=None, check_same_thread=False)
    _configure(conn)
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


def migrate(db_path: Path) -> int:
    """Apply pending migrations. Returns the resulting schema version."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with connect(db_path) as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
        row = conn.execute("SELECT MAX(version) AS v FROM schema_version").fetchone()
        current = row["v"] or 0
        for version, sql in enumerate(MIGRATIONS, start=1):
            if version <= current:
                continue
            conn.executescript("BEGIN;" + sql + f"; INSERT INTO schema_version VALUES ({version}); COMMIT;")
            current = version
        return current


def now() -> float:
    return time.time()


def dumps(value: object) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def loads(value: str | None, default: object = None) -> object:
    return default if value is None else json.loads(value)
