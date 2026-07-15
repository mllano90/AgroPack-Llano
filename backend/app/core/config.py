from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from typing import Optional


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    All secrets (especially SECRET_KEY) MUST come from the environment.
    """

    # --- Security / Auth ---
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    # --- Database ---
    DATABASE_URL: str = "sqlite:///./agropack_llano.db"

    # --- Application ---
    PROJECT_NAME: str = "AgroPack Llano"
    DEBUG: bool = False
    VERSION: str = "1.0.0"

    # Pydantic v2 configuration
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",  # Ignore unknown env vars
    )


@lru_cache()
def get_settings() -> Settings:
    """Return cached application settings."""
    return Settings()
