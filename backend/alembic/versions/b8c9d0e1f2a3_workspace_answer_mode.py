"""add answer_mode to workspaces

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-07-11
"""
from alembic import op

revision = 'b8c9d0e1f2a3'
down_revision = 'a7b8c9d0e1f2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing workspaces default to the strict (docs-only) behaviour they already had.
    op.execute("ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS answer_mode VARCHAR(16) NOT NULL DEFAULT 'strict'")


def downgrade() -> None:
    op.execute("ALTER TABLE workspaces DROP COLUMN IF EXISTS answer_mode")
