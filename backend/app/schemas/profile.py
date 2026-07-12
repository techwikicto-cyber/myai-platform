from pydantic import BaseModel

class ProfileUpdate(BaseModel):
    full_name: str | None = None
    profile_picture: str | None = None  # Base64

class PasswordChange(BaseModel):
    current_password: str
    new_password: str
