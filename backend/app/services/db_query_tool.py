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
# Per-call cap on how much of a single query result is embedded into the LLM
# prompt. Kept modest (much smaller than the old 20000) because this text is
# added to the *same* prompt as the schema, grounding rules, and conversation
# history — several large results in one multi-round turn can otherwise push
# the total prompt past the model's context window. Full results are always
# available to the user via the CSV export endpoint, independent of this cap.
MAX_RESULT_CHARS = 4000

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
                "اجرای یک کوئری فقط-خواندنی روی دیتابیس متصل به این فضای کاری. "
                "تو باید برای پاسخ به هر سوالی درباره داده‌ها، آمار، مشتریان، فاکتورها، "
                "تراکنش‌ها، درآمد، هزینه یا هرگونه اطلاعات عددی از این ابزار استفاده کنی. "
                "هرگز بدون استفاده از این ابزار به سوالات داده‌ای پاسخ نده. "
                "بعد از دریافت نتیجه، حتماً متن کوئری اجراشده را هم در پاسخ نمایش بده. "
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
        return (
            "کوئری اجرا شد اما هیچ ردیفی برنگشت. "
            "(راهنما: اگر مطمئنی داده‌ای باید وجود داشته باشد، ممکن است شرط‌های WHERE، "
            "نوع JOINها یا مقادیر فیلتر خیلی سخت‌گیرانه یا اشتباه بوده باشد. لطفاً کوئری "
            "را اصلاح کرده و مجدداً امتحان کن.)"
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

    # Aggregation hint: warn if many raw rows returned for an analytical question,
    # but still return the data so the LLM can answer correctly.
    _looks_aggregated = any(
        col.lower() in {"sum", "total", "count", "avg", "average", "min", "max"}
        or col.lower().startswith(("sum_", "total_", "count_", "avg_"))
        for col in result.columns
    )
    if (
        len(result.rows) > 20
        and any(w in user_question for w in AGGREGATION_HINT_WORDS)
        and not _looks_aggregated
    ):
        table += (
            f"\n\n(راهنما: این کوئری {len(result.rows)} ردیف خام برگرداند. "
            "اگر هدف محاسبه جمع/میانگین/تعداد است، یک کوئری با SUM/AVG/COUNT/GROUP BY بنویس "
            "تا عدد نهایی مستقیم از دیتابیس برگردد.)"
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
) -> tuple[str, uuid.UUID | None, int]:
    """Executes one query_database tool call.

    Returns (result_text_for_llm, audit_id, result_text_char_len). audit_id is
    set only for successfully executed queries, so the caller can link it to
    the saved assistant message and offer a full-result CSV export.
    result_text_char_len lets the caller enforce a cumulative character
    budget across multiple tool-calling rounds within the same turn, so a
    single request can never silently balloon the prompt past the model's
    context window."""
    try:
        arguments = json.loads(arguments_json)
    except json.JSONDecodeError:
        msg = "خطا: آرگومان‌های ارسال‌شده برای ابزار کوئری، JSON معتبر نیستند."
        return msg, None, len(msg)

    connection_name = arguments.get("connection_name")
    query = arguments.get("query")
    conn = connections_by_name.get(connection_name)
    if not conn:
        if len(connections_by_name) == 1:
            conn = next(iter(connections_by_name.values()))
        else:
            msg = f"خطا: اتصال دیتابیسی با نام «{connection_name}» پیدا نشد."
            return msg, None, len(msg)

    if not query:
        msg = "خطا: کوئری ارسال نشده است."
        return msg, None, len(msg)

    raw_query = query
    parsed_query: str | dict = query
    start_ms = int(time.time() * 1000)

    if conn.engine == DbEngine.mongodb:
        try:
            parsed_query = json.loads(query)
        except json.JSONDecodeError:
            msg = "خطا: برای MongoDB باید کوئری به‌صورت JSON معتبر ارسال شود."
            return msg, None, len(msg)
        # Allowlist check for MongoDB collection
        try:
            if conn.allowed_tables is not None:
                ensure_allowed_mongo_collection(parsed_query, conn.allowed_tables)
        except QuerySafetyError as exc:
            await _write_audit_log(
                conn.workspace_id, conn.id, user_id, thread_id,
                raw_query, None, QueryAuditStatus.rejected, str(exc), None, None,
            )
            msg = f"خطای امنیتی: {exc}"
            return msg, None, len(msg)
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
            msg = f"خطای امنیتی: {exc}"
            return msg, None, len(msg)

    try:
        result = await factory.execute_query(
            conn, parsed_query, row_limit=settings.db_query_row_limit, timeout=settings.db_query_timeout_seconds
        )
        duration = int(time.time() * 1000) - start_ms
        audit_id = await _write_audit_log(
            conn.workspace_id, conn.id, user_id, thread_id,
            raw_query, None, QueryAuditStatus.success, None, len(result.rows), duration,
        )
        result_text = format_query_result(result, user_question)
        # Prepend the executed query so the LLM can display it to the user
        query_display = raw_query if isinstance(raw_query, str) else json.dumps(raw_query, ensure_ascii=False)
        result_text = f"کوئری اجراشده:\n```\n{query_display}\n```\n\nنتیجه:\n{result_text}"
        return result_text, audit_id, len(result_text)
    except Exception as exc:  # noqa: BLE001
        duration = int(time.time() * 1000) - start_ms
        await _write_audit_log(
            conn.workspace_id, conn.id, user_id, thread_id,
            raw_query, None, QueryAuditStatus.error, str(exc), None, duration,
        )
        # SQL auto-repair: hand the real database error back to the model with an
        # explicit instruction to diagnose, fix, and re-run in a fresh tool call.
        # The multi-round agentic loop in the chat router lets it retry.
        err_text = str(exc).strip()
        query_display = raw_query if isinstance(raw_query, str) else json.dumps(raw_query, ensure_ascii=False)
        msg = (
            "اجرای کوئری با خطا مواجه شد.\n"
            f"کوئری اجراشده:\n```\n{query_display}\n```\n"
            f"متن دقیق خطای دیتابیس:\n{err_text}\n\n"
            "این خطا را تحلیل کن و علت را پیدا کن (مثلاً نام ستون یا جدول اشتباه، خطای سینتکس، نوع JOIN، "
            "نام مستعار، یا فرمت تاریخ)، سپس کوئری اصلاح‌شده را بلافاصله با یک فراخوانی جدید query_database "
            "اجرا کن. برای پیداکردن نام درست ستون‌ها و جدول‌ها به اسکیمای «منابع مرتبط» رجوع کن و از خودت "
            "ستون نساز. اگر بعد از چند تلاش همچنان خطا داشت، به کاربر بگو کوئری قابل اجرا نشد و دلیل را کوتاه توضیح بده."
        )
        return msg, None, len(msg)
