"""Keeper (F10.23): the name of the assistant you ask, and what it remembers from the answers you rated.

VAULT is the product; Keeper is the one who keeps the vault and answers in the chat. The name lives here only.

What Keeper learns is deliberately small and visible:

- every answered question is stored with the documents its answer cited (ids only, plus the answer's text);
- the person who asked can rate it thumbs up or down;
- a thumbs-up answer is recalled at once when a near-identical question comes again ("You asked this before"),
  and the helpers still run, so the recall is checked against the documents as they are now;
- documents cited by liked answers (and not by disliked ones) get a small ranking boost for the Finder.

The stored text is shown as text and never run or parsed as anything else.
"""

from __future__ import annotations

import re
import sqlite3

from backend.indexing.investigate import STOPWORDS
from backend.storage.db import dumps, loads, now

ASSISTANT_NAME = "Keeper"

# Two questions are "the same" when their content words overlap this much (Jaccard similarity).
SAME_QUESTION = 0.8
MAX_ANSWER_CHARS = 4000
MAX_DOCUMENTS = 40
RUN_RE = re.compile(r"^ask-[0-9a-f]{12}$")


def words(question: str) -> list[str]:
    """The question's content words, lower-case, plural "s" dropped, sorted and unique."""
    out = set()
    for w in re.findall(r"[\w-]+", question.casefold()):
        if len(w) < 2 or w in STOPWORDS:
            continue
        if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        out.add(w)
    return sorted(out)


def _similar(a: list[str], b: list[str]) -> float:
    sa, sb = set(a), set(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def record(
    conn: sqlite3.Connection,
    collection_id: int,
    run: str,
    username: str,
    question: str,
    text: str,
    document_ids: list[int],
) -> None:
    """Store one answered question. Called by the coordinator, never with text the browser sent."""
    conn.execute(
        "INSERT OR IGNORE INTO ask_answers (collection_id, run, username, question, words, answer, document_ids, "
        "created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            collection_id,
            run,
            username,
            question[:300],
            " ".join(words(question)),
            text[:MAX_ANSWER_CHARS],
            dumps(list(dict.fromkeys(document_ids))[:MAX_DOCUMENTS]),
            now(),
        ),
    )


def recall(conn: sqlite3.Connection, collection_id: int, question: str) -> dict | None:
    """The most recent liked answer to a near-identical question in this collection, if there is one."""
    mine = words(question)
    if not mine:
        return None
    rows = conn.execute(
        "SELECT run, question, words, answer, document_ids, created_at FROM ask_answers "
        "WHERE collection_id = ? AND vote = 1 ORDER BY id DESC LIMIT 200",
        (collection_id,),
    ).fetchall()
    best, best_score = None, 0.0
    for r in rows:
        score = _similar(mine, r["words"].split())
        if score >= SAME_QUESTION and score > best_score:
            best, best_score = r, score
    if best is None:
        return None
    return {
        "run": best["run"],
        "question": best["question"],
        "text": best["answer"],
        "document_ids": loads(best["document_ids"], []),
        "asked_at": best["created_at"],
        "similarity": round(best_score, 2),
    }


def liked_documents(conn: sqlite3.Connection, collection_id: int) -> set[int]:
    """Documents cited by liked answers, minus any cited by an answer someone marked as wrong."""
    liked: set[int] = set()
    disliked: set[int] = set()
    for r in conn.execute(
        "SELECT vote, document_ids FROM ask_answers WHERE collection_id = ? AND vote != 0", (collection_id,)
    ):
        ids = {int(i) for i in loads(r["document_ids"], []) if isinstance(i, int)}
        (liked if r["vote"] > 0 else disliked).update(ids)
    return liked - disliked


def vote(conn: sqlite3.Connection, collection_id: int, run: str, username: str, value: int) -> dict | None:
    """Rate an answer. Only the person who asked may rate it. Returns None when there is no such answer of theirs."""
    row = conn.execute(
        "SELECT id FROM ask_answers WHERE collection_id = ? AND run = ? AND username = ?",
        (collection_id, run, username),
    ).fetchone()
    if not row:
        return None
    conn.execute("UPDATE ask_answers SET vote = ?, voted_at = ? WHERE id = ?", (value, now(), row["id"]))
    return {"run": run, "vote": value, **stats(conn, collection_id)}


def stats(conn: sqlite3.Connection, collection_id: int) -> dict:
    r = conn.execute(
        "SELECT COUNT(*) AS answers, COALESCE(SUM(vote = 1), 0) AS liked, COALESCE(SUM(vote = -1), 0) AS disliked "
        "FROM ask_answers WHERE collection_id = ?",
        (collection_id,),
    ).fetchone()
    return {
        "assistant": ASSISTANT_NAME,
        "answers": r["answers"],
        "liked": r["liked"],
        "disliked": r["disliked"],
        # "Learned from" counts the answers someone rated: those are the ones that change what Keeper does.
        "learned": r["liked"] + r["disliked"],
        "boosted_documents": len(liked_documents(conn, collection_id)),
    }
