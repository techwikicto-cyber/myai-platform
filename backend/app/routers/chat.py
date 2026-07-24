import asyncio
import csv
import io
import json
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import AsyncSessionLocal, get_db
from app.deps import get_current_user, get_workspace_membership, require_workspace_member
from app.models.db_connection import DbConnection, DbEngine
from app.models.document import Document, DocumentKind
from app.models.pinned import PinnedMessage
from app.models.query_audit_log import QueryAuditLog, QueryAuditStatus
from app.models.thread import Message, MessageRole, Thread
from app.models.user import User, UserRole
from app.models.workspace import Workspace
from app.schemas.thread import MessageCreate, MessageOut, PinCreate, PinOut, ThreadCreate, ThreadOut, ThreadRename
from app.services.chat_context import build_messages
from app.services.db_connectors import factory
from app.services.db_chat import build_db_tools_and_context
from app.services.db_query_tool import run_tool_call
from app.services.embeddings import embed_texts
from app.services.llm import LlmError, complete_chat_with_tools, stream_chat
from app.services.memory import maybe_summarize_history
from app.services.model_config import get_embedding_config, get_llm_config, get_reviewer_llm_config
from app.services.query_review import review_sql_query
from app.services.rag import search_similar_chunks

router = APIRouter(tags=["chat"])
settings = get_settings()


# Words that signal the user is asking for real data/analytics (values, aggregates,
# rankings, lists of records). When a DB is connected and the question carries one of
# these, we force the model to actually run query_database instead of letting it decide
# — a weak model given the choice will often skip the query and fabricate a plausible
# table plus a fake "executed query". Meta questions (schema/structure) and general
# knowledge keep tool_choice="auto" so they are answered from context, not forced.
_DATA_SIGNAL_WORDS = {
    # aggregation / analytics
    "میانگین", "متوسط", "مجموع", "جمع", "تعداد", "چند", "چندتا", "بیشترین", "کمترین",
    "بالاترین", "پایین‌ترین", "برتر", "برترین", "نرخ", "درصد", "رتبه", "رتبه‌بندی",
    "روند", "توزیع", "مقایسه", "نمودار", "آمار",
    # list / record retrieval
    "لیست", "فهرست", "گزارش", "کدام", "کدامند", "کدوم", "کسانی که", "مشتریانی",
    "مشتریان", "حساب‌هایی", "حساب هایی", "رکورد",
    # domain values present in a connected DB
    "موجودی", "مانده", "سود", "درآمد", "هزینه", "کارمزد", "پرداخت", "تراکنش",
    "تراکنش‌ها", "وام", "سهم", "پرتفوی", "حقوق", "فاکتور", "سفارش",
    # english
    "sum", "total", "average", "avg", "count", "top", "list", "report", "rate",
    "percentage", "percent", "trend", "ranking", "highest", "lowest",
}
# If the question is clearly about the *structure* (schema/docs), never force a query —
# it must be answered from the injected context.
_META_HINTS = (
    "چه جدول", "جدول‌هایی", "جدول هایی", "چه ستون", "ستون‌های", "ستون های", "اسکیما",
    "ساختار دیتابیس", "ساختار جدول", "به چه دیتابیس", "چه دیتابیس", "چه اسنادی",
    "چه سندی", "چه فایل", "چه منابع", "چه مستنداتی", "چه مستندی", "مستندات در اختیار",
    "اسناد در اختیار", "دسترسی به چه", "چه دسترسی",
)


def _looks_like_resource_question(text: str) -> bool:
    return any(h in text.lower() for h in _META_HINTS)


def _looks_like_data_question(text: str) -> bool:
    """True when the question asks for real data and a DB query must run. Used to force
    tool use so the model cannot answer from imagination."""
    t = text.lower()
    if _looks_like_resource_question(t):
        return False
    return any(w in t for w in _DATA_SIGNAL_WORDS)


_COLLATE_RE = re.compile(r'\s*COLLATE\s*"[^"]*"', re.IGNORECASE)

# Above this many tables/collections, rendering full column-by-column Markdown tables
# for every one of them produces a response of tens of thousands of characters. That
# is not just unreadable — the frontend fake-streams every answer in small chunks, and
# re-rendering a Markdown document that size on every chunk visibly freezes the tab
# (this is what "قفل شدن پرامپت" turned out to be). Past this threshold, switch to a
# compact name-only listing and say so explicitly, instead of silently dumping a wall
# of text.
_MAX_ITEMS_FULL_DETAIL = 20


def _render_schema_markdown(conn: DbConnection, full: bool = False) -> str:
    """Human-readable schema listing for the deterministic resource answer: one compact
    Markdown table per DB table/collection, with the COLLATE clause stripped from column
    types. summarize_schema() (db_query_tool.py) stays as-is for the LLM prompt — dense
    comma-separated text is fine for a model to parse but unreadable for a person reading
    it directly in chat, which is what this function is for.

    full=True bypasses the item-count cap entirely — used for the downloadable export,
    which is a real file the user opens outside the chat, not something fake-streamed
    into a message bubble, so the size limit that protects the chat UI doesn't apply."""
    if not conn.schema_summary:
        return "(اسکیما هنوز استخراج نشده است — از دکمه «به‌روزرسانی اسکیما» استفاده کنید)"

    allowed = conn.allowed_tables

    if conn.engine == DbEngine.mongodb:
        colls = [
            c for c in conn.schema_summary.get("collections", [])
            if allowed is None or c["name"].lower() in {k.lower() for k in allowed}
        ]
        if not colls:
            return "(کالکشنی پیدا نشد)"
        if not full and len(colls) > _MAX_ITEMS_FULL_DETAIL:
            names = "\n".join(f"- `{c['name']}`" for c in colls)
            return (
                f"این اتصال **{len(colls)} کالکشن** دارد — برای جلوگیری از شلوغی چت، فقط نام‌ها نشان داده شد:\n\n"
                f"{names}\n\n"
                "برای دیدن فیلدهای یک کالکشن خاص، نامش را در سؤال بعدی بپرس. برای فهرست کامل با همه‌ی "
                "فیلدها، پنل «منابع» کنار چت را باز کن یا از همان‌جا فایل کامل را دانلود کن."
            )
        blocks = []
        for coll in colls:
            allowed_cols = (allowed or {}).get(coll["name"]) or (allowed or {}).get(coll["name"].lower())
            fields = {
                k: v for k, v in coll.get("sample_fields", {}).items()
                if allowed_cols is None or k in allowed_cols
            }
            rows = "\n".join(f"| `{k}` | {v} |" for k, v in fields.items())
            blocks.append(f"**کالکشن `{coll['name']}`**\n\n| فیلد | نوع |\n|---|---|\n{rows}")
        return "\n\n".join(blocks)

    tables = [
        t for t in conn.schema_summary.get("tables", [])
        if allowed is None or t["name"].lower() in {k.lower() for k in allowed}
    ]
    if not tables:
        return "(جدولی پیدا نشد)"
    if not full and len(tables) > _MAX_ITEMS_FULL_DETAIL:
        names = "\n".join(f"- `{t['name']}`" for t in tables)
        return (
            f"این اتصال **{len(tables)} جدول** دارد — نمایش کامل ستون‌های همه‌شان در چت شلوغ و کند "
            f"می‌شود، برای همین فقط نام جدول‌ها نشان داده شد:\n\n{names}\n\n"
            "برای دیدن ستون‌های یک جدول خاص، نامش را در سؤال بعدی بپرس (مثلاً «ستون‌های جدول X چیست؟»). "
            "برای فهرست کامل با همه‌ی ستون‌ها، پنل «منابع» کنار چت را باز کن یا از همان‌جا فایل کامل را دانلود کن."
        )
    blocks = []
    for table in tables:
        allowed_cols = None
        if allowed is not None:
            allowed_cols = allowed.get(table["name"]) or allowed.get(table["name"].lower())
        cols = [c for c in table.get("columns", []) if allowed_cols is None or c["name"] in allowed_cols]
        rows = "\n".join(f"| `{c['name']}` | {_COLLATE_RE.sub('', c['type']).strip()} |" for c in cols)
        blocks.append(f"**جدول `{table['name']}`**\n\n| ستون | نوع |\n|---|---|\n{rows}")
    return "\n\n".join(blocks)


def _find_mentioned_table(question: str, connections: dict[str, DbConnection]) -> str | None:
    """If the question names one specific table/collection (e.g. 'ستون‌های جدول Customers
    چیست؟'), render just that one in full even when the connection has too many
    tables for a full dump — matching what the compact-mode message tells the user
    to do. Matches on the bare name (last segment after any database.schema.
    qualification) so it works for multi-database connections too."""
    q = question.lower()
    for conn in connections.values():
        is_mongo = conn.engine == DbEngine.mongodb
        items = (conn.schema_summary or {}).get("collections" if is_mongo else "tables", [])
        for item in items:
            bare_name = item["name"].split(".")[-1].lower()
            if bare_name and bare_name in q:
                label = "کالکشن" if is_mongo else "جدول"
                if is_mongo:
                    allowed_cols = (conn.allowed_tables or {}).get(item["name"]) or (conn.allowed_tables or {}).get(item["name"].lower())
                    fields = {
                        k: v for k, v in item.get("sample_fields", {}).items()
                        if conn.allowed_tables is None or allowed_cols is None or k in allowed_cols
                    }
                    rows = "\n".join(f"| `{k}` | {v} |" for k, v in fields.items())
                    col_header = "فیلد"
                else:
                    allowed_cols = None
                    if conn.allowed_tables is not None:
                        allowed_cols = conn.allowed_tables.get(item["name"]) or conn.allowed_tables.get(item["name"].lower())
                    cols = [c for c in item.get("columns", []) if allowed_cols is None or c["name"] in allowed_cols]
                    rows = "\n".join(f"| `{c['name']}` | {_COLLATE_RE.sub('', c['type']).strip()} |" for c in cols)
                    col_header = "ستون"
                return f"**{label} `{item['name']}`** (اتصال «{conn.name}»)\n\n| {col_header} | نوع |\n|---|---|\n{rows}"
    return None


def _build_resource_listing(
    ready_docs: list[Document], connections: dict[str, DbConnection], question: str = "", full: bool = False
) -> str:
    """Renders the 'what documents/databases do you have' answer directly from live rows,
    never through the LLM. A resource question repeated in the same thread after a
    document was deleted showed the model trusting its own earlier turn (still in raw
    history) over a fresh system instruction saying the source was gone — a prompt
    cannot force compliance from a weak model. This makes the one class of question with
    an exact, structured answer immune to that failure mode: the LLM never sees this
    question, so it never gets a chance to blend in stale history.

    full=True is for the downloadable export endpoint: bypasses per-connection item caps
    and the single-table shortcut, since a file the user opens outside the chat has none
    of the chat-rendering size concerns."""
    if not full and connections and question:
        focused = _find_mentioned_table(question, connections)
        if focused is not None:
            return focused

    parts: list[str] = []
    if ready_docs:
        doc_lines = "\n".join(f"- {d.filename}" for d in ready_docs)
        parts.append(f"### اسناد موجود در این فضای کاری\n{doc_lines}")
    else:
        parts.append("### اسناد موجود در این فضای کاری\nهیچ سندی آپلود نشده است.")

    if connections:
        for name, conn in connections.items():
            parts.append(
                f"### اتصال دیتابیس «{name}» (نوع: {conn.engine.value})\n\n{_render_schema_markdown(conn, full=full)}"
            )
    else:
        parts.append("### اتصال دیتابیس\nهیچ دیتابیسی به این فضای کاری وصل نشده است.")

    return "\n\n".join(parts)


async def get_owned_thread(
    thread_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Thread:
    thread = await db.get(Thread, thread_id)
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="گفتگو پیدا نشد")
    if thread.user_id != user.id and user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="اجازه دسترسی به این گفتگو را ندارید")
    if user.role != UserRole.admin:
        membership = await get_workspace_membership(thread.workspace_id, user, db)
        if not membership:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="دیگر عضو این فضای کاری نیستید")
    return thread


@router.get("/api/workspaces/{workspace_id}/threads", response_model=list[ThreadOut])
async def list_threads(
    workspace_id: uuid.UUID,
    membership=Depends(require_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    user, _ = membership
    result = await db.execute(
        select(Thread)
        .where(Thread.workspace_id == workspace_id, Thread.user_id == user.id)
        .order_by(Thread.updated_at.desc())
    )
    return result.scalars().all()


@router.post("/api/workspaces/{workspace_id}/threads", response_model=ThreadOut, status_code=status.HTTP_201_CREATED)
async def create_thread(
    workspace_id: uuid.UUID,
    payload: ThreadCreate,
    membership=Depends(require_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    user, _ = membership
    thread = Thread(workspace_id=workspace_id, user_id=user.id, title=payload.title or "گفتگوی جدید")
    db.add(thread)
    await db.commit()
    await db.refresh(thread)
    return thread


@router.delete("/api/threads/{thread_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_thread(thread: Thread = Depends(get_owned_thread), db: AsyncSession = Depends(get_db)):
    await db.delete(thread)
    await db.commit()


@router.patch("/api/threads/{thread_id}", response_model=ThreadOut)
async def rename_thread(
    payload: ThreadRename,
    thread: Thread = Depends(get_owned_thread),
    db: AsyncSession = Depends(get_db),
):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="عنوان نمی‌تواند خالی باشد")
    thread.title = title[:255]
    await db.commit()
    await db.refresh(thread)
    return thread


@router.get("/api/threads/{thread_id}/messages", response_model=list[MessageOut])
async def list_messages(thread: Thread = Depends(get_owned_thread), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Message).where(Message.thread_id == thread.id).order_by(Message.created_at))
    messages = result.scalars().all()

    # Attach exportable query audits so the UI can offer full-result CSV download.
    audit_rows = await db.execute(
        select(QueryAuditLog.message_id, QueryAuditLog.id)
        .where(
            QueryAuditLog.thread_id == thread.id,
            QueryAuditLog.message_id.is_not(None),
            QueryAuditLog.status == QueryAuditStatus.success,
            QueryAuditLog.row_count > 0,
        )
        .order_by(QueryAuditLog.created_at)
    )
    exports_by_message: dict[uuid.UUID, list[uuid.UUID]] = {}
    for message_id, audit_id in audit_rows.all():
        exports_by_message.setdefault(message_id, []).append(audit_id)

    return [
        MessageOut(
            id=m.id,
            role=m.role,
            content=m.content,
            created_at=m.created_at,
            export_ids=exports_by_message.get(m.id, []),
        )
        for m in messages
    ]


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _stream_chunk_params(content: str) -> tuple[int, float]:
    """Chunk size/delay for the fake-typing effect used on non-LLM-streamed answers.
    Scaled so a very long response (e.g. an uncapped schema dump) can never turn into
    thousands of tiny updates — each one makes the frontend re-render the whole
    growing Markdown string from scratch, and enough of them in a row visibly freezes
    the tab. Caps the total number of chunks to roughly 150 regardless of length."""
    if len(content) <= 2000:
        return 12, 0.015
    return max(12, len(content) // 150), 0.008


# How often to send an SSE keep-alive comment while no real chunk is ready yet. A data
# question can spend well over a minute with zero bytes sent to the client — the initial
# LLM call, the insist-retry, every DB query in the multi-round tool loop, every
# reviewer-LLM call, and every between-round LLM call all happen before anything is
# streamed. nginx's proxy_read_timeout (idle time between reads from upstream, commonly
# 300s but can be tuned lower) then kills the connection, which the browser reports as a
# broken/corrupted HTTP/2 stream rather than a clean timeout error. A short SSE comment
# line (starts with ":", which every SSE/our own parser ignores) keeps bytes flowing.
_HEARTBEAT_INTERVAL_SECONDS = 15


@router.post("/api/threads/{thread_id}/messages")
async def send_message(
    payload: MessageCreate,
    thread: Thread = Depends(get_owned_thread),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    workspace = await db.get(Workspace, thread.workspace_id)
    if not workspace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="فضای کاری پیدا نشد")

    user_message = Message(thread_id=thread.id, role=MessageRole.user, content=payload.content)
    db.add(user_message)
    await db.commit()

    history_result = await db.execute(
        select(Message).where(Message.thread_id == thread.id).order_by(Message.created_at)
    )
    history = history_result.scalars().all()[:-1]  # exclude the just-added user message; passed separately

    llm_config = await get_llm_config(db)
    reviewer_config = await get_reviewer_llm_config(db)

    history = await maybe_summarize_history(thread, history, llm_config)
    await db.commit()

    query_vector: list[float] | None = None
    try:
        embedding_config = await get_embedding_config(db)
        query_vector = (await embed_texts(embedding_config, [payload.content]))[0]
    except Exception:  # noqa: BLE001
        query_vector = None  # RAG/DB-tooling is best-effort; chat still works without it

    extra_context = None
    has_retrieved_document_evidence = False
    if query_vector is not None:
        try:
            chunks = await search_similar_chunks(
                thread.workspace_id, query_vector, db, query_text=payload.content
            )
            if chunks:
                has_retrieved_document_evidence = True
                parts = [f"【منبع: {c.filename}】\n{c.content}" for c in chunks]
                extra_context = "\n\n".join(parts)
        except Exception:  # noqa: BLE001
            extra_context = None

    db_tools, db_context, db_connections_by_name = await build_db_tools_and_context(
        thread.workspace_id, query_vector, db, query_text=payload.content
    )
    if db_context:
        extra_context = f"{extra_context}\n\n{db_context}" if extra_context else db_context

    # Always tell the model exactly which real sources exist, so it never invents
    # documents or database tables when the workspace is empty.
    doc_result = await db.execute(
        select(Document).where(
            Document.workspace_id == thread.workspace_id,
            Document.kind == DocumentKind.workspace_doc,
            Document.status == "ready",
        )
    )
    ready_docs = list(doc_result.scalars().all())

    # "What documents/databases do you have" has one exact, structured answer that lives
    # entirely in rows we already queried. Build it here and skip the LLM for this turn
    # entirely — a resource question repeated after a document was deleted showed the
    # model repeating its own earlier turn (still sitting in raw history) instead of
    # honoring a fresh system instruction that the source was gone. No prompt can
    # guarantee a weak model won't do that again; not calling the LLM at all does.
    resource_answer = (
        _build_resource_listing(ready_docs, db_connections_by_name, question=payload.content)
        if _looks_like_resource_question(payload.content)
        else None
    )

    if ready_docs:
        doc_list = "\n".join(f"- {d.filename}" for d in ready_docs)
        doc_index = f"فایل‌های آپلود‌شده و پردازش‌شده در این فضای کاری:\n{doc_list}"
        extra_context = f"{doc_index}\n\n{extra_context}" if extra_context else doc_index

    if not ready_docs and not db_connections_by_name:
        inventory = (
            "وضعیت قطعی و فعلی این فضای کاری: هیچ سند و هیچ دیتابیسی اضافه نشده است. "
            "اگر کاربر درباره اسناد، جداول، فیلدها یا داده‌های موجود پرسید، صریح بگو که هنوز هیچ سند یا "
            "دیتابیسی اضافه نشده است و هرگز جدول، فیلد، سند یا داده‌ی نمونه/فرضی از خودت نساز."
        )
        extra_context = f"{inventory}\n\n{extra_context}" if extra_context else inventory

    # Belt-and-suspenders against stale sources: a document can be deleted mid-thread.
    # thread.memory_summary is cleared on delete (see documents.py), but the raw recent
    # history built below still carries whatever the assistant said about it earlier in
    # this same conversation, until it ages out of the token budget. The list above is
    # the only current truth — anything else about documents/tables in earlier turns of
    # this conversation is stale and must not be repeated.
    staleness_note = (
        "هشدار مهم: فهرست اسناد و اتصال‌های دیتابیسِ بالا، تنها منابع معتبر و موجود همین الان "
        "هستند. اگر در پیام‌های قبلی همین گفتگو یا در خلاصه مکالمات، ادعایی درباره سند، جدول یا "
        "دیتابیسی شده که در این فهرست فعلی نیست، آن منبع حذف شده یا از اول ساختگی بوده — آن ادعا "
        "را کاملاً نادیده بگیر و تکرارش نکن."
    )
    extra_context = f"{extra_context}\n\n{staleness_note}" if extra_context else staleness_note

    messages = (
        [] if resource_answer is not None
        else build_messages(workspace, history, thread.memory_summary, extra_context, payload.content)
    )

    async def produce(queue: asyncio.Queue) -> None:
        # The tool-retry branch replaces the message list with an augmented copy.
        # Declare the enclosing value explicitly; otherwise Python treats every
        # reference in this coroutine as a local variable and fails before the
        # first model call.
        nonlocal messages
        full_content = ""
        completed = False
        audit_ids: list[uuid.UUID] = []
        successful_query_count = 0

        async def link_audits(message_id: uuid.UUID) -> None:
            if not audit_ids:
                return
            await db.execute(
                update(QueryAuditLog)
                .where(QueryAuditLog.id.in_(audit_ids))
                .values(message_id=message_id)
            )
            await db.commit()

        MAX_TOOL_ROUNDS = 5

        try:
            if resource_answer is not None:
                # Deterministic path: never call the LLM, so it has no chance to blend
                # in a stale document/table name from earlier in this same thread's
                # raw history.
                full_content = resource_answer
                _CHUNK, _DELAY = _stream_chunk_params(full_content)
                for i in range(0, len(full_content), _CHUNK):
                    await queue.put(_sse({"type": "token", "content": full_content[i : i + _CHUNK]}))
                    await asyncio.sleep(_DELAY)
            elif db_tools:
                # For data questions, force the model to actually run a query this turn
                # (tool_choice="required") so it cannot skip the DB and fabricate a table.
                # Gracefully fall back to "auto" if the model gateway rejects forcing.
                # Keyword detection catches common analytical questions. In strict
                # workspaces, an otherwise unclassified question with no retrieved
                # document evidence is also treated as a data question: refusing or
                # querying is safer than answering it from the model's memory.
                force_query = (
                    _looks_like_data_question(payload.content)
                    or (
                        workspace.answer_mode == "strict"
                        and not _looks_like_resource_question(payload.content)
                        and not has_retrieved_document_evidence
                    )
                )
                forced_supported = True
                try:
                    content, tool_calls = await complete_chat_with_tools(
                        llm_config, messages, db_tools,
                        tool_choice="required" if force_query else "auto",
                    )
                except Exception:  # noqa: BLE001 — gateway may not support forced tool_choice
                    if force_query:
                        forced_supported = False
                        content, tool_calls = await complete_chat_with_tools(
                            llm_config, messages, db_tools, tool_choice="auto"
                        )
                    else:
                        raise

                # Manual enforcement guard: if this is a data question but the model still
                # answered without querying (weak model, or a gateway that silently ignores
                # tool_choice="required"), insist once more with an explicit instruction.
                # This makes correctness independent of whether the gateway honours forcing.
                if force_query and not tool_calls:
                    insist_messages = messages + [{
                        "role": "system",
                        "content": (
                            "این یک سوال داده‌ای است و پاسخ بدون اجرای کوئری قابل قبول نیست. "
                            "همین حالا ابزار query_database را با یک کوئری معتبر صدا بزن و فقط از "
                            "نتیجه‌ی واقعیِ آن پاسخ بده. هیچ عدد، نام، شعبه یا ردیفی از حافظه ننویس."
                        ),
                    }]
                    try:
                        content, tool_calls = await complete_chat_with_tools(
                            llm_config, insist_messages, db_tools,
                            tool_choice="required" if forced_supported else "auto",
                        )
                    except Exception:  # noqa: BLE001
                        content, tool_calls = await complete_chat_with_tools(
                            llm_config, insist_messages, db_tools, tool_choice="auto"
                        )
                    if tool_calls:
                        messages = insist_messages

                if not tool_calls:
                    if force_query:
                        # A data question with no query executed: never show fabricated
                        # numbers/tables. Be honest instead of inventing data.
                        content = (
                            "برای پاسخ به این سوال باید روی دیتابیس کوئری اجرا می‌شد، اما مدل زبانی "
                            "این کار را انجام نداد. برای جلوگیری از نمایش داده‌ی نادرست، پاسخی ساخته "
                            "نشد. لطفاً دوباره بپرس یا سوال را کمی دقیق‌تر بیان کن. اگر این مشکل تکرار "
                            "شد، مدل زبانیِ متصل در فراخوانی ابزار (function calling) به‌خوبی پشتیبانی "
                            "نمی‌کند و باید مدل قوی‌تری انتخاب شود."
                        )
                    # LLM produced a direct answer (or the honest fallback above) — fake-stream
                    # it in small chunks for a consistent typing UX. No extra LLM call.
                    full_content = content
                    _CHUNK, _DELAY = _stream_chunk_params(content)
                    for i in range(0, len(content), _CHUNK):
                        await queue.put(_sse({"type": "token", "content": content[i : i + _CHUNK]}))
                        await asyncio.sleep(_DELAY)
                else:
                    # ── Multi-round agentic tool-call loop ──────────────────────────────
                    # Allows the LLM to run a corrective follow-up query when the first
                    # result is raw/wrong (e.g. returns rows instead of aggregated values).
                    #
                    # IMPORTANT: rounds_used alone does not bound how much text gets
                    # appended to `messages`. Each round can add a full tool-result table,
                    # and previously this had no cap — long/expensive result sets across a
                    # few rounds could push the final prompt (system context + history +
                    # all tool results) past the underlying model's context window. Many
                    # OpenAI-compatible gateways silently truncate an over-long prompt from
                    # the left instead of erroring, which drops the actual data while
                    # leaving trailing instructions intact — the model then produces a
                    # fluent but fabricated answer instead of failing loudly. We now track
                    # cumulative tool-result size and stop pulling in more data once the
                    # budget is spent, forcing a final answer from whatever was retrieved
                    # so far (with a nudge to say so if it's insufficient).
                    rounds_used = 0
                    tool_result_chars_used = 0
                    budget_exhausted = False
                    while tool_calls and rounds_used < MAX_TOOL_ROUNDS and not budget_exhausted:
                        rounds_used += 1
                        messages.append(
                            {
                                "role": "assistant",
                                "content": content or None,
                                "tool_calls": [
                                    {
                                        "id": tc["id"],
                                        "type": "function",
                                        "function": {"name": tc["name"], "arguments": tc["arguments"]},
                                    }
                                    for tc in tool_calls
                                ],
                            }
                        )
                        for tc in tool_calls:
                            if tool_result_chars_used >= settings.max_tool_result_chars_per_turn:
                                # Budget already spent by an earlier tool call in this same
                                # round — still respond to every pending tool_call id (the
                                # API requires one tool message per call) but don't run it.
                                budget_exhausted = True
                                messages.append({
                                    "role": "tool",
                                    "tool_call_id": tc["id"],
                                    "content": (
                                        "این کوئری اجرا نشد: سقف حجم داده‌ی قابل بارگذاری در همین "
                                        "پاسخ برای این پیام تمام شده است. با داده‌های به‌دست‌آمده تا "
                                        "همین‌جا پاسخ بده و اگر کافی نبود، صریح بگو که نتیجه ناقص است "
                                        "و کاربر باید سوال را محدودتر (مثلاً با فیلتر یا بازه زمانی) "
                                        "دوباره بپرسد."
                                    ),
                                })
                                continue

                            # Optional second-opinion review (best-effort): before running the
                            # query, ask the reviewer model whether it actually answers the
                            # user's question — catches logic errors (wrong JOIN, missing
                            # filter, wrong aggregation) that execute successfully and so slip
                            # past every other guard. The reviewer only ever flags a concern; it
                            # never executes or rewrites anything, and final judgment stays with
                            # the main model in the next round.
                            review_concern = None
                            if reviewer_config is not None:
                                try:
                                    review_args = json.loads(tc["arguments"])
                                    review_conn = db_connections_by_name.get(review_args.get("connection_name"))
                                    if review_conn is None and len(db_connections_by_name) == 1:
                                        review_conn = next(iter(db_connections_by_name.values()))
                                    if review_conn is not None and review_args.get("query"):
                                        review_concern = await review_sql_query(
                                            reviewer_config, payload.content, review_args["query"], review_conn,
                                        )
                                except Exception:  # noqa: BLE001 — review is best-effort only
                                    review_concern = None

                            if review_concern:
                                messages.append({
                                    "role": "tool",
                                    "tool_call_id": tc["id"],
                                    "content": (
                                        f"این کوئری هنوز اجرا نشده. یک بازبینِ جداگانه این نگرانی را "
                                        f"مطرح کرد: «{review_concern}». با توجه به سؤال کاربر و اسکیما "
                                        "بررسی کن که آیا این نگرانی درست است؛ اگر درست بود کوئری را "
                                        "اصلاح و دوباره اجرا کن، در غیر این صورت با همین کوئری ادامه بده."
                                    ),
                                })
                                continue

                            tool_result, audit_id, result_chars = await run_tool_call(
                                db_connections_by_name, tc["arguments"],
                                user_id=user.id, thread_id=thread.id, user_question=payload.content,
                            )
                            if audit_id:
                                audit_ids.append(audit_id)
                                successful_query_count += 1
                            tool_result_chars_used += result_chars
                            if tool_result_chars_used >= settings.max_tool_result_chars_per_turn:
                                budget_exhausted = True
                            messages.append({"role": "tool", "tool_call_id": tc["id"], "content": tool_result})

                        # Ask the LLM: do you need another query or is the answer ready?
                        if rounds_used < MAX_TOOL_ROUNDS and not budget_exhausted:
                            content, tool_calls = await complete_chat_with_tools(llm_config, messages, db_tools)
                        else:
                            break  # safety cap — force final streaming answer
                    # ────────────────────────────────────────────────────────────────────

                    # If every generated query failed or was rejected, never ask
                    # the model to "answer anyway". The database has provided no
                    # evidence, so a deterministic refusal is the only truthful
                    # response.
                    if force_query and successful_query_count == 0:
                        full_content = (
                            "هیچ کوئری معتبری با موفقیت اجرا نشد؛ بنابراین برای جلوگیری از "
                            "پاسخ نادرست، نتیجه‌ای اعلام نمی‌کنم. لطفاً اتصال، اسکیمای به‌روزشده "
                            "و سطح دسترسی جدول‌ها را بررسی کنید و سؤال را دوباره بپرسید."
                        )
                        _CHUNK, _DELAY = _stream_chunk_params(full_content)
                        for i in range(0, len(full_content), _CHUNK):
                            await queue.put(_sse({"type": "token", "content": full_content[i : i + _CHUNK]}))
                            await asyncio.sleep(_DELAY)
                    else:
                        # Stream the final answer with all tool results in context.
                        async for event in stream_chat(llm_config, messages):
                            if event["type"] == "token":
                                full_content += event["content"]
                                await queue.put(_sse({"type": "token", "content": event["content"]}))
            elif (
                workspace.answer_mode == "strict"
                and not has_retrieved_document_evidence
                and not _looks_like_resource_question(payload.content)
            ):
                # No DB is connected here (db_tools is empty), so the only possible
                # grounding is retrieved document evidence. AnythingLLM's "query mode"
                # makes this exact check in code — zero retrieved chunks means the LLM
                # is never even called — rather than trusting a prompt instruction to
                # make the model admit it doesn't know. We mirror that: a hard,
                # deterministic refusal beats hoping a weak model stays honest.
                full_content = (
                    "در اسناد این فضای کاری هیچ محتوای مرتبطی با این سوال پیدا نشد. چون این فضای "
                    "کاری در حالت «سخت‌گیرانه» است، به‌جای حدس‌زدن پاسخی داده نمی‌شود. سند مرتبط را "
                    "آپلود کنید یا حالت پاسخ‌دهی این فضای کاری را به «باز» تغییر دهید."
                )
                _CHUNK, _DELAY = _stream_chunk_params(full_content)
                for i in range(0, len(full_content), _CHUNK):
                    await queue.put(_sse({"type": "token", "content": full_content[i : i + _CHUNK]}))
                    await asyncio.sleep(_DELAY)
            else:
                async for event in stream_chat(llm_config, messages):
                    if event["type"] == "token":
                        full_content += event["content"]
                        await queue.put(_sse({"type": "token", "content": event["content"]}))

            # Normal completion — save and signal done.
            assistant_message = Message(thread_id=thread.id, role=MessageRole.assistant, content=full_content)
            db.add(assistant_message)
            if thread.title == "گفتگوی جدید":
                thread.title = payload.content[:60]
            await db.commit()
            await db.refresh(assistant_message)
            await link_audits(assistant_message.id)
            completed = True
            await queue.put(_sse({
                "type": "done",
                "message_id": str(assistant_message.id),
                "export_ids": [str(a) for a in audit_ids],
            }))

        except LlmError as exc:
            await queue.put(_sse({"type": "error", "message": str(exc)}))
        except Exception as exc:  # noqa: BLE001
            await queue.put(_sse({"type": "error", "message": f"خطا در ارتباط با مدل زبانی: {exc}"}))
        finally:
            # Client disconnected mid-stream: event_stream() cancels this task, which
            # raises CancelledError here — Python still runs this finally block, so
            # partial content is saved exactly as when this was a plain generator
            # receiving GeneratorExit at its current yield.
            if not completed and full_content:
                try:
                    async with AsyncSessionLocal() as temp_db:
                        partial = Message(thread_id=thread.id, role=MessageRole.assistant, content=full_content)
                        temp_db.add(partial)

                        # Update thread title if needed
                        if thread.title == "گفتگوی جدید":
                            t = await temp_db.get(Thread, thread.id)
                            if t:
                                t.title = payload.content[:60]

                        await temp_db.commit()
                        await temp_db.refresh(partial)

                        # Link audits if any
                        if audit_ids:
                            await temp_db.execute(
                                update(QueryAuditLog)
                                .where(QueryAuditLog.id.in_(audit_ids))
                                .values(message_id=partial.id)
                            )
                            await temp_db.commit()
                except Exception as e:
                    import logging
                    logging.error(f"Failed to save partial message on disconnect: {e}")
            await queue.put(None)  # sentinel: tells event_stream() no more chunks are coming

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()
        producer = asyncio.create_task(produce(queue))
        try:
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_INTERVAL_SECONDS)
                except asyncio.TimeoutError:
                    # Nothing real to send yet (producer is mid-LLM-call/DB-query/reviewer-
                    # call) — an SSE comment line keeps nginx from seeing an idle upstream.
                    yield ": keep-alive\n\n"
                    continue
                if item is None:
                    break
                yield item
        finally:
            if not producer.done():
                producer.cancel()
                try:
                    await producer
                except asyncio.CancelledError:
                    pass

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/api/messages/{message_id}/pin", response_model=PinOut, status_code=status.HTTP_201_CREATED)
async def pin_message(
    message_id: uuid.UUID,
    payload: PinCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    message = await db.get(Message, message_id)
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="پیام پیدا نشد")

    thread = await db.get(Thread, message.thread_id)
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="گفتگو پیدا نشد")

    if user.role != UserRole.admin:
        membership = await get_workspace_membership(thread.workspace_id, user, db)
        if not membership:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="دسترسی ندارید")

    pin = PinnedMessage(
        workspace_id=thread.workspace_id,
        message_id=message_id,
        user_id=user.id,
        question_snapshot=payload.question_snapshot,
        content_snapshot=payload.content_snapshot,
    )
    db.add(pin)
    await db.commit()
    await db.refresh(pin)
    return pin


@router.get("/api/workspaces/{workspace_id}/pins", response_model=list[PinOut])
async def list_pins(
    workspace_id: uuid.UUID,
    membership=Depends(require_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    user, _ = membership
    result = await db.execute(
        select(PinnedMessage)
        .where(PinnedMessage.workspace_id == workspace_id, PinnedMessage.user_id == user.id)
        .order_by(PinnedMessage.created_at.desc())
    )
    return result.scalars().all()


@router.delete("/api/pins/{pin_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pin(
    pin_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pin = await db.get(PinnedMessage, pin_id)
    if not pin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="پین پیدا نشد")
    if pin.user_id != user.id and user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="دسترسی ندارید")
    await db.delete(pin)
    await db.commit()


@router.get("/api/query-audits/{audit_id}/export")
async def export_query_result(
    audit_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Re-runs an audited read-only query with the (much higher) export row limit
    and streams the full result as CSV. The in-chat table stays capped so the LLM
    context doesn't blow up; this endpoint is how users get the complete data."""
    audit = await db.get(QueryAuditLog, audit_id)
    if not audit or audit.status != QueryAuditStatus.success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="نتیجه‌ای برای دانلود پیدا نشد")
    if audit.user_id != user.id and user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="اجازه دانلود این نتیجه را ندارید")
    if not audit.db_connection_id:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="اتصال دیتابیس این کوئری حذف شده است")

    conn = await db.get(DbConnection, audit.db_connection_id)
    if not conn:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="اتصال دیتابیس این کوئری حذف شده است")

    query: str | dict = audit.raw_query
    if conn.engine == DbEngine.mongodb:
        try:
            query = json.loads(audit.raw_query)
        except json.JSONDecodeError:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="کوئری ثبت‌شده معتبر نیست")

    try:
        # Connectors re-validate read-only safety internally on every execution.
        result = await factory.execute_query(
            conn, query,
            row_limit=settings.db_export_row_limit,
            timeout=settings.db_export_timeout_seconds,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"اجرای مجدد کوئری ناموفق بود: {exc}")

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(result.columns)
    for row in result.rows:
        writer.writerow(["" if row.get(c) is None else row.get(c) for c in result.columns])

    csv_bytes = ("\ufeff" + buf.getvalue()).encode("utf-8")  # BOM so Excel opens UTF-8 Persian correctly
    filename = f"report-{audit_id.hex[:8]}.csv"
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/workspaces/{workspace_id}/resources/export")
async def export_resources(
    workspace_id: uuid.UUID,
    membership=Depends(require_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    """Full, uncapped documents+schema listing as a downloadable Markdown file \u2014 the
    counterpart to the in-chat resource answer, which caps large connections (200+
    tables) to keep the chat itself readable and fast. This is what the compact-mode
    message points to when it says "\u062f\u0627\u0646\u0644\u0648\u062f \u0641\u0627\u06cc\u0644 \u06a9\u0627\u0645\u0644"."""
    doc_result = await db.execute(
        select(Document).where(
            Document.workspace_id == workspace_id,
            Document.kind == DocumentKind.workspace_doc,
            Document.status == "ready",
        )
    )
    ready_docs = list(doc_result.scalars().all())

    conn_result = await db.execute(select(DbConnection).where(DbConnection.workspace_id == workspace_id))
    connections = {c.name: c for c in conn_result.scalars().all()}

    content = _build_resource_listing(ready_docs, connections, full=True)
    md_bytes = ("\ufeff" + content).encode("utf-8")
    return Response(
        content=md_bytes,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="resources.md"'},
    )
