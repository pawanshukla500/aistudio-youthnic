from typing import Optional
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Service settings
    ENV: str = Field(
        default="development",
        validation_alias=AliasChoices("ENV", "RAILWAY_ENVIRONMENT"),
    )
    PORT: int = 8000
    INTERNAL_API_SECRET: str = Field(
        default="",
        validation_alias=AliasChoices("INTERNAL_API_SECRET", "CATALOG_WORKER_SECRET"),
    )
    INTERNAL_API_AUTH_BYPASS: bool = False
    CORS_ORIGINS: str = "*"

    # PostgreSQL / Supabase (populated via environment variables)
    DATABASE_URL: str = Field(
        default="",
        validation_alias=AliasChoices("POSTGRES_PRIVATE_URL", "DATABASE_URL", "POSTGRES_URL"),
    )
    DB_POOL_MAX_SIZE: int = 5
    DB_POOL_MAX_IDLE_SECONDS: float = 60.0
    IDLE_RESOURCE_RELEASE_SECONDS: int = 45
    HEALTH_CHECK_IDLE_SAFE: bool = True
    CELERY_WORKER_WAKE_URL: str = Field(
        default="http://celery-worker.railway.internal:8080/wake",
        validation_alias=AliasChoices("CELERY_WORKER_WAKE_URL", "WORKER_WAKE_URL"),
    )
    CELERY_WORKER_POOL: str = "threads"
    CELERY_WORKER_CONCURRENCY: int = 2
    WORKER_IDLE_SHUTDOWN_SECONDS: int = 60
    WORKER_POLL_INTERVAL_SECONDS: int = 15
    SUPABASE_URL: str = "https://envoy-production-37ba.up.railway.app"
    SUPABASE_SERVICE_ROLE_KEY: str = ""

    # Valkey / Redis (populated via environment variables)
    VALKEY_URL: str = Field(
        default="redis://localhost:6379/0",
        validation_alias=AliasChoices("VALKEY_URL", "VALKEY_PUBLIC_URL", "REDIS_URL"),
    )

    # Firebase
    FIREBASE_PROJECT_ID: str = "ai-studio-app-be068"
    FIREBASE_STORAGE_BUCKET: str = "ai-studio-app-be068.firebasestorage.app"
    FIREBASE_SERVICE_ACCOUNT: Optional[str] = None

    # Model APIs
    META_MODEL_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None

    # Budgets & Timeouts
    MAX_JOB_COST_USD: float = 2.50
    VISION_TIMEOUT_SECONDS: int = 120
    IMAGE_GEN_TIMEOUT_SECONDS: int = 180

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
