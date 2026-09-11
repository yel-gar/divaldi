import asyncio
from getpass import getpass

from sqlalchemy import select

from app.auth import hash_password
from app.models.auth import User
from app.tasks.conf.broker import tsq_db


async def main():
    username = input("Enter username: ")
    password = getpass("Enter password: ", echo_char="*")
    password_confirm = getpass("Confirm password: ", echo_char="*")
    if password != password_confirm:
        print("Passwords do not match")
        return
    async with tsq_db() as db:
        user = await db.scalar(select(User).where(User.username == username))
        if user:
            print("User already exists")
            return
        db.add(User(username=username, password_hash=hash_password(password), is_superuser=True))
        await db.commit()
        print("User created successfully")


asyncio.run(main())
