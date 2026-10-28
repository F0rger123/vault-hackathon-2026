"""F12.1: the `vault` CLI end to end on a small slice of the synthetic dataset, with the rule-based provider."""

import json
import shutil

import pytest
from typer.testing import CliRunner

from backend.core.config import get_settings
from cli.main import app

runner = CliRunner()


@pytest.fixture
def cli_env(tmp_path, monkeypatch, dataset):
    monkeypatch.setenv("VAULT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("VAULT_ALLOW_REMOTE_INFERENCE", "false")
    monkeypatch.setenv("VAULT_PROVIDER", "heuristic")
    get_settings.cache_clear()
    # Every Alpha document: enough for the planted BV-7891 conflict, small enough to stay fast.
    files = tmp_path / "files"
    files.mkdir()
    for p in (dataset / "files").glob("ALP-*"):
        shutil.copy(p, files / p.name)
    yield tmp_path / "data", files
    get_settings.cache_clear()


def run(*args):
    result = runner.invoke(app, list(args))
    assert result.exit_code == 0, result.output
    return result.output


def test_init_ingest_process_search_findings(cli_env):
    data, files = cli_env
    out = run("init", "--demo-users")
    assert "demo tokens written" in out
    tokens = json.loads((data / "dev_tokens.json").read_text())
    assert set(tokens) == {"admin", "analyst", "viewer"}
    assert not any(t in out for t in tokens.values()), "tokens must never be printed"

    count = len(list(files.iterdir()))
    out = run("ingest", str(files), "--collection", "demo")
    assert f"{count}" in out

    out = run("process", "--collection", "demo", "--provider", "heuristic", "--workers", "2")
    assert "heuristic x2" in out
    assert f"{count}/{count} done, 0 failed" in out

    out = run("search", "BV-7891")
    assert "ALP-" in out

    out = run("findings", "--collection", "demo")
    assert "BV-7891" in out
    assert "psi" in out


def test_remote_provider_refused_without_both_approvals(cli_env):
    data, files = cli_env
    run("init")
    run("ingest", str(files), "--collection", "demo")
    result = runner.invoke(app, ["process", "--collection", "demo", "--provider", "meta_api", "--confirm-remote"])
    assert result.exit_code == 2
    assert "sends document text off this machine" in result.output


def test_unknown_collection_is_a_clear_error(cli_env):
    run("init")
    result = runner.invoke(app, ["findings", "--collection", "nope"])
    assert result.exit_code != 0
    assert "no collection named 'nope'" in result.output
