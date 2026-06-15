"""Pydantic schemas for Module 2 — document comparison.

Flow: a freshly uploaded regulation is split into clauses; each clause is
matched against the RAG's existing norms via hybrid retrieval; an LLM judge
classifies the relationship between the new clause and the closest base norm.
"""
from __future__ import annotations

import enum
import uuid

from pydantic import BaseModel, Field


class ClauseRelation(str, enum.Enum):
    """How a clause from the new document relates to the existing norm base."""

    duplicate = "duplicate"      # дубль — повторяет существующую норму
    conflict = "conflict"        # противоречие — расходится с существующей нормой
    addition = "addition"        # дополнение — расширяет/уточняет существующую норму
    gap = "gap"                  # пробел — в базе нет нормы, покрывающей это положение


class MatchedNorm(BaseModel):
    """The base-norm chunk the judge tied a clause to (None-able for `gap`)."""

    chunk_id: uuid.UUID
    file_id: uuid.UUID
    filename: str
    page_start: int | None = None
    page_end: int | None = None
    quote: str = Field(..., description="Дословный фрагмент нормы базы, обосновывающий вердикт")
    score: float = Field(0.0, description="Скор гибридного поиска")
    grounded: bool = Field(
        False,
        description="True, если quote дословно (или близко) найден в тексте нормы — защита от галлюцинаций",
    )


class ClauseFinding(BaseModel):
    """Verdict for a single clause of the new document."""

    clause_index: int
    clause_label: str | None = None
    clause_text: str
    page_start: int | None = None
    page_end: int | None = None
    relation: ClauseRelation
    rationale: str = Field(..., description="Почему именно такой тип отношения")
    recommendation: str = Field(..., description="Что делать: принять / отклонить / согласовать и т.д.")
    confidence: float = Field(..., ge=0.0, le=1.0)
    matched_norm: MatchedNorm | None = None


class CompareSummary(BaseModel):
    total_clauses: int = 0
    duplicate: int = 0
    conflict: int = 0
    addition: int = 0
    gap: int = 0


class CompareReport(BaseModel):
    rag_id: uuid.UUID
    filename: str
    summary: CompareSummary
    findings: list[ClauseFinding] = Field(default_factory=list)
    truncated: bool = Field(
        False, description="True, если число положений превысило лимит и часть не обработана"
    )
    note: str | None = None


class JudgeVerdict(BaseModel):
    """Internal — strict shape the LLM judge must return (one clause).

    `matched_candidate` is the 0-based index into the candidate list shown to
    the judge, or None when the verdict is `gap` (no base norm applies).
    """

    relation: ClauseRelation
    matched_candidate: int | None = None
    quote: str = ""
    rationale: str = ""
    recommendation: str = ""
    confidence: float = Field(0.5, ge=0.0, le=1.0)
