"""add question snapshot to pinned messages

Revision ID: f1a2b3c4d5e6
Revises: e5f6a7b8c9d0
Create Date: 2026-07-09
"""
from alembic import op

revision = 'f1a2b3c4d5e6'
down_revision = 'e5f6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE pinned_messages ADD COLUMN IF NOT EXISTS question_snapshot TEXT NOT NULL DEFAULT ''")


def downgrade() -> None:
    op.execute("ALTER TABLE pinned_messages DROP COLUMN IF EXISTS question_snapshot")
