from pydantic import BaseModel, Field

from app.models.auth import MAX_USERNAME_LENGTH
from app.schemas import PasswordField


class UserLogin(BaseModel):
    username: str = Field(max_length=MAX_USERNAME_LENGTH)
    password: PasswordField
