from datetime import UTC

import pytest
from sqlalchemy import select

from app.auth import generate_token
from app.models.auth import Session


@pytest.mark.asyncio
async def test_login_success_sets_cookie(client, test_user):
    response = await client.post("/auth/login", json={"username": test_user.username, "password": "password1234"})
    assert response.status_code == 200
    assert response.json() == {"message": "Login OK"}
    assert "session_token" in response.cookies


@pytest.mark.asyncio
async def test_login_wrong_password(client, test_user):
    response = await client.post("/auth/login", json={"username": test_user.username, "password": "amogus"})

    assert response.status_code == 401
    assert "session_token" not in response.cookies


@pytest.mark.asyncio
async def test_login_nonexistent_user(client):
    response = await client.post(
        "/auth/login",
        json={"username": "ghost", "password": "whatever"},
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_protected_route_requires_login(client):
    response = await client.get("/users/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_protected_route_with_valid_session(client, test_user):
    login_response = await client.post(
        "/auth/login",
        json={"username": "test", "password": "password1234"},
    )
    assert login_response.status_code == 200

    # httpx's AsyncClient automatically carries cookies across requests
    # made on the same client instance, same as a browser session
    me_response = await client.get("/users/me")

    assert me_response.status_code == 200
    assert me_response.json()["username"] == "test"


@pytest.mark.asyncio
async def test_logout_clears_session(client, test_user, db_session):
    login_response = await client.post(
        "/auth/login",
        json={"username": "test", "password": "password1234"},
    )
    token = login_response.cookies["session_token"]

    logout_response = await client.post("/auth/logout")
    assert logout_response.status_code == 200

    # session row should be gone from the DB
    result = await db_session.execute(select(Session).where(Session.token == token))
    assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_protected_route_after_logout_fails(client, test_user):
    await client.post(
        "/auth/login",
        json={"username": "test", "password": "password1234"},
    )
    await client.post("/auth/logout")

    response = await client.get("/users/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_expired_session_rejected(client, test_user, db_session):
    from datetime import datetime, timedelta

    expired_token = generate_token()
    db_session.add(
        Session(
            token=expired_token,
            user_id=test_user.id,
            expires_at=datetime.now(UTC) - timedelta(days=1),  # already expired
        )
    )
    await db_session.commit()

    response = await client.get("/users/me", cookies={"session_token": expired_token})
    assert response.status_code == 401

    result = await db_session.execute(select(Session).where(Session.token == expired_token))
    assert result.scalar_one_or_none() is None
