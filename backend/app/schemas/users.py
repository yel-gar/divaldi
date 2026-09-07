from pydantic import BaseModel


class UserSchema(BaseModel):
    id: int
    username: str
    first_name: str | None
    last_name: str | None

    model_config = {"from_attributes": True}
