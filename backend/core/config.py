"""Runtime configuration. Every setting can be overridden with a VAULT_* environment variable."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VAULT_", env_file=".env", extra="ignore")

    data_dir: Path = Path("data/runtime")
    max_upload_mb: int = 50
    max_pages_per_document: int = 500

    # Directories the server may read when importing a collection by path (comma separated).
    # Empty means path imports are disabled; uploads still work.
    import_roots: str = ""

    # Model provider: "ollama" (local Meta open-weight model), "meta_api" (Meta Model API, remote)
    # or "heuristic" (rule-based baseline, not a model).
    provider: str = "ollama"
    ollama_url: str = "http://127.0.0.1:11434"
    # Meta open-weight model served by Ollama. muse-glimmer:30b needs ~18 GB; llama3:latest (8B) runs on 8 GB GPUs.
    ollama_model: str = "llama3:latest"
    meta_api_url: str = "https://api.meta.ai/v1"
    # Do not use the "-contributor" variants: Meta may train on their inputs.
    meta_api_model: str = "muse-spark-1.3"
    meta_api_key: str = ""

    # Remote inference sends document text off this machine. It stays off unless an admin enables it.
    allow_remote_inference: bool = False

    max_workers: int = 0  # 0 = choose from hardware profile
    job_max_attempts: int = 3
    model_timeout_s: float = 120.0
    # A worker holds back a new document while free RAM is below this floor, for up to memory_wait_s (F05.6).
    min_free_memory_mb: int = 256
    memory_wait_s: float = 60.0
    # Reuse earlier model answers for unchanged documents in processing jobs (development runs; F04.9).
    response_cache: bool = False

    # One-click sign-in as the demo admin/analyst/viewer. For a laptop showing fictional data only.
    demo_login: bool = False
    # Sessions from password or demo sign-in expire after this many hours.
    session_ttl_hours: float = 12.0

    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "vault.db"

    @property
    def originals_dir(self) -> Path:
        return self.data_dir / "originals"

    @property
    def exports_dir(self) -> Path:
        return self.data_dir / "exports"

    @property
    def import_root_paths(self) -> list[Path]:
        return [Path(p).resolve() for p in self.import_roots.split(",") if p.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
