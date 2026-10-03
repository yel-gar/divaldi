import os
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from starlette import status

from app.auth import hash_password
from app.deps import AdminUser, DbSession, ensure_can_assign_roles, ensure_outranks, require_admin
from app.models.auth import AccountRole, User
from app.schemas import MessageResponse
from app.schemas.admin import (
    AdminCreateUserSchema,
    AdminEditUserSchema,
    AdminSetPasswordSchema,
    AdminUserFilters,
)
from app.schemas.users import AdminUserSchema

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])

#: Fields `TEST_INSTANCE_MODE` refuses to touch. Renaming an account or moving it
#: between tiers is what makes a test instance irrecoverable, so it stays blocked.
TEST_INSTANCE_PROTECTED_FIELDS = {"username", "role"}


@router.get(
    "/users",
    response_model=list[AdminUserSchema],
    summary="Get all users, filtered by specified fields",
    responses={
        401: {"description": "Not authenticated, or session expired/invalid"},
        403: {"description": "The caller is neither an admin nor a superuser"},
    },
)
async def admin_get_users(
    db: DbSession,
    filters: Annotated[AdminUserFilters, Depends()],
    items_per_page: Annotated[int, Query(ge=1, le=1000)] = 50,
    page: Annotated[int, Query(ge=0, description="Current page, starting from zero")] = 0,
):
    conditions = []

    if filters.username is not None:
        conditions.append(User.username.ilike(f"%{filters.username}%"))

    if filters.first_name is not None:
        conditions.append(User.first_name.ilike(f"%{filters.first_name}%"))

    if filters.last_name is not None:
        conditions.append(User.last_name.ilike(f"%{filters.last_name}%"))

    if filters.role is not None:
        conditions.append(User.role == filters.role)

    if filters.is_expired is not None:
        now = datetime.now().astimezone()

        if filters.is_expired:
            conditions.append((User.expires_at.is_not(None)) & (User.expires_at <= now))
        else:
            conditions.append(
                (User.expires_at.is_(None)) | (User.expires_at > now),
            )

    query = select(User).where(*conditions).order_by(User.id).limit(items_per_page).offset(page * items_per_page)

    res = await db.execute(query)
    return res.scalars().all()


@router.get(
    "/users/{user_id}",
    response_model=AdminUserSchema,
    summary="Get user by ID",
    responses={
        401: {"description": "Not authenticated, or session expired/invalid"},
        403: {"description": "The caller is neither an admin nor a superuser"},
        404: {"description": "User not found"},
    },
)
async def admin_get_user(user_id: int, db: DbSession):
    """Return a single user by their id."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post(
    "/users/{user_id}/set-password",
    response_model=MessageResponse,
    summary="Set password of user by ID",
    responses={
        401: {"description": "Not authenticated, or session expired/invalid"},
        403: {"description": "The target is a superuser, or is of the caller's own tier or higher"},
        404: {"description": "User not found"},
        450: {"description": "Password changing is disabled on a test instance (`TEST_INSTANCE_MODE`)"},
    },
)
async def admin_user_set_password(user_id: int, db: DbSession, admin: AdminUser, data: AdminSetPasswordSchema):
    """Set the password of a user without knowing their old one.

    Existing sessions of that user are not invalidated. Superusers cannot be
    targeted, so another superuser can reset their password. An admin can only
    reset the password of a plain user.
    """
    if os.getenv("TEST_INSTANCE_MODE", "false") in {"true", "yes", "1"}:
        raise HTTPException(status_code=450, detail="Password changing on test instance is not allowed")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role is AccountRole.SUPERUSER:
        raise HTTPException(status_code=403, detail="You can't change password of superuser")
    ensure_outranks(admin, user)
    user.password_hash = hash_password(data.password)
    await db.commit()
    return MessageResponse(message="Password changed successfully")


@router.patch(
    "/users/{user_id}",
    response_model=AdminUserSchema,
    summary="Edit user by ID. Returns updated user",
    responses={
        401: {"description": "Not authenticated, or session expired/invalid"},
        403: {
            "description": "The target is of the caller's own tier or higher, or the caller "
            "is not a superuser and tried to change a role"
        },
        404: {"description": "User not found"},
        409: {"description": "The new username is already taken by another user"},
        450: {"description": "Changing `username` or `role` is disabled " "on a test instance (`TEST_INSTANCE_MODE`)"},
    },
)
async def admin_edit_user(user_id: int, db: DbSession, admin: AdminUser, data: AdminEditUserSchema):
    """Update the fields present in the request body and return the updated user.

    Fields left out of the body are untouched. `username` and `role` cannot be
    set to null, and only a superuser may change a role.
    """
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    updates = data.model_dump(exclude_unset=True)
    if updates.keys() & TEST_INSTANCE_PROTECTED_FIELDS and os.getenv("TEST_INSTANCE_MODE", "false") in {
        "true",
        "yes",
        "1",
    }:
        raise HTTPException(status_code=450, detail="Username/role changing on test instance is not allowed")

    ensure_outranks(admin, user)
    if "role" in updates:
        ensure_can_assign_roles(admin)

    for attr, val in updates.items():
        setattr(user, attr, val)

    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail="User already exists") from e

    await db.refresh(user)
    return user


@router.delete(
    "/users/{user_id}",
    response_model=AdminUserSchema,
    summary="Delete user by ID. Returns deleted user",
    description="You cannot delete superusers, demote them first. Admins can only delete plain users.",
    responses={
        401: {"description": "Not authenticated, or session expired/invalid"},
        403: {"description": "The target is a superuser, or is of the caller's own tier or higher"},
        404: {"description": "User not found"},
        450: {"description": "Deleting users is disabled on a test instance (`TEST_INSTANCE_MODE`)"},
    },
)
async def admin_delete_user(user_id: int, db: DbSession, admin: AdminUser):
    """Delete a user along with their sessions and chat sessions.

    Superusers cannot be deleted; demote them with `PATCH /admin/users/{user_id}`
    first. An admin can only delete a plain user.
    """
    if os.getenv("TEST_INSTANCE_MODE", "false") in {"true", "yes", "1"}:
        raise HTTPException(status_code=450, detail="Deleting users on test instance is not allowed")
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role is AccountRole.SUPERUSER:
        raise HTTPException(status_code=403, detail="Superuser can't be deleted")
    ensure_outranks(admin, user)
    await db.delete(user)
    await db.commit()
    return user


@router.post(
    "/users",
    response_model=AdminUserSchema,
    status_code=status.HTTP_201_CREATED,
    summary="Create user",
    responses={
        401: {"description": "Not authenticated, or session expired/invalid"},
        403: {
            "description": "The caller is neither an admin nor a superuser, or is not a "
            "superuser and tried to create an elevated account"
        },
        409: {"description": "A user with this username already exists"},
    },
)
async def admin_create_user(db: DbSession, admin: AdminUser, data: AdminCreateUserSchema):
    """Create a user and return it.

    The password is hashed before storage and is never returned. `expires_at`
    is optional; a null value means the account does not expire. Only a
    superuser may create an account above the `user` tier.
    """
    if data.role is not AccountRole.USER:
        ensure_can_assign_roles(admin)
    password_hash = hash_password(data.password)
    user = User(password_hash=password_hash, **data.model_dump(exclude={"password"}))
    db.add(user)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail="User already exists") from e

    await db.refresh(user)
    return user
