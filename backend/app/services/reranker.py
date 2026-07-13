import httpx

from app.config import get_settings

settings = get_settings()


def rerank_enabled() -> bool:
    """True when a reranker endpoint is configured. When False, callers keep their
    existing (RRF) ordering and never pay any latency."""
    return bool(settings.reranker_base_url)


async def rerank(query: str, texts: list[str]) -> list[float] | None:
    """Score each text for relevance to `query` with a cross-encoder reranker
    (HuggingFace text-embeddings-inference `/rerank` endpoint).

    Best-effort by design: returns a score-per-text list aligned to the input
    order, or None on any failure (endpoint down, timeout, bad response) so the
    caller can silently fall back to the pre-rerank ordering. Never raises.
    """
    if not settings.reranker_base_url or len(texts) < 2:
        return None

    url = f"{settings.reranker_base_url.rstrip('/')}/rerank"
    payload: dict = {"query": query, "texts": texts}
    if settings.reranker_model:
        payload["model"] = settings.reranker_model

    try:
        async with httpx.AsyncClient(timeout=settings.reranker_timeout_seconds) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except Exception:  # noqa: BLE001 — reranking is optional; degrade gracefully
        return None

    # TEI returns [{"index": i, "score": s}, ...] in ranked order; map back to
    # the original input order so the caller can zip scores with its candidates.
    try:
        scores = [0.0] * len(texts)
        for item in data:
            idx = item.get("index")
            if isinstance(idx, int) and 0 <= idx < len(texts):
                scores[idx] = float(item.get("score", 0.0))
        return scores
    except Exception:  # noqa: BLE001 — unexpected response shape
        return None
