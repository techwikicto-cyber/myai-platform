import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_admin, require_workspace_manager, require_workspace_member
from app.models.user import User, UserRole
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.workspace import (
    WorkspaceCreate,
    WorkspaceMemberAdd,
    WorkspaceMemberOut,
    WorkspaceOut,
    WorkspaceUpdate,
)

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


def slugify(name: str) -> str:
    base = re.sub(r"[^a-zA-Z0-9؀-ۿ]+", "-", name).strip("-").lower()
    return base or uuid.uuid4().hex[:8]


async def _unique_slug(db: AsyncSession, name: str) -> str:
    slug = slugify(name)
    candidate = slug
    suffix = 1
    while (await db.execute(select(Workspace).where(Workspace.slug == candidate))).scalar_one_or_none():
        suffix += 1
        candidate = f"{slug}-{suffix}"
    return candidate


@router.get("", response_model=list[WorkspaceOut])
async def list_workspaces(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role == UserRole.admin:
        result = await db.execute(select(Workspace).order_by(Workspace.created_at))
        workspaces = result.scalars().all()
        return [WorkspaceOut.model_validate(w).model_copy(update={"is_manager": True}) for w in workspaces]

    result = await db.execute(
        select(Workspace, WorkspaceMember.is_manager)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == user.id)
        .order_by(Workspace.created_at)
    )
    return [WorkspaceOut.model_validate(w).model_copy(update={"is_manager": is_manager}) for w, is_manager in result.all()]


@router.post("", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
async def create_workspace(
    payload: WorkspaceCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    if user.role == UserRole.user:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="اجازه ساخت فضای کاری ندارید")
    slug = await _unique_slug(db, payload.name)
    workspace = Workspace(name=payload.name, slug=slug, created_by=user.id)
    db.add(workspace)
    await db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, is_manager=True))
    await db.commit()
    await db.refresh(workspace)
    return WorkspaceOut.model_validate(workspace).model_copy(update={"is_manager": True})


@router.get("/{workspace_id}", response_model=WorkspaceOut)
async def get_workspace(
    workspace_id: uuid.UUID,
    membership: tuple[User, bool] = Depends(require_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    workspace = await db.get(Workspace, workspace_id)
    if not workspace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="فضای کاری پیدا نشد")
    _, is_manager = membership
    return WorkspaceOut.model_validate(workspace).model_copy(update={"is_manager": is_manager})


@router.patch("/{workspace_id}", response_model=WorkspaceOut)
async def update_workspace(
    workspace_id: uuid.UUID,
    payload: WorkspaceUpdate,
    user: User = Depends(require_workspace_manager),
    db: AsyncSession = Depends(get_db),
):
    workspace = await db.get(Workspace, workspace_id)
    if not workspace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="فضای کاری پیدا نشد")
    if payload.name is not None:
        workspace.name = payload.name
    if payload.system_prompt is not None:
        workspace.system_prompt = payload.system_prompt
    if payload.answer_mode is not None:
        workspace.answer_mode = payload.answer_mode
    await db.commit()
    await db.refresh(workspace)
    return WorkspaceOut.model_validate(workspace).model_copy(update={"is_manager": True})


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(
    workspace_id: uuid.UUID,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    workspace = await db.get(Workspace, workspace_id)
    if not workspace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="فضای کاری پیدا نشد")
    await db.delete(workspace)
    await db.commit()


@router.get("/{workspace_id}/members", response_model=list[WorkspaceMemberOut])
async def list_members(
    workspace_id: uuid.UUID,
    membership: tuple[User, bool] = Depends(require_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id)
    )
    return [
        WorkspaceMemberOut(id=m.id, user_id=u.id, email=u.email, is_manager=m.is_manager) for m, u in result.all()
    ]


@router.post("/{workspace_id}/members", response_model=WorkspaceMemberOut, status_code=status.HTTP_201_CREATED)
async def add_member(
    workspace_id: uuid.UUID,
    payload: WorkspaceMemberAdd,
    user: User = Depends(require_workspace_manager),
    db: AsyncSession = Depends(get_db),
):
    target = (await db.execute(select(User).where(User.email == payload.email))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="کاربری با این ایمیل پیدا نشد")
    existing = (
        await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == target.id
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="کاربر قبلاً عضو این فضای کاری است")
    member = WorkspaceMember(workspace_id=workspace_id, user_id=target.id, is_manager=payload.is_manager)
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return WorkspaceMemberOut(id=member.id, user_id=target.id, email=target.email, is_manager=member.is_manager)


@router.delete("/{workspace_id}/members/{member_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    workspace_id: uuid.UUID,
    member_user_id: uuid.UUID,
    user: User = Depends(require_workspace_manager),
    db: AsyncSession = Depends(get_db),
):
    member = (
        await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == member_user_id
            )
        )
    ).scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="عضو پیدا نشد")
    await db.delete(member)
    await db.commit()
