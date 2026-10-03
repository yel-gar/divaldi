import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import hash_password
from app.models.auth import AccountRole, User

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
    assert data[0]["role"] == "superuser"


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
    client: AsyncClient,
    admin_client: AsyncClient,
    test_user: User,
    db_session: AsyncSession,
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
    assert data["role"] == "superuser"


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
            "role": "user",
        },
    )

    assert response.status_code == 201

    data = response.json()

    assert data["username"] == "john"
    assert data["first_name"] == "John"
    assert data["last_name"] == "Doe"
    assert data["role"] == "user"

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
    assert data["role"] == "user"


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
async def test_filter_by_role(
    admin_client: AsyncClient,
    test_admin_user: User,
    test_user: User,
):
    response = await admin_client.get(
        "/admin/users",
        params={"role": "superuser"},
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
            role=AccountRole.USER,
        ),
        User(
            username="john-admin",
            password_hash=hash_password("password1234"),
            first_name="John",
            role=AccountRole.SUPERUSER,
        ),
        User(
            username="alice",
            password_hash=hash_password("password1234"),
            first_name="Alice",
            role=AccountRole.USER,
        ),
    ]

    db_session.add_all(users)
    await db_session.commit()

    response = await admin_client.get(
        "/admin/users",
        params={
            "username": "john",
            "first_name": "john",
            "role": "user",
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert len(data) == 1
    assert data[0]["username"] == "john"


# ---------------------------------------------------------------------------
# Tiers: admin manages plain users, superuser manages admins
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_plain_user_is_refused_by_the_admin_api(client: AsyncClient, test_user: User):
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    response = await client.get("/admin/users")

    assert response.status_code == 403
    assert response.json()["detail"] == "You're not an admin"


@pytest.mark.asyncio
async def test_admin_tier_manages_plain_users(tier_admin_client: AsyncClient, test_user: User):
    """The new tier has the same day-to-day powers a superuser always had."""
    listing = await tier_admin_client.get("/admin/users")
    assert listing.status_code == 200
    assert {user["username"] for user in listing.json()} == {"tier-admin", "test"}

    edited = await tier_admin_client.patch(f"/admin/users/{test_user.id}", json={"first_name": "Jane"})
    assert edited.status_code == 200
    assert edited.json()["first_name"] == "Jane"

    created = await tier_admin_client.post(
        "/admin/users",
        json={"username": "newcomer", "password": "password1234"},
    )
    assert created.status_code == 201
    assert created.json()["role"] == "user"

    deleted = await tier_admin_client.delete(f"/admin/users/{test_user.id}")
    assert deleted.status_code == 200


@pytest.mark.asyncio
async def test_admin_tier_cannot_promote_anyone(tier_admin_client: AsyncClient, test_user: User):
    response = await tier_admin_client.patch(f"/admin/users/{test_user.id}", json={"role": "admin"})

    assert response.status_code == 403
    assert response.json()["detail"] == "Only a superuser can change roles"


@pytest.mark.asyncio
async def test_admin_tier_cannot_create_an_elevated_account(tier_admin_client: AsyncClient):
    response = await tier_admin_client.post(
        "/admin/users",
        json={"username": "wannabe", "password": "password1234", "role": "admin"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Only a superuser can change roles"


@pytest.mark.asyncio
async def test_admin_tier_cannot_create_a_superuser(tier_admin_client: AsyncClient):
    response = await tier_admin_client.post(
        "/admin/users",
        json={"username": "wannabe-root", "password": "password1234", "role": "superuser"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Only a superuser can change roles"


@pytest.mark.asyncio
async def test_admin_tier_cannot_edit_another_admin(tier_admin_client: AsyncClient, db_session: AsyncSession):
    peer = User(
        username="second-admin",
        password_hash=hash_password("password1234"),
        role=AccountRole.ADMIN,
    )
    db_session.add(peer)
    await db_session.commit()

    response = await tier_admin_client.patch(f"/admin/users/{peer.id}", json={"first_name": "Mallory"})

    assert response.status_code == 403
    assert response.json()["detail"] == "You can't manage a user of the same or a higher tier"


@pytest.mark.asyncio
async def test_admin_tier_cannot_delete_another_admin(tier_admin_client: AsyncClient, db_session: AsyncSession):
    peer = User(
        username="second-admin",
        password_hash=hash_password("password1234"),
        role=AccountRole.ADMIN,
    )
    db_session.add(peer)
    await db_session.commit()

    response = await tier_admin_client.delete(f"/admin/users/{peer.id}")

    assert response.status_code == 403
    assert await db_session.get(User, peer.id) is not None


@pytest.mark.asyncio
async def test_admin_tier_cannot_reset_another_admin_password(tier_admin_client: AsyncClient, db_session: AsyncSession):
    peer = User(
        username="second-admin",
        password_hash=hash_password("password1234"),
        role=AccountRole.ADMIN,
    )
    db_session.add(peer)
    await db_session.commit()

    response = await tier_admin_client.post(f"/admin/users/{peer.id}/set-password", json={"password": "hijacked12345"})

    assert response.status_code == 403
    assert response.json()["detail"] == "You can't manage a user of the same or a higher tier"


@pytest.mark.asyncio
async def test_admin_tier_cannot_act_on_itself(tier_admin_client: AsyncClient, test_tier_admin_user: User):
    """The rank comparison is strict, so peers and self are both off limits."""
    response = await tier_admin_client.patch(f"/admin/users/{test_tier_admin_user.id}", json={"first_name": "Renamed"})

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_superuser_promotes_and_demotes(admin_client: AsyncClient, test_user: User, db_session: AsyncSession):
    promoted = await admin_client.patch(f"/admin/users/{test_user.id}", json={"role": "admin"})
    assert promoted.status_code == 200
    assert promoted.json()["role"] == "admin"

    await db_session.refresh(test_user)
    assert test_user.role is AccountRole.ADMIN

    demoted = await admin_client.patch(f"/admin/users/{test_user.id}", json={"role": "user"})
    assert demoted.status_code == 200
    assert demoted.json()["role"] == "user"


@pytest.mark.asyncio
async def test_superuser_creates_an_admin(admin_client: AsyncClient, db_session: AsyncSession):
    response = await admin_client.post(
        "/admin/users",
        json={"username": "made-admin", "password": "password1234", "role": "admin"},
    )

    assert response.status_code == 201
    assert response.json()["role"] == "admin"


@pytest.mark.asyncio
async def test_role_change_is_blocked_on_a_test_instance(admin_client: AsyncClient, test_user: User, monkeypatch):
    monkeypatch.setenv("TEST_INSTANCE_MODE", "true")

    response = await admin_client.patch(f"/admin/users/{test_user.id}", json={"role": "admin"})

    assert response.status_code == 450
    assert "test instance" in response.json()["detail"]


@pytest.mark.asyncio
async def test_username_change_is_blocked_on_a_test_instance(admin_client: AsyncClient, test_user: User, monkeypatch):
    monkeypatch.setenv("TEST_INSTANCE_MODE", "true")

    response = await admin_client.patch(f"/admin/users/{test_user.id}", json={"username": "renamed"})

    assert response.status_code == 450


@pytest.mark.asyncio
async def test_delete_is_blocked_on_a_test_instance(admin_client: AsyncClient, test_user: User, monkeypatch):
    monkeypatch.setenv("TEST_INSTANCE_MODE", "true")

    response = await admin_client.delete(f"/admin/users/{test_user.id}")

    assert response.status_code == 450
    assert "test instance" in response.json()["detail"]


@pytest.mark.asyncio
async def test_edit_rejects_a_null_role(admin_client: AsyncClient, test_user: User):
    response = await admin_client.patch(f"/admin/users/{test_user.id}", json={"role": None})

    assert response.status_code == 422
