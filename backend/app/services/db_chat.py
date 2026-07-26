import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_connection import DbConnection, DbEngine
from app.models.sharing import DbConnectionWorkspaceShare
from app.services.db_engine_knowledge import get_engine_knowledge
from app.services.db_query_tool import build_tool_schema, summarize_schema
from app.services.rag import search_similar_chunks


async def build_db_tools_and_context(
    workspace_id: uuid.UUID,
    query_embedding: list[float] | None,
    db: AsyncSession,
    query_text: str = "",
    only_tables: set[str] | None = None,
) -> tuple[list[dict], str | None, dict[str, DbConnection]]:
    share_subq = (
        select(DbConnectionWorkspaceShare.id)
        .where(
            DbConnectionWorkspaceShare.db_connection_id == DbConnection.id,
            DbConnectionWorkspaceShare.workspace_id == workspace_id,
        )
        .exists()
    )
    result = await db.execute(
        select(DbConnection).where(
            or_(DbConnection.workspace_id == workspace_id, share_subq)
        )
    )
    connections = list(result.scalars().all())
    if not connections:
        return [], None, {}

    by_name: dict[str, DbConnection] = {}
    context_parts = []
    has_mongo = False
    has_sql = False

    for conn in connections:
        by_name[conn.name] = conn
        has_mongo = has_mongo or conn.engine == DbEngine.mongodb
        has_sql = has_sql or conn.engine != DbEngine.mongodb

        doc_text = ""
        if query_embedding is not None:
            chunks = await search_similar_chunks(
                workspace_id, query_embedding, db, query_text=query_text, top_k=3, db_connection_id=conn.id
            )
            doc_text = "\n".join(c.content for c in chunks)

        engine_knowledge = get_engine_knowledge(conn.engine)
        schema_text = summarize_schema(conn, only_tables=only_tables)
        scope_note = (
            "\n\n(کاربر این پرسش را به همین جدول‌های انتخاب‌شده محدود کرده است؛ فقط از همین‌ها "
            "استفاده کن و نام جدول دیگری به کار نبر.)"
            if only_tables
            else ""
        )
        context_parts.append(
            f"### اتصال دیتابیس «{conn.name}» (نوع: {conn.engine.value})\n"
            f"ساختار:\n{schema_text}{scope_note}\n\n"
            f"توضیحات معنایی (از سند آموزش اسکیما):\n{doc_text or '(سندی آپلود نشده)'}\n\n"
            f"{engine_knowledge}"
        )

    tools = [build_tool_schema(list(by_name.keys()), has_mongo, has_sql)]
    context = "\n\n".join(context_parts)
    return tools, context, by_name
