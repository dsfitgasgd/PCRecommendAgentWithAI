from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./data/app.db"
    jwt_secret: str = "change-me-before-deployment-at-least-32-characters"
    frontend_origin: str = "http://localhost:5173"
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-flash"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5"
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1-mini"
    tavily_api_key: str = ""
    upload_limit_bytes: int = 5 * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()


def ensure_sqlite_directory(url: str) -> None:
    if url.startswith("sqlite:///") and url != "sqlite:///:memory:":
        path = Path(url.removeprefix("sqlite:///"))
        path.parent.mkdir(parents=True, exist_ok=True)
