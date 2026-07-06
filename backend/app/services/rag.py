import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.document import Document, DocumentChunk, DocumentStatus
from app.services.chunking import chunk_text, estimate_tokens
from app.services.embeddings import embed_texts
from app.services.model_config import EmbeddingConfig, get_embedding_config
from app.services.parsers import ParseError, extract_text

EMBED_BATCH_SIZE = 32


async def process_document_background(document_id: uuid.UUID, content: bytes) -> None:
    """Runs after the upload request has already returned, with its own DB session,
    so large files don't block the HTTP request and multiple uploads can queue up.
    The UI polls the document list to observe pending -> processing -> ready/failed."""
    async with AsyncSessionLocal() as db:
        document = await db.get(Document, document_id)
        if not document:
            return
        try:
            embedding_config = await get_embedding_config(db)
        except Exception as exc:  # noqa: BLE001
            document.status = DocumentStatus.failed
            document.error_message = str(exc)
            await db.commit()
            return
        await process_document(document, content, embedding_config, db)


async def process_document(
    document: Document,
    content: bytes,
    embedding_config: EmbeddingConfig,
    db: AsyncSession,
) -> None:
    document.status = DocumentStatus.processing
    await db.commit()

    try:
        text = extract_text(document.filename, content)
        chunks = chunk_text(text)
        if not chunks:
            raise ParseError("متنی برای استخراج از این فایل پیدا نشد")

        for batch_start in range(0, len(chunks), EMBED_BATCH_SIZE):
            batch = chunks[batch_start : batch_start + EMBED_BATCH_SIZE]
            vectors = await embed_texts(embedding_config, batch)
            for i, (chunk, vector) in enumerate(zip(batch, vectors)):
                db.add(
                    DocumentChunk(
                        document_id=document.id,
                        workspace_id=document.workspace_id,
                        chunk_index=batch_start + i,
                        content=chunk,
                        token_count=estimate_tokens(chunk),
                        embedding=vector,
                    )
                )
        document.status = DocumentStatus.ready
        document.error_message = None
    except Exception as exc:  # noqa: BLE001
        document.status = DocumentStatus.failed
        document.error_message = str(exc)

    await db.commit()


async def search_similar_chunks(
    workspace_id: uuid.UUID,
    query_embedding: list[float],
    db: AsyncSession,
    top_k: int = 5,
    db_connection_id: uuid.UUID | None = None,
) -> list[DocumentChunk]:
    stmt = (
        select(DocumentChunk)
        .join(Document, Document.id == DocumentChunk.document_id)
        .where(DocumentChunk.workspace_id == workspace_id, Document.status == DocumentStatus.ready)
    )
    if db_connection_id is not None:
        stmt = stmt.where(Document.db_connection_id == db_connection_id)
    else:
        stmt = stmt.where(Document.db_connection_id.is_(None))
    stmt = stmt.order_by(DocumentChunk.embedding.cosine_distance(query_embedding)).limit(top_k)
    result = await db.execute(stmt)
    return list(result.scalars().all())
