import enum
import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.document import EMBEDDING_DIM


class KnowledgeKind(str, enum.Enum):
    """Modelled on Chat2DB's KnowledgeManagementPromptType. Three kinds because they
    answer three genuinely different questions the schema alone can't:

    term            — what a business word means in this database ("حساب کل" -> _Accs,
                      acc_Level=1). The fix for opaque third-party ERP table names.
    business_logic  — rules that aren't visible in the schema ("مبلغ خالص = tr_Deb -
                      tr_Cre", "اسناد با art_State=3 نهایی‌اند").
    sql_template    — a known-correct query for a recurring question, so the model
                      adapts a verified example instead of inventing joins.
    """

    term = "term"
    business_logic = "business_logic"
    sql_template = "sql_template"


class KnowledgeEntry(Base):
    """A workspace's curated domain knowledge, retrieved by embedding similarity and
    injected into the chat prompt. This is the layer that turns a generic NL-to-SQL
    model into one that understands *this* organization's database: the schema says a
    column is called acc_Level, only a knowledge entry says level 1 means «کل»."""

    __tablename__ = "knowledge_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Optional: scope an entry to one connection when the same term means different
    # things in different databases. NULL = applies to the whole workspace.
    db_connection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("db_connections.id", ondelete="CASCADE"), nullable=True, index=True
    )
    kind: Mapped[KnowledgeKind] = mapped_column(
        Enum(KnowledgeKind, name="knowledge_kind"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Nullable so an entry is still saved (and usable via the always-included term list)
    # when the embedding service is down — degrading to no semantic retrieval beats
    # refusing the write.
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
