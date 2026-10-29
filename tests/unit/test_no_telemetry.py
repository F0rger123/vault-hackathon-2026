"""F12.10: nothing VAULT starts sends Next.js usage data off the machine."""

import importlib.util
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_launcher_turns_off_next_telemetry(monkeypatch):
    monkeypatch.delenv("NEXT_TELEMETRY_DISABLED", raising=False)
    spec = importlib.util.spec_from_file_location("vault_start", ROOT / "scripts" / "start.py")
    spec.loader.exec_module(importlib.util.module_from_spec(spec))
    assert os.environ["NEXT_TELEMETRY_DISABLED"] == "1"


def test_frontend_image_turns_off_next_telemetry():
    dockerfile = (ROOT / "frontend" / "Dockerfile").read_text(encoding="utf-8")
    # Once for the build stage and once for the runtime stage.
    assert dockerfile.count("NEXT_TELEMETRY_DISABLED=1") == 2
