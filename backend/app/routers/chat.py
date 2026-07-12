import csv
import io
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
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
from app.services.model_config import get_embedding_config, get_llm_config
from app.services.rag import search_similar_chunks

router = APIRouter(tags=["chat"])
settings = get_settings()


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

    history = await maybe_summarize_history(thread, history, llm_config)
    await db.commit()

    query_vector: list[float] | None = None
    try:
        embedding_config = await get_embedding_config(db)
        query_vector = (await embed_texts(embedding_config, [payload.content]))[0]
    except Exception:  # noqa: BLE001
        query_vector = None  # RAG/DB-tooling is best-effort; chat still works without it

    extra_context = None
    if query_vector is not None:
        try:
            chunks = await search_similar_chunks(
                thread.workspace_id, query_vector, db, query_text=payload.content
            )
            if chunks:
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
    if ready_docs:
        doc_list = "\n".join(f"- {d.filename}" for d in ready_docs)
        doc_index = f"فایل‌های آپلود‌شده و پردازش‌شده در این فضای کاری:\n{doc_list}"
        extra_context = f"{doc_index}\n\n{extra_context}" if extra_context else doc_index

    if not ready_docs and not db_connections_by_name:
        inventory = (
            "وضعیت قطعی و فعلی این فضای کاری: هیچ سند و هیچ دیتابیسی اضافه نشده است. "
            "اگر کاربر درباره اسناد، جداول، فیلدها یا داده‌های موجود پرسید، صریح بگو که هنوز هیچ سند یا "
            "دیتابیسی اضافه نشده است و هرگز جدول، فیلد، سند یا داده‌ی نمونه/فرضی از خودت نساز. "
            "هشدار مهم: اگر در پیام‌های قبلی همین گفتگو یا در خلاصه مکالمات، ادعایی درباره وجود جدول "
            "(مثل orders یا customers)، دیتابیس یا سند شده است، آن ادعاها اشتباه و ساختگی بوده‌اند — "
            "آن‌ها را کاملاً نادیده بگیر و تکرارشان نکن؛ فقط همین وضعیت فعلی معتبر است."
        )
        extra_context = f"{inventory}\n\n{extra_context}" if extra_context else inventory

    messages = build_messages(workspace, history, thread.memory_summary, extra_context, payload.content)

    async def event_stream():
        full_content = ""
        completed = False
        audit_ids: list[uuid.UUID] = []

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
            if db_tools:
                content, tool_calls = await complete_chat_with_tools(llm_config, messages, db_tools)

                if not tool_calls:
                    # LLM decided no DB query needed — direct answer (no streaming for brevity)
                    full_content = content
                    yield _sse({"type": "token", "content": content})
                else:
                    # ── Multi-round agentic tool-call loop ──────────────────────────────
                    # Allows the LLM to run a corrective follow-up query when the first
                    # result is raw/wrong (e.g. returns rows instead of aggregated values).
                    rounds_used = 0
                    while tool_calls and rounds_used < MAX_TOOL_ROUNDS:
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
                            tool_result, audit_id = await run_tool_call(
                                db_connections_by_name, tc["arguments"],
                                user_id=user.id, thread_id=thread.id, user_question=payload.content,
                            )
                            if audit_id:
                                audit_ids.append(audit_id)
                            messages.append({"role": "tool", "tool_call_id": tc["id"], "content": tool_result})

                        # Ask the LLM: do you need another query or is the answer ready?
                        if rounds_used < MAX_TOOL_ROUNDS:
                            content, tool_calls = await complete_chat_with_tools(llm_config, messages, db_tools)
                        else:
                            break  # safety cap — force final streaming answer
                    # ────────────────────────────────────────────────────────────────────

                    # Stream the final answer with all tool results in context
                    async for event in stream_chat(llm_config, messages):
                        if event["type"] == "token":
                            full_content += event["content"]
                            yield _sse({"type": "token", "content": event["content"]})
            else:
                async for event in stream_chat(llm_config, messages):
                    if event["type"] == "token":
                        full_content += event["content"]
                        yield _sse({"type": "token", "content": event["content"]})

            # Normal completion — save and signal done.
            assistant_message = Message(thread_id=thread.id, role=MessageRole.assistant, content=full_content)
            db.add(assistant_message)
            if thread.title == "گفتگوی جدید":
                thread.title = payload.content[:60]
            await db.commit()
            await db.refresh(assistant_message)
            await link_audits(assistant_message.id)
            completed = True
            yield _sse({
                "type": "done",
                "message_id": str(assistant_message.id),
                "export_ids": [str(a) for a in audit_ids],
            })

        except LlmError as exc:
            yield _sse({"type": "error", "message": str(exc)})
        except Exception as exc:  # noqa: BLE001
            yield _sse({"type": "error", "message": f"خطا در ارتباط با مدل زبانی: {exc}"})
        finally:
            # Client disconnected mid-stream (GeneratorExit / aclose).
            # Save whatever was generated so far so the user sees it on return.
            if not completed and full_content:
                try:
                    from app.database import AsyncSessionLocal
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
                            from sqlalchemy import update
                            from app.models.query_audit_log import QueryAuditLog
                            await temp_db.execute(
                                update(QueryAuditLog)
                                .where(QueryAuditLog.id.in_(audit_ids))
                                .values(message_id=partial.id)
                            )
                            await temp_db.commit()
                except Exception as e:
                    import logging
                    logging.error(f"Failed to save partial message on disconnect: {e}")

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
