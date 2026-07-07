import uuid
from collections import defaultdict

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, status
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.deps import require_admin, require_workspace_manager, require_workspace_member
from app.models.document import Document, DocumentKind
from app.models.sharing import DocumentWorkspaceShare
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.document import DocumentOut, DocumentShareUpdate, SharedDocumentOut
from app.services.parsers import SUPPORTED_EXTENSIONS, extension_of
from app.services.rag import process_document_background

router = APIRouter(prefix="/api/workspaces/{workspace_id}/documents", tags=["documents"])

settings = get_settings()


async def _load_doc_shares(db: AsyncSession, doc_ids: list[uuid.UUID]) -> dict[str, list[uuid.UUID]]:
    if not doc_ids:
        return {}
    result = await db.execute(
        select(DocumentWorkspaceShare.document_id, DocumentWorkspaceShare.workspace_id)
        .where(DocumentWorkspaceShare.document_id.in_(doc_ids))
    )
    shares: dict[str, list[uuid.UUID]] = defaultdict(list)
    for doc_id, ws_id in result:
        shares[str(doc_id)].append(ws_id)
    return shares


def _doc_out(doc: Document, shared_ids: list[uuid.UUID]) -> DocumentOut:
    return DocumentOut(
        id=doc.id,
        filename=doc.filename,
        source_type=doc.source_type,
        status=doc.status,
        error_message=doc.error_message,
        shared_workspace_ids=shared_ids,
        created_at=doc.created_at,
    )


@router.get("/shared", response_model=list[SharedDocumentOut])
async def list_shared_documents(
    workspace_id: uuid.UUID,
    membership=Depends(require_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Document, Workspace.name)
        .join(DocumentWorkspaceShare, DocumentWorkspaceShare.document_id == Document.id)
        .join(Workspace, Workspace.id == Document.workspace_id)
        .where(
            DocumentWorkspaceShare.workspace_id == workspace_id,
            Document.kind == DocumentKind.workspace_doc,
        )
        .order_by(Document.created_at.desc())
    )
    return [
        SharedDocumentOut(
            id=doc.id,
            filename=doc.filename,
            source_type=doc.source_type,
            status=doc.status,
            error_message=doc.error_message,
            source_workspace_name=ws_name,
            created_at=doc.created_at,
        )
        for doc, ws_name in result.all()
    ]


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
    docs = list(result.scalars().all())
    shares = await _load_doc_shares(db, [d.id for d in docs])
    return [_doc_out(d, shares.get(str(d.id), [])) for d in docs]


@router.post("", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    workspace_id: uuid.UUID,
    file: UploadFile,
    background_tasks: BackgroundTasks,
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

    background_tasks.add_task(process_document_background, document.id, content)
    return _doc_out(document, [])


@router.patch("/{document_id}/share", response_model=DocumentOut)
async def share_document(
    workspace_id: uuid.UUID,
    document_id: uuid.UUID,
    payload: DocumentShareUpdate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    document = await db.get(Document, document_id)
    if not document or document.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="سند پیدا نشد")

    # Replace all shares atomically
    await db.execute(sa_delete(DocumentWorkspaceShare).where(DocumentWorkspaceShare.document_id == document_id))
    for ws_id in payload.workspace_ids:
        if ws_id != workspace_id:
            db.add(DocumentWorkspaceShare(document_id=document_id, workspace_id=ws_id))
    await db.commit()

    result = await db.execute(
        select(DocumentWorkspaceShare.workspace_id)
        .where(DocumentWorkspaceShare.document_id == document_id)
    )
    return _doc_out(document, list(result.scalars()))


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
