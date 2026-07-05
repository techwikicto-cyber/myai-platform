import asyncio

from bson import ObjectId
from pymongo import MongoClient

from app.services.db_connectors.base import ConnectionParams, QueryResult
from app.services.query_safety import ensure_readonly_mongo

SAMPLE_SIZE = 20


def _client(params: ConnectionParams, timeout: int) -> MongoClient:
    return MongoClient(
        host=params.host,
        port=params.port,
        username=params.username or None,
        password=params.password or None,
        authSource=params.options.get("auth_source", params.database),
        serverSelectionTimeoutMS=timeout * 1000,
        connectTimeoutMS=timeout * 1000,
    )


def _jsonable(value):
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    return value


def _test_connection_sync(params: ConnectionParams, timeout: int) -> tuple[bool, str]:
    try:
        client = _client(params, timeout)
        client.admin.command("ping")
        client.close()
        return True, "اتصال موفق بود"
    except Exception as exc:  # noqa: BLE001
        return False, f"خطا در اتصال: {exc}"


async def test_connection(params: ConnectionParams, timeout: int = 10) -> tuple[bool, str]:
    return await asyncio.to_thread(_test_connection_sync, params, timeout)


def _introspect_sync(params: ConnectionParams, timeout: int) -> dict:
    client = _client(params, timeout)
    try:
        db = client[params.database]
        collections = []
        for coll_name in db.list_collection_names():
            fields: dict[str, str] = {}
            for doc in db[coll_name].find().limit(SAMPLE_SIZE):
                for key, value in doc.items():
                    if key not in fields:
                        fields[key] = type(value).__name__
            collections.append({"name": coll_name, "sample_fields": fields})
        return {"collections": collections}
    finally:
        client.close()


async def introspect_schema(params: ConnectionParams, timeout: int = 15) -> dict:
    return await asyncio.to_thread(_introspect_sync, params, timeout)


def _execute_query_sync(
    params: ConnectionParams, operation: str, payload: dict, row_limit: int, timeout: int
) -> QueryResult:
    ensure_readonly_mongo(operation, payload)
    client = _client(params, timeout)
    try:
        db = client[params.database]
        collection = db[payload["collection"]]

        if operation == "find":
            cursor = collection.find(
                payload.get("filter") or {}, payload.get("projection") or None
            ).limit(row_limit).max_time_ms(timeout * 1000)
            docs = [_jsonable(d) for d in cursor]
        else:  # aggregate
            pipeline = list(payload.get("pipeline") or []) + [{"$limit": row_limit}]
            docs = [_jsonable(d) for d in collection.aggregate(pipeline, maxTimeMS=timeout * 1000)]

        columns = sorted({k for d in docs for k in d.keys()})
        return QueryResult(columns=columns, rows=docs, truncated=len(docs) == row_limit)
    finally:
        client.close()


async def execute_query(
    params: ConnectionParams,
    operation: str,
    payload: dict,
    row_limit: int = 200,
    timeout: int = 15,
) -> QueryResult:
    return await asyncio.wait_for(
        asyncio.to_thread(_execute_query_sync, params, operation, payload, row_limit, timeout),
        timeout=timeout + 5,
    )
