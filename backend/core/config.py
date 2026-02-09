from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=False,
    )

    DB_SERVER: str
    DB_NAME: str
    CORS_ORIGINS: str


settings = Settings()
