from pydantic import BaseModel, Field

from app.models.auth import MAX_USERNAME_LENGTH


class UserLogin(BaseModel):
    username: str = Field(max_length=MAX_USERNAME_LENGTH)
    password: str
