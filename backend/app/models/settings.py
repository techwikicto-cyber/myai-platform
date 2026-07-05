from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ModelSettings(Base):
    """Singleton row (id=1) holding system-wide LLM/embedding provider configuration."""

    __tablename__ = "model_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    llm_base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    llm_api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    llm_model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    embedding_base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    embedding_api_type: Mapped[str] = mapped_column(String(20), default="tei")
    embedding_model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
