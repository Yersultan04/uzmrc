"""Router smalltalk classification — the regex fast-path that keeps greetings /
identity / thanks from triggering retrieval (and thus the alarming 0%-confidence
escalation). See app/agent/router.py.
"""
from __future__ import annotations

import pytest

from app.agent.router import _regex_route

SMALLTALK = [
    "привет",
    "Привет!",
    "приветствую",
    "здравствуйте",
    "салам",
    "ассалому алейкум",
    "кто ты",
    "ты кто?",
    "что ты умеешь",
    "что ты такое",
    "расскажи о себе",
    "спасибо",
    "спасибо большое",
    "рахмат",
    "hello",
    "hi there",
    "hey",
    "salom",
    "who are you",
    "what can you do",
    "до свидания",
    "пока",
    "ок",
    "понятно",
]

DOC_QUESTIONS = [
    "какая ставка по ипотеке",
    "что такое первоначальный взнос",
    "покажи правила рефинансирования RM-2",
    "сколько составляет процентная ставка 13%",
    # greeting prefix + a real question → must NOT be smalltalk
    "привет, какая максимальная сумма кредита по программе рефинансирования?",
]


@pytest.mark.parametrize("q", SMALLTALK)
def test_smalltalk_is_routed_without_retrieval(q: str) -> None:
    route = _regex_route(q)
    assert route is not None, f"expected a regex route for {q!r}"
    assert route.kind == "smalltalk", f"{q!r} should be smalltalk, got {route.kind}"
    assert route.needs_retrieval is False
    assert route.suggested_tool == "none"


@pytest.mark.parametrize("q", DOC_QUESTIONS)
def test_document_questions_are_not_smalltalk(q: str) -> None:
    route = _regex_route(q)
    # Either no regex match (→ delegated to the LLM router) or a non-smalltalk
    # decision (e.g. quoted phrase → exact_lookup). It must never be smalltalk.
    if route is not None:
        assert route.kind != "smalltalk", f"{q!r} wrongly classified as smalltalk"
        assert route.needs_retrieval is True
