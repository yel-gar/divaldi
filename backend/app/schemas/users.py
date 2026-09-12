from datetime import datetime

from pydantic import BaseModel

from app.schemas import PasswordField


class UserSchema(BaseModel):
    id: int
    username: str
    first_name: str | None
    last_name: str | None
    is_superuser: bool

    model_config = {"from_attributes": True}


class AdminUserSchema(UserSchema):
    expires_at: datetime | None


class SetPasswordSchema(BaseModel):
    old_password: PasswordField
    new_password: PasswordField
