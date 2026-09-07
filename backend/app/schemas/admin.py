from datetime import datetime

from pydantic import BaseModel, Field, ValidationError, field_validator

from app.models.auth import MAX_USERNAME_LENGTH, NAME_SURNAME_MAX_LENGTH


class AdminUserFilters(BaseModel):
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    is_superuser: bool | None = None
    is_expired: bool | None = None


class AdminCreateUserSchema(BaseModel):
    username: str = Field(max_length=MAX_USERNAME_LENGTH)
    password: str
    first_name: str | None = Field(None, max_length=NAME_SURNAME_MAX_LENGTH)
    last_name: str | None = Field(None, max_length=NAME_SURNAME_MAX_LENGTH)
    expires_at: datetime | None = None
    is_superuser: bool = False


class AdminEditUserSchema(BaseModel):
    username: str | None = Field(None, max_length=MAX_USERNAME_LENGTH)
    first_name: str | None = Field(None, max_length=NAME_SURNAME_MAX_LENGTH)
    last_name: str | None = Field(None, max_length=NAME_SURNAME_MAX_LENGTH)
    expires_at: datetime | None = None
    is_superuser: bool | None = None

    @field_validator("username", "is_superuser")
    @classmethod
    def reject_none(cls, value):
        if value is None:
            raise ValidationError("Field cannot be None")
