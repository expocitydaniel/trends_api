from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    central_brain_internal_base_url: str = ""
    central_brain_internal_api_key: str = ""
    # Live Central Brain currently accepts user | wordmap | test (not trends).
    alert_rule_type: str = "test"
    bff_host: str = "0.0.0.0"
    bff_port: int = 8080
    data_dir: Path = Path("./data")
    cors_origins: str = (
        "http://172.22.225.176:3210,http://localhost:3210,http://localhost:5173"
    )

    @property
    def images_dir(self) -> Path:
        return self.data_dir / "images"

    @property
    def manifest_path(self) -> Path:
        return self.data_dir / "manifest.jsonl"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def configured(self) -> bool:
        return bool(
            self.central_brain_internal_base_url.strip()
            and self.central_brain_internal_api_key.strip()
        )


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.images_dir.mkdir(parents=True, exist_ok=True)
    return settings
