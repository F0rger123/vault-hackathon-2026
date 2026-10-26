"""Provider registry."""

from backend.core.config import Settings
from backend.providers.base import Provider, ProviderError
from backend.providers.heuristic import HeuristicProvider
from backend.providers.llm import MetaModelAPIProvider, OllamaProvider

PROVIDER_NAMES = ("ollama", "meta_api", "heuristic")


def get_provider(name: str, settings: Settings) -> Provider:
    if name == "ollama":
        return OllamaProvider(settings)
    if name == "meta_api":
        return MetaModelAPIProvider(settings)
    if name == "heuristic":
        return HeuristicProvider()
    raise ProviderError(f"unknown provider: {name}")


def apply_policy(extraction, pages: list[str], rules: list[dict]):
    """Apply versioned, human-approved override rules after extraction.

    Rule shape: {"when_contains": "<text>", "field": "doc_type" | "project", "value": "<value>"}.
    """
    text = "\n".join(pages).casefold()
    for rule in rules:
        needle = str(rule.get("when_contains", "")).casefold()
        field = rule.get("field")
        if needle and needle in text and field in ("doc_type", "project"):
            try:
                extraction = extraction.model_copy(update={field: rule["value"]})
                extraction = type(extraction).model_validate(extraction.model_dump())
            except Exception:  # noqa: S112 - invalid rule values are skipped, never fatal
                continue
    return extraction
