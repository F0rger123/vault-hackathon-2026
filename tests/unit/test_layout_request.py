"""F08.4: plain-language organization requests become allowed folder patterns, never anything else."""

import json

import pytest

from backend.providers.base import ProviderError, ProviderInfo
from backend.providers.heuristic import HeuristicProvider
from backend.workers.layout_request import ALLOWED_PATTERNS, interpret, rule_based, validate


class FakeModel(HeuristicProvider):
    def __init__(self, answer: str):
        self.answer = answer
        self.prompts: list[str] = []

    def info(self) -> ProviderInfo:
        return ProviderInfo("ollama", "fake-llama", "local", True, ("extract",), "local", True)

    def chat_json(self, system, user, schema):
        self.prompts.append(user)
        return self.answer


def test_allowed_patterns_cover_every_ordering_of_the_three_fields():
    assert len(ALLOWED_PATTERNS) == 15 and "{project}/{doc_type}/{year}" in ALLOWED_PATTERNS


def test_model_choice_is_returned_when_it_is_on_the_list():
    model = FakeModel(json.dumps({"pattern": "{year}/{project}", "explanation": "Year first, then project."}))
    out = interpret(model, "Put every year in its own folder, split by project")
    assert out["pattern"] == "{year}/{project}" and out["supported"] and out["is_ai_model"]
    assert "Put every year" in model.prompts[0]


@pytest.mark.parametrize(
    "answer",
    [
        json.dumps({"pattern": "../../etc", "explanation": "x"}),
        json.dumps({"pattern": "{department}/{year}", "explanation": "x"}),
        json.dumps({"pattern": "rm -rf /", "explanation": "x"}),
        "not json at all",
        json.dumps(["{year}"]),
    ],
)
def test_anything_off_the_list_is_rejected(answer):
    with pytest.raises(ProviderError):
        interpret(FakeModel(answer), "Organize by year")


def test_unsupported_is_a_valid_answer_and_explanation_is_capped():
    out = validate(json.dumps({"pattern": "unsupported", "explanation": "x" * 1000}))
    assert out["pattern"] == "unsupported" and len(out["explanation"]) == 300


@pytest.mark.parametrize(
    ("instruction", "pattern"),
    [
        ("Organize by project, document type and year", "{project}/{doc_type}/{year}"),
        ("Group by year, then project", "{year}/{project}"),
        ("One folder per document type", "{doc_type}"),
        ("Sort by project and date", "{project}/{year}"),
        ("Split everything by kind of document and then by year", "{doc_type}/{year}"),
        ("Organize by department then date", "unsupported"),
        ("Please tidy things up", "unsupported"),
    ],
)
def test_rule_based_fallback(instruction, pattern):
    assert rule_based(instruction)["pattern"] == pattern
    out = interpret(HeuristicProvider(), instruction)
    assert out["pattern"] == pattern and out["is_ai_model"] is False
