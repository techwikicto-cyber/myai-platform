from app.services.tokens import count_tokens

CHUNK_SIZE_CHARS = 3200  # ~800 tokens at the ~4 chars/token estimate
CHUNK_OVERLAP_CHARS = 400


def chunk_text(text: str) -> list[str]:
    text = text.strip()
    if not text:
        return []

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        paragraphs = [text]

    chunks: list[str] = []
    current = ""

    for para in paragraphs:
        candidate = f"{current}\n\n{para}" if current else para
        if len(candidate) <= CHUNK_SIZE_CHARS:
            current = candidate
            continue

        if current:
            chunks.append(current)
        if len(para) <= CHUNK_SIZE_CHARS:
            current = para
        else:
            # paragraph itself too large: hard-split with overlap
            start = 0
            while start < len(para):
                end = start + CHUNK_SIZE_CHARS
                chunks.append(para[start:end])
                start = end - CHUNK_OVERLAP_CHARS
            current = ""

    if current:
        chunks.append(current)

    return chunks


def estimate_tokens(chunk: str) -> int:
    return count_tokens(chunk)
