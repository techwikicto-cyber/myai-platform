from app.models.db_connection import DbConnection, DbEngine
from app.security import decrypt_secret
from app.services.db_connectors import engine_cache, mongo, sql
from app.services.db_connectors.base import ConnectionParams, QueryResult


def _params(db_connection: DbConnection) -> ConnectionParams:
    return ConnectionParams(
        host=db_connection.host,
        port=db_connection.port,
        database=db_connection.database,
        username=db_connection.username,
        password=decrypt_secret(db_connection.encrypted_password) if db_connection.encrypted_password else None,
        options=db_connection.options or {},
    )


async def test_connection(db_connection: DbConnection, timeout: int = 10) -> tuple[bool, str]:
    params = _params(db_connection)
    if db_connection.engine == DbEngine.mongodb:
        return await mongo.test_connection(params, timeout)
    return await sql.test_connection(db_connection.engine, params, timeout)


async def introspect_schema(db_connection: DbConnection, timeout: int = 15) -> dict:
    params = _params(db_connection)
    if db_connection.engine == DbEngine.mongodb:
        return await mongo.introspect_schema(params, timeout)
    return await sql.introspect_schema(
        db_connection.engine, params, timeout, databases=db_connection.selected_databases or None
    )


async def list_databases(db_connection: DbConnection, timeout: int = 15) -> list[str]:
    """Enumerate the databases visible on this server (for connections where a single
    login can see multiple databases, e.g. an MSSQL instance with one DB per fiscal
    year). Raises for engines that don't support this (Oracle, MongoDB)."""
    params = _params(db_connection)
    if db_connection.engine == DbEngine.mongodb:
        raise ValueError("MongoDB از فهرست‌کردن دیتابیس‌ها پشتیبانی نمی‌کند")
    return await sql.list_databases(db_connection.engine, params, timeout)


async def execute_query(
    db_connection: DbConnection,
    query: str | dict,
    row_limit: int = 200,
    timeout: int = 15,
) -> QueryResult:
    params = _params(db_connection)
    if db_connection.engine == DbEngine.mongodb:
        if not isinstance(query, dict) or "operation" not in query:
            raise ValueError('برای MongoDB باید {"operation": "find"|"aggregate", "collection": ..., ...} ارسال شود')
        operation = query["operation"]
        return await mongo.execute_query(params, operation, query, row_limit, timeout)

    if not isinstance(query, str):
        raise ValueError("برای دیتابیس‌های SQL باید یک عبارت SQL متنی ارسال شود")
    return await sql.execute_query(str(db_connection.id), db_connection.engine, params, query, row_limit, timeout)


def invalidate_engine(db_connection: DbConnection) -> None:
    """Remove cached engine so next query rebuilds the connection pool."""
    engine_cache.invalidate(str(db_connection.id))
