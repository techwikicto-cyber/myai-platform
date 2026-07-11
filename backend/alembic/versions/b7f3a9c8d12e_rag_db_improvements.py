"""rag and db improvements: allowed_tables, hybrid search tsvector, audit log

Revision ID: b7f3a9c8d12e
Revises: 6e41ffbf840d
Create Date: 2026-07-07 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b7f3a9c8d12e'
down_revision: Union[str, None] = '6e41ffbf840d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    from sqlalchemy import inspect as sa_inspect
    inspector = sa_inspect(conn)

    # 1. Table/column allowlist per DB connection
    existing_cols = {c['name'] for c in inspector.get_columns('db_connections')}
    if 'allowed_tables' not in existing_cols:
        op.add_column('db_connections', sa.Column('allowed_tables', sa.JSON(), nullable=True))

    # 2. tsvector column for hybrid BM25+vector search (generated, auto-populated for existing rows)
    op.execute(
        "ALTER TABLE document_chunks "
        "ADD COLUMN IF NOT EXISTS content_tsv tsvector "
        "GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_document_chunks_content_tsv "
        "ON document_chunks USING gin(content_tsv)"
    )

    # 3. Audit log for every DB query (success, rejected, error)
    if 'query_audit_logs' not in inspector.get_table_names():
        # Postgres has no "CREATE TYPE IF NOT EXISTS"; guard with a DO block instead.
        op.execute(
            "DO $$ BEGIN "
            "CREATE TYPE query_audit_status AS ENUM ('success', 'rejected', 'error'); "
            "EXCEPTION WHEN duplicate_object THEN null; "
            "END $$;"
        )
        op.create_table(
            'query_audit_logs',
            sa.Column('id', sa.UUID(), nullable=False),
            sa.Column('workspace_id', sa.UUID(), nullable=False),
            sa.Column('db_connection_id', sa.UUID(), nullable=True),
            sa.Column('user_id', sa.UUID(), nullable=True),
            sa.Column('thread_id', sa.UUID(), nullable=True),
            sa.Column('raw_query', sa.Text(), nullable=False),
            sa.Column('executed_query', sa.Text(), nullable=True),
            sa.Column('status', sa.Enum('success', 'rejected', 'error', name='query_audit_status', create_type=False), nullable=False),
            sa.Column('error_message', sa.Text(), nullable=True),
            sa.Column('row_count', sa.Integer(), nullable=True),
            sa.Column('duration_ms', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.ForeignKeyConstraint(['db_connection_id'], ['db_connections.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_query_audit_logs_workspace_id', 'query_audit_logs', ['workspace_id'])
        op.create_index('ix_query_audit_logs_user_id', 'query_audit_logs', ['user_id'])
        op.create_index('ix_query_audit_logs_created_at', 'query_audit_logs', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_query_audit_logs_created_at', table_name='query_audit_logs')
    op.drop_index('ix_query_audit_logs_user_id', table_name='query_audit_logs')
    op.drop_index('ix_query_audit_logs_workspace_id', table_name='query_audit_logs')
    op.drop_table('query_audit_logs')
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_content_tsv")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS content_tsv")
    op.drop_column('db_connections', 'allowed_tables')
    op.execute("DROP TYPE IF EXISTS query_audit_status")
