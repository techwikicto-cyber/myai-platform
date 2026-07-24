import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.db_connection import DbEngine


class DbConnectionCreate(BaseModel):
    name: str
    engine: DbEngine
    host: str
    port: int
    database: str
    username: str | None = None
    password: str | None = None
    options: dict = {}


class DbConnectionTestRequest(DbConnectionCreate):
    pass


class DbConnectionOut(BaseModel):
    id: uuid.UUID
    name: str
    engine: DbEngine
    host: str
    port: int
    database: str
    username: str | None
    options: dict
    schema_summary: dict | None
    allowed_tables: dict | None
    available_databases: list[str] | None = None
    selected_databases: list[str] | None = None
    shared_workspace_ids: list[uuid.UUID] = []
    last_introspected_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class SelectedDatabasesUpdate(BaseModel):
    selected_databases: list[str]


class ShareUpdate(BaseModel):
    workspace_ids: list[uuid.UUID]


class SharedConnectionOut(BaseModel):
    id: uuid.UUID
    name: str
    engine: DbEngine
    host: str
    database: str
    source_workspace_name: str
    schema_summary: dict | None
    last_introspected_at: datetime | None
    created_at: datetime


class AllowedTablesUpdate(BaseModel):
    # {"orders": ["id","total"], "invoices": null}  — null means all columns of that table
    allowed_tables: dict[str, list[str] | None]


class ConnectionTestResult(BaseModel):
    success: bool
    message: str
