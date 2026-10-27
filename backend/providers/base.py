"""Provider interface. A provider turns page text into a validated `Extraction`.

Providers receive text only. They get no filesystem, network or tool access beyond their own
inference endpoint, and nothing they return is ever executed.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass

from backend.providers.schema import Extraction


@dataclass(frozen=True)
class ProviderInfo:
    name: str
    model: str
    locality: str  # "local" or "remote"
    is_ai_model: bool
    tasks: tuple[str, ...]
    privacy: str
    available: bool
    detail: str = ""


class ProviderError(RuntimeError):
    """Raised for provider failures. Messages must not contain document text."""


class Provider(ABC):
    name: str
    locality: str

    @abstractmethod
    def info(self) -> ProviderInfo: ...

    @abstractmethod
    def extract(
        self, pages: list[str], filename: str, policy_rules: list[dict], examples: list[dict] | None = None
    ) -> Extraction: ...

    def chat_json(self, system: str, user: str, schema: dict) -> str:
        """Return raw JSON text constrained to `schema`. Only model-backed providers implement this."""
        raise ProviderError(f"provider {self.name} cannot write free-form answers")
