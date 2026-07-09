import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.thread import MessageRole


class ThreadOut(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ThreadCreate(BaseModel):
    title: str | None = None


class MessageOut(BaseModel):
    id: uuid.UUID
    role: MessageRole
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageCreate(BaseModel):
    content: str


class PinCreate(BaseModel):
    content_snapshot: str


class PinOut(BaseModel):
    id: uuid.UUID
    message_id: uuid.UUID
    workspace_id: uuid.UUID
    content_snapshot: str
    created_at: datetime

    model_config = {"from_attributes": True}
