"""Validate the coordination files that let agents resume without chat history (F01.9).

Checks:
1. Required coordination and onboarding files exist.
2. Every task ID mentioned in the status files and PROJECT_STATE.md exists in coordination/TASKS.md.
3. Each agent status file has a "Last updated: YYYY-MM-DD" line and the required sections.
4. With --pr-title/--pr-body (CI on pull requests), the PR names at least one existing task ID.

Warnings (never failures): a status file or PROJECT_STATE.md not updated for more than STALE_DAYS days.

    python scripts/check_coordination.py
    python scripts/check_coordination.py --pr-title "Add X (F09.7)" --pr-body "..."
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    "llms.txt",
    "docs/PROJECT_VISION.md",
    "docs/LONG_TERM_ROADMAP.md",
    "docs/AI_ONBOARDING.md",
    "docs/AI_GUIDE.md",
    "coordination/PROJECT_STATE.md",
    "coordination/TASKS.md",
    "coordination/OWNERSHIP.md",
    "coordination/BLOCKERS.md",
    "coordination/DECISIONS.md",
    "coordination/API_CONTRACT.md",
    "coordination/AGENT_COMMUNICATION_PROTOCOL.md",
    "coordination/AGENT_UPDATES.md",
    "coordination/NEW_AGENT_BOOTSTRAP_PROMPT.md",
]
STATUS_FILES = ["coordination/status/luke.md"]
STATUS_SECTIONS = ["## Now", "## Waiting on", "## Updates"]
TASK_ID = re.compile(r"\bF\d{2}\.\d{1,2}\b")
UPDATED = re.compile(r"Last updated\D*(\d{4}-\d{2}-\d{2})")
STALE_DAYS = 3


def known_tasks(tasks_md: str) -> set[str]:
    return set(re.findall(r"^#### (F\d{2}\.\d{1,2}) ", tasks_md, flags=re.M))


def mentioned(text: str) -> set[str]:
    return set(TASK_ID.findall(text))


def check(root: Path, pr_title: str | None, pr_body: str | None, today: dt.date) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    for rel in REQUIRED + STATUS_FILES:
        if not (root / rel).is_file():
            errors.append(f"missing required file: {rel}")
    if errors:
        return errors, warnings

    tasks = known_tasks((root / "coordination/TASKS.md").read_text(encoding="utf-8"))
    if not tasks:
        return ["no task headings ('#### Fxx.y ...') found in coordination/TASKS.md"], warnings

    for rel in STATUS_FILES + ["coordination/PROJECT_STATE.md"]:
        text = (root / rel).read_text(encoding="utf-8")
        for tid in sorted(mentioned(text) - tasks):
            errors.append(f"{rel}: task {tid} is not in coordination/TASKS.md")
        m = UPDATED.search(text)
        if not m:
            errors.append(f"{rel}: no 'Last updated: YYYY-MM-DD' line")
            continue
        try:
            age = (today - dt.date.fromisoformat(m.group(1))).days
        except ValueError:
            errors.append(f"{rel}: invalid date {m.group(1)!r}")
            continue
        if age > STALE_DAYS:
            warnings.append(f"{rel}: last updated {age} days ago; refresh it at the next checkpoint")
        if rel in STATUS_FILES:
            for section in STATUS_SECTIONS:
                if not re.search(rf"^{re.escape(section)}\s*$", text, flags=re.M):
                    errors.append(f"{rel}: missing section '{section}' (see coordination/AGENT_UPDATES.md)")

    if pr_title is not None or pr_body is not None:
        ids = mentioned(f"{pr_title or ''}\n{pr_body or ''}")
        if not ids:
            errors.append("PR title or body must name a task ID from coordination/TASKS.md, for example (F09.7)")
        for tid in sorted(ids - tasks):
            errors.append(f"PR mentions task {tid}, which is not in coordination/TASKS.md")
    return errors, warnings


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pr-title")
    ap.add_argument("--pr-body")
    a = ap.parse_args()
    errors, warnings = check(ROOT, a.pr_title, a.pr_body, dt.date.today())
    for w in warnings:
        print(f"warning: {w}")
    for e in errors:
        print(f"error: {e}")
    print("coordination check: " + ("FAILED" if errors else "ok"))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
