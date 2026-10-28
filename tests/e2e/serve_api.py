"""Reset the e2e data directory and serve the VAULT API for the browser tests (F11.5).

Playwright starts this as a web server. It seeds a fresh demo with scripts/demo_reset.py (rule-based provider,
fictional data only), then runs the API on 127.0.0.1 so the tests always start from the same state.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "e2e"
API_PORT = os.environ.get("VAULT_E2E_API_PORT", "8100")
WEB_PORT = os.environ.get("VAULT_E2E_WEB_PORT", "3100")


def main() -> int:
    reset = [sys.executable, str(ROOT / "scripts" / "demo_reset.py"), "--data-dir", str(DATA), "--workers", "4"]
    subprocess.run(reset, cwd=ROOT, check=True)  # noqa: S603
    env = {
        **os.environ,
        "VAULT_DATA_DIR": str(DATA),
        "VAULT_ALLOW_REMOTE_INFERENCE": "false",
        "VAULT_CORS_ORIGINS": f"http://localhost:{WEB_PORT},http://127.0.0.1:{WEB_PORT}",
    }
    serve = [sys.executable, "-m", "uvicorn", "backend.main:create_app", "--factory", "--host", "127.0.0.1"]
    return subprocess.call([*serve, "--port", API_PORT], cwd=ROOT, env=env)  # noqa: S603


if __name__ == "__main__":
    sys.exit(main())
