"""support one server connection exposing multiple databases (e.g. MSSQL instance
with several accounting-year databases)

Revision ID: e6f7a8b9c0d1
Revises: d4e5f6a7b8c9
Create Date: 2026-07-24
"""
from alembic import op

revision = 'e6f7a8b9c0d1'
down_revision = 'd4e5f6a7b8c9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS available_databases JSON")
    op.execute("ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS selected_databases JSON")


def downgrade() -> None:
    op.execute("ALTER TABLE db_connections DROP COLUMN IF EXISTS selected_databases")
    op.execute("ALTER TABLE db_connections DROP COLUMN IF EXISTS available_databases")
