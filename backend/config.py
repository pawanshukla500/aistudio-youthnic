import os
import json
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Service settings
    ENV: str = os.getenv("RAILWAY_ENVIRONMENT", "production")
    PORT: int = int(os.getenv("PORT", "8000"))
    INTERNAL_API_SECRET: str = os.getenv("CATALOG_WORKER_SECRET", "cws_internal_secret")

    # PostgreSQL / Supabase
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        os.getenv(
            "POSTGRES_PRIVATE_URL",
            os.getenv(
                "POSTGRES_URL",
                "postgresql://supabase_admin:9rcfkuq6ntgpze1is7q3368k1vm949wa58xu89x0yfwo32gifizhgomeon1us1ss@zephyr.proxy.rlwy.net:40295/postgres"
            )
        )
    )
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "https://envoy-production-37ba.up.railway.app")
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    # Valkey / Redis
    VALKEY_URL: str = os.getenv(
        "VALKEY_URL",
        os.getenv(
            "VALKEY_PUBLIC_URL",
            os.getenv(
                "REDIS_URL",
                "redis://default:uxHRAgP_x.3Ye-jQm92IV5ejy6hs84GT@hayabusa.proxy.rlwy.net:19950"
            )
        )
    )

    # Firebase
    FIREBASE_PROJECT_ID: str = os.getenv("FIREBASE_PROJECT_ID", "ai-studio-app-be068")
    FIREBASE_STORAGE_BUCKET: str = os.getenv("FIREBASE_STORAGE_BUCKET", "ai-studio-app-be068.firebasestorage.app")
    FIREBASE_SERVICE_ACCOUNT: Optional[str] = os.getenv("FIREBASE_SERVICE_ACCOUNT")

    # Model APIs
    META_MODEL_API_KEY: Optional[str] = os.getenv("META_MODEL_API_KEY")
    OPENAI_API_KEY: Optional[str] = os.getenv("OPENAI_API_KEY")
    GEMINI_API_KEY: Optional[str] = os.getenv("GEMINI_API_KEY")

    # Budgets & Timeouts
    MAX_JOB_COST_USD: float = 2.50
    VISION_TIMEOUT_SECONDS: int = 120
    IMAGE_GEN_TIMEOUT_SECONDS: int = 180

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
