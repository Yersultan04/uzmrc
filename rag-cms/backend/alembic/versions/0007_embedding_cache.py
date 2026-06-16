"""embedding_cache — content-addressed vector cache

Revision ID: 0007_embedding_cache
Revises: 0006_rag_members
Create Date: 2026-06-16
"""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0007_embedding_cache"
down_revision = "0006_rag_members"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "embedding_cache",
        sa.Column("hash", sa.String(length=64), primary_key=True),
        sa.Column("model_sig", sa.String(length=255), nullable=False),
        sa.Column("dim", sa.Integer(), nullable=False),
        sa.Column("vector", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_embedding_cache_model_sig", "embedding_cache", ["model_sig"])


def downgrade() -> None:
    op.drop_index("ix_embedding_cache_model_sig", table_name="embedding_cache")
    op.drop_table("embedding_cache")
