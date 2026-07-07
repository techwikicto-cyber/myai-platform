import uuid
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, status
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.deps import require_admin, require_workspace_manager, require_workspace_member
from app.models.db_connection import DbConnection
from app.models.document import Document, DocumentKind
from app.models.sharing import DbConnectionWorkspaceShare
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.db_connection import (
    AllowedTablesUpdate,
    ConnectionTestResult,
    DbConnectionCreate,
    DbConnectionOut,
    DbConnectionTestRequest,
    SharedConnectionOut,
    ShareUpdate,
)
from app.schemas.document import DocumentOut
from app.security import encrypt_secret
from app.services.db_connectors import factory
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


async def _load_conn_shares(db: AsyncSession, conn_ids: list[uuid.UUID]) -> dict[str, list[uuid.UUID]]:
    if not conn_ids:
        return {}
    result = await db.execute(
        select(DbConnectionWorkspaceShare.db_connection_id, DbConnectionWorkspaceShare.workspace_id)
        .where(DbConnectionWorkspaceShare.db_connection_id.in_(conn_ids))
    )
    shares: dict[str, list[uuid.UUID]] = defaultdict(list)
    for conn_id, ws_id in result:
        shares[str(conn_id)].append(ws_id)
    return shares


def _conn_out(conn: DbConnection, shared_ids: list[uuid.UUID]) -> DbConnectionOut:
    return DbConnectionOut(
        id=conn.id,
        name=conn.name,
        engine=conn.engine,
        host=conn.host,
        port=conn.port,
        database=conn.database,
        username=conn.username,
        options=conn.options,
        schema_summary=conn.schema_summary,
        allowed_tables=conn.allowed_tables,
        shared_workspace_ids=shared_ids,
        last_introspected_at=conn.last_introspected_at,
        created_at=conn.created_at,
    )


@router.get("/shared", response_model=list[SharedConnectionOut])
async def list_shared_connections(
    workspace_id: uuid.UUID,
    membership=Depends(require_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DbConnection, Workspace.name)
        .join(DbConnectionWorkspaceShare, DbConnectionWorkspaceShare.db_connection_id == DbConnection.id)
        .join(Workspace, Workspace.id == DbConnection.workspace_id)
        .where(DbConnectionWorkspaceShare.workspace_id == workspace_id)
        .order_by(DbConnection.created_at.desc())
    )
    return [
        SharedConnectionOut(
            id=conn.id,
            name=conn.name,
            engine=conn.engine,
            host=conn.host,
            database=conn.database,
            source_workspace_name=ws_name,
            schema_summary=conn.schema_summary,
            last_introspected_at=conn.last_introspected_at,
            created_at=conn.created_at,
        )
        for conn, ws_name in result.all()
    ]


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
    conns = list(result.scalars().all())
    shares = await _load_conn_shares(db, [c.id for c in conns])
    return [_conn_out(c, shares.get(str(c.id), [])) for c in conns]


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
        pass

    return _conn_out(conn, [])


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

    shares = await _load_conn_shares(db, [conn.id])
    return _conn_out(conn, shares.get(str(conn.id), []))


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
    factory.invalidate_engine(conn)
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
    docs = list(result.scalars().all())
    # Schema docs are never shared, so shared_workspace_ids is always empty
    return [
        DocumentOut(
            id=d.id, filename=d.filename, source_type=d.source_type,
            status=d.status, error_message=d.error_message,
            shared_workspace_ids=[], created_at=d.created_at,
        )
        for d in docs
    ]


@router.patch("/{connection_id}/share", response_model=DbConnectionOut)
async def share_connection(
    workspace_id: uuid.UUID,
    connection_id: uuid.UUID,
    payload: ShareUpdate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    conn = await db.get(DbConnection, connection_id)
    if not conn or conn.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="اتصال پیدا نشد")

    await db.execute(sa_delete(DbConnectionWorkspaceShare).where(DbConnectionWorkspaceShare.db_connection_id == connection_id))
    for ws_id in payload.workspace_ids:
        if ws_id != workspace_id:
            db.add(DbConnectionWorkspaceShare(db_connection_id=connection_id, workspace_id=ws_id))
    await db.commit()

    result = await db.execute(
        select(DbConnectionWorkspaceShare.workspace_id)
        .where(DbConnectionWorkspaceShare.db_connection_id == connection_id)
    )
    return _conn_out(conn, list(result.scalars()))


@router.patch("/{connection_id}/allowlist", response_model=DbConnectionOut)
async def set_allowlist(
    workspace_id: uuid.UUID,
    connection_id: uuid.UUID,
    payload: AllowedTablesUpdate,
    user: User = Depends(require_workspace_manager),
    db: AsyncSession = Depends(get_db),
):
    conn = await db.get(DbConnection, connection_id)
    if not conn or conn.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="اتصال پیدا نشد")
    conn.allowed_tables = payload.allowed_tables or None
    await db.commit()
    await db.refresh(conn)

    shares = await _load_conn_shares(db, [conn.id])
    return _conn_out(conn, shares.get(str(conn.id), []))


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
    return DocumentOut(
        id=document.id, filename=document.filename, source_type=document.source_type,
        status=document.status, error_message=document.error_message,
        shared_workspace_ids=[], created_at=document.created_at,
    )
