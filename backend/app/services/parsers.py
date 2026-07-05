import io

import pandas as pd
from docx import Document as DocxDocument
from pypdf import PdfReader

SUPPORTED_EXTENSIONS = {"pdf", "docx", "xlsx", "xls", "csv", "txt", "md"}


class ParseError(Exception):
    pass


def extension_of(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def extract_text(filename: str, content: bytes) -> str:
    ext = extension_of(filename)
    try:
        if ext == "pdf":
            return _extract_pdf(content)
        if ext == "docx":
            return _extract_docx(content)
        if ext in ("xlsx", "xls"):
            return _extract_excel(content)
        if ext == "csv":
            return _extract_csv(content)
        if ext in ("txt", "md"):
            return content.decode("utf-8", errors="ignore")
    except Exception as exc:  # noqa: BLE001
        raise ParseError(f"خطا در خواندن فایل: {exc}") from exc
    raise ParseError(f"فرمت فایل .{ext} پشتیبانی نمی‌شود")


def _extract_pdf(content: bytes) -> str:
    reader = PdfReader(io.BytesIO(content))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n\n".join(pages).strip()


def _extract_docx(content: bytes) -> str:
    doc = DocxDocument(io.BytesIO(content))
    parts = [p.text for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells]
            if any(cells):
                parts.append(" | ".join(cells))
    return "\n".join(parts).strip()


def _extract_excel(content: bytes) -> str:
    sheets = pd.read_excel(io.BytesIO(content), sheet_name=None, dtype=str)
    parts = []
    for name, df in sheets.items():
        df = df.fillna("")
        parts.append(f"# شیت: {name}\n{df.to_csv(index=False)}")
    return "\n\n".join(parts).strip()


def _extract_csv(content: bytes) -> str:
    df = pd.read_csv(io.BytesIO(content), dtype=str).fillna("")
    return df.to_csv(index=False).strip()
