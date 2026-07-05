import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.deps import require_workspace_manager, require_workspace_member
from app.models.document import Document, DocumentKind
from app.models.user import User
from app.schemas.document import DocumentOut
from app.services.model_config import get_embedding_config
from app.services.parsers import SUPPORTED_EXTENSIONS, extension_of
from app.services.rag import process_document

router = APIRouter(prefix="/api/workspaces/{workspace_id}/documents", tags=["documents"])

settings = get_settings()


@router.get("", response_model=list[DocumentOut])
async def list_documents(
    workspace_id: uuid.UUID,
    membership=Depends(require_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Document)
        .where(Document.workspace_id == workspace_id, Document.kind == DocumentKind.workspace_doc)
        .order_by(Document.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    workspace_id: uuid.UUID,
    file: UploadFile,
    user: User = Depends(require_workspace_manager),
    db: AsyncSession = Depends(get_db),
):
    ext = extension_of(file.filename or "")
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"فرمت .{ext} پشتیبانی نمی‌شود. فرمت‌های مجاز: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    content = await file.read()
    if len(content) > settings.upload_max_mb * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"حجم فایل نباید بیشتر از {settings.upload_max_mb} مگابایت باشد",
        )

    document = Document(
        workspace_id=workspace_id,
        kind=DocumentKind.workspace_doc,
        filename=file.filename or "بدون‌نام",
        source_type=ext,
        uploaded_by=user.id,
    )
    db.add(document)
    await db.commit()
    await db.refresh(document)

    embedding_config = await get_embedding_config(db)
    await process_document(document, content, embedding_config, db)
    await db.refresh(document)
    return document


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    workspace_id: uuid.UUID,
    document_id: uuid.UUID,
    user: User = Depends(require_workspace_manager),
    db: AsyncSession = Depends(get_db),
):
    document = await db.get(Document, document_id)
    if not document or document.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="سند پیدا نشد")
    await db.delete(document)
    await db.commit()
