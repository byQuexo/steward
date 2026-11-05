"""One question's run: the SSE events of a chat turn, with convenient views."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Turn:
    events: list[dict[str, Any]] = field(default_factory=list)
    http_error: str | None = None
    seconds: float = 0.0
    approvals: list[dict[str, Any]] = field(default_factory=list)  # what the harness decided

    def of(self, kind: str) -> list[dict[str, Any]]:
        return [e for e in self.events if e.get("type") == kind]

    @property
    def done(self) -> dict[str, Any] | None:
        d = self.of("done")
        return d[-1] if d else None

    @property
    def answer(self) -> str:
        if self.done is not None and self.done.get("answer"):
            return str(self.done["answer"])
        return "".join(str(e.get("text", "")) for e in self.of("token"))

    @property
    def citations(self) -> list[dict[str, Any]]:
        return self.of("citation")

    @property
    def decisions(self) -> list[dict[str, Any]]:
        return self.of("decision")

    @property
    def tool_calls(self) -> list[dict[str, Any]]:
        return self.of("tool_call")

    @property
    def tool_results(self) -> list[dict[str, Any]]:
        return self.of("tool_result")

    @property
    def ok_results(self) -> list[dict[str, Any]]:
        return [r for r in self.tool_results if r.get("ok") is True]

    @property
    def abstained_event(self) -> bool:
        return bool(self.of("abstained"))

    @property
    def errors(self) -> list[str]:
        out = [str(e.get("message", "")) for e in self.of("error")]
        if self.http_error:
            out.insert(0, self.http_error)
        return out

    @property
    def eur(self) -> float:
        if self.done is not None and self.done.get("eur") is not None:
            return float(self.done["eur"])
        return float(sum(float(e.get("eur", 0.0)) for e in self.of("cost")))

    @property
    def completed(self) -> bool:
        return self.http_error is None and self.done is not None

    def approved_ids(self) -> set[str]:
        """Approval ids that ended approved (from the stream or the harness's own decision)."""
        ok: set[str] = set()
        for e in self.of("approval_decided"):
            status = str(e.get("status", e.get("decision", ""))).lower()
            if status in ("approved", "approve"):
                ok.add(str(e.get("approval_id", "")))
        for a in self.approvals:
            if a.get("final") == "approved":
                ok.add(str(a.get("approval_id", "")))
        return ok

    def to_json(self) -> dict[str, Any]:
        return {"events": self.events, "http_error": self.http_error, "seconds": self.seconds, "approvals": self.approvals}

    @classmethod
    def from_json(cls, d: dict[str, Any]) -> Turn:
        return cls(events=d.get("events", []), http_error=d.get("http_error"), seconds=d.get("seconds", 0.0), approvals=d.get("approvals", []))
