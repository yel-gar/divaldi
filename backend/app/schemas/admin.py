from datetime import datetime

from pydantic import BaseModel, ValidationError, field_validator


class AdminUserFilters(BaseModel):
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    is_superuser: bool | None = None
    is_expired: bool | None = None


class AdminCreateUserSchema(BaseModel):
    username: str
    password: str
    first_name: str | None = None
    last_name: str | None = None
    expires_at: datetime | None = None
    is_superuser: bool = False


class AdminEditUserSchema(BaseModel):
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    expires_at: datetime | None = None
    is_superuser: bool | None = None

    @field_validator("username", "is_superuser")
    @classmethod
    def reject_none(cls, value):
        if value is None:
            raise ValidationError("Field cannot be None")
