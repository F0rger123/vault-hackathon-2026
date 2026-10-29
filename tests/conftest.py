import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.core.config import Settings
from backend.main import create_app
from backend.security.auth import create_user, issue_token
from backend.storage.db import connect

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "data" / "synthetic" / "v1"


@pytest.fixture(scope="session")
def dataset(tmp_path_factory) -> Path:
    """The committed synthetic dataset, or a freshly generated copy if it is missing."""
    if (DATASET / "manifest.json").exists():
        return DATASET
    from generator.generate import generate

    out = tmp_path_factory.mktemp("synthetic")
    generate(out, 2026)
    return out


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        data_dir=tmp_path / "data",
        provider="heuristic",
        max_upload_mb=2,
        import_roots=str(tmp_path / "imports"),
        allow_remote_inference=False,
        job_max_attempts=2,
        allowed_hosts="testserver,127.0.0.1,localhost",
        _env_file=None,
    )


@pytest.fixture
def app(settings):
    return create_app(settings, resume_jobs=False)


@pytest.fixture
def tokens(app, settings) -> dict[str, str]:
    with connect(settings.db_path) as conn:
        return {role: issue_token(conn, create_user(conn, role, role)) for role in ("admin", "analyst", "viewer")}


@pytest.fixture
def client(app) -> TestClient:
    return TestClient(app)


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def wait_job(client: TestClient, token: str, job_id: int, timeout: float = 60) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        j = client.get(f"/api/v1/jobs/{job_id}", headers=auth(token)).json()
        if j["status"] not in ("queued", "running"):
            return j
        time.sleep(0.1)
    raise AssertionError("job did not finish")
