import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import KnowledgeEntry, KnowledgeKind

# Terms are cheap (a line each) and are exactly what disambiguates opaque table names,
# so every term in the workspace is always included rather than being subject to
# retrieval — missing the one term that defines «حساب کل» defeats the whole feature.
# Business logic and SQL templates are longer, so those are retrieved by similarity.
MAX_ALWAYS_INCLUDED_TERMS = 80
TOP_K_PER_KIND = 4

_KIND_LABELS = {
    KnowledgeKind.term: "اصطلاحات و معادل‌های سازمانی",
    KnowledgeKind.business_logic: "قواعد کسب‌وکار",
    KnowledgeKind.sql_template: "نمونه کوئری‌های تأییدشده",
}


async def build_knowledge_context(
    workspace_id: uuid.UUID,
    db: AsyncSession,
    query_embedding: list[float] | None,
    db_connection_ids: list[uuid.UUID] | None = None,
) -> str | None:
    """Curated domain knowledge for this workspace, formatted for the system prompt.

    Returns None when the workspace has no knowledge entries, so nothing is added to
    the prompt for workspaces that don't use the feature."""
    scope = [KnowledgeEntry.workspace_id == workspace_id]
    # Entries pinned to a connection only apply when that connection is in play; the
    # rest (db_connection_id IS NULL) always apply.
    if db_connection_ids:
        scope.append(
            or_(
                KnowledgeEntry.db_connection_id.is_(None),
                KnowledgeEntry.db_connection_id.in_(db_connection_ids),
            )
        )
    else:
        scope.append(KnowledgeEntry.db_connection_id.is_(None))

    sections: list[str] = []

    term_rows = await db.execute(
        select(KnowledgeEntry)
        .where(*scope, KnowledgeEntry.kind == KnowledgeKind.term)
        .order_by(KnowledgeEntry.name)
        .limit(MAX_ALWAYS_INCLUDED_TERMS)
    )
    terms = list(term_rows.scalars().all())
    if terms:
        lines = "\n".join(f"- **{e.name}**: {e.content}" for e in terms)
        sections.append(f"#### {_KIND_LABELS[KnowledgeKind.term]}\n{lines}")

    for kind in (KnowledgeKind.business_logic, KnowledgeKind.sql_template):
        stmt = select(KnowledgeEntry).where(*scope, KnowledgeEntry.kind == kind)
        if query_embedding is not None:
            # Nearest-neighbour on the question; NULL embeddings sort last under
            # pgvector's distance operator, so unembedded rows never crowd out real hits.
            stmt = stmt.where(KnowledgeEntry.embedding.is_not(None)).order_by(
                KnowledgeEntry.embedding.cosine_distance(query_embedding)
            )
        else:
            stmt = stmt.order_by(KnowledgeEntry.created_at.desc())
        rows = await db.execute(stmt.limit(TOP_K_PER_KIND))
        entries = list(rows.scalars().all())
        if entries:
            lines = "\n\n".join(f"- **{e.name}**:\n{e.content}" for e in entries)
            sections.append(f"#### {_KIND_LABELS[kind]}\n{lines}")

    if not sections:
        return None

    body = "\n\n".join(sections)
    return (
        "### دانش سازمانی این فضای کاری\n"
        "این بخش را مدیرِ فضای کاری وارد کرده و بر حدس تو ارجحیت دارد: اگر اینجا گفته شده "
        "یک اصطلاح به کدام جدول/ستون نگاشت می‌شود یا یک محاسبه چطور انجام می‌گیرد، دقیقاً "
        "همان را به کار ببر و از روی نام جدول‌ها حدس نزن.\n\n"
        f"{body}"
    )
