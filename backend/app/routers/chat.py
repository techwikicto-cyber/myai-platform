import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, get_workspace_membership, require_workspace_member
from app.models.thread import Message, MessageRole, Thread
from app.models.user import User, UserRole
from app.models.workspace import Workspace
from app.schemas.thread import MessageCreate, MessageOut, ThreadCreate, ThreadOut
from app.services.chat_context import build_messages
from app.services.db_chat import build_db_tools_and_context
from app.services.db_query_tool import run_tool_call
from app.services.embeddings import embed_texts
from app.services.llm import LlmError, complete_chat_with_tools, stream_chat
from app.services.memory import maybe_summarize_history
from app.services.model_config import get_embedding_config, get_llm_config
from app.services.rag import search_similar_chunks

router = APIRouter(tags=["chat"])


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
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="دیگر عضو این ورک‌اسپیس نیستید")
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


@router.get("/api/threads/{thread_id}/messages", response_model=list[MessageOut])
async def list_messages(thread: Thread = Depends(get_owned_thread), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Message).where(Message.thread_id == thread.id).order_by(Message.created_at))
    return result.scalars().all()


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/api/threads/{thread_id}/messages")
async def send_message(
    payload: MessageCreate,
    thread: Thread = Depends(get_owned_thread),
    db: AsyncSession = Depends(get_db),
):
    workspace = await db.get(Workspace, thread.workspace_id)
    if not workspace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ورک‌اسپیس پیدا نشد")

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
            chunks = await search_similar_chunks(thread.workspace_id, query_vector, db)
            if chunks:
                extra_context = "\n\n---\n\n".join(c.content for c in chunks)
        except Exception:  # noqa: BLE001
            extra_context = None

    db_tools, db_context, db_connections_by_name = await build_db_tools_and_context(
        thread.workspace_id, query_vector, db
    )
    if db_context:
        extra_context = f"{extra_context}\n\n{db_context}" if extra_context else db_context

    messages = build_messages(workspace, history, thread.memory_summary, extra_context, payload.content)

    async def event_stream():
        full_content = ""
        try:
            if db_tools:
                content, tool_calls = await complete_chat_with_tools(llm_config, messages, db_tools)
                if tool_calls:
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
                        tool_result = await run_tool_call(db_connections_by_name, tc["arguments"])
                        messages.append({"role": "tool", "tool_call_id": tc["id"], "content": tool_result})

                    async for event in stream_chat(llm_config, messages):
                        if event["type"] == "token":
                            full_content += event["content"]
                            yield _sse({"type": "token", "content": event["content"]})
                else:
                    full_content = content
                    yield _sse({"type": "token", "content": content})
            else:
                async for event in stream_chat(llm_config, messages):
                    if event["type"] == "token":
                        full_content += event["content"]
                        yield _sse({"type": "token", "content": event["content"]})
        except LlmError as exc:
            yield _sse({"type": "error", "message": str(exc)})
            return
        except Exception as exc:  # noqa: BLE001
            yield _sse({"type": "error", "message": f"خطا در ارتباط با مدل زبانی: {exc}"})
            return

        assistant_message = Message(thread_id=thread.id, role=MessageRole.assistant, content=full_content)
        db.add(assistant_message)
        if thread.title == "گفتگوی جدید":
            thread.title = payload.content[:60]
        await db.commit()
        await db.refresh(assistant_message)
        yield _sse({"type": "done", "message_id": str(assistant_message.id)})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
