import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.models.thread import MessageRole

# Mirrors Chat2DB's QuestionType (ORDINARY_CHAT / NL_2_SQL / ...): the caller declares
# what kind of question this is instead of the model inferring it from wording. Their
# client picks the type from context ("console opens as NL_2_SQL"); Bina is a single
# chat surface, so the user picks it explicitly next to the input box.
#   auto  — let the model decide (default; unchanged behaviour)
#   query — must run a real database query; a prose-only reply is rejected
#   chat  — never query; answer from documents + schema already in context
ChatMode = Literal["auto", "query", "chat"]


class ThreadOut(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ThreadCreate(BaseModel):
    title: str | None = None


class ThreadRename(BaseModel):
    title: str


class MessageOut(BaseModel):
    id: uuid.UUID
    role: MessageRole
    content: str
    created_at: datetime
    export_ids: list[uuid.UUID] = []

    model_config = {"from_attributes": True}


class MessageCreate(BaseModel):
    content: str
    mode: ChatMode = "auto"


class PinCreate(BaseModel):
    question_snapshot: str = ""
    content_snapshot: str


class PinOut(BaseModel):
    id: uuid.UUID
    message_id: uuid.UUID
    workspace_id: uuid.UUID
    question_snapshot: str
    content_snapshot: str
    created_at: datetime

    model_config = {"from_attributes": True}
