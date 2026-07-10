"""link query audit logs to assistant messages for full-result export

Revision ID: a7b8c9d0e1f2
Revises: f1a2b3c4d5e6
Create Date: 2026-07-10
"""
from alembic import op

revision = 'a7b8c9d0e1f2'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE query_audit_logs ADD COLUMN IF NOT EXISTS "
        "message_id UUID NULL REFERENCES messages(id) ON DELETE SET NULL"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_query_audit_logs_message_id ON query_audit_logs(message_id)")


def downgrade() -> None:
    op.execute("ALTER TABLE query_audit_logs DROP COLUMN IF EXISTS message_id")
