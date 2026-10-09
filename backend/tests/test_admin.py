import datetime
from dataclasses import fields

import pytest
from httpx import AsyncClient
from processing.calculator.calc import DEFAULT_PARAMETERS, Parameters
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import hash_password
from app.models.auth import AccountRole, User
from app.models.settings import MAX_PROMPT_EXTENSION_LENGTH, SETTINGS_ROW_ID, Settings
from app.schemas.admin import AdminRatesSchema

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


# ---------------------------------------------------------------------------
# GET/PUT /admin/settings
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_settings_defaults_when_never_configured(admin_client: AsyncClient):
    """An untouched instance reports an empty extension, not a 404.

    There is one settings row conceptually; it simply holds no value yet, so the
    frontend can render the form without treating absence as an error.
    """
    response = await admin_client.get("/admin/settings")

    assert response.status_code == 200
    assert response.json()["prompt_extension"] == ""
    assert response.json()["last_update_by"] is None
    assert response.json()["last_update_at"] is None


@pytest.mark.asyncio
async def test_update_settings_stores_the_extension_and_stamps_the_audit_fields(
    admin_client: AsyncClient,
    test_admin_user: User,
):
    response = await admin_client.put(
        "/admin/settings",
        json={"prompt_extension": "Материал 24 недоступен для заказа."},
    )

    assert response.status_code == 200

    body = response.json()
    assert body["prompt_extension"] == "Материал 24 недоступен для заказа."
    assert body["last_update_by"] == test_admin_user.id
    assert body["last_update_at"] is not None

    # Read back through the API rather than trusting the write.
    stored = await admin_client.get("/admin/settings")
    assert stored.json() == body


@pytest.mark.asyncio
async def test_update_settings_strips_trailing_whitespace(admin_client: AsyncClient):
    response = await admin_client.put("/admin/settings", json={"prompt_extension": "Недоступен материал 3.\n\n  "})

    assert response.status_code == 200
    assert response.json()["prompt_extension"] == "Недоступен материал 3."


@pytest.mark.asyncio
async def test_update_settings_with_an_empty_string_resets_but_keeps_the_audit_trail(
    admin_client: AsyncClient,
    test_admin_user: User,
):
    saved = await admin_client.put("/admin/settings", json={"prompt_extension": "Что-то"})
    assert saved.json()["prompt_extension"] == "Что-то"

    reset = await admin_client.put("/admin/settings", json={"prompt_extension": ""})

    assert reset.status_code == 200
    body = reset.json()
    assert body["prompt_extension"] == ""
    # The reset is itself an edit, so it stays attributable.
    assert body["last_update_by"] == test_admin_user.id
    assert body["last_update_at"] is not None


@pytest.mark.asyncio
async def test_update_settings_reuses_the_single_row(admin_client: AsyncClient, db_session: AsyncSession):
    """Two saves must land in one row; the id is the singleton's, not a sequence's."""
    await admin_client.put("/admin/settings", json={"prompt_extension": "Первый"})
    await admin_client.put("/admin/settings", json={"prompt_extension": "Второй"})

    rows = (await db_session.execute(select(Settings))).scalars().all()

    assert len(rows) == 1
    assert rows[0].id == SETTINGS_ROW_ID
    assert rows[0].prompt_extension == "Второй"


@pytest.mark.asyncio
async def test_update_settings_rejects_an_oversized_extension(admin_client: AsyncClient):
    response = await admin_client.put(
        "/admin/settings", json={"prompt_extension": "x" * (MAX_PROMPT_EXTENSION_LENGTH + 1)}
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_update_settings_accepts_an_extension_at_the_limit(admin_client: AsyncClient):
    response = await admin_client.put("/admin/settings", json={"prompt_extension": "x" * MAX_PROMPT_EXTENSION_LENGTH})

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_update_settings_rejects_a_null_extension(admin_client: AsyncClient):
    """Explicit null is rejected, unlike omitting the field: the two mean opposites."""
    response = await admin_client.put("/admin/settings", json={"prompt_extension": None})

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_update_settings_ignores_an_absent_extension(admin_client: AsyncClient, db_session: AsyncSession):
    """An empty body is a no-op on the value, which is what lets a later option be
    added to the payload without this one having to be resent."""
    await admin_client.put("/admin/settings", json={"prompt_extension": "Оставить"})

    response = await admin_client.put("/admin/settings", json={})

    assert response.status_code == 200
    assert response.json()["prompt_extension"] == "Оставить"


@pytest.mark.asyncio
async def test_admin_tier_may_edit_the_prompt(tier_admin_client: AsyncClient):
    """Both elevated tiers can write: the prompt is not an account-level power."""
    response = await tier_admin_client.put("/admin/settings", json={"prompt_extension": "Материал 7 недоступен."})

    assert response.status_code == 200
    assert response.json()["prompt_extension"] == "Материал 7 недоступен."


@pytest.mark.asyncio
async def test_settings_are_allowed_on_a_test_instance(admin_client: AsyncClient, monkeypatch):
    """Unlike the account mutations, this write is not gated: it holds no credential
    and no ownership, and an empty string undoes it."""
    monkeypatch.setenv("TEST_INSTANCE_MODE", "true")

    response = await admin_client.put("/admin/settings", json={"prompt_extension": "Правило площаха"})

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_plain_user_is_refused_the_settings_api(client: AsyncClient, test_user: User):
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    assert (await client.get("/admin/settings")).status_code == 403
    assert (await client.put("/admin/settings", json={"prompt_extension": "нет"})).status_code == 403


@pytest.mark.asyncio
async def test_settings_require_authentication(client: AsyncClient):
    assert (await client.get("/admin/settings")).status_code == 401
    assert (await client.put("/admin/settings", json={"prompt_extension": "нет"})).status_code == 401


@pytest.mark.asyncio
async def test_settings_survive_the_admin_who_wrote_them(
    admin_client: AsyncClient,
    db_session: AsyncSession,
    test_admin_user: User,
):
    """Deleting an admin nulls the attribution and keeps the prompt.

    SET NULL is the whole reason the column is nullable: the configuration is
    still in force long after the person who typed it has gone.
    """
    await admin_client.put("/admin/settings", json={"prompt_extension": "Материал 12 недоступен."})

    await db_session.delete(test_admin_user)
    await db_session.commit()

    settings = await db_session.get(Settings, SETTINGS_ROW_ID)

    assert settings is not None
    assert settings.prompt_extension == "Материал 12 недоступен."
    assert settings.last_update_by is None


# ---------------------------------------------------------------------------
# PUT /admin/settings: production rates
# ---------------------------------------------------------------------------

#: The four editable rates, spelled out so a typo here fails the test rather than
#: the request.
RATES = {
    "laser_speed_m_per_hour": 8.0,
    "welding_speed_m_per_hour": 2.5,
    "bending_rate_per_hour": 70.0,
    "painting_rate_m2_per_hour": 6.5,
}


@pytest.mark.asyncio
async def test_get_settings_reports_the_default_rates(admin_client: AsyncClient):
    """An unconfigured instance reports the calculator's own defaults.

    The response is the effective configuration rather than the stored blob, so a
    fresh instance renders a form full of real numbers instead of empty boxes.
    """
    response = await admin_client.get("/admin/settings")

    assert response.status_code == 200
    assert response.json()["parameters"] == {
        "laser_speed_m_per_hour": DEFAULT_PARAMETERS.laser_speed_m_per_hour,
        "welding_speed_m_per_hour": DEFAULT_PARAMETERS.welding_speed_m_per_hour,
        "bending_rate_per_hour": DEFAULT_PARAMETERS.bending_rate_per_hour,
        "painting_rate_m2_per_hour": DEFAULT_PARAMETERS.painting_rate_m2_per_hour,
    }


@pytest.mark.asyncio
async def test_rates_cover_every_editable_parameter():
    """The API exposes every `Parameters` field except the deliberately fixed one.

    Without this, adding a rate to the dataclass would leave the admin API quietly
    unable to configure it, with nothing failing.
    """
    editable = {f.name for f in fields(Parameters)} - {"max_positions"}
    assert editable == set(AdminRatesSchema.model_fields)


@pytest.mark.asyncio
async def test_update_settings_stores_the_rates(admin_client: AsyncClient, db_session: AsyncSession):
    response = await admin_client.put("/admin/settings", json={"parameters": RATES})

    assert response.status_code == 200
    assert response.json()["parameters"] == RATES

    settings = await db_session.get(Settings, SETTINGS_ROW_ID)
    assert settings.parameters == RATES


@pytest.mark.asyncio
async def test_update_settings_requires_all_rates_together(admin_client: AsyncClient):
    """A partial rate set is a 422, not a silent reset of the other three.

    These numbers become prices, so a dropped field must not quietly fall back to a
    default nobody asked for.
    """
    response = await admin_client.put(
        "/admin/settings",
        json={"parameters": {"laser_speed_m_per_hour": 9.0}},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_update_settings_rejects_a_non_positive_rate(admin_client: AsyncClient):
    for bad in (0, -1.0):
        response = await admin_client.put(
            "/admin/settings",
            json={"parameters": {**RATES, "welding_speed_m_per_hour": bad}},
        )
        assert response.status_code == 422, bad


@pytest.mark.asyncio
async def test_update_settings_rejects_a_non_finite_rate(admin_client: AsyncClient):
    """NaN and infinity are refused, and the body is sent raw to prove it.

    `httpx` cannot encode them, so a `json=` body would prove nothing; but Starlette
    parses with `json.loads`, which accepts the `NaN` and `Infinity` literals that
    Pydantic accepts as floats by default. Left unchecked they reach the calculator
    and produce a workbook of `#NUM!` rather than an error.

    This also covers the sanitising `RequestValidationError` handler in `app.main`:
    the error detail quotes the offending input, and without that handler the 422
    itself cannot be encoded, so the client gets a broken response instead of this
    message. `NaN > 0` is false, but a comparison against NaN is not what catches it
    here — `allow_inf_nan=False` is, and it reports `finite_number`.
    """
    for literal in ("NaN", "Infinity", "-Infinity"):
        rates = (
            "{"
            + ", ".join(
                f'"{name}": {literal if name == "bending_rate_per_hour" else value}' for name, value in RATES.items()
            )
            + "}"
        )
        response = await admin_client.put(
            "/admin/settings",
            content='{"parameters": ' + rates + "}",
            headers={"content-type": "application/json"},
        )
        assert response.status_code == 422, literal
        # The literal has to survive as text: a bare NaN in the payload is what makes
        # the error response unencodable.
        assert response.json()["detail"][0]["input"] in {"nan", "inf", "-inf"}


@pytest.mark.asyncio
async def test_update_settings_rejects_an_unknown_rate(admin_client: AsyncClient):
    """`max_positions` is the real case: it exists but is not editable, so it must
    be refused rather than silently ignored."""
    response = await admin_client.put(
        "/admin/settings",
        json={"parameters": {**RATES, "max_positions": 25}},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_null_parameters_resets_to_defaults_and_keeps_the_audit_trail(
    admin_client: AsyncClient,
    db_session: AsyncSession,
    test_admin_user: User,
):
    """`null` is the way back from a bad edit, so it means "forget my rates"."""
    await admin_client.put("/admin/settings", json={"parameters": RATES})

    response = await admin_client.put("/admin/settings", json={"parameters": None})

    assert response.status_code == 200
    body = response.json()
    assert body["parameters"] == {
        "laser_speed_m_per_hour": DEFAULT_PARAMETERS.laser_speed_m_per_hour,
        "welding_speed_m_per_hour": DEFAULT_PARAMETERS.welding_speed_m_per_hour,
        "bending_rate_per_hour": DEFAULT_PARAMETERS.bending_rate_per_hour,
        "painting_rate_m2_per_hour": DEFAULT_PARAMETERS.painting_rate_m2_per_hour,
    }
    assert body["last_update_by"] == test_admin_user.id
    assert body["last_update_at"] is not None

    settings = await db_session.get(Settings, SETTINGS_ROW_ID)
    assert settings.parameters is None


@pytest.mark.asyncio
async def test_omitting_parameters_leaves_the_rates_alone(admin_client: AsyncClient):
    """Absent is not the same as null: a prompt-only edit must not reset rates."""
    await admin_client.put("/admin/settings", json={"parameters": RATES})

    response = await admin_client.put("/admin/settings", json={"prompt_extension": "Правило"})

    assert response.status_code == 200
    assert response.json()["parameters"] == RATES


@pytest.mark.asyncio
async def test_saving_the_prompt_leaves_the_rates_alone(admin_client: AsyncClient):
    await admin_client.put("/admin/settings", json={"parameters": RATES})

    response = await admin_client.put("/admin/settings", json={"prompt_extension": "Только промпт"})

    assert response.json()["parameters"] == RATES


@pytest.mark.asyncio
async def test_both_settings_can_be_saved_together(admin_client: AsyncClient):
    response = await admin_client.put(
        "/admin/settings",
        json={"prompt_extension": "Материал 5 недоступен.", "parameters": RATES},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["prompt_extension"] == "Материал 5 недоступен."
    assert body["parameters"] == RATES
