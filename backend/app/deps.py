import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User, UserRole
from app.models.workspace import WorkspaceMember
from app.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


async def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    unauthorized = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="احراز هویت نامعتبر است")
    if not token:
        raise unauthorized
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise unauthorized
    try:
        user_id = uuid.UUID(payload["sub"])
    except ValueError:
        raise unauthorized
    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise unauthorized
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="فقط ادمین سیستم اجازه دارد")
    return user


async def get_workspace_membership(
    workspace_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> WorkspaceMember | None:
    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user.id,
        )
    )
    return result.scalar_one_or_none()


async def require_workspace_member(
    workspace_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> tuple[User, bool]:
    """Returns (user, is_manager_for_this_workspace). Admins pass with is_manager=True."""
    if user.role == UserRole.admin:
        return user, True
    membership = await get_workspace_membership(workspace_id, user, db)
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="عضو این فضای کاری نیستید")
    return user, membership.is_manager


async def require_workspace_manager(
    workspace_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    if user.role == UserRole.admin:
        return user
    membership = await get_workspace_membership(workspace_id, user, db)
    if not membership or not membership.is_manager:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="فقط مدیر فضای کاری اجازه دارد")
    return user
