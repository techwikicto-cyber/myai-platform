import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_workspace_member
from app.models.db_connection import DbConnection
from app.models.query_audit_log import QueryAuditLog, QueryAuditStatus
from app.models.user import User

router = APIRouter(prefix="/api/workspaces/{workspace_id}/query-history", tags=["query-history"])


class QueryHistoryItem(BaseModel):
    id: uuid.UUID
    raw_query: str
    executed_query: str | None
    status: QueryAuditStatus
    error_message: str | None
    row_count: int | None
    duration_ms: int | None
    created_at: datetime
    connection_name: str | None
    user_email: str | None
    # Distinguishes a console run from one the assistant made on the user's behalf;
    # only the latter is tied to a chat thread.
    source: str


@router.get("", response_model=list[QueryHistoryItem])
async def list_query_history(
    workspace_id: uuid.UUID,
    limit: int = 100,
    membership=Depends(require_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    """Every query run against this workspace's databases, newest first — console and
    assistant alike, since both already write to the same audit log."""
    limit = max(1, min(limit, 500))
    rows = await db.execute(
        select(QueryAuditLog, DbConnection.name, User.email)
        .outerjoin(DbConnection, QueryAuditLog.db_connection_id == DbConnection.id)
        .outerjoin(User, QueryAuditLog.user_id == User.id)
        .where(QueryAuditLog.workspace_id == workspace_id)
        .order_by(QueryAuditLog.created_at.desc())
        .limit(limit)
    )
    return [
        QueryHistoryItem(
            id=log.id,
            raw_query=log.raw_query,
            executed_query=log.executed_query,
            status=log.status,
            error_message=log.error_message,
            row_count=log.row_count,
            duration_ms=log.duration_ms,
            created_at=log.created_at,
            connection_name=conn_name,
            user_email=user_email,
            source="assistant" if log.thread_id else "console",
        )
        for log, conn_name, user_email in rows.all()
    ]
