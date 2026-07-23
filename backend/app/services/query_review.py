import asyncio
import json

from app.config import get_settings
from app.models.db_connection import DbConnection, DbEngine
from app.services.llm import complete_chat
from app.services.model_config import LlmConfig
from app.services.query_safety import extract_referenced_tables

settings = get_settings()

_REVIEW_SYSTEM_PROMPT = (
    "تو یک بازبینِ SQL هستی. فقط بررسی کن که آیا کوئریِ داده‌شده واقعاً به سؤال کاربر جواب "
    "می‌دهد یا نه (JOIN اشتباه، شرط WHERE فراموش‌شده، GROUP BY یا تجمیع نادرست). خودت هیچ "
    "کوئری‌ای اجرا نمی‌کنی و اجازه‌ی بازنویسی نداری — فقط تحلیل می‌کنی. "
    "فقط یک JSON با این شکل دقیق برگردان، بدون هیچ متن اضافه: "
    '{"ok": true} یا {"ok": false, "issue": "توضیح کوتاه مشکل"}'
)


def _minimal_schema_snippet(conn: DbConnection, sql: str) -> str:
    """Only the tables actually referenced in this query — not the whole DB schema.
    Keeps the reviewer's prompt small on purpose: it was flagged to have a smaller
    context window and fewer parameters than the main model, so less (but relevant)
    context lowers its own chance of getting confused or hallucinating a false concern."""
    if not conn.schema_summary or conn.engine == DbEngine.mongodb:
        return "(اسکیما در دسترس نیست)"
    referenced = extract_referenced_tables(sql)
    lines = []
    for table in conn.schema_summary.get("tables", []):
        if referenced and table["name"].lower() not in referenced:
            continue
        cols = ", ".join(f"{c['name']}:{c['type']}" for c in table.get("columns", []))
        lines.append(f"- {table['name']}: {cols}")
    return "\n".join(lines) or "(جدول مرتبطی در اسکیما پیدا نشد)"


async def review_sql_query(
    reviewer_config: LlmConfig | None,
    user_question: str,
    sql: str,
    conn: DbConnection,
) -> str | None:
    """Best-effort second-opinion check of a generated SQL query, run by a separate
    (smaller/weaker) model before execution. Returns None when the query looks fine, the
    reviewer isn't configured, or the reviewer call fails/times out for any reason — the
    caller then proceeds with the original query exactly as if no reviewer existed.

    Returns a short Persian description of the concern when the reviewer flags one. The
    caller must NOT execute the flagged query or trust any rewrite from the reviewer —
    only hand the concern back to the main (stronger) model so it decides how to react.
    Never raises."""
    if reviewer_config is None or not reviewer_config.base_url or conn.engine == DbEngine.mongodb:
        return None

    schema_snippet = _minimal_schema_snippet(conn, sql)
    review_messages = [
        {"role": "system", "content": _REVIEW_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"سؤال کاربر:\n{user_question}\n\n"
                f"اسکیمای جدول‌های مرتبط:\n{schema_snippet}\n\n"
                f"کوئری تولیدشده:\n{sql}"
            ),
        },
    ]

    try:
        raw = await asyncio.wait_for(
            complete_chat(reviewer_config, review_messages, temperature=0),
            timeout=settings.reviewer_timeout_seconds,
        )
    except Exception:  # noqa: BLE001 — reviewer is optional; never block the main flow
        return None

    try:
        # Reviewer may wrap the JSON in prose despite instructions; take the outermost braces.
        start, end = raw.index("{"), raw.rindex("}") + 1
        data = json.loads(raw[start:end])
    except Exception:  # noqa: BLE001 — unparseable response is treated as "no concern raised"
        return None

    if data.get("ok") is False:
        issue = str(data.get("issue") or "").strip() or "دلیل مشخصی ذکر نشد"
        return issue
    return None
