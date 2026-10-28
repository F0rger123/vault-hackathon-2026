"""F01.9: coordination validation and task claims."""

import datetime as dt
import json
from argparse import Namespace

import pytest

from scripts import agent_mail
from scripts.check_coordination import REQUIRED, STATUS_FILES, check

TODAY = dt.date(2026, 10, 28)
STATUS = "# x\n\nLast updated: 2026-10-28\n\n## Now\n\n- F01.1\n\n## Waiting on\n\n- nothing\n\n## Updates\n"


def _repo(tmp_path, status=STATUS, state="Last updated | 2026-10-28\n\nNext: F01.1"):
    for rel in REQUIRED + STATUS_FILES:
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_text("x\n", encoding="utf-8")
    (tmp_path / "coordination/TASKS.md").write_text("#### F01.1 — Repo\n#### F09.7 — ZAP\n", encoding="utf-8")
    (tmp_path / "coordination/PROJECT_STATE.md").write_text(state, encoding="utf-8")
    for rel in STATUS_FILES:
        (tmp_path / rel).write_text(status, encoding="utf-8")
    return tmp_path


def test_real_repository_passes():
    from scripts.check_coordination import ROOT

    errors, _ = check(ROOT, None, None, dt.date.today())
    assert errors == []


def test_valid_files_pass_and_pr_needs_task_id(tmp_path):
    root = _repo(tmp_path)
    assert check(root, None, None, TODAY) == ([], [])
    assert check(root, "Add ZAP scan (F09.7)", "", TODAY)[0] == []
    assert any("must name a task ID" in e for e in check(root, "Add ZAP scan", "", TODAY)[0])
    assert any("F99.9" in e for e in check(root, "x (F99.9)", "", TODAY)[0])


def test_unknown_task_missing_section_and_stale_date(tmp_path):
    root = _repo(tmp_path, status=STATUS.replace("## Waiting on", "## Later").replace("F01.1", "F42.1"))
    errors, _ = check(root, None, None, TODAY)
    assert any("F42.1" in e for e in errors)
    assert any("missing section '## Waiting on'" in e for e in errors)
    _, warnings = check(_repo(tmp_path), None, None, TODAY + dt.timedelta(days=10))
    assert any("10 days ago" in w for w in warnings)


def test_missing_file_fails(tmp_path):
    root = _repo(tmp_path)
    (root / "docs/PROJECT_VISION.md").unlink()
    assert check(root, None, None, TODAY)[0] == ["missing required file: docs/PROJECT_VISION.md"]


def test_claim_refuses_task_held_by_other_agent(monkeypatch):
    calls = []

    def fake_gh(*args):
        calls.append(args)
        if args[:2] == ("issue", "list"):
            return json.dumps([{"number": 9, "title": "[F09.7] Controlled security verification"}])
        if args[:2] == ("issue", "view"):
            mark = agent_mail.CLAIM_MARK.format("franco-agent")
            return json.dumps({"labels": [{"name": "in-progress"}], "comments": [{"body": mark + " claimed"}]})
        return ""

    monkeypatch.setattr(agent_mail, "gh", fake_gh)
    a = Namespace(task="F09.7", me="luke-agent", branch="", force=False)
    with pytest.raises(SystemExit, match="already claimed by franco-agent"):
        agent_mail.cmd_claim(a)
    assert not any(c[:2] == ("issue", "comment") for c in calls)

    a.force = True
    agent_mail.cmd_claim(a)
    assert any(c[:2] == ("issue", "comment") and "agent=luke-agent" in c[4] for c in calls)
