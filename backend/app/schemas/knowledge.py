import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.knowledge import KnowledgeKind


class KnowledgeEntryCreate(BaseModel):
    kind: KnowledgeKind
    name: str = Field(min_length=1, max_length=300)
    content: str = Field(min_length=1)
    db_connection_id: uuid.UUID | None = None


class KnowledgeEntryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=300)
    content: str | None = Field(default=None, min_length=1)
    db_connection_id: uuid.UUID | None = None


class KnowledgeEntryOut(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    db_connection_id: uuid.UUID | None
    kind: KnowledgeKind
    name: str
    content: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
