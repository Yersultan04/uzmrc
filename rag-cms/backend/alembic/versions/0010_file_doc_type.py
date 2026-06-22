"""file doc_type — document category column

Revision ID: 0010_file_doc_type
Revises: 0009_pgvector
Create Date: 2026-06-22
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010_file_doc_type"
down_revision = "0009_pgvector"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("files", sa.Column("doc_type", sa.String(length=32), nullable=True))
    op.create_index("ix_files_doc_type", "files", ["doc_type"])


def downgrade() -> None:
    op.drop_index("ix_files_doc_type", table_name="files")
    op.drop_column("files", "doc_type")
