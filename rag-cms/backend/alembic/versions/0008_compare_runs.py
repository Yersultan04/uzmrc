"""compare_runs — async compare run tracking

Revision ID: 0008_compare_runs
Revises: 0007_embedding_cache
Create Date: 2026-06-17
"""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0008_compare_runs"
down_revision = "0007_embedding_cache"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "compare_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "rag_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("rags.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("queued", "running", "succeeded", "failed", name="compare_run_status"),
            nullable=False,
            server_default="queued",
        ),
        sa.Column("filename", sa.String(length=512), nullable=True),
        sa.Column("stream_token", sa.String(length=64), nullable=True),
        sa.Column("report", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_compare_runs_rag_id", "compare_runs", ["rag_id"])
    op.create_index("ix_compare_runs_stream_token", "compare_runs", ["stream_token"])


def downgrade() -> None:
    op.drop_index("ix_compare_runs_stream_token", table_name="compare_runs")
    op.drop_index("ix_compare_runs_rag_id", table_name="compare_runs")
    op.drop_table("compare_runs")
    op.execute("DROP TYPE IF EXISTS compare_run_status")
