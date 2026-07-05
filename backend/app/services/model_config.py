from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.settings import ModelSettings
from app.security import decrypt_secret

settings = get_settings()


@dataclass
class LlmConfig:
    base_url: str
    api_key: str
    model: str


@dataclass
class EmbeddingConfig:
    base_url: str
    api_type: str
    model: str


async def _get_or_create_row(db: AsyncSession) -> ModelSettings:
    row = await db.get(ModelSettings, 1)
    if not row:
        row = ModelSettings(id=1)
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


async def get_llm_config(db: AsyncSession) -> LlmConfig:
    row = await _get_or_create_row(db)
    return LlmConfig(
        base_url=row.llm_base_url or "",
        api_key=decrypt_secret(row.llm_api_key_encrypted) if row.llm_api_key_encrypted else "",
        model=row.llm_model or "",
    )


async def get_embedding_config(db: AsyncSession) -> EmbeddingConfig:
    row = await _get_or_create_row(db)
    return EmbeddingConfig(
        base_url=row.embedding_base_url or settings.default_embedding_base_url,
        api_type=row.embedding_api_type or settings.default_embedding_api_type,
        model=row.embedding_model or settings.default_embedding_model,
    )
