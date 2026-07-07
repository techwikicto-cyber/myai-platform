import re

from app.services.tokens import count_tokens

CHUNK_SIZE_CHARS = 3200   # ~800 tokens at ~4 chars/token
CHUNK_OVERLAP_CHARS = 400

# Sentence-ending punctuation (Latin + Persian/Arabic)
_SENTENCE_END = re.compile(r'(?<=[.!?؟\n])\s+')


def _split_sentences(text: str) -> list[str]:
    parts = _SENTENCE_END.split(text)
    return [p.strip() for p in parts if p.strip()]


def chunk_text(text: str, source_type: str = "") -> list[str]:
    text = text.strip()
    if not text:
        return []

    # For CSV/Excel rows: each logical line is a record — don't split mid-row.
    # The parsers already produce CSV-like output; keep rows together as units.
    if source_type in ("csv", "xlsx", "xls"):
        return _chunk_tabular(text)

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
            # Para too large → split at sentence boundaries with overlap
            sentences = _split_sentences(para)
            current = ""
            for sentence in sentences:
                candidate = f"{current} {sentence}" if current else sentence
                if len(candidate) <= CHUNK_SIZE_CHARS:
                    current = candidate
                else:
                    if current:
                        chunks.append(current)
                    overlap = current[-CHUNK_OVERLAP_CHARS:] if current else ""
                    current = f"{overlap} {sentence}".strip() if overlap else sentence
            # Remainder after last sentence loop already in current

    if current:
        chunks.append(current)

    return chunks


def _chunk_tabular(text: str) -> list[str]:
    """Chunk CSV/spreadsheet text keeping the header row with every chunk."""
    lines = text.splitlines()
    if not lines:
        return []

    # Find the header line (first non-empty line of each sheet section or overall first)
    header = lines[0]
    data_lines = lines[1:]

    chunks: list[str] = []
    current_lines: list[str] = [header]
    current_len = len(header)

    for line in data_lines:
        # Sheet separator (added by parsers as "# شیت: ...")
        if line.startswith("# شیت:"):
            if len(current_lines) > 1:
                chunks.append("\n".join(current_lines))
            header = line
            current_lines = [header]
            current_len = len(header)
            continue

        new_len = current_len + len(line) + 1
        if new_len > CHUNK_SIZE_CHARS and len(current_lines) > 1:
            chunks.append("\n".join(current_lines))
            current_lines = [header, line]
            current_len = len(header) + len(line) + 1
        else:
            current_lines.append(line)
            current_len = new_len

    if len(current_lines) > 1:
        chunks.append("\n".join(current_lines))

    return chunks or [text[:CHUNK_SIZE_CHARS]]


def estimate_tokens(chunk: str) -> int:
    return count_tokens(chunk)
