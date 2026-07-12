"""add profile fields

Revision ID: c1d2e3f4a5b6
Revises: b8c9d0e1f2a3
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa

revision = 'c1d2e3f4a5b6'
down_revision = 'b8c9d0e1f2a3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new fields to users table
    op.add_column('users', sa.Column('must_change_password', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('users', sa.Column('full_name', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('profile_picture', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'profile_picture')
    op.drop_column('users', 'full_name')
    op.drop_column('users', 'must_change_password')
