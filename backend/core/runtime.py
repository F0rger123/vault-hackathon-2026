"""Runtime overrides that administrators change through the API, layered over environment settings."""

import sqlite3

from backend.core.config import Settings


def effective_settings(conn: sqlite3.Connection, settings: Settings) -> Settings:
    row = conn.execute("SELECT value FROM settings_kv WHERE key = 'allow_remote_inference'").fetchone()
    if row is None:
        return settings
    return settings.model_copy(update={"allow_remote_inference": row["value"] == "true"})
