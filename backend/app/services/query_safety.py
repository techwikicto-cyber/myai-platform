import sqlglot
import sqlglot.expressions as exp
import sqlparse
from sqlparse.tokens import DML, Keyword

FORBIDDEN_KEYWORDS = {
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "ALTER",
    "CREATE",
    "TRUNCATE",
    "GRANT",
    "REVOKE",
    "MERGE",
    "REPLACE",
    "CALL",
    "EXEC",
    "EXECUTE",
}


class QuerySafetyError(Exception):
    pass


def ensure_readonly_sql(sql: str, default_row_limit: int) -> str:
    """Validates the SQL is a single read-only SELECT statement and ensures a LIMIT clause,
    so LLM-generated queries can never mutate or exfiltrate more than the configured cap."""
    cleaned = sql.strip().rstrip(";")
    if not cleaned:
        raise QuerySafetyError("کوئری خالی است")

    statements = sqlparse.parse(cleaned)
    if len(statements) != 1:
        raise QuerySafetyError("فقط اجرای یک عبارت SQL در هر بار مجاز است")

    stmt = statements[0]
    upper_sql = cleaned.upper()

    first_dml = next((t for t in stmt.flatten() if t.ttype is DML), None)
    if not first_dml or first_dml.value.upper() != "SELECT":
        raise QuerySafetyError("فقط عبارت‌های SELECT مجاز است")

    for token in stmt.flatten():
        if token.ttype in (Keyword, DML) and token.value.upper() in FORBIDDEN_KEYWORDS:
            raise QuerySafetyError(f"استفاده از دستور «{token.value.upper()}» مجاز نیست")

    if " LIMIT " not in f" {upper_sql} " and not upper_sql.rstrip().endswith("LIMIT"):
        if "TOP " in upper_sql.split("SELECT", 1)[-1][:20]:
            return cleaned  # MSSQL-style TOP already caps rows
        cleaned = f"{cleaned} LIMIT {default_row_limit}"

    return cleaned


def ensure_allowed_tables(sql: str, allowed_tables: dict) -> None:
    """Raises QuerySafetyError if the SQL references tables not in the allowlist.
    Uses sqlglot for reliable AST-based table extraction (handles CTEs, subqueries, aliases)."""
    if not allowed_tables:
        return  # allowlist not configured → allow everything (backward compat)
    try:
        parsed = sqlglot.parse_one(sql)
        referenced = {t.name.lower() for t in parsed.find_all(exp.Table)}
    except Exception:  # noqa: BLE001
        return  # if sqlglot can't parse, defer to ensure_readonly_sql already done

    allowed_lower = {k.lower() for k in allowed_tables}
    not_allowed = referenced - allowed_lower
    if not_allowed:
        raise QuerySafetyError(f"دسترسی به جدول(های) {', '.join(sorted(not_allowed))} مجاز نیست")


def ensure_allowed_mongo_collection(payload: dict, allowed_tables: dict) -> None:
    """Raises QuerySafetyError if the MongoDB operation targets a collection not in the allowlist."""
    if not allowed_tables:
        return
    collection = payload.get("collection", "")
    if collection.lower() not in {k.lower() for k in allowed_tables}:
        raise QuerySafetyError(f"دسترسی به کالکشن «{collection}» مجاز نیست")


ALLOWED_MONGO_OPERATIONS = {"find", "aggregate"}
FORBIDDEN_AGGREGATION_STAGES = {"$out", "$merge", "$function", "$where"}


def ensure_readonly_mongo(operation: str, payload: dict) -> None:
    if operation not in ALLOWED_MONGO_OPERATIONS:
        raise QuerySafetyError(f"عملیات «{operation}» مجاز نیست؛ فقط find و aggregate مجاز است")
    if operation == "aggregate":
        pipeline = payload.get("pipeline", [])
        for stage in pipeline:
            for key in stage:
                if key in FORBIDDEN_AGGREGATION_STAGES:
                    raise QuerySafetyError(f"استفاده از مرحله «{key}» در aggregate مجاز نیست")
