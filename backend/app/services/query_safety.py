import sqlglot
import sqlglot.expressions as exp
import sqlparse
import re
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


def ensure_readonly_sql(sql: str, default_row_limit: int, engine: str = "") -> str:
    """Validates the SQL is a single read-only SELECT statement and ensures a row-limit clause,
    using the correct syntax for the target database engine."""
    cleaned = sql.strip().rstrip(";")
    if not cleaned:
        raise QuerySafetyError("کوئری خالی است")

    statements = sqlparse.parse(cleaned)
    if len(statements) != 1:
        raise QuerySafetyError("فقط اجرای یک عبارت SQL در هر بار مجاز است")

    # sqlparse is useful for tokenisation but is not a security boundary. Parse
    # the AST too: this permits legitimate CTEs while rejecting data-modifying
    # statements and SELECT INTO disguised as a read query.
    try:
        parsed = sqlglot.parse_one(cleaned)
    except Exception as exc:  # noqa: BLE001
        raise QuerySafetyError(f"ساختار SQL معتبر نیست: {exc}") from exc
    if not isinstance(parsed, (exp.Select, exp.Union, exp.Intersect, exp.Except)):
        raise QuerySafetyError("فقط عبارت‌های خواندنی SELECT/CTE مجاز است")
    if parsed.find(exp.Into) is not None:
        raise QuerySafetyError("SELECT INTO مجاز نیست")
    forbidden_nodes = (exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create, exp.Alter, exp.Merge)
    if any(parsed.find(node) is not None for node in forbidden_nodes):
        raise QuerySafetyError("عبارت‌های تغییردهندهٔ داده یا ساختار مجاز نیستند")

    stmt = statements[0]
    upper_sql = cleaned.upper()

    first_dml = next((t for t in stmt.flatten() if t.ttype is DML), None)
    if not first_dml or first_dml.value.upper() != "SELECT":
        raise QuerySafetyError("فقط عبارت‌های SELECT مجاز است")

    for token in stmt.flatten():
        if token.ttype in (Keyword, DML) and token.value.upper() in FORBIDDEN_KEYWORDS:
            raise QuerySafetyError(f"استفاده از دستور «{token.value.upper()}» مجاز نیست")

    engine_lower = engine.lower()

    # Fetching only a few rows after executing an unlimited statement is not a
    # resource guard. Never accept a model-supplied limit above the app cap.
    limit_match = re.search(r"\bLIMIT\s+(\d+)\b", upper_sql)
    if "LIMIT" in upper_sql and not limit_match:
        raise QuerySafetyError("LIMIT باید یک عدد ثابت باشد")
    if limit_match and int(limit_match.group(1)) > default_row_limit:
        raise QuerySafetyError(f"LIMIT نباید بیشتر از {default_row_limit} باشد")
    top_match = re.search(r"\bTOP\s*(?:\(\s*)?(\d+)", upper_sql)
    if top_match and int(top_match.group(1)) > default_row_limit:
        raise QuerySafetyError(f"TOP نباید بیشتر از {default_row_limit} باشد")

    # MSSQL: already capped with TOP — no further action needed
    if top_match:
        return cleaned

    # Oracle: already capped with FETCH FIRST — no further action needed
    if "FETCH FIRST" in upper_sql or "FETCH NEXT" in upper_sql:
        return cleaned

    # Oracle: use FETCH FIRST ... ROWS ONLY
    if engine_lower == "oracle":
        if " LIMIT " not in f" {upper_sql} ":
            cleaned = f"{cleaned} FETCH FIRST {default_row_limit} ROWS ONLY"
        return cleaned

    # MSSQL without TOP: use OFFSET/FETCH (safer than LIMIT)
    if engine_lower == "mssql":
        if " LIMIT " not in f" {upper_sql} " and "OFFSET" not in upper_sql:
            cleaned = f"{cleaned} OFFSET 0 ROWS FETCH NEXT {default_row_limit} ROWS ONLY"
        return cleaned

    # PostgreSQL / MySQL / SQLite: use LIMIT
    if " LIMIT " not in f" {upper_sql} ":
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
        # CTE aliases are relations local to this query, not physical database
        # tables. Treating them as real tables made valid, safe CTE queries fail
        # whenever an allowlist was enabled.
        cte_aliases = {cte.alias_or_name.lower() for cte in parsed.find_all(exp.CTE)}
        referenced -= cte_aliases
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
