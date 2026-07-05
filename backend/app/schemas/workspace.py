import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


class WorkspaceCreate(BaseModel):
    name: str


class WorkspaceUpdate(BaseModel):
    name: str | None = None
    system_prompt: str | None = None


class WorkspaceOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    system_prompt: str | None
    created_at: datetime
    is_manager: bool = False

    model_config = {"from_attributes": True}


class WorkspaceMemberAdd(BaseModel):
    email: EmailStr
    is_manager: bool = False


class WorkspaceMemberOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    email: EmailStr
    is_manager: bool

    model_config = {"from_attributes": True}
