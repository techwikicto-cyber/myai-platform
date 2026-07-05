from dataclasses import dataclass, field


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[dict]
    truncated: bool = False


@dataclass
class ConnectionParams:
    host: str
    port: int
    database: str
    username: str | None
    password: str | None
    options: dict = field(default_factory=dict)
