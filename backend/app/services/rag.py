import uuid
from dataclasses import dataclass

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.document import Document, DocumentChunk, DocumentStatus
from app.services.chunking import chunk_text, estimate_tokens
from app.services.embeddings import embed_texts
from app.services.model_config import EmbeddingConfig, get_embedding_config
from app.services.parsers import ParseError, extract_text

EMBED_BATCH_SIZE = 32
MIN_SIMILARITY = 0.35  # chunks with cosine similarity below this are dropped
RRF_K = 60             # Reciprocal Rank Fusion constant


@dataclass
class ChunkResult:
    content: str
    filename: str
    chunk_index: int


async def process_document_background(document_id: uuid.UUID, content: bytes) -> None:
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
        text_content = extract_text(document.filename, content)
        chunks = chunk_text(text_content, document.source_type)
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
    query_text: str = "",
    top_k: int = 5,
    db_connection_id: uuid.UUID | None = None,
) -> list[ChunkResult]:
    """Hybrid search: combines vector similarity (semantic) with BM25 keyword matching via RRF."""
    filter_extra = (
        Document.db_connection_id == db_connection_id
        if db_connection_id is not None
        else Document.db_connection_id.is_(None)
    )

    # --- Vector search ---
    vec_stmt = (
        select(
            DocumentChunk,
            Document.filename,
            (1 - DocumentChunk.embedding.cosine_distance(query_embedding)).label("similarity"),
        )
        .join(Document, Document.id == DocumentChunk.document_id)
        .where(
            DocumentChunk.workspace_id == workspace_id,
            Document.status == DocumentStatus.ready,
            filter_extra,
            (1 - DocumentChunk.embedding.cosine_distance(query_embedding)) >= MIN_SIMILARITY,
        )
        .order_by(DocumentChunk.embedding.cosine_distance(query_embedding))
        .limit(top_k * 3)
    )
    vec_rows = (await db.execute(vec_stmt)).all()

    # RRF scores keyed by chunk UUID
    rrf_scores: dict[str, dict] = {}
    for rank, (chunk, filename, _sim) in enumerate(vec_rows):
        key = str(chunk.id)
        rrf_scores[key] = {
            "content": chunk.content,
            "filename": filename,
            "chunk_index": chunk.chunk_index,
            "score": 1.0 / (RRF_K + rank + 1),
        }

    # --- Keyword (BM25 tsvector) search ---
    if query_text.strip():
        try:
            conn_filter = (
                "AND d.db_connection_id = :conn_id"
                if db_connection_id is not None
                else "AND d.db_connection_id IS NULL"
            )
            kw_sql = text(f"""
                SELECT dc.id::text, dc.content, dc.chunk_index, d.filename
                FROM document_chunks dc
                JOIN documents d ON d.id = dc.document_id
                WHERE dc.workspace_id = :workspace_id
                  AND d.status = 'ready'
                  {conn_filter}
                  AND dc.content_tsv @@ plainto_tsquery('simple', :query)
                ORDER BY ts_rank(dc.content_tsv, plainto_tsquery('simple', :query)) DESC
                LIMIT :limit
            """)
            params: dict = {
                "workspace_id": str(workspace_id),
                "query": query_text,
                "limit": top_k * 3,
            }
            if db_connection_id is not None:
                params["conn_id"] = str(db_connection_id)

            kw_rows = (await db.execute(kw_sql, params)).all()
            for rank, (chunk_id, content, chunk_index, filename) in enumerate(kw_rows):
                if chunk_id in rrf_scores:
                    rrf_scores[chunk_id]["score"] += 1.0 / (RRF_K + rank + 1)
                else:
                    rrf_scores[chunk_id] = {
                        "content": content,
                        "filename": filename,
                        "chunk_index": chunk_index,
                        "score": 1.0 / (RRF_K + rank + 1),
                    }
        except Exception:  # noqa: BLE001
            pass  # keyword search is best-effort; vector results still returned

    sorted_results = sorted(rrf_scores.values(), key=lambda x: x["score"], reverse=True)
    return [
        ChunkResult(content=r["content"], filename=r["filename"], chunk_index=r["chunk_index"])
        for r in sorted_results[:top_k]
    ]
