from fastapi import APIRouter

from app.deps import CurrentUser
from app.schemas.users import UserSchema

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserSchema)
async def users_me(user: CurrentUser):
    return user
