import asyncio
from dataclasses import replace

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine

from app.models.db_connection import DbEngine
from app.services.db_connectors import engine_cache
from app.services.db_connectors.base import ConnectionParams, QueryResult
from app.services.query_safety import ensure_readonly_sql

# Server-level catalog queries to enumerate the databases a login can see, excluding
# built-in system databases. Only engines where "one server, many databases" is a real,
# common topology (MSSQL instances hosting one DB per fiscal year is the motivating case)
# are supported; Oracle's service/schema model and MongoDB's own connector don't fit this.
_LIST_DATABASES_SQL = {
    DbEngine.mssql: "SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name",
    DbEngine.postgres: "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
    DbEngine.mysql: "SHOW DATABASES",
}
_SYSTEM_DBS_TO_EXCLUDE = {
    DbEngine.mysql: {"information_schema", "mysql", "performance_schema", "sys"},
}

_DRIVER_BY_ENGINE = {
    DbEngine.postgres: "postgresql+psycopg",
    DbEngine.mysql: "mysql+pymysql",
    DbEngine.mssql: "mssql+pymssql",
    DbEngine.oracle: "oracle+oracledb",
}

_CONNECT_ARGS_BY_ENGINE = {
    DbEngine.postgres: lambda timeout: {"connect_timeout": timeout, "options": f"-c statement_timeout={timeout * 1000}"},
    DbEngine.mysql: lambda timeout: {"connect_timeout": timeout, "read_timeout": timeout},
    DbEngine.mssql: lambda timeout: {"timeout": timeout, "login_timeout": timeout},
    DbEngine.oracle: lambda timeout: {},
}


def _build_url(engine: DbEngine, params: ConnectionParams) -> str:
    driver = _DRIVER_BY_ENGINE[engine]
    auth = ""
    if params.username:
        auth = params.username
        if params.password:
            from urllib.parse import quote_plus
            auth += f":{quote_plus(params.password)}"
        auth += "@"

    if engine == DbEngine.oracle:
        service_name = params.options.get("service_name") or params.database
        return f"{driver}://{auth}{params.host}:{params.port}/?service_name={service_name}"
    return f"{driver}://{auth}{params.host}:{params.port}/{params.database}"


def _build_engine(engine: DbEngine, params: ConnectionParams, timeout: int) -> Engine:
    url = _build_url(engine, params)
    connect_args = _CONNECT_ARGS_BY_ENGINE[engine](timeout)
    return create_engine(
        url,
        connect_args=connect_args,
        pool_pre_ping=True,
        pool_recycle=300,
        pool_size=5,
        max_overflow=2,
        pool_timeout=10,
    )


def _test_connection_sync(engine: DbEngine, params: ConnectionParams, timeout: int) -> tuple[bool, str]:
    try:
        # Test connections use a temporary engine (no cache) to avoid polluting the pool
        eng = _build_engine(engine, params, timeout)
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        eng.dispose()
        return True, "اتصال موفق بود"
    except Exception as exc:  # noqa: BLE001
        return False, f"خطا در اتصال: {exc}"


async def test_connection(engine: DbEngine, params: ConnectionParams, timeout: int = 10) -> tuple[bool, str]:
    return await asyncio.to_thread(_test_connection_sync, engine, params, timeout)


def _introspect_one_database(engine: DbEngine, params: ConnectionParams, timeout: int, qualify_with: str | None) -> list[dict]:
    eng = _build_engine(engine, params, timeout)
    try:
        inspector = inspect(eng)
        schema_name = inspector.default_schema_name or "dbo"
        tables = []
        for table_name in inspector.get_table_names():
            columns = [
                {"name": col["name"], "type": str(col["type"])} for col in inspector.get_columns(table_name)
            ]
            # In multi-database mode, qualify names as database.schema.table (MSSQL
            # 3-part naming) so the model can write cross-database queries directly
            # over a single connection, and every existing consumer of schema_summary
            # (prompt formatting, allowlist matching) needs no changes — it's still
            # just a string in the same flat "tables" list.
            name = f"{qualify_with}.{schema_name}.{table_name}" if qualify_with else table_name
            tables.append({"name": name, "columns": columns})
        return tables
    finally:
        eng.dispose()


def _introspect_sync(engine: DbEngine, params: ConnectionParams, timeout: int, databases: list[str] | None = None) -> dict:
    if not databases:
        return {"tables": _introspect_one_database(engine, params, timeout, qualify_with=None)}

    all_tables: list[dict] = []
    for db_name in databases:
        try:
            db_params = replace(params, database=db_name)
            all_tables.extend(_introspect_one_database(engine, db_params, timeout, qualify_with=db_name))
        except Exception:  # noqa: BLE001 — one inaccessible database shouldn't break the rest
            continue
    return {"tables": all_tables}


async def introspect_schema(
    engine: DbEngine, params: ConnectionParams, timeout: int = 15, databases: list[str] | None = None
) -> dict:
    return await asyncio.to_thread(_introspect_sync, engine, params, timeout, databases)


def _list_databases_sync(engine: DbEngine, params: ConnectionParams, timeout: int) -> list[str]:
    if engine not in _LIST_DATABASES_SQL:
        raise ValueError("فهرست دیتابیس‌ها برای این نوع موتور پشتیبانی نمی‌شود")
    eng = _build_engine(engine, params, timeout)
    try:
        with eng.connect() as conn:
            rows = conn.execute(text(_LIST_DATABASES_SQL[engine])).fetchall()
        exclude = _SYSTEM_DBS_TO_EXCLUDE.get(engine, set())
        return sorted({str(r[0]) for r in rows} - exclude)
    finally:
        eng.dispose()


async def list_databases(engine: DbEngine, params: ConnectionParams, timeout: int = 15) -> list[str]:
    return await asyncio.to_thread(_list_databases_sync, engine, params, timeout)


def _execute_query_sync(
    conn_id: str, engine: DbEngine, params: ConnectionParams, sql: str, row_limit: int, timeout: int
) -> QueryResult:
    safe_sql = ensure_readonly_sql(sql, row_limit, engine=engine.value)
    eng = engine_cache.get_or_create(conn_id, lambda: _build_engine(engine, params, timeout))
    with eng.connect() as conn:
        result = conn.execute(text(safe_sql))
        columns = list(result.keys())
        rows = [dict(zip(columns, row)) for row in result.fetchmany(row_limit)]
        return QueryResult(columns=columns, rows=rows, truncated=len(rows) == row_limit)


async def execute_query(
    conn_id: str,
    engine: DbEngine,
    params: ConnectionParams,
    sql: str,
    row_limit: int = 200,
    timeout: int = 15,
) -> QueryResult:
    return await asyncio.wait_for(
        asyncio.to_thread(_execute_query_sync, conn_id, engine, params, sql, row_limit, timeout),
        timeout=timeout + 5,
    )
