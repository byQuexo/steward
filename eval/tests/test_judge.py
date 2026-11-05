import json

import httpx

from steward_eval.data import Gold, Question
from steward_eval.judge import Judge, build_messages, default_judge_model, expected_behaviour, parse_verdict
from steward_eval.turn import Turn


def test_parse_verdict_variants():
    v = parse_verdict('```json\n{"reasoning": "ok", "correct": true, "faithful": "false"}\n```')
    assert (v.correct, v.faithful, v.reasoning, v.error) == (True, False, "ok", None)
    assert parse_verdict("no json here").error
    assert parse_verdict('{"correct": tru').error


def test_expected_behaviour_texts():
    a = Question("a", "ivo", "?", "answer", "docs", key_facts=["14 Zeichen", ["x", "y"]], reference="Mindestens 14 Zeichen.")
    assert "Mindestens 14 Zeichen." in expected_behaviour(a) and "x / y" in expected_behaviour(a)
    d = Question("d", "hanna", "?", "deny", "hr", protected=["112500"], approval_required=True)
    assert "112500" in expected_behaviour(d) and "REJECTED" in expected_behaviour(d)


def test_messages_carry_cited_page_and_tool_results(profile):
    q = Question("x", "ivo", "Handshake?", "answer", "docs", gold=Gold("it-vpn-setup", 2), key_facts=["Systemzeit"])
    turn = Turn(
        events=[
            {"type": "citation", "doc_id": "it-vpn-setup", "page": 2, "quote": "Die Systemzeit des Geräts weicht ab."},
            {"type": "tool_result", "tool": "docs.search", "ok": True, "preview": "{...}"},
            {"type": "done", "answer": "Systemzeit synchronisieren.", "eur": 0},
        ]
    )
    msgs = build_messages(q, turn, profile)
    assert msgs[0]["role"] == "system" and "faithful" in msgs[0]["content"]
    assert "DNS-Server 10.20.0.53" in msgs[1]["content"]  # full page text, not just the quote
    assert "[tool docs.search ok]" in msgs[1]["content"]


def test_default_model_and_env(profile, monkeypatch):
    assert default_judge_model(profile) == "openrouter/deepseek/deepseek-v4.1-flash"
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("STEWARD_EVAL_JUDGE_KEY", raising=False)
    monkeypatch.setattr("steward_eval.judge.stored_key", lambda name: None)
    assert Judge.from_env("openrouter/x") is None
    monkeypatch.setattr("steward_eval.judge.stored_key", lambda name: "from-keyring")
    assert Judge.from_env("openrouter/x") is not None


def test_grade_over_openai_compatible_api(profile):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(json.loads(request.content))
        seen["auth"] = request.headers["authorization"]
        content = '{"reasoning": "matches", "correct": true, "faithful": true}'
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": content}}], "usage": {"prompt_tokens": 900, "completion_tokens": 40, "cost": 0.0002}},
        )

    j = Judge("openrouter/deepseek/deepseek-v4.1-flash", "k", "https://example.test/v1", transport=httpx.MockTransport(handler))
    q = Question("x", "fiona", "Hotel?", "answer", "docs", key_facts=["180 Euro"], reference="180 Euro.")
    v = j.grade(q, Turn(events=[{"type": "done", "answer": "180 Euro", "eur": 0}]), profile)
    j.close()
    assert v.correct and v.faithful and v.input_tokens == 900 and v.cost_usd == 0.0002
    assert seen["model"] == "deepseek/deepseek-v4.1-flash" and seen["temperature"] == 0 and seen["auth"] == "Bearer k"
