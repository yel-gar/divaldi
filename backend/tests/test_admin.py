import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import hash_password
from app.models.auth import User

# ---------------------------------------------------------------------------
# GET /admin/users
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_users(
    admin_client: AsyncClient,
    test_admin_user: User,
):
    response = await admin_client.get("/admin/users")

    assert response.status_code == 200

    data = response.json()

    assert len(data) == 1
    assert data[0]["id"] == test_admin_user.id
    assert data[0]["username"] == "admin"
    assert data[0]["is_superuser"] is True


@pytest.mark.asyncio
async def test_get_users_with_filters(
    admin_client: AsyncClient,
    test_admin_user: User,
    test_user: User,
):
    response = await admin_client.get(
        "/admin/users",
        params={"username": "test"},
    )

    assert response.status_code == 200

    data = response.json()

    assert len(data) == 1
    assert data[0]["id"] == test_user.id


@pytest.mark.asyncio
async def test_get_users_paginated(admin_client: AsyncClient, db_session: AsyncSession, test_100_users: list[User]):
    response = await admin_client.get("/admin/users", params={"page": 0, "items_per_page": 50})
    assert response.status_code == 200

    data_50 = response.json()

    response = await admin_client.get("/admin/users", params={"page": 0, "items_per_page": 1})
    assert response.status_code == 200

    data_0 = response.json()
    assert data_0[0] == data_50[0]

    response = await admin_client.get("/admin/users", params={"page": 1, "items_per_page": 1})
    assert response.status_code == 200

    data_1 = response.json()
    assert data_1[0] == data_50[1]


# ---------------------------------------------------------------------------
# POST /admin/users/{user_id}/set-password
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_set_password(
    client: AsyncClient, admin_client: AsyncClient, test_user: User, db_session: AsyncSession
):
    new_password = "balls34981792"
    response = await admin_client.post(f"/admin/users/{test_user.id}/set-password", json={"password": new_password})
    assert response.status_code == 200

    response = await client.post("/auth/login", json={"username": "test", "password": new_password})
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# GET /admin/users/{user_id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_user(
    admin_client: AsyncClient,
    test_admin_user: User,
):
    response = await admin_client.get(
        f"/admin/users/{test_admin_user.id}",
    )

    assert response.status_code == 200

    data = response.json()

    assert data["id"] == test_admin_user.id
    assert data["username"] == "admin"
    assert data["is_superuser"] is True


@pytest.mark.asyncio
async def test_get_user_not_found(
    admin_client: AsyncClient,
):
    response = await admin_client.get("/admin/users/999999")

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


# ---------------------------------------------------------------------------
# POST /admin/users/create
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_user(
    admin_client: AsyncClient,
):
    response = await admin_client.post(
        "/admin/users",
        json={
            "username": "john",
            "password": "password1234",
            "first_name": "John",
            "last_name": "Doe",
            "is_superuser": False,
        },
    )

    assert response.status_code == 201

    data = response.json()

    assert data["username"] == "john"
    assert data["first_name"] == "John"
    assert data["last_name"] == "Doe"
    assert data["is_superuser"] is False

    # Sensitive fields must not be exposed.
    assert "password" not in data
    assert "password_hash" not in data


@pytest.mark.asyncio
async def test_create_duplicate_user(
    admin_client: AsyncClient,
    test_user: User,
):
    response = await admin_client.post(
        "/admin/users",
        json={
            "username": test_user.username,
            "password": "password1234",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "User already exists"


# ---------------------------------------------------------------------------
# PATCH /admin/users/{user_id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_edit_user(
    admin_client: AsyncClient,
    test_user: User,
):
    response = await admin_client.patch(
        f"/admin/users/{test_user.id}",
        json={
            "first_name": "John",
            "last_name": "Doe",
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert data["id"] == test_user.id
    assert data["username"] == "test"
    assert data["first_name"] == "John"
    assert data["last_name"] == "Doe"
    assert data["is_superuser"] is False


@pytest.mark.asyncio
async def test_edit_user_partial(
    admin_client: AsyncClient,
    test_user: User,
):
    response = await admin_client.patch(
        f"/admin/users/{test_user.id}",
        json={
            "first_name": "John",
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert data["first_name"] == "John"
    assert data["last_name"] is None
    assert data["username"] == "test"


@pytest.mark.asyncio
async def test_edit_user_not_found(
    admin_client: AsyncClient,
):
    response = await admin_client.patch(
        "/admin/users/999999",
        json={"first_name": "John"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


@pytest.mark.asyncio
async def test_edit_user_duplicate_username(
    admin_client: AsyncClient,
    test_user: User,
    db_session: AsyncSession,
):
    other_user = User(
        username="other",
        password_hash=hash_password("password1234"),
    )
    db_session.add(other_user)
    await db_session.commit()
    await db_session.refresh(other_user)

    response = await admin_client.patch(
        f"/admin/users/{other_user.id}",
        json={"username": test_user.username},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "User already exists"


# ---------------------------------------------------------------------------
# DELETE /admin/users/{user_id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_user(
    admin_client: AsyncClient,
    test_user: User,
    db_session: AsyncSession,
):
    user_id = test_user.id

    response = await admin_client.delete(
        f"/admin/users/{user_id}",
    )

    assert response.status_code == 200

    data = response.json()

    assert data["id"] == user_id
    assert data["username"] == "test"

    # Verify the user was actually deleted.
    assert await db_session.get(User, user_id) is None


@pytest.mark.asyncio
async def test_delete_user_not_found(
    admin_client: AsyncClient,
):
    response = await admin_client.delete("/admin/users/999999")

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


@pytest.mark.asyncio
async def test_delete_superuser(
    admin_client: AsyncClient,
    test_admin_user: User,
):
    response = await admin_client.delete(
        f"/admin/users/{test_admin_user.id}",
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Superuser can't be deleted"


# ---------------------------------------------------------------------------
# User filters
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_filter_by_username(
    admin_client: AsyncClient,
    db_session: AsyncSession,
):
    users = [
        User(
            username="john",
            password_hash=hash_password("password1234"),
        ),
        User(
            username="johnny",
            password_hash=hash_password("password1234"),
        ),
        User(
            username="alice",
            password_hash=hash_password("password1234"),
        ),
    ]

    db_session.add_all(users)
    await db_session.commit()

    response = await admin_client.get(
        "/admin/users",
        params={"username": "john"},
    )

    assert response.status_code == 200

    data = response.json()

    assert {user["username"] for user in data} == {
        "john",
        "johnny",
    }


@pytest.mark.asyncio
async def test_filter_by_first_name(
    admin_client: AsyncClient,
    db_session: AsyncSession,
):
    users = [
        User(
            username="john",
            password_hash=hash_password("password1234"),
            first_name="John",
        ),
        User(
            username="alice",
            password_hash=hash_password("password1234"),
            first_name="Alice",
        ),
        User(
            username="johnny",
            password_hash=hash_password("password1234"),
            first_name="Johnny",
        ),
    ]

    db_session.add_all(users)
    await db_session.commit()

    response = await admin_client.get(
        "/admin/users",
        params={"first_name": "john"},
    )

    assert response.status_code == 200

    data = response.json()

    assert {user["username"] for user in data} == {
        "john",
        "johnny",
    }


@pytest.mark.asyncio
async def test_filter_by_last_name(
    admin_client: AsyncClient,
    db_session: AsyncSession,
):
    users = [
        User(
            username="john",
            password_hash=hash_password("password1234"),
            last_name="Smith",
        ),
        User(
            username="alice",
            password_hash=hash_password("password1234"),
            last_name="Smith",
        ),
        User(
            username="bob",
            password_hash=hash_password("password1234"),
            last_name="Jones",
        ),
    ]

    db_session.add_all(users)
    await db_session.commit()

    response = await admin_client.get(
        "/admin/users",
        params={"last_name": "smith"},
    )

    assert response.status_code == 200

    data = response.json()

    assert {user["username"] for user in data} == {
        "john",
        "alice",
    }


@pytest.mark.asyncio
async def test_filter_by_is_superuser(
    admin_client: AsyncClient,
    test_admin_user: User,
    test_user: User,
):
    response = await admin_client.get(
        "/admin/users",
        params={"is_superuser": "true"},
    )

    assert response.status_code == 200

    data = response.json()

    assert {user["username"] for user in data} == {"admin"}


@pytest.mark.asyncio
async def test_filter_by_expired(
    admin_client: AsyncClient,
    db_session: AsyncSession,
):
    now = datetime.datetime.now(datetime.UTC)

    expired = User(
        username="expired",
        password_hash=hash_password("password1234"),
        expires_at=now - datetime.timedelta(days=1),
    )

    active = User(
        username="active",
        password_hash=hash_password("password1234"),
        expires_at=now + datetime.timedelta(days=1),
    )

    never_expires = User(
        username="never",
        password_hash=hash_password("password1234"),
        expires_at=None,
    )

    db_session.add_all(
        [
            expired,
            active,
            never_expires,
        ]
    )
    await db_session.commit()

    response = await admin_client.get(
        "/admin/users",
        params={"is_expired": "true"},
    )

    assert response.status_code == 200

    data = response.json()

    assert {user["username"] for user in data} == {"expired"}


@pytest.mark.asyncio
async def test_filter_by_not_expired(
    admin_client: AsyncClient,
    db_session: AsyncSession,
):
    now = datetime.datetime.now(datetime.UTC)

    expired = User(
        username="expired",
        password_hash=hash_password("password1234"),
        expires_at=now - datetime.timedelta(days=1),
    )

    active = User(
        username="active",
        password_hash=hash_password("password1234"),
        expires_at=now + datetime.timedelta(days=1),
    )

    never_expires = User(
        username="never",
        password_hash=hash_password("password1234"),
        expires_at=None,
    )

    db_session.add_all(
        [
            expired,
            active,
            never_expires,
        ]
    )
    await db_session.commit()

    response = await admin_client.get(
        "/admin/users",
        params={"is_expired": "false"},
    )

    assert response.status_code == 200

    data = response.json()

    assert {user["username"] for user in data} == {"active", "never", "admin"}


@pytest.mark.asyncio
async def test_combined_filters(
    admin_client: AsyncClient,
    test_admin_user: User,
    db_session: AsyncSession,
):
    users = [
        User(
            username="john",
            password_hash=hash_password("password1234"),
            first_name="John",
            is_superuser=False,
        ),
        User(
            username="john-admin",
            password_hash=hash_password("password1234"),
            first_name="John",
            is_superuser=True,
        ),
        User(
            username="alice",
            password_hash=hash_password("password1234"),
            first_name="Alice",
            is_superuser=False,
        ),
    ]

    db_session.add_all(users)
    await db_session.commit()

    response = await admin_client.get(
        "/admin/users",
        params={
            "username": "john",
            "first_name": "john",
            "is_superuser": "false",
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert len(data) == 1
    assert data[0]["username"] == "john"
