"""Suggest correction rules from documents a reviewer has graded (F07.3, reused by Training in F07.6).

A rule is a phrase from a wrongly read document plus the right value. It is only suggested when it is
100% precise on the graded documents: every graded document containing the phrase has that true value,
so a rule can never make a graded document wrong.
"""

from __future__ import annotations

import re

MAX_RULES = 20
FIELDS = ("doc_type", "project")


def _candidates(text: str) -> set[str]:
    """Phrases a reviewer could copy from a document: whole lines, and the label before a colon.

    Lines with digits are skipped because they are usually identifiers, dates or quantities that do not
    describe a kind of document.
    """
    out = set()
    for line in text.splitlines():
        for phrase in (line, line.split(":", 1)[0]):
            phrase = re.sub(r"\s+", " ", phrase).strip(" -|#*")
            if 6 <= len(phrase) <= 80 and not re.search(r"\d", phrase):
                out.add(phrase)
    return out


def pick_rules(train: list[dict]) -> list[dict]:
    """Choose `when_contains` rules from train documents only.

    `train` items: {"document_id", "text", "truth": {field: value}, "got": {field: value}}.
    A phrase is accepted for (field, value) when every train document containing it has that true value
    (it can never make a train document wrong), and it fixes at least one train document. Phrases that fix
    more documents win; ties go to the shorter, more general phrase.
    """
    rules: list[dict] = []
    folded = [(d, d["text"].casefold()) for d in train]
    for field in FIELDS:
        wrong = [d for d in train if (d["got"].get(field) or "").casefold() != d["truth"][field].casefold()]
        remaining = {d["document_id"] for d in wrong}
        options: dict[tuple[str, str], tuple[str, int]] = {}
        for d in wrong:
            value = d["truth"][field]
            for phrase in _candidates(d["text"]):
                needle = phrase.casefold()
                hits = [x for x, t in folded if needle in t]
                if any(x["truth"][field].casefold() != value.casefold() for x in hits):
                    continue
                fixes = {x["document_id"] for x in hits} & remaining
                best = options.get((phrase, value))
                if not best or len(fixes) > best[1]:
                    options[(phrase, value)] = (d["document_id"], len(fixes))
        # Greedy cover: take the phrase that fixes the most still-wrong documents, repeat.
        while remaining and len(rules) < MAX_RULES:
            scored = []
            for (phrase, value), (doc_id, _) in options.items():
                hits = {x["document_id"] for x, t in folded if phrase.casefold() in t}
                gain = len(hits & remaining)
                if gain:
                    scored.append((-gain, len(phrase), phrase, value, doc_id, hits))
            if not scored:
                break
            _, _, phrase, value, doc_id, hits = min(scored)
            rules.append(
                {
                    "document_id": doc_id,
                    "field": field,
                    "value": value,
                    "when_contains": phrase,
                    "fixes_train_docs": len(hits & remaining),
                }
            )
            remaining -= hits
    return rules
