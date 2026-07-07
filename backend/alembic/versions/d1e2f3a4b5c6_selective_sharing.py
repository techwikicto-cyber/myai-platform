"""selective workspace sharing

Revision ID: d1e2f3a4b5c6
Revises: c9d0e1f2a3b4
Create Date: 2026-07-07
"""
from alembic import op

revision = 'd1e2f3a4b5c6'
down_revision = 'c9d0e1f2a3b4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the old boolean is_shared columns
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS is_shared")
    op.execute("ALTER TABLE db_connections DROP COLUMN IF EXISTS is_shared")

    # Per-workspace sharing tables
    op.execute("""
        CREATE TABLE IF NOT EXISTS document_workspace_shares (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            CONSTRAINT uq_doc_ws_share UNIQUE (document_id, workspace_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_dws_document_id ON document_workspace_shares(document_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_dws_workspace_id ON document_workspace_shares(workspace_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS db_connection_workspace_shares (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            db_connection_id UUID NOT NULL REFERENCES db_connections(id) ON DELETE CASCADE,
            workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            CONSTRAINT uq_dbconn_ws_share UNIQUE (db_connection_id, workspace_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_dcws_db_connection_id ON db_connection_workspace_shares(db_connection_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_dcws_workspace_id ON db_connection_workspace_shares(workspace_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS document_workspace_shares")
    op.execute("DROP TABLE IF EXISTS db_connection_workspace_shares")
    op.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE")
    op.execute("ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE")
