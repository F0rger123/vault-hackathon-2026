"""F07.3 rule picking: rules come only from train documents and never break a train document."""

from evaluation.corrections_experiment import _candidates, pick_rules


def _doc(i, text, truth_type, got_type, project="Alpha"):
    return {
        "document_id": i,
        "text": text,
        "truth": {"doc_type": truth_type, "project": project},
        "got": {"doc_type": got_type, "project": project},
    }


def test_candidates_skip_identifiers():
    phrases = _candidates("Field Verification Record\nRecord No: FVR-0042\nWitness: R. Okafor")
    assert "Field Verification Record" in phrases and "Witness" in phrases
    assert not any(any(ch.isdigit() for ch in p) for p in phrases)


def test_rule_fixes_wrong_docs_without_breaking_others():
    train = [
        _doc(1, "Field Verification Record\nvalve test", "inspection_report", "other"),
        _doc(2, "Field Verification Record\nflange test", "inspection_report", "other"),
        _doc(3, "Inspection Report\nvalve test", "inspection_report", "inspection_report"),
        _doc(4, "Memo\nvalve test schedule", "project_memo", "project_memo"),
    ]
    rules = pick_rules(train)
    assert len(rules) == 1
    rule = rules[0]
    assert rule["field"] == "doc_type" and rule["value"] == "inspection_report"
    assert rule["fixes_train_docs"] == 2
    # "valve test" also appears in the memo, so it must not be chosen.
    assert "valve test" not in rule["when_contains"].casefold()


def test_no_rule_when_every_phrase_is_ambiguous():
    train = [
        _doc(1, "Shared heading", "contract", "other"),
        _doc(2, "Shared heading", "parts_list", "parts_list"),
    ]
    assert pick_rules(train) == []
