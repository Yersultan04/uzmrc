"""pgvector — add chunks.embedding column

Revision ID: 0009_pgvector
Revises: 0008_compare_runs
Create Date: 2026-06-18
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009_pgvector"
down_revision = "0008_compare_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable pgvector extension (idempotent — safe to run even if already enabled).
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Add the dense embedding column.  Vector() without a fixed dimension accepts
    # embeddings of any width (1024 for Voyage, 3072 for Gemini, etc.).
    # Nullable so existing rows survive until they are re-indexed.
    op.execute("ALTER TABLE chunks ADD COLUMN IF NOT EXISTS embedding vector")

    # GIN index on FTS tsvector expression for the sparse (FTS) leg.
    # Language is 'simple' here because each RAG may use a different config;
    # the query-time ts_rank_cd call uses the per-RAG language dynamically.
    # This index speeds up the @@ operator for the most common case.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_chunks_fts_simple
        ON chunks
        USING gin (to_tsvector('simple', coalesce(heading, '') || ' ' || text))
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_chunks_fts_simple")
    op.execute("ALTER TABLE chunks DROP COLUMN IF EXISTS embedding")
