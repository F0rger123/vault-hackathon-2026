"""Meta model providers.

- OllamaProvider: local inference against an Ollama server on this machine (no external traffic).
- MetaModelAPIProvider: Meta Model API (https://api.meta.ai/v1, OpenAI-compatible Chat Completions,
  Muse Spark models). Sends document text off the machine, so it refuses to run unless an
  administrator has enabled remote inference.
"""

import json
from urllib.parse import urlparse

import httpx
from pydantic import ValidationError

from backend.core.config import Settings
from backend.providers.base import Provider, ProviderError, ProviderInfo
from backend.providers.prompting import SYSTEM_PROMPT, build_user_prompt
from backend.providers.schema import Extraction, inline_schema

LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", "ollama", "host.docker.internal"}


def _parse(content: str) -> Extraction:
    try:
        return Extraction.model_validate(json.loads(content))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise ProviderError(f"model returned output that failed schema validation ({type(exc).__name__})") from exc


class OllamaProvider(Provider):
    name = "ollama"
    locality = "local"

    def __init__(self, settings: Settings):
        self.url = settings.ollama_url.rstrip("/")
        self.model = settings.ollama_model
        self.timeout = settings.model_timeout_s
        host = urlparse(self.url).hostname or ""
        if host not in LOCAL_HOSTS:
            # A remote Ollama would silently send documents off-machine; treat it as misconfiguration.
            raise ProviderError("VAULT_OLLAMA_URL must point at a local host for the local provider")

    def _available(self) -> tuple[bool, str]:
        try:
            r = httpx.get(f"{self.url}/api/tags", timeout=3)
            r.raise_for_status()
            names = {m.get("name") for m in r.json().get("models", [])}
        except (httpx.HTTPError, ValueError):
            return False, "Ollama server not reachable"
        if self.model not in names:
            return False, f"model {self.model} not pulled (run: ollama pull {self.model})"
        return True, "ready"

    def info(self) -> ProviderInfo:
        ok, detail = self._available()
        return ProviderInfo(
            name=self.name,
            model=self.model,
            locality="local",
            is_ai_model=True,
            tasks=("classification", "extraction", "summarisation"),
            privacy="Inference runs on this machine through Ollama. No document data leaves it.",
            available=ok,
            detail=detail,
        )

    def extract(
        self, pages: list[str], filename: str, policy_rules: list[dict], examples: list[dict] | None = None
    ) -> Extraction:
        body = {
            "model": self.model,
            "stream": False,
            "format": inline_schema(),
            "options": {"temperature": 0, "num_ctx": 8192},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_user_prompt(pages, filename, policy_rules, examples)},
            ],
        }
        try:
            r = httpx.post(f"{self.url}/api/chat", json=body, timeout=self.timeout)
            r.raise_for_status()
            content = r.json()["message"]["content"]
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            raise ProviderError(f"Ollama request failed ({type(exc).__name__})") from exc
        return _parse(content)


class MetaModelAPIProvider(Provider):
    name = "meta_api"
    locality = "remote"

    def __init__(self, settings: Settings):
        self.url = settings.meta_api_url.rstrip("/")
        self.model = settings.meta_api_model
        self.key = settings.meta_api_key
        self.allowed = settings.allow_remote_inference
        self.timeout = settings.model_timeout_s

    def info(self) -> ProviderInfo:
        if not self.key:
            ok, detail = False, "VAULT_META_API_KEY not set"
        elif not self.allowed:
            ok, detail = False, "remote inference disabled (admin must set VAULT_ALLOW_REMOTE_INFERENCE=true)"
        else:
            ok, detail = True, "ready"
        return ProviderInfo(
            name=self.name,
            model=self.model,
            locality="remote",
            is_ai_model=True,
            tasks=("classification", "extraction", "summarisation"),
            privacy=f"Document text is sent to {urlparse(self.url).hostname} (Meta Model API).",
            available=ok,
            detail=detail,
        )

    def extract(
        self, pages: list[str], filename: str, policy_rules: list[dict], examples: list[dict] | None = None
    ) -> Extraction:
        if not self.allowed:
            raise ProviderError("remote inference is disabled by policy")
        if not self.key:
            raise ProviderError("Meta Model API key is not configured")
        body = {
            "model": self.model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_user_prompt(pages, filename, policy_rules, examples)},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "vault_extraction", "schema": inline_schema()},
            },
        }
        try:
            r = httpx.post(
                f"{self.url}/chat/completions",
                json=body,
                timeout=self.timeout,
                headers={"Authorization": f"Bearer {self.key}"},
            )
            r.raise_for_status()
            content = r.json()["choices"][0]["message"]["content"]
        except httpx.HTTPStatusError as exc:
            raise ProviderError(f"Meta Model API returned HTTP {exc.response.status_code}") from exc
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            raise ProviderError(f"Meta Model API request failed ({type(exc).__name__})") from exc
        return _parse(content)
