import json

from app.config import get_settings
from app.models.db_connection import DbConnection, DbEngine
from app.services.db_connectors import factory
from app.services.db_connectors.base import QueryResult

settings = get_settings()

TOOL_NAME = "query_database"

MAX_RESULT_CHARS = 4000


def summarize_schema(conn: DbConnection) -> str:
    if not conn.schema_summary:
        return "(اسکیما هنوز استخراج نشده است — از دکمه «به‌روزرسانی اسکیما» استفاده کنید)"

    if conn.engine == DbEngine.mongodb:
        lines = []
        for coll in conn.schema_summary.get("collections", []):
            fields = ", ".join(f"{k}:{v}" for k, v in coll.get("sample_fields", {}).items())
            lines.append(f"- کالکشن {coll['name']}: {fields}")
        return "\n".join(lines) or "(کالکشنی پیدا نشد)"

    lines = []
    for table in conn.schema_summary.get("tables", []):
        cols = ", ".join(f"{c['name']}:{c['type']}" for c in table.get("columns", []))
        lines.append(f"- جدول {table['name']}: {cols}")
    return "\n".join(lines) or "(جدولی پیدا نشد)"


def build_tool_schema(connection_names: list[str], has_mongo: bool, has_sql: bool) -> dict:
    query_desc = []
    if has_sql:
        query_desc.append(
            'برای دیتابیس‌های SQL: یک عبارت خواندنی SELECT معتبر (رشته متن ساده، بدون JSON)، مثلا "SELECT * FROM orders WHERE ..."'
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


def format_query_result(result: QueryResult) -> str:
    if not result.rows:
        return "کوئری اجرا شد اما هیچ ردیفی برنگشت."

    header = " | ".join(result.columns)
    separator = " | ".join("---" for _ in result.columns)
    body_lines = []
    for row in result.rows:
        body_lines.append(" | ".join(str(row.get(c, "")) for c in result.columns))
    table = "\n".join([header, separator, *body_lines])

    if len(table) > MAX_RESULT_CHARS:
        table = table[:MAX_RESULT_CHARS] + "\n... (خروجی به دلیل حجم بالا کوتاه شد)"
    if result.truncated:
        table += f"\n\n(توجه: نتایج به {len(result.rows)} ردیف اول محدود شده است)"
    return table


async def run_tool_call(connections_by_name: dict[str, DbConnection], arguments_json: str) -> str:
    try:
        arguments = json.loads(arguments_json)
    except json.JSONDecodeError:
        return "خطا: آرگومان‌های ارسال‌شده برای ابزار کوئری، JSON معتبر نیستند."

    connection_name = arguments.get("connection_name")
    query = arguments.get("query")
    conn = connections_by_name.get(connection_name)
    if not conn:
        if len(connections_by_name) == 1:
            conn = next(iter(connections_by_name.values()))
        else:
            return f"خطا: اتصال دیتابیسی با نام «{connection_name}» پیدا نشد."

    if not query:
        return "خطا: کوئری ارسال نشده است."

    parsed_query: str | dict = query
    if conn.engine == DbEngine.mongodb:
        try:
            parsed_query = json.loads(query)
        except json.JSONDecodeError:
            return "خطا: برای MongoDB باید کوئری به‌صورت JSON معتبر ارسال شود."

    try:
        result = await factory.execute_query(
            conn, parsed_query, row_limit=settings.db_query_row_limit, timeout=settings.db_query_timeout_seconds
        )
        return format_query_result(result)
    except Exception as exc:  # noqa: BLE001
        return f"خطا در اجرای کوئری: {exc}"
