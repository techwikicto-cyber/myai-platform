import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.models.thread import MessageRole

# Mirrors Chat2DB's QuestionType: the caller declares what kind of question this is
# instead of the model inferring it from wording, and each type is paired with its own
# prompt. Like theirs, most types are set by the action the user invoked rather than by
# a setting — explain/optimize/debug are only ever reachable from a button attached to
# an actual query, which is where their SendParams.sql equivalent comes from too.
#   auto     — let the model decide (default; their ORDINARY_CHAT)
#   query    — must run a real database query (their NL_2_SQL)
#   chat     — never query; answer from documents + schema already in context
#   explain  — explain the attached query in plain language (their SQL_EXPLAIN)
#   optimize — suggest a faster/cleaner rewrite (their SQL_OPTIMIZER)
#   debug    — diagnose why the attached query failed (their SQL_DEBUG)
ChatMode = Literal["auto", "query", "chat", "explain", "optimize", "debug"]

# Types that reason *about* a query rather than running one. They are handed the SQL
# directly, so offering the query tool would only invite an unnecessary round-trip.
SQL_REASONING_MODES = frozenset({"explain", "optimize", "debug"})


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
    # Tables/collections the user scoped this question to via the composer's "@" picker
    # (Chat2DB's @-mention equivalent). Empty = whole schema, as before.
    tables: list[str] = []
    # The query an explain/optimize/debug action was invoked on (their SendParams.sql).
    sql: str | None = None


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
