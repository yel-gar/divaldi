from fastapi import APIRouter

from app.deps import CurrentUser
from app.schemas.users import UserSchema

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserSchema, summary="Get current authenticated user")
async def users_me(user: CurrentUser):
    return user
