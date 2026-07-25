from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    # Defense-in-depth on top of closing the chat-streaming session early (see
    # send_message in chat.py) — the real fix for pool exhaustion is not holding
    # connections open for the duration of a long SSE stream, but a bit more headroom
    # here means a burst of concurrent short requests has room to breathe too.
    pool_size=10,
    max_overflow=20,
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
