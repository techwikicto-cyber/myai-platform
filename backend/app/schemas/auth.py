import uuid

from pydantic import BaseModel, EmailStr

from app.models.user import UserRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class OnboardingRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(BaseModel):
    id: uuid.UUID
    email: EmailStr
    role: UserRole
    is_active: bool

    model_config = {"from_attributes": True}


class SystemStatus(BaseModel):
    needs_onboarding: bool


TokenResponse.model_rebuild()
