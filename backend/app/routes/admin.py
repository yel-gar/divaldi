from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth import hash_password
from app.deps import DbSession, require_admin
from app.models.auth import User
from app.schemas.admin import AdminCreateUserSchema, AdminEditUserSchema, AdminUserFilters
from app.schemas.users import AdminUserSchema

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/users", response_model=list[AdminUserSchema], summary="Get all users, filtered by specified fields")
async def admin_get_users(
    db: DbSession,
    filters: AdminUserFilters = Depends(),
):
    conditions = []

    if filters.username is not None:
        conditions.append(User.username.ilike(f"%{filters.username}%"))

    if filters.first_name is not None:
        conditions.append(User.first_name.ilike(f"%{filters.first_name}%"))

    if filters.last_name is not None:
        conditions.append(User.last_name.ilike(f"%{filters.last_name}%"))

    if filters.is_superuser is not None:
        conditions.append(User.is_superuser == filters.is_superuser)

    if filters.is_expired is not None:
        now = datetime.now().astimezone()

        if filters.is_expired:
            conditions.append((User.expires_at.is_not(None)) & (User.expires_at <= now))
        else:
            conditions.append(
                (User.expires_at.is_(None)) | (User.expires_at > now),
            )

    query = select(User).where(*conditions)

    res = await db.execute(query)
    return res.scalars().all()


@router.get("/users/{user_id}", response_model=AdminUserSchema, summary="Get user by ID")
async def admin_get_user(user_id: int, db: DbSession):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch("/users/{user_id}", response_model=AdminUserSchema, summary="Edit user by ID. Returns updated user")
async def admin_edit_user(user_id: int, db: DbSession, data: AdminEditUserSchema):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    for attr, val in data.model_dump(exclude_unset=True).items():
        setattr(user, attr, val)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="User already exists")

    await db.refresh(user)
    return user


@router.delete(
    "/users/{user_id}",
    response_model=AdminUserSchema,
    summary="Delete user by ID. Returns deleted user",
    description="You cannot delete superusers, demote them first",
)
async def admin_delete_user(user_id: int, db: DbSession):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_superuser:
        raise HTTPException(status_code=403, detail="Superuser can't be deleted")
    await db.delete(user)
    await db.commit()
    return user


@router.post("/users/create", response_model=AdminUserSchema)
async def admin_create_user(db: DbSession, data: AdminCreateUserSchema):
    password_hash = hash_password(data.password)
    user = User(password_hash=password_hash, **data.model_dump(exclude={"password"}))
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="User already exists")

    await db.refresh(user)
    return user
