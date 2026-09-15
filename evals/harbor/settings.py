"""Harbor eval settings — local `.env`, not kernel config."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

HARBOR_DIR = Path(__file__).resolve().parent


class HarborSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(HARBOR_DIR / ".env",),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    openai_base_url: str = Field(default="http://127.0.0.1:11434/v1")
    openai_api_key: str | None = Field(default="local")
    barney_api_base: str | None = Field(default=None)
    barney_api_key: str | None = Field(default=None)
    anthropic_api_key: str | None = Field(default=None)
    anthropic_base_url: str | None = Field(default=None)
    openrouter_api_key: str | None = Field(default=None)
    openrouter_base_url: str | None = Field(default=None)

    bun_linux_url: str = Field(
        default="https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-x64.zip",
    )
    bun_linux_zip: Path = Field(default=Path("/tmp/barney-eval-vendor/bun-linux-x64.zip"))
    uv_linux_url: str = Field(
        default="https://github.com/astral-sh/uv/releases/download/0.9.5/uv-x86_64-unknown-linux-gnu.tar.gz",
    )
    uv_linux_tar: Path = Field(
        default=Path("/tmp/barney-eval-vendor/uv-x86_64-unknown-linux-gnu.tar.gz"),
    )

    @property
    def eval_llm_base(self) -> str:
        return (self.barney_api_base or self.openai_base_url).rstrip("/")


@lru_cache(maxsize=1)
def get_settings() -> HarborSettings:
    return HarborSettings()


def apply_environ(settings: HarborSettings | None = None, *, override: bool = False) -> HarborSettings:
    """Push settings into ``os.environ`` so Harbor / bun / child processes see them."""
    s = settings or get_settings()
    pairs = {
        "OPENAI_BASE_URL": s.eval_llm_base,
        "OPENAI_API_KEY": s.openai_api_key,
        "BARNEY_API_BASE": s.barney_api_base or s.eval_llm_base,
        "BARNEY_API_KEY": s.barney_api_key or s.openai_api_key,
        "ANTHROPIC_API_KEY": s.anthropic_api_key,
        "ANTHROPIC_BASE_URL": s.anthropic_base_url,
        "OPENROUTER_API_KEY": s.openrouter_api_key,
        "OPENROUTER_BASE_URL": s.openrouter_base_url,
    }
    for key, value in pairs.items():
        if value is None or value == "":
            continue
        if override or key not in os.environ:
            os.environ[key] = str(value)
    return s
