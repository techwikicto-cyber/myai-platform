from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.deps import require_admin
from app.models.settings import ModelSettings
from app.schemas.settings import ConnectionTestResult, ModelSettingsIn, ModelSettingsOut
from app.security import decrypt_secret, encrypt_secret
from app.services.embeddings import test_embedding_connection
from app.services.llm import test_llm_connection
from app.services.model_config import EmbeddingConfig, LlmConfig, get_embedding_config, get_llm_config

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(require_admin)])

settings = get_settings()


async def _get_or_create_row(db: AsyncSession) -> ModelSettings:
    row = await db.get(ModelSettings, 1)
    if not row:
        row = ModelSettings(id=1)
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


def _to_out(row: ModelSettings) -> ModelSettingsOut:
    # Embedding fields fall back to the deployment defaults so the UI always shows
    # the effective values instead of empty inputs with placeholder text.
    return ModelSettingsOut(
        llm_base_url=row.llm_base_url,
        llm_model=row.llm_model,
        llm_api_key_set=bool(row.llm_api_key_encrypted),
        embedding_base_url=row.embedding_base_url or settings.default_embedding_base_url,
        embedding_api_type=row.embedding_api_type or settings.default_embedding_api_type,
        embedding_model=row.embedding_model or settings.default_embedding_model,
    )


@router.get("/model", response_model=ModelSettingsOut)
async def get_model_settings(db: AsyncSession = Depends(get_db)):
    row = await _get_or_create_row(db)
    return _to_out(row)


@router.put("/model", response_model=ModelSettingsOut)
async def update_model_settings(payload: ModelSettingsIn, db: AsyncSession = Depends(get_db)):
    row = await _get_or_create_row(db)
    row.llm_base_url = payload.llm_base_url
    row.llm_model = payload.llm_model
    if payload.llm_api_key:
        row.llm_api_key_encrypted = encrypt_secret(payload.llm_api_key)
    row.embedding_base_url = payload.embedding_base_url
    row.embedding_api_type = payload.embedding_api_type
    row.embedding_model = payload.embedding_model
    await db.commit()
    await db.refresh(row)
    return _to_out(row)


@router.post("/model/test-llm", response_model=ConnectionTestResult)
async def test_llm(payload: ModelSettingsIn | None = None, db: AsyncSession = Depends(get_db)):
    # When the form values are sent along, test those directly so users can verify
    # a configuration before saving it. Falls back to the saved settings otherwise.
    if payload and payload.llm_base_url:
        row = await _get_or_create_row(db)
        api_key = payload.llm_api_key or (
            decrypt_secret(row.llm_api_key_encrypted) if row.llm_api_key_encrypted else ""
        )
        config = LlmConfig(base_url=payload.llm_base_url, api_key=api_key, model=payload.llm_model or "")
    else:
        config = await get_llm_config(db)
    success, message = await test_llm_connection(config)
    return ConnectionTestResult(success=success, message=message)


@router.post("/model/test-embedding", response_model=ConnectionTestResult)
async def test_embedding(payload: ModelSettingsIn | None = None, db: AsyncSession = Depends(get_db)):
    if payload and payload.embedding_base_url:
        config = EmbeddingConfig(
            base_url=payload.embedding_base_url,
            api_type=payload.embedding_api_type or "tei",
            model=payload.embedding_model or "",
        )
    else:
        config = await get_embedding_config(db)
    success, message = await test_embedding_connection(config)
    return ConnectionTestResult(success=success, message=message)
