"""workspace knowledge base (terms / business logic / SQL templates) retrieved by
embedding similarity and injected into the chat prompt

Revision ID: a8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-07-26
"""
from alembic import op

revision = 'a8b9c0d1e2f3'
down_revision = 'f7a8b9c0d1e2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DO $$ BEGIN CREATE TYPE knowledge_kind AS ENUM ('term', 'business_logic', 'sql_template'); EXCEPTION WHEN duplicate_object THEN NULL; END $$")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS knowledge_entries (
            id UUID PRIMARY KEY,
            workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            db_connection_id UUID REFERENCES db_connections(id) ON DELETE CASCADE,
            kind knowledge_kind NOT NULL,
            name VARCHAR(300) NOT NULL,
            content TEXT NOT NULL,
            embedding vector(1024),
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_knowledge_entries_workspace_id ON knowledge_entries (workspace_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_knowledge_entries_db_connection_id ON knowledge_entries (db_connection_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_knowledge_entries_kind ON knowledge_entries (kind)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS knowledge_entries")
    op.execute("DROP TYPE IF EXISTS knowledge_kind")
