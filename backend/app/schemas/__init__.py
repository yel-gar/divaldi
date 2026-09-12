from typing import Annotated

from pydantic import BaseModel, Field

MAX_PASSWORD_LENGTH = 128
PasswordField = Annotated[str, Field(min_length=8, max_length=MAX_PASSWORD_LENGTH)]


class MessageResponse(BaseModel):
    message: str
