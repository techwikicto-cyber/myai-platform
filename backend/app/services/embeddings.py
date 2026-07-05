import httpx

from app.services.model_config import EmbeddingConfig


class EmbeddingError(Exception):
    pass


async def embed_texts(config: EmbeddingConfig, texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    if not config.base_url:
        raise EmbeddingError("آدرس سرویس embedding تنظیم نشده است")

    async with httpx.AsyncClient(timeout=60) as client:
        if config.api_type == "openai":
            resp = await client.post(
                f"{config.base_url.rstrip('/')}/embeddings",
                json={"model": config.model, "input": texts},
            )
            resp.raise_for_status()
            data = resp.json()
            return [item["embedding"] for item in data["data"]]
        else:
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


async def test_embedding_connection(config: EmbeddingConfig) -> tuple[bool, str]:
    try:
        vectors = await embed_texts(config, ["test"])
        if vectors and len(vectors[0]) > 0:
            return True, f"اتصال موفق — بردار {len(vectors[0])} بعدی دریافت شد"
        return False, "پاسخ نامعتبر از سرویس embedding"
    except Exception as exc:  # noqa: BLE001
        return False, f"خطا در اتصال: {exc}"
