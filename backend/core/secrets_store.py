"""The Meta Model API key, set from the Security screen instead of editing `.env` (F10.11).

The key is written to `<data_dir>/secrets/meta_api_key`, a git-ignored file next to the database, and is
never returned by the API: the interface only learns whether a key is configured and where it came
from. A key in the environment (`VAULT_META_API_KEY`) always wins over the stored one.
"""

from __future__ import annotations

import os
import re
import stat
from pathlib import Path

from backend.core.config import Settings
from backend.security.files import safe_join

KEY_RE = re.compile(r"^LLM_[A-Za-z0-9_\-]{16,200}$")


def _path(settings: Settings) -> Path:
    return safe_join(settings.data_dir, "secrets", "meta_api_key")


def stored_key(settings: Settings) -> str:
    path = _path(settings)
    return path.read_text(encoding="utf-8").strip() if path.is_file() else ""


def store_key(settings: Settings, key: str) -> None:
    if not KEY_RE.match(key):
        raise ValueError("that does not look like a Meta Model API key (they start with LLM_)")
    path = _path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(key, encoding="utf-8")
    # Owner read/write only where the OS supports it (no effect on Windows ACLs, which inherit the folder's).
    os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
    tmp.replace(path)


def clear_key(settings: Settings) -> bool:
    path = _path(settings)
    if path.is_file():
        path.unlink()
        return True
    return False


def key_status(settings: Settings) -> dict:
    if settings.meta_api_key:
        return {"configured": True, "source": "environment"}
    return {"configured": bool(stored_key(settings)), "source": "vault" if stored_key(settings) else None}
