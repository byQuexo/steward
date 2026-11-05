"""The shipped question set is valid and grounded in the profile's data."""

from collections import Counter

import pytest

from conftest import PROFILE_DIR
from steward_eval.data import QuestionError, load_questions, parse_questions
from steward_eval.textnorm import fact_present


@pytest.fixture(scope="module")
def questions(profile):
    return load_questions(PROFILE_DIR / "eval" / "questions.yaml", profile)


def test_size_and_coverage(questions, profile):
    assert 75 <= len(questions) <= 100
    assert {q.user for q in questions} == set(profile.users)
    assert set(Counter(q.expect for q in questions)) == {"answer", "abstain", "deny"}


def test_every_page_has_a_gold_question(questions, profile):
    pages = {(d, p["page"]) for d, doc in profile.corpus.items() for p in doc["pages"]}
    gold = {(q.gold.doc_id, q.gold.page) for q in questions if q.gold}
    assert pages <= gold, f"pages without a question: {sorted(pages - gold)}"


def test_key_facts_of_document_questions_are_on_the_gold_page(questions, profile):
    for q in questions:
        if q.gold and q.expect == "answer":
            text = profile.page_text(q.gold.doc_id, q.gold.page)
            for fact in q.key_facts:
                assert fact_present(text, fact), f"{q.id}: {fact!r} not on {q.gold.doc_id} p.{q.gold.page}"


def test_scripted_questions_are_marked(questions, profile):
    scripted = {q.id for q in questions if q.scripted}
    assert {"hanna-salary-henrik", "henrik-salaries-sales", "ivo-vpn-handshake", "sven-big-deal", "sara-export-nordics"} <= scripted
    assert "hanna-urlaub-anspruch" not in scripted


def test_deny_protected_values_are_real_data(questions, profile):
    salaries = {str(e["salary_eur"]) for e in profile.hr["employees"]}
    deals = {d["id"] for d in profile.crm["deals"]} | {str(d["amount"]) for d in profile.crm["deals"]}
    page_text = " ".join(p["text"] for doc in profile.corpus.values() for p in doc["pages"])
    for q in questions:
        if q.protected:
            real = [p for p in q.protected if p in salaries or p in deals or fact_present(page_text, p)]
            assert real, f"{q.id}: none of {q.protected} is in the data"


def test_validation_reports_problems(profile):
    bad = {
        "questions": [
            {"id": "a", "user": "nobody", "question": "x", "expect": "maybe", "category": "docs"},
            {"id": "a", "user": "sven", "question": "x", "expect": "answer", "category": "docs", "gold": {"doc_id": "hr-salary-bands", "page": 1}},
            {"id": "b", "user": "sven"},
        ]
    }
    with pytest.raises(QuestionError) as e:
        parse_questions(bad, profile)
    msg = str(e.value)
    for needle in ("unknown user nobody", "expect must be", "duplicate id", "outside sven's doc_scope", "missing question, expect, category"):
        assert needle in msg
