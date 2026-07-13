from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://myai:myai@postgres:5432/myai"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    encryption_key: str = "0000000000000000000000000000000000000000="
    default_embedding_base_url: str = "http://embedding:8080/v1"
    default_embedding_api_type: str = "openai"
    default_embedding_model: str = "BAAI/bge-m3"
    cors_origins: list[str] = ["*"]
    upload_max_mb: int = 50
    db_query_row_limit: int = 50
    db_query_timeout_seconds: int = 15
    db_export_row_limit: int = 500000
    db_export_timeout_seconds: int = 60
    max_tool_result_chars_per_turn: int = 8000

    # Cross-encoder reranker (optional). When reranker_base_url is set to a TEI
    # /rerank endpoint (e.g. http://reranker:80), hybrid-search candidates are
    # re-scored by a cross-encoder before the top_k reach the prompt. Empty =
    # disabled (falls back to the RRF order), so this is fully opt-in.
    reranker_base_url: str = ""
    reranker_model: str = ""            # optional; only needed by some rerankers
    rerank_candidate_pool: int = 20     # how many hybrid candidates to rerank down to top_k
    reranker_timeout_seconds: int = 20


@lru_cache
def get_settings() -> Settings:
    return Settings()
