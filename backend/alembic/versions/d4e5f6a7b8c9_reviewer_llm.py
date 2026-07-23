"""add optional reviewer LLM config (second-opinion SQL query review)

Revision ID: d4e5f6a7b8c9
Revises: c1d2e3f4a5b6
Create Date: 2026-07-23
"""
from alembic import op

revision = 'd4e5f6a7b8c9'
down_revision = 'c1d2e3f4a5b6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # All nullable / empty-default: an unset reviewer_llm_base_url means the feature
    # stays fully opt-in, matching how the (now-removed) reranker config worked.
    op.execute("ALTER TABLE model_settings ADD COLUMN IF NOT EXISTS reviewer_llm_base_url VARCHAR(500)")
    op.execute("ALTER TABLE model_settings ADD COLUMN IF NOT EXISTS reviewer_llm_api_key_encrypted TEXT")
    op.execute("ALTER TABLE model_settings ADD COLUMN IF NOT EXISTS reviewer_llm_model VARCHAR(255)")


def downgrade() -> None:
    op.execute("ALTER TABLE model_settings DROP COLUMN IF EXISTS reviewer_llm_model")
    op.execute("ALTER TABLE model_settings DROP COLUMN IF EXISTS reviewer_llm_api_key_encrypted")
    op.execute("ALTER TABLE model_settings DROP COLUMN IF EXISTS reviewer_llm_base_url")
