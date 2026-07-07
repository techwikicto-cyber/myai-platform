"""sharing: is_shared on documents and db_connections

Revision ID: c9d0e1f2a3b4
Revises: b7f3a9c8d12e
Create Date: 2026-07-07 14:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, None] = 'b7f3a9c8d12e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE")
    op.execute("ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE")


def downgrade() -> None:
    op.drop_column('documents', 'is_shared')
    op.drop_column('db_connections', 'is_shared')
