"""Review agent: checks each extraction and decides whether to accept, escalate or flag for a person.

Rules are deliberately simple and visible:
- every evidence quote must be found in the source (verified_ratio == 1.0);
- a document must be classified (not "other") unless it really is unstructured;
- a document with injection-like text is always flagged for a person, whatever the model said.
"""

from dataclasses import dataclass

ACCEPT, ESCALATE, HUMAN = "accepted", "escalate", "needs_human_review"


@dataclass
class Review:
    decision: str
    reasons: list[str]


def review(result: dict, injection_flags: int, media_type: str, escalated: bool) -> Review:
    reasons = []
    if injection_flags:
        return Review(HUMAN, ["document contains instruction-like text aimed at AI systems"])
    if result.get("verified_ratio", 0) < 1.0 and result.get("evidence_count", 0) > 0:
        reasons.append("some evidence quotes were not found in the source")
    if result.get("doc_type") == "other" and not media_type.startswith("image/"):
        reasons.append("document could not be classified")
    if not reasons:
        return Review(ACCEPT, [])
    return Review(HUMAN if escalated else ESCALATE, reasons)
