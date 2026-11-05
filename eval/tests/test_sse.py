from steward_eval.sse import iter_events, parse_sse


def test_parses_steward_events():
    body = (
        "event: token\n"
        'data: {"text":"Hallo","type":"token"}\n'
        "\n"
        ": keep-alive\n"
        "\n"
        "event: done\n"
        'data: {"answer":"Hallo","eur":0.01,"run_id":"r1","type":"done"}\n'
        "\n"
    )
    events = parse_sse(body)
    assert [e["type"] for e in events] == ["token", "done"]
    assert events[1]["answer"] == "Hallo"


def test_crlf_and_missing_trailing_blank_line():
    body = 'event: token\r\ndata: {"text":"a","type":"token"}\r\n\r\ndata: {"type":"done","answer":"a"}'
    assert [e["type"] for e in parse_sse(body)] == ["token", "done"]


def test_multiline_data_is_joined():
    body = 'data: {"type":"citation",\ndata: "quote":"x"}\n\n'
    assert parse_sse(body) == [{"type": "citation", "quote": "x"}]


def test_event_name_fills_missing_type_and_garbage_is_skipped():
    body = "event: abstained\ndata: {\"tool\":\"docs.search\"}\n\ndata: not json\n\ndata: [1,2]\n\n"
    assert parse_sse(body) == [{"tool": "docs.search", "type": "abstained"}]


def test_iter_events_streams_lines():
    lines = iter(['data: {"type":"token","text":"a"}', "", 'data: {"type":"done","answer":"a"}', ""])
    got = []
    for e in iter_events(lines):
        got.append(e["type"])
    assert got == ["token", "done"]
