import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_admin
from app.models.user import User, UserRole
from app.models.workspace import Workspace
from app.models.db_connection import DbConnection
from app.models.document import Document
from app.schemas.user import UserCreate, UserOut, UserUpdate
from app.security import hash_password

# Public router for listing users (accessible by admin + manager)
router = APIRouter(prefix="/api/users", tags=["users"])

# Admin-only sub-router for mutations
admin_router = APIRouter(prefix="/api/users", tags=["users"], dependencies=[Depends(require_admin)])


@router.get("", response_model=list[UserOut])
async def list_users(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List users. Admin sees all; manager sees non-admin users to assign to workspaces."""
    if user.role == UserRole.admin:
        result = await db.execute(select(User).order_by(User.created_at))
    elif user.role == UserRole.manager:
        result = await db.execute(
            select(User).where(User.role != UserRole.admin).order_by(User.created_at)
        )
    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="دسترسی ندارید")
    return result.scalars().all()


@admin_router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="این ایمیل قبلاً ثبت شده است")
    user = User(email=payload.email, password_hash=hash_password(payload.password), role=payload.role)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@admin_router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    current_admin: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="کاربر پیدا نشد")
    if user.id == current_admin.id:
        if payload.is_active is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="نمی‌توانید حساب کاربری خودتان را غیرفعال کنید",
            )
        if payload.role is not None and payload.role != UserRole.admin:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="نمی‌توانید نقش ادمین خود را تغییر دهید",
            )
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.password:
        user.password_hash = hash_password(payload.password)
    await db.commit()
    await db.refresh(user)
    return user


@admin_router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="کاربر پیدا نشد")
        
    # Manually nullify foreign keys since the live database may lack ON DELETE SET NULL
    await db.execute(update(Workspace).where(Workspace.created_by == user_id).values(created_by=None))
    await db.execute(update(DbConnection).where(DbConnection.created_by == user_id).values(created_by=None))
    await db.execute(update(Document).where(Document.uploaded_by == user_id).values(uploaded_by=None))
    
    await db.delete(user)
    await db.commit()

