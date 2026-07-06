import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.deps import require_workspace_manager, require_workspace_member
from app.models.db_connection import DbConnection
from app.models.document import Document, DocumentKind
from app.models.user import User
from app.schemas.db_connection import (
    ConnectionTestResult,
    DbConnectionCreate,
    DbConnectionOut,
    DbConnectionTestRequest,
)
from app.schemas.document import DocumentOut
from app.security import encrypt_secret
from app.services.db_connectors import factory
from app.services.db_connectors.base import ConnectionParams
from app.services.parsers import SUPPORTED_EXTENSIONS, extension_of
from app.services.rag import process_document_background

router = APIRouter(prefix="/api/workspaces/{workspace_id}/db-connections", tags=["db-connections"])
settings = get_settings()


def _temp_connection(payload: DbConnectionCreate) -> DbConnection:
    conn = DbConnection(
        workspace_id=uuid.uuid4(),
        name=payload.name,
        engine=payload.engine,
        host=payload.host,
        port=payload.port,
        database=payload.database,
        username=payload.username,
        options=payload.options,
    )
    conn.encrypted_password = encrypt_secret(payload.password) if payload.password else None
    return conn


@router.post("/test", response_model=ConnectionTestResult)
async def test_new_connection(
    workspace_id: uuid.UUID,
    payload: DbConnectionTestRequest,
    user: User = Depends(require_workspace_manager),
):
    conn = _temp_connection(payload)
    success, message = await factory.test_connection(conn, timeout=settings.db_query_timeout_seconds)
    return ConnectionTestResult(success=success, message=message)


@router.get("", response_model=list[DbConnectionOut])
async def list_connections(
    workspace_id: uuid.UUID,
    membership=Depends(require_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(DbConnection).where(DbConnection.workspace_id == workspace_id))
    return result.scalars().all()


@router.post("", response_model=DbConnectionOut, status_code=status.HTTP_201_CREATED)
async def create_connection(
    workspace_id: uuid.UUID,
    payload: DbConnectionCreate,
    user: User = Depends(require_workspace_manager),
    db: AsyncSession = Depends(get_db),
):
    conn = DbConnection(
        workspace_id=workspace_id,
        name=payload.name,
        engine=payload.engine,
        host=payload.host,
        port=payload.port,
        database=payload.database,
        username=payload.username,
        encrypted_password=encrypt_secret(payload.password) if payload.password else None,
        options=payload.options,
        created_by=user.id,
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)

    try:
        schema = await factory.introspect_schema(conn, timeout=settings.db_query_timeout_seconds)
        conn.schema_summary = schema
        conn.last_introspected_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(conn)
    except Exception:  # noqa: BLE001
        pass  # connection is still saved; user can retry via "refresh schema"

    return conn


@router.post("/{connection_id}/test", response_model=ConnectionTestResult)
async def test_connection(
    workspace_id: uuid.UUID,
    connection_id: uuid.UUID,
    user: User = Depends(require_workspace_manager),
    db: AsyncSession = Depends(get_db),
):
    conn = await db.get(DbConnection, connection_id)
    if not conn or conn.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="اتصال پیدا نشد")
    success, message = await factory.test_connection(conn, timeout=settings.db_query_timeout_seconds)
    return ConnectionTestResult(success=success, message=message)


@router.post("/{connection_id}/refresh-schema", response_model=DbConnectionOut)
async def refresh_schema(
    workspace_id: uuid.UUID,
    connection_id: uuid.UUID,
    user: User = Depends(require_workspace_manager),
    db: AsyncSession = Depends(get_db),
):
    conn = await db.get(DbConnection, connection_id)
    if not conn or conn.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="اتصال پیدا نشد")
    try:
        schema = await factory.introspect_schema(conn, timeout=settings.db_query_timeout_seconds)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"خطا در خواندن اسکیما: {exc}")
    conn.schema_summary = schema
    conn.last_introspected_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(conn)
    return conn


@router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(
    workspace_id: uuid.UUID,
    connection_id: uuid.UUID,
    user: User = Depends(require_workspace_manager),
    db: AsyncSession = Depends(get_db),
):
    conn = await db.get(DbConnection, connection_id)
    if not conn or conn.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="اتصال پیدا نشد")
    await db.delete(conn)
    await db.commit()


@router.get("/{connection_id}/schema-docs", response_model=list[DocumentOut])
async def list_schema_docs(
    workspace_id: uuid.UUID,
    connection_id: uuid.UUID,
    membership=Depends(require_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Document)
        .where(Document.db_connection_id == connection_id, Document.kind == DocumentKind.db_schema_doc)
        .order_by(Document.created_at.desc())
    )
    return result.scalars().all()


@router.post("/{connection_id}/schema-docs", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_schema_doc(
    workspace_id: uuid.UUID,
    connection_id: uuid.UUID,
    file: UploadFile,
    background_tasks: BackgroundTasks,
    user: User = Depends(require_workspace_manager),
    db: AsyncSession = Depends(get_db),
):
    conn = await db.get(DbConnection, connection_id)
    if not conn or conn.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="اتصال پیدا نشد")

    ext = extension_of(file.filename or "")
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"فرمت .{ext} پشتیبانی نمی‌شود. فرمت‌های مجاز: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )
    content = await file.read()
    if len(content) > settings.upload_max_mb * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"حجم فایل نباید بیشتر از {settings.upload_max_mb} مگابایت باشد",
        )

    document = Document(
        workspace_id=workspace_id,
        db_connection_id=connection_id,
        kind=DocumentKind.db_schema_doc,
        filename=file.filename or "بدون‌نام",
        source_type=ext,
        uploaded_by=user.id,
    )
    db.add(document)
    await db.commit()
    await db.refresh(document)

    background_tasks.add_task(process_document_background, document.id, content)
    return document
