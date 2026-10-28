"""Response cache for repeated development runs (F04.9).

Re-running a job on unchanged documents with an unchanged model and prompt gives the same answer, so a
second run should not pay for it again in time or, for the Meta Model API, in money. `CachingProvider`
wraps a model-backed provider and stores each validated extraction under a key built from everything that
can change the answer:
- the provider and model;
- the prompt code (`prompting.py`);
- the page text, filename, policy rules and few-shot examples.

The cache is off unless `VAULT_RESPONSE_CACHE=true`. It is only used for processing jobs, never for
estimates or capacity measurements, whose whole point is timing a real call. Cached entries live under
`<data_dir>/cache/`, next to the originals they were derived from.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from backend.providers import prompting
from backend.providers.base import Provider, ProviderInfo
from backend.providers.schema import Extraction
from backend.security.files import safe_join

_PROMPT_CODE = hashlib.sha256(Path(prompting.__file__).read_bytes()).hexdigest()


class CachingProvider(Provider):
    def __init__(self, inner: Provider, cache_dir: Path):
        self.inner = inner
        self.name = inner.name
        self.locality = getattr(inner, "locality", "local")
        self.cache_dir = cache_dir / "extract"
        self.hits = 0
        self.misses = 0

    def info(self) -> ProviderInfo:
        return self.inner.info()

    def _key(self, pages: list[str], filename: str, rules: list[dict], examples: list[dict] | None) -> str:
        info = self.inner.info()
        material = [info.name, info.model, _PROMPT_CODE, pages, filename, rules, examples or []]
        return hashlib.sha256(json.dumps(material, sort_keys=True, default=str).encode()).hexdigest()

    def extract(
        self, pages: list[str], filename: str, policy_rules: list[dict], examples: list[dict] | None = None
    ) -> Extraction:
        key = self._key(pages, filename, policy_rules, examples)
        # The key is a hex digest, but cache paths still go through safe_join like every server-side path.
        path = safe_join(self.cache_dir, key[:2], f"{key}.json")
        if path.is_file():
            try:
                cached = Extraction.model_validate_json(path.read_text(encoding="utf-8"))
                self.hits += 1
                return cached
            except ValueError:
                path.unlink(missing_ok=True)  # corrupt or outdated entry: call the model again
        result = self.inner.extract(pages, filename, policy_rules, examples)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(result.model_dump_json(), encoding="utf-8")
        tmp.replace(path)  # atomic, so parallel lanes never read half a file
        self.misses += 1
        return result

    def chat_json(self, system: str, user: str, schema: dict) -> str:
        # Investigation answers are not cached: questions are rarely repeated word for word.
        return self.inner.chat_json(system, user, schema)
