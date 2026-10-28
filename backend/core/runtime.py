"""Runtime overrides that administrators change through the API, layered over environment settings."""

import sqlite3

from backend.core.config import Settings
from backend.core.secrets_store import stored_key


def effective_settings(conn: sqlite3.Connection, settings: Settings) -> Settings:
    update: dict = {}
    row = conn.execute("SELECT value FROM settings_kv WHERE key = 'allow_remote_inference'").fetchone()
    if row is not None:
        update["allow_remote_inference"] = row["value"] == "true"
    # A key pasted on the Security screen is used when the environment does not set one.
    if not settings.meta_api_key and (key := stored_key(settings)):
        update["meta_api_key"] = key
    return settings.model_copy(update=update) if update else settings
