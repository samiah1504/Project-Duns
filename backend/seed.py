"""
Run: python seed.py
Creates the default admin user and sample data.
"""
import asyncio
from app.database import AsyncSessionLocal, engine, Base
from app.models import *  # noqa
from app.models.user import User, UserRole
from app.core.auth import hash_password


async def seed():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        existing = await db.execute(select(User).where(User.email == "admin@tardmart.com"))
        if existing.scalar_one_or_none():
            print("Admin user already exists.")
            return

        admin = User(
            name="Admin",
            email="admin@tardmart.com",
            hashed_password=hash_password("tardmart2024"),
            role=UserRole.ADMIN,
        )
        db.add(admin)
        await db.commit()
        print("Created admin user: admin@tardmart.com / tardmart2024")


if __name__ == "__main__":
    asyncio.run(seed())
