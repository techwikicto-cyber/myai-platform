import asyncio

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine

from app.models.db_connection import DbEngine
from app.services.db_connectors import engine_cache
from app.services.db_connectors.base import ConnectionParams, QueryResult
from app.services.query_safety import ensure_readonly_sql

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


def _introspect_sync(engine: DbEngine, params: ConnectionParams, timeout: int) -> dict:
    # Introspection also uses a temporary engine
    eng = _build_engine(engine, params, timeout)
    try:
        inspector = inspect(eng)
        tables = []
        for table_name in inspector.get_table_names():
            columns = [
                {"name": col["name"], "type": str(col["type"])} for col in inspector.get_columns(table_name)
            ]
            tables.append({"name": table_name, "columns": columns})
        return {"tables": tables}
    finally:
        eng.dispose()


async def introspect_schema(engine: DbEngine, params: ConnectionParams, timeout: int = 15) -> dict:
    return await asyncio.to_thread(_introspect_sync, engine, params, timeout)


def _execute_query_sync(
    conn_id: str, engine: DbEngine, params: ConnectionParams, sql: str, row_limit: int, timeout: int
) -> QueryResult:
    safe_sql = ensure_readonly_sql(sql, row_limit)
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
