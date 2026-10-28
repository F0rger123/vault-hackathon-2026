"""F04.9: a second run over unchanged documents makes zero model calls."""

from backend.core.config import Settings
from backend.providers.base import Provider, ProviderInfo
from backend.providers.cache import CachingProvider
from backend.providers.schema import Extraction
from backend.workers.processing import make_provider


class CountingModel(Provider):
    name = "ollama"
    locality = "local"

    def __init__(self):
        self.calls = 0

    def info(self) -> ProviderInfo:
        return ProviderInfo("ollama", "fake-llama", "local", True, ("extract",), "local", True)

    def extract(self, pages, filename, policy_rules, examples=None):
        self.calls += 1
        return Extraction(doc_type="inspection_report", title=f"call {self.calls}")


PAGES = ["BV-7891 Ball valve hydrostatic test at 600 psi - PASS"]


def test_second_run_makes_no_model_calls(tmp_path):
    model = CountingModel()
    cached = CachingProvider(model, tmp_path)
    first = [cached.extract(PAGES, f"doc{i}.pdf", []) for i in range(3)]
    second = [cached.extract(PAGES, f"doc{i}.pdf", []) for i in range(3)]
    assert model.calls == 3 and cached.hits == 3 and cached.misses == 3
    assert [x.model_dump() for x in first] == [x.model_dump() for x in second]


def test_anything_that_changes_the_answer_misses(tmp_path):
    model = CountingModel()
    cached = CachingProvider(model, tmp_path)
    cached.extract(PAGES, "a.pdf", [])
    cached.extract(PAGES + ["page two"], "a.pdf", [])  # different text
    cached.extract(PAGES, "a.pdf", [{"when_contains": "BV", "field": "project", "value": "Alpha"}])  # new rule
    cached.extract(PAGES, "a.pdf", [], [{"filename": "x.pdf", "labels": {"doc_type": "contract"}}])  # new example
    assert model.calls == 4 and cached.hits == 0


def test_corrupt_entry_is_replaced(tmp_path):
    model = CountingModel()
    cached = CachingProvider(model, tmp_path)
    cached.extract(PAGES, "a.pdf", [])
    for f in (tmp_path / "extract").rglob("*.json"):
        f.write_text("{not json", encoding="utf-8")
    assert cached.extract(PAGES, "a.pdf", []).title == "call 2"
    assert cached.extract(PAGES, "a.pdf", []).title == "call 2"


def test_cache_is_off_by_default_and_never_wraps_the_rules_baseline(tmp_path):
    off = Settings(data_dir=tmp_path, _env_file=None)
    assert not isinstance(make_provider(off, "heuristic"), CachingProvider)
    on = Settings(data_dir=tmp_path, response_cache=True, _env_file=None)
    assert not isinstance(make_provider(on, "heuristic"), CachingProvider)
