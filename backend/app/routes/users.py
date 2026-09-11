from fastapi import APIRouter, HTTPException

from app.auth import verify_password
from app.deps import CurrentUser
from app.schemas import MessageResponse
from app.schemas.users import SetPasswordSchema, UserSchema

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserSchema, summary="Get current authenticated user")
async def users_me(user: CurrentUser):
    return user


@router.get("/me/set-password", response_model=MessageResponse, summary="Set password of current user")
async def users_set_password(user: CurrentUser, data: SetPasswordSchema):
    if not verify_password(user.password_hash, data.old_password):
        raise HTTPException(status_code=400, detail="Bad old password")
