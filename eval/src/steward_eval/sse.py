"""Server-sent events as Steward's `/api/chat` streams them.

Each event is a block of `field: value` lines ended by a blank line; Steward puts the whole
JSON payload (with a `type` field) into one `data:` line and repeats the type as `event:`.
Comment lines (`:` keep-alives) are ignored. Multi-line `data:` fields are joined with `\\n`
as the SSE spec says, so a payload split over several lines still parses.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from typing import Any


def iter_events(lines: Iterable[str]) -> Iterator[dict[str, Any]]:
    """Parse SSE lines (without or with line endings) into JSON events.

    Events without a parsable JSON `data` are skipped. If the payload has no `type`,
    the SSE `event:` name is used.
    """
    data: list[str] = []
    name: str | None = None
    for raw in lines:
        line = raw.rstrip("\r\n")
        if line == "":
            event = _finish(data, name)
            if event is not None:
                yield event
            data, name = [], None
            continue
        if line.startswith(":"):
            continue
        field, _, value = line.partition(":")
        if value.startswith(" "):
            value = value[1:]
        if field == "data":
            data.append(value)
        elif field == "event":
            name = value
    event = _finish(data, name)
    if event is not None:
        yield event


def parse_sse(text: str) -> list[dict[str, Any]]:
    """All JSON events of a complete SSE body."""
    return list(iter_events(text.replace("\r\n", "\n").split("\n")))


def _finish(data: list[str], name: str | None) -> dict[str, Any] | None:
    if not data:
        return None
    try:
        payload = json.loads("\n".join(data))
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    if "type" not in payload and name:
        payload["type"] = name
    return payload
