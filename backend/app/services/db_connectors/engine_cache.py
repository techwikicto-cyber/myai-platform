"""Connection pool cache — one SQLAlchemy Engine per db_connection_id.

Engines are reused across requests so each query doesn't pay a full TCP handshake.
Call `invalidate_engine()` whenever connection credentials/host change or on delete.
TTL ensures stale engines are eventually discarded even without explicit invalidation.
"""

import time
from typing import Callable

from sqlalchemy.engine import Engine

_CACHE: dict[str, tuple[Engine, float]] = {}
_TTL_SECONDS = 3600  # recycle after 1 hour of last use


def get_or_create(conn_id: str, factory_fn: Callable[[], Engine]) -> Engine:
    cached = _CACHE.get(conn_id)
    if cached:
        engine, _last_used = cached
        _CACHE[conn_id] = (engine, time.monotonic())
        return engine
    engine = factory_fn()
    _CACHE[conn_id] = (engine, time.monotonic())
    return engine


def invalidate(conn_id: str) -> None:
    """Dispose and remove the cached engine for this connection."""
    entry = _CACHE.pop(conn_id, None)
    if entry:
        try:
            entry[0].dispose()
        except Exception:  # noqa: BLE001
            pass


def evict_expired() -> None:
    """Remove engines idle longer than TTL. Call from a periodic task if needed."""
    now = time.monotonic()
    expired = [cid for cid, (_, last) in _CACHE.items() if now - last > _TTL_SECONDS]
    for cid in expired:
        invalidate(cid)
