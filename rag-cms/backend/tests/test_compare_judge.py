from __future__ import annotations

import json

from app.compare import judge as judge_mod
from app.compare.schemas import ClauseRelation

CANDS = [
    {"text": "Первоначальный взнос не менее 20 процентов.", "filename": "norm1.pdf", "page_start": 3},
    {"text": "Срок рассмотрения заявки 10 рабочих дней.", "filename": "norm2.pdf", "page_start": 5},
]


def test_parse_clean_json():
    raw = json.dumps(
        {
            "relation": "conflict",
            "matched_candidate": 0,
            "quote": "не менее 20 процентов",
            "rationale": "Новое положение требует 30%, норма — 20%.",
            "recommendation": "Согласовать",
            "confidence": 0.9,
        }
    )
    v = judge_mod._parse_verdict(raw, n_candidates=2)
    assert v.relation == ClauseRelation.conflict
    assert v.matched_candidate == 0


def test_parse_strips_code_fences():
    raw = "```json\n" + json.dumps({"relation": "duplicate", "matched_candidate": 1}) + "\n```"
    v = judge_mod._parse_verdict(raw, n_candidates=2)
    assert v.relation == ClauseRelation.duplicate
    assert v.matched_candidate == 1


def test_unknown_relation_coerced_to_gap():
    raw = json.dumps({"relation": "banana", "matched_candidate": 0})
    v = judge_mod._parse_verdict(raw, n_candidates=2)
    assert v.relation == ClauseRelation.gap


def test_out_of_range_candidate_downgraded_to_gap():
    raw = json.dumps({"relation": "duplicate", "matched_candidate": 9})
    v = judge_mod._parse_verdict(raw, n_candidates=2)
    assert v.relation == ClauseRelation.gap
    assert v.matched_candidate is None


def test_non_gap_without_match_downgraded_to_gap():
    raw = json.dumps({"relation": "conflict", "matched_candidate": None})
    v = judge_mod._parse_verdict(raw, n_candidates=2)
    assert v.relation == ClauseRelation.gap


def test_gap_clears_candidate():
    raw = json.dumps({"relation": "gap", "matched_candidate": 0})
    v = judge_mod._parse_verdict(raw, n_candidates=2)
    assert v.matched_candidate is None


async def test_judge_no_candidates_returns_gap():
    v = await judge_mod.judge_clause("какое-то новое положение", [])
    assert v.relation == ClauseRelation.gap


async def test_judge_uses_llm(monkeypatch):
    async def fake_chat(**kwargs):
        return json.dumps(
            {
                "relation": "conflict",
                "matched_candidate": 0,
                "quote": "не менее 20 процентов",
                "rationale": "ставки расходятся",
                "recommendation": "согласовать",
                "confidence": 0.8,
            }
        )

    monkeypatch.setattr(judge_mod.llm, "chat", fake_chat)
    v = await judge_mod.judge_clause("Первоначальный взнос 30 процентов.", CANDS)
    assert v.relation == ClauseRelation.conflict
    assert v.matched_candidate == 0


async def test_judge_llm_error_degrades_to_gap(monkeypatch):
    async def boom(**kwargs):
        raise RuntimeError("llm down")

    monkeypatch.setattr(judge_mod.llm, "chat", boom)
    v = await judge_mod.judge_clause("Любое положение.", CANDS)
    assert v.relation == ClauseRelation.gap
    assert v.confidence == 0.0
