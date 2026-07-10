import json
import time
import uuid

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.db_connection import DbConnection, DbEngine
from app.models.query_audit_log import QueryAuditLog, QueryAuditStatus
from app.services.db_connectors import factory
from app.services.db_connectors.base import QueryResult
from app.services.query_safety import (
    QuerySafetyError,
    ensure_allowed_mongo_collection,
    ensure_allowed_tables,
)

settings = get_settings()

TOOL_NAME = "query_database"
MAX_RESULT_CHARS = 20000

# Aggregation hint: if question looks analytical but query returns too many raw rows, warn the model.
AGGREGATION_HINT_WORDS = {"جمع", "مجموع", "میانگین", "متوسط", "تعداد", "چند", "درصد", "sum", "total", "average", "count"}


def summarize_schema(conn: DbConnection) -> str:
    """Returns schema description filtered to allowed tables only."""
    if not conn.schema_summary:
        return "(اسکیما هنوز استخراج نشده است — از دکمه «به‌روزرسانی اسکیما» استفاده کنید)"

    allowed = conn.allowed_tables  # None = all allowed

    if conn.engine == DbEngine.mongodb:
        lines = []
        for coll in conn.schema_summary.get("collections", []):
            if allowed is not None and coll["name"].lower() not in {k.lower() for k in allowed}:
                continue
            allowed_cols = (allowed or {}).get(coll["name"]) or (allowed or {}).get(coll["name"].lower())
            fields = {k: v for k, v in coll.get("sample_fields", {}).items()
                      if allowed_cols is None or k in allowed_cols}
            field_str = ", ".join(f"{k}:{v}" for k, v in fields.items())
            lines.append(f"- کالکشن {coll['name']}: {field_str}")
        return "\n".join(lines) or "(کالکشنی پیدا نشد)"

    lines = []
    for table in conn.schema_summary.get("tables", []):
        if allowed is not None and table["name"].lower() not in {k.lower() for k in allowed}:
            continue
        allowed_cols = None
        if allowed is not None:
            allowed_cols = (allowed.get(table["name"]) or allowed.get(table["name"].lower()))
        cols = [
            c for c in table.get("columns", [])
            if allowed_cols is None or c["name"] in allowed_cols
        ]
        cols_str = ", ".join(f"{c['name']}:{c['type']}" for c in cols)
        lines.append(f"- جدول {table['name']}: {cols_str}")
    return "\n".join(lines) or "(جدولی پیدا نشد)"


def build_tool_schema(connection_names: list[str], has_mongo: bool, has_sql: bool) -> dict:
    query_desc = []
    if has_sql:
        query_desc.append(
            'برای دیتابیس‌های SQL: یک عبارت خواندنی SELECT معتبر (رشته متن ساده، بدون JSON). '
            'مهم: اگر سوال نیاز به جمع، میانگین، شمارش یا درصد دارد، این محاسبات را '
            'حتماً خودِ SQL انجام دهد (با SUM/AVG/COUNT/GROUP BY) — هرگز ردیف‌های خام '
            'را برای محاسبه دستی برنگردان.'
        )
    if has_mongo:
        query_desc.append(
            'برای MongoDB: یک رشته JSON به شکل {"operation":"find","collection":"...","filter":{...}} '
            'یا {"operation":"aggregate","collection":"...","pipeline":[...]}'
        )

    return {
        "type": "function",
        "function": {
            "name": TOOL_NAME,
            "description": (
                "اجرای یک کوئری فقط-خواندنی روی دیتابیس متصل به این فضای کاری برای پاسخ به سوالات کاربر درباره داده‌ها. "
                + " ".join(query_desc)
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "connection_name": {
                        "type": "string",
                        "enum": connection_names,
                        "description": "نام اتصال دیتابیسی که باید کوئری روی آن اجرا شود",
                    },
                    "query": {"type": "string", "description": "متن کوئری طبق فرمت توضیح داده‌شده"},
                },
                "required": ["connection_name", "query"],
            },
        },
    }


def format_query_result(result: QueryResult, user_question: str = "") -> str:
    if not result.rows:
        return "کوئری اجرا شد اما هیچ ردیفی برنگشت."

    # Aggregation check: warn if too many raw rows returned for an analytical question
    if len(result.rows) > 20 and any(w in user_question for w in AGGREGATION_HINT_WORDS):
        return (
            f"(هشدار: کوئری {len(result.rows)} ردیف خام برگرداند. "
            "برای سوالات آماری/محاسباتی، لطفاً کوئری را با SUM/AVG/COUNT/GROUP BY بازنویسی کن "
            "تا عدد نهایی مستقیم از دیتابیس آید، نه ردیف‌های خام.)"
        )

    header = " | ".join(result.columns)
    separator = " | ".join("---" for _ in result.columns)
    body_lines = [" | ".join(str(row.get(c, "")) for c in result.columns) for row in result.rows]
    table = "\n".join([header, separator, *body_lines])

    if len(table) > MAX_RESULT_CHARS:
        table = table[:MAX_RESULT_CHARS] + (
            "\n... (خروجی برای نمایش کوتاه شد — به کاربر بگو نتایج کامل را "
            "با دکمه «دانلود CSV» زیر همین پاسخ دریافت کند)"
        )
    if result.truncated:
        table += (
            f"\n\n(توجه: نمایش به {len(result.rows)} ردیف اول محدود شده است؛ "
            "نتایج کامل با دکمه «دانلود CSV» زیر پاسخ قابل دریافت است)"
        )
    return table


async def _write_audit_log(
    workspace_id: uuid.UUID,
    db_connection_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    thread_id: uuid.UUID | None,
    raw_query: str,
    executed_query: str | None,
    status: QueryAuditStatus,
    error_message: str | None,
    row_count: int | None,
    duration_ms: int | None,
) -> uuid.UUID | None:
    try:
        async with AsyncSessionLocal() as db:
            log = QueryAuditLog(
                workspace_id=workspace_id,
                db_connection_id=db_connection_id,
                user_id=user_id,
                thread_id=thread_id,
                raw_query=raw_query,
                executed_query=executed_query,
                status=status,
                error_message=error_message,
                row_count=row_count,
                duration_ms=duration_ms,
            )
            db.add(log)
            await db.commit()
            return log.id
    except Exception:  # noqa: BLE001
        return None  # audit failure never blocks the main flow


async def run_tool_call(
    connections_by_name: dict[str, DbConnection],
    arguments_json: str,
    user_id: uuid.UUID | None = None,
    thread_id: uuid.UUID | None = None,
    user_question: str = "",
) -> tuple[str, uuid.UUID | None]:
    """Executes one query_database tool call.

    Returns (result_text_for_llm, audit_id). audit_id is set only for
    successfully executed queries, so the caller can link it to the saved
    assistant message and offer a full-result CSV export."""
    try:
        arguments = json.loads(arguments_json)
    except json.JSONDecodeError:
        return "خطا: آرگومان‌های ارسال‌شده برای ابزار کوئری، JSON معتبر نیستند.", None

    connection_name = arguments.get("connection_name")
    query = arguments.get("query")
    conn = connections_by_name.get(connection_name)
    if not conn:
        if len(connections_by_name) == 1:
            conn = next(iter(connections_by_name.values()))
        else:
            return f"خطا: اتصال دیتابیسی با نام «{connection_name}» پیدا نشد.", None

    if not query:
        return "خطا: کوئری ارسال نشده است.", None

    raw_query = query
    parsed_query: str | dict = query
    start_ms = int(time.time() * 1000)

    if conn.engine == DbEngine.mongodb:
        try:
            parsed_query = json.loads(query)
        except json.JSONDecodeError:
            return "خطا: برای MongoDB باید کوئری به‌صورت JSON معتبر ارسال شود.", None
        # Allowlist check for MongoDB collection
        try:
            if conn.allowed_tables is not None:
                ensure_allowed_mongo_collection(parsed_query, conn.allowed_tables)
        except QuerySafetyError as exc:
            await _write_audit_log(
                conn.workspace_id, conn.id, user_id, thread_id,
                raw_query, None, QueryAuditStatus.rejected, str(exc), None, None,
            )
            return f"خطای امنیتی: {exc}", None
    else:
        # Allowlist check for SQL tables
        try:
            if conn.allowed_tables is not None:
                ensure_allowed_tables(query, conn.allowed_tables)
        except QuerySafetyError as exc:
            await _write_audit_log(
                conn.workspace_id, conn.id, user_id, thread_id,
                raw_query, None, QueryAuditStatus.rejected, str(exc), None, None,
            )
            return f"خطای امنیتی: {exc}", None

    try:
        result = await factory.execute_query(
            conn, parsed_query, row_limit=settings.db_query_row_limit, timeout=settings.db_query_timeout_seconds
        )
        duration = int(time.time() * 1000) - start_ms
        audit_id = await _write_audit_log(
            conn.workspace_id, conn.id, user_id, thread_id,
            raw_query, None, QueryAuditStatus.success, None, len(result.rows), duration,
        )
        return format_query_result(result, user_question), audit_id
    except Exception as exc:  # noqa: BLE001
        duration = int(time.time() * 1000) - start_ms
        await _write_audit_log(
            conn.workspace_id, conn.id, user_id, thread_id,
            raw_query, None, QueryAuditStatus.error, str(exc), None, duration,
        )
        return f"خطا در اجرای کوئری: {exc}", None
