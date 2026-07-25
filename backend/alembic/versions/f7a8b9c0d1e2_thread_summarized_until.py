"""add threads.summarized_until cursor so history re-fetch/re-summarization is bounded
to messages since the last summary instead of the whole thread every turn

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-07-25
"""
from alembic import op

revision = 'f7a8b9c0d1e2'
down_revision = 'e6f7a8b9c0d1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE threads ADD COLUMN IF NOT EXISTS summarized_until TIMESTAMPTZ")


def downgrade() -> None:
    op.execute("ALTER TABLE threads DROP COLUMN IF EXISTS summarized_until")
