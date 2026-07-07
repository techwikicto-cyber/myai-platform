import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.document import DocumentStatus


class DocumentShareUpdate(BaseModel):
    is_shared: bool


class DocumentOut(BaseModel):
    id: uuid.UUID
    filename: str
    source_type: str
    status: DocumentStatus
    error_message: str | None
    is_shared: bool
    created_at: datetime

    model_config = {"from_attributes": True}
