import httpx

from app.services.model_config import EmbeddingConfig


class EmbeddingError(Exception):
    pass


async def embed_texts(config: EmbeddingConfig, texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    if not config.base_url:
        raise EmbeddingError("آدرس سرویس embedding تنظیم نشده است")

    try:
        return await _embed_texts_inner(config, texts)
    except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
        raise EmbeddingError(_friendly_error(exc, config.base_url)) from exc
    except httpx.HTTPStatusError as exc:
        raise EmbeddingError(
            f"سرویس embedding پاسخ خطا داد (HTTP {exc.response.status_code}): {exc.response.text[:300]}"
        ) from exc


async def _embed_openai(client: httpx.AsyncClient, config: EmbeddingConfig, texts: list[str]) -> list[list[float]]:
    url = f"{config.base_url.rstrip('/')}/embeddings"
    try:
        resp = await client.post(url, json={"model": config.model, "input": texts})
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        # Some minimal OpenAI-compatible servers only accept a single string as
        # "input"; fall back to one request per text before giving up.
        if len(texts) > 1 and exc.response.status_code in (400, 413, 422):
            vectors: list[list[float]] = []
            for text in texts:
                single = await client.post(url, json={"model": config.model, "input": text})
                single.raise_for_status()
                vectors.append(single.json()["data"][0]["embedding"])
            return vectors
        raise
    data = resp.json()
    items = sorted(data["data"], key=lambda item: item.get("index", 0))
    return [item["embedding"] for item in items]


async def _embed_texts_inner(config: EmbeddingConfig, texts: list[str]) -> list[list[float]]:
    async with httpx.AsyncClient(timeout=120) as client:
        if config.api_type == "openai":
            return await _embed_openai(client, config, texts)

        # HuggingFace text-embeddings-inference API: POST /embed
        resp = await client.post(
            f"{config.base_url.rstrip('/')}/embed",
            json={"inputs": texts},
        )
        resp.raise_for_status()
        data = resp.json()
        # TEI returns a list of vectors (list[list[float]]) for batch input
        if data and isinstance(data[0], float):
            return [data]
        return data


def _friendly_error(exc: Exception, base_url: str) -> str:
    if isinstance(exc, httpx.ConnectError | httpx.ConnectTimeout):
        return (
            f"سرویس embedding در آدرس {base_url} در دسترس نیست. "
            "مطمئن شوید کانتینر embedding بالا است: «docker compose ps» و «docker compose logs -f embedding». "
            "اگر آدرس را دستی تغییر داده‌اید، توجه کنید که از داخل کانتینر backend، آدرس localhost معنی ندارد و "
            "باید از نام سرویس (مثل http://embedding:8080/v1) استفاده کنید."
        )
    return f"خطا در اتصال: {exc}"


async def test_embedding_connection(config: EmbeddingConfig) -> tuple[bool, str]:
    try:
        vectors = await embed_texts(config, ["test"])
        if vectors and len(vectors[0]) > 0:
            return True, f"اتصال موفق — بردار {len(vectors[0])} بعدی دریافت شد"
        return False, "پاسخ نامعتبر از سرویس embedding"
    except EmbeddingError as exc:
        return False, str(exc)
    except Exception as exc:  # noqa: BLE001
        return False, _friendly_error(exc, config.base_url)
