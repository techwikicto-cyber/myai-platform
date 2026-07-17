import uuid
from dataclasses import dataclass

from sqlalchemy import and_, delete, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.document import Document, DocumentChunk, DocumentKind, DocumentStatus
from app.models.sharing import DocumentWorkspaceShare
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
    similarity: float | None = None


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
        # A retry after a worker restart must not make duplicate chunks that bias
        # retrieval toward a stale or partial ingestion.
        await db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document.id))
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
    """Hybrid search: combines vector similarity (semantic) with BM25 keyword matching via RRF.

    For regular workspace-doc searches (db_connection_id=None), shared documents from any
    workspace are automatically included in addition to the workspace's own documents.
    """
    if db_connection_id is not None:
        # Schema doc search: specific to this connection in this workspace only
        scope_filter = and_(
            DocumentChunk.workspace_id == workspace_id,
            Document.db_connection_id == db_connection_id,
        )
        kw_scope = f"dc.workspace_id = '{workspace_id}' AND d.db_connection_id = :conn_id"
        kw_params_extra: dict = {"conn_id": str(db_connection_id)}
    else:
        # Regular doc search: own workspace docs + docs explicitly shared with this workspace
        share_subq = (
            select(DocumentWorkspaceShare.id)
            .where(
                DocumentWorkspaceShare.document_id == Document.id,
                DocumentWorkspaceShare.workspace_id == workspace_id,
            )
            .exists()
        )
        scope_filter = and_(
            Document.db_connection_id.is_(None),
            or_(
                DocumentChunk.workspace_id == workspace_id,
                and_(Document.kind == DocumentKind.workspace_doc, share_subq),
            ),
        )
        kw_scope = (
            "d.db_connection_id IS NULL AND ("
            "dc.workspace_id = :workspace_id OR "
            "(d.kind = 'workspace_doc' AND EXISTS ("
            "  SELECT 1 FROM document_workspace_shares dws"
            "  WHERE dws.document_id = d.id AND dws.workspace_id = :workspace_id"
            ")))"
        )
        kw_params_extra = {}

    # --- Vector search ---
    vec_stmt = (
        select(
            DocumentChunk,
            Document.filename,
            (1 - DocumentChunk.embedding.cosine_distance(query_embedding)).label("similarity"),
        )
        .join(Document, Document.id == DocumentChunk.document_id)
        .where(
            Document.status == DocumentStatus.ready,
            scope_filter,
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
            "similarity": float(_sim),
        }

    # --- Keyword (BM25 tsvector) search ---
    if query_text.strip():
        try:
            kw_sql = text(f"""
                SELECT dc.id::text, dc.content, dc.chunk_index, d.filename
                FROM document_chunks dc
                JOIN documents d ON d.id = dc.document_id
                WHERE {kw_scope}
                  AND d.status = 'ready'
                  AND dc.content_tsv @@ plainto_tsquery('simple', :query)
                ORDER BY ts_rank(dc.content_tsv, plainto_tsquery('simple', :query)) DESC
                LIMIT :limit
            """)
            params: dict = {
                "workspace_id": str(workspace_id),
                "query": query_text,
                "limit": top_k * 3,
                **kw_params_extra,
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
                        "similarity": None,
                    }
        except Exception:  # noqa: BLE001
            pass  # keyword search is best-effort; vector results still returned

    sorted_results = sorted(rrf_scores.values(), key=lambda x: x["score"], reverse=True)

    return [
        ChunkResult(
            content=r["content"], filename=r["filename"], chunk_index=r["chunk_index"],
            similarity=r.get("similarity"),
        )
        for r in sorted_results[:top_k]
    ]
