import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_workspace_manager, require_workspace_member
from app.models.knowledge import KnowledgeEntry, KnowledgeKind
from app.models.user import User
from app.schemas.knowledge import KnowledgeEntryCreate, KnowledgeEntryOut, KnowledgeEntryUpdate
from app.services.embeddings import embed_texts
from app.services.model_config import get_embedding_config

router = APIRouter(prefix="/api/workspaces/{workspace_id}/knowledge", tags=["knowledge"])


async def _embed_entry(entry: KnowledgeEntry, db: AsyncSession) -> None:
    """Embeds "name: content" so retrieval matches on the term itself as well as its
    explanation. Best-effort — a failing embedding service must not block the write, and
    terms are injected into the prompt by listing (not retrieval) anyway."""
    try:
        config = await get_embedding_config(db)
        entry.embedding = (await embed_texts(config, [f"{entry.name}: {entry.content}"]))[0]
    except Exception:  # noqa: BLE001
        entry.embedding = None


@router.get("", response_model=list[KnowledgeEntryOut])
async def list_knowledge(
    workspace_id: uuid.UUID,
    kind: KnowledgeKind | None = None,
    membership=Depends(require_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(KnowledgeEntry).where(KnowledgeEntry.workspace_id == workspace_id)
    if kind is not None:
        stmt = stmt.where(KnowledgeEntry.kind == kind)
    result = await db.execute(stmt.order_by(KnowledgeEntry.updated_at.desc()))
    return result.scalars().all()


@router.post("", response_model=KnowledgeEntryOut, status_code=status.HTTP_201_CREATED)
async def create_knowledge(
    workspace_id: uuid.UUID,
    payload: KnowledgeEntryCreate,
    user: User = Depends(require_workspace_manager),
    db: AsyncSession = Depends(get_db),
):
    entry = KnowledgeEntry(
        workspace_id=workspace_id,
        db_connection_id=payload.db_connection_id,
        kind=payload.kind,
        name=payload.name.strip(),
        content=payload.content.strip(),
        created_by=user.id,
    )
    await _embed_entry(entry, db)
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.patch("/{entry_id}", response_model=KnowledgeEntryOut)
async def update_knowledge(
    workspace_id: uuid.UUID,
    entry_id: uuid.UUID,
    payload: KnowledgeEntryUpdate,
    _: User = Depends(require_workspace_manager),
    db: AsyncSession = Depends(get_db),
):
    entry = await db.get(KnowledgeEntry, entry_id)
    if not entry or entry.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ورودی دانش پیدا نشد")

    changed_text = False
    if payload.name is not None:
        entry.name = payload.name.strip()
        changed_text = True
    if payload.content is not None:
        entry.content = payload.content.strip()
        changed_text = True
    if payload.db_connection_id is not None:
        entry.db_connection_id = payload.db_connection_id

    if changed_text:
        await _embed_entry(entry, db)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge(
    workspace_id: uuid.UUID,
    entry_id: uuid.UUID,
    _: User = Depends(require_workspace_manager),
    db: AsyncSession = Depends(get_db),
):
    entry = await db.get(KnowledgeEntry, entry_id)
    if not entry or entry.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ورودی دانش پیدا نشد")
    await db.delete(entry)
    await db.commit()
