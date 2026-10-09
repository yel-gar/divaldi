import os
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from starlette import status

from app.auth import hash_password
from app.deps import AdminUser, DbSession, ensure_can_assign_roles, ensure_outranks, require_admin
from app.models.auth import AccountRole, User
from app.models.settings import SETTINGS_ROW_ID, Settings
from app.schemas import MessageResponse
from app.schemas.admin import (
    AdminCreateUserSchema,
    AdminEditUserSchema,
    AdminRatesSchema,
    AdminSetPasswordSchema,
    AdminSettingsResponse,
    AdminSettingsUpdate,
    AdminUserFilters,
    default_rates,
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


async def _save_settings(db, data: AdminSettingsUpdate, admin: User) -> Settings:
    """Apply an update to the singleton settings row and persist it.

    The row does not exist until the first PUT, so two admins saving at the same time
    both read "no row", both add `Settings(id=1)`, and the loser's INSERT trips the
    primary key. Returning an error there would silently discard that admin's change,
    so the loser adopts the row the winner just inserted and re-applies its own update
    on top: the last write wins, which is what two sequential saves would have done.
    """
    settings = await db.get(Settings, SETTINGS_ROW_ID)
    if settings is None:
        settings = Settings(id=SETTINGS_ROW_ID)
        db.add(settings)
    # Read before the rollback, not inside the recovery path: a rollback expires every
    # instance in the session, and touching `admin.id` afterwards would trigger an
    # implicit refresh that async SQLAlchemy refuses with MissingGreenlet.
    admin_id = admin.id
    stamp = datetime.now(tz=UTC)
    _apply_settings(settings, data, admin_id, stamp)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        settings = await db.get(Settings, SETTINGS_ROW_ID)
        if settings is None:
            # The other transaction rolled back as well, so there is nothing to adopt.
            # Its author retries and gets the row they expected.
            raise HTTPException(status_code=409, detail="Settings are being saved at the same time, retry") from e
        _apply_settings(settings, data, admin_id, stamp)
        await db.commit()
    await db.refresh(settings)
    return settings


def _apply_settings(settings: Settings, data: AdminSettingsUpdate, admin_id: int, stamp: datetime) -> None:
    """Write the requested fields onto a settings row and stamp the audit fields.

    Separate from the commit so the recovery path can re-apply the same changes to the
    row another request created, and takes plain values rather than the `User` so that
    nothing here can reach the database.
    """
    sent = data.model_fields_set
    if "prompt_extension" in sent:
        settings.prompt_extension = data.prompt_extension.strip()
    if "parameters" in sent:
        # An explicit null is the reset; absent is handled by not being in `sent`. A
        # malformed rate object is rejected by the schema, so this only ever sees a
        # validated model or a deliberate null.
        settings.parameters = None if data.parameters is None else data.parameters.model_dump()
    settings.last_update_by = admin_id
    settings.last_update_at = stamp


def _as_settings_response(settings: Settings) -> AdminSettingsResponse:
    return AdminSettingsResponse(
        prompt_extension=settings.prompt_extension,
        parameters=AdminRatesSchema(**settings.parameters) if settings.parameters else default_rates(),
        last_update_by=settings.last_update_by,
        last_update_at=settings.last_update_at,
    )


@router.get(
    "/settings",
    response_model=AdminSettingsResponse,
    summary="Get the instance settings",
    responses={
        401: {"description": "Not authenticated, or session expired/invalid"},
        403: {"description": "The caller is neither an admin nor a superuser"},
    },
)
async def admin_get_settings(db: DbSession):
    """Return the instance-wide settings.

    An instance that has never been configured returns an empty
    `prompt_extension`, the default rates and null audit fields rather than 404:
    there is exactly one settings row conceptually, and it simply holds no value
    yet. The rates reported are the effective ones, so the response is directly
    renderable as a form.
    """
    settings = await db.get(Settings, SETTINGS_ROW_ID)
    if settings is None:
        return AdminSettingsResponse(
            prompt_extension="", parameters=default_rates(), last_update_by=None, last_update_at=None
        )
    return _as_settings_response(settings)


@router.put(
    "/settings",
    response_model=AdminSettingsResponse,
    summary="Update the instance settings",
    responses={
        401: {"description": "Not authenticated, or session expired/invalid"},
        403: {"description": "The caller is neither an admin nor a superuser"},
    },
)
async def admin_update_settings(data: AdminSettingsUpdate, db: DbSession, admin: AdminUser):
    """Update the instance-wide settings and return the stored result.

    Only the fields present in the body are touched, so an option added to the
    payload later will not disturb this one. Saving stamps both audit fields with
    the acting account.

    `prompt_extension` is appended to the end of the system prompt of every chat
    created *after* this call; chats already in progress keep the prompt they
    started with. An empty string is the reset.

    `parameters` replaces the stored rates wholesale and must name all four when
    present. Sending it as `null` restores the defaults, which is the way back from
    a bad edit; omitting it leaves the current rates alone.

    Deliberately not blocked by `TEST_INSTANCE_MODE`, unlike the account
    mutations: this touches no credentials and no ownership, and is undone by
    saving an empty string or `null` rates.
    """
    settings = await _save_settings(db, data, admin)
    return _as_settings_response(settings)
