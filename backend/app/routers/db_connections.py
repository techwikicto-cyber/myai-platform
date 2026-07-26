import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from pydantic import BaseModel

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, status
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.deps import require_admin, require_workspace_manager, require_workspace_member
from app.models.db_connection import DbConnection
from app.models.query_audit_log import QueryAuditLog, QueryAuditStatus
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
    SelectedDatabasesUpdate,
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
        available_databases=conn.available_databases,
        selected_databases=conn.selected_databases,
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


@router.post("/{connection_id}/databases", response_model=list[str])
async def discover_databases(
    workspace_id: uuid.UUID,
    connection_id: uuid.UUID,
    user: User = Depends(require_workspace_manager),
    db: AsyncSession = Depends(get_db),
):
    """Lists the databases visible on this server (e.g. one login seeing several
    yearly accounting databases on the same MSSQL instance) so a manager can pick
    which ones to expose, instead of being limited to the single `database` field."""
    conn = await db.get(DbConnection, connection_id)
    if not conn or conn.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="اتصال پیدا نشد")
    try:
        databases = await factory.list_databases(conn, timeout=settings.db_query_timeout_seconds)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"خطا در فهرست‌کردن دیتابیس‌ها: {exc}")
    conn.available_databases = databases
    await db.commit()
    return databases


@router.patch("/{connection_id}/selected-databases", response_model=DbConnectionOut)
async def set_selected_databases(
    workspace_id: uuid.UUID,
    connection_id: uuid.UUID,
    payload: SelectedDatabasesUpdate,
    user: User = Depends(require_workspace_manager),
    db: AsyncSession = Depends(get_db),
):
    conn = await db.get(DbConnection, connection_id)
    if not conn or conn.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="اتصال پیدا نشد")
    conn.selected_databases = payload.selected_databases or None
    await db.commit()
    await db.refresh(conn)

    shares = await _load_conn_shares(db, [conn.id])
    return _conn_out(conn, shares.get(str(conn.id), []))


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

    # In multi-database mode a per-database failure doesn't raise (one bad database
    # shouldn't block the others), but if it means nothing came back at all, the user
    # must see why instead of a silent "0 tables" — that silence was the actual
    # symptom reported.
    if not schema.get("tables") and schema.get("errors"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="خواندن اسکیما ناموفق بود: " + " | ".join(schema["errors"]),
        )
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


class ConsoleQueryIn(BaseModel):
    """A hand-written query from the SQL console."""

    sql: str
    row_limit: int = 200


@router.post("/{connection_id}/execute")
async def execute_console_query(
    workspace_id: uuid.UUID,
    connection_id: uuid.UUID,
    payload: ConsoleQueryIn,
    membership=Depends(require_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    """Runs a query the user typed themselves, for the SQL console.

    Read-only enforcement (ensure_readonly_sql, inside the connector) is deliberately
    NOT relaxed here even though the query is hand-written: these connections point at
    live production accounting databases, and a console is exactly where a stray UPDATE
    would do damage. Allowing writes is a separate decision, not a side effect of adding
    a console.

    Every run is written to the same audit log the assistant's queries use, so console
    and chat activity share one history.
    """
    user, _ = membership
    conn = await db.get(DbConnection, connection_id)
    if not conn or conn.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="اتصال پیدا نشد")

    sql = payload.sql.strip()
    if not sql:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="کوئری خالی است")

    row_limit = max(1, min(payload.row_limit, 1000))
    started = time.perf_counter()
    audit = QueryAuditLog(
        workspace_id=workspace_id,
        db_connection_id=conn.id,
        user_id=user.id,
        raw_query=sql,
        status=QueryAuditStatus.success,
    )
    try:
        result = await factory.execute_query(conn, sql, row_limit=row_limit)
    except Exception as exc:  # noqa: BLE001 — surfaced to the user as the query's error
        audit.status = QueryAuditStatus.failed
        audit.error_message = str(exc)[:2000]
        audit.duration_ms = int((time.perf_counter() - started) * 1000)
        db.add(audit)
        await db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    audit.executed_query = sql
    audit.row_count = len(result.rows)
    audit.duration_ms = int((time.perf_counter() - started) * 1000)
    db.add(audit)
    await db.commit()

    return {
        "columns": result.columns,
        "rows": result.rows,
        "truncated": result.truncated,
        "duration_ms": audit.duration_ms,
    }


def _known_table_names(conn: DbConnection) -> set[str]:
    summary = conn.schema_summary or {}
    items = summary.get("tables") or summary.get("collections") or []
    return {i["name"] for i in items if isinstance(i, dict) and "name" in i}


@router.get("/{connection_id}/tables/{table_name:path}/preview")
async def preview_table(
    workspace_id: uuid.UUID,
    connection_id: uuid.UUID,
    table_name: str,
    limit: int = 100,
    membership=Depends(require_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    """Rows and column list for one table, for the data browser.

    The table name is matched against the introspected schema rather than interpolated
    from user input, so the generated SELECT can only ever name a table we already know
    exists — the client cannot smuggle SQL through this path.
    """
    conn = await db.get(DbConnection, connection_id)
    if not conn or conn.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="اتصال پیدا نشد")

    known = _known_table_names(conn)
    match = next((n for n in known if n == table_name or n.split(".")[-1] == table_name), None)
    if match is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="جدول در اسکیمای این اتصال پیدا نشد")

    limit = max(1, min(limit, 500))
    if conn.engine == DbEngine.mongodb:
        result = await factory.execute_query(
            conn, {"operation": "find", "collection": match.split(".")[-1], "filter": {}}, row_limit=limit
        )
    else:
        result = await factory.execute_query(conn, f"SELECT * FROM {match}", row_limit=limit)

    summary = conn.schema_summary or {}
    items = summary.get("tables") or summary.get("collections") or []
    entry = next((i for i in items if i.get("name") == match), {})
    columns_meta = entry.get("columns") or [
        {"name": k, "type": v} for k, v in (entry.get("sample_fields") or {}).items()
    ]

    return {
        "name": match,
        "columns_meta": columns_meta,
        "columns": result.columns,
        "rows": result.rows,
        "truncated": result.truncated,
    }
