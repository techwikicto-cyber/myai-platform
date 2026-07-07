import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.document import DocumentStatus


class DocumentShareUpdate(BaseModel):
    workspace_ids: list[uuid.UUID]


class SharedDocumentOut(BaseModel):
    id: uuid.UUID
    filename: str
    source_type: str
    status: DocumentStatus
    error_message: str | None
    source_workspace_name: str
    created_at: datetime


class DocumentOut(BaseModel):
    id: uuid.UUID
    filename: str
    source_type: str
    status: DocumentStatus
    error_message: str | None
    shared_workspace_ids: list[uuid.UUID] = []
    created_at: datetime

    model_config = {"from_attributes": True}
