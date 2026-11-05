"""HTTP client for Steward's BFF, the way a browser uses it: dev login (cookie session),
chat over SSE, the approval inbox, and test-as sessions. One `httpx.Client` per user."""

from __future__ import annotations

import time
from typing import Any

import httpx

from steward_eval.sse import iter_events
from steward_eval.turn import Turn

HEADERS = {"X-Steward": "1"}


class StewardError(RuntimeError):
    pass


class Session:
    """A logged-in browser session for one user."""

    def __init__(self, base: str, user: str, timeout: float = 300.0, transport: httpx.BaseTransport | None = None):
        self.base = base.rstrip("/")
        self.user = user
        self.http = httpx.Client(
            base_url=self.base,
            headers=HEADERS,
            timeout=httpx.Timeout(timeout, connect=10.0),
            transport=transport,
        )

    def close(self) -> None:
        self.http.close()

    def login(self) -> None:
        r = self.http.post("/api/dev-login", json={"user": self.user})
        if r.status_code != 200:
            raise StewardError(f"dev-login {self.user}: HTTP {r.status_code} {r.text[:200]}")

    def test_as(self, target: str) -> None:
        """Switch this (admin) session into a test-as session for `target`."""
        r = self.http.post("/api/admin/test-as", json={"user": target})
        if r.status_code != 200:
            raise StewardError(f"test-as {target}: HTTP {r.status_code} {r.text[:200]}")

    def clear_history(self) -> None:
        self.http.delete("/api/chat/history")

    def get(self, path: str, **params: Any) -> Any:
        r = self.http.get(path, params=params or None)
        r.raise_for_status()
        return r.json()

    def pending_approvals(self) -> list[dict[str, Any]]:
        try:
            return list(self.get("/api/approvals").get("to_decide", []))
        except httpx.HTTPError:
            return []

    def decide(self, approval_id: str, approve: bool) -> tuple[int, str]:
        r = self.http.post(
            f"/api/approvals/{approval_id}",
            json={"decision": "approve" if approve else "deny", "reason": "steward-eval"},
        )
        return r.status_code, r.text[:200]

    def chat(self, message: str, on_event=None) -> Turn:
        """One chat turn; `on_event(event)` is called for every event as it arrives
        (used to decide approvals while the gateway holds the call)."""
        turn = Turn()
        start = time.monotonic()
        try:
            with self.http.stream("POST", "/api/chat", json={"message": message}) as r:
                if r.status_code != 200:
                    r.read()
                    turn.http_error = f"chat: HTTP {r.status_code} {r.text[:200]}"
                    return turn
                for event in iter_events(r.iter_lines()):
                    turn.events.append(event)
                    if on_event is not None:
                        on_event(event)
                    if event.get("type") == "done":
                        break
        except httpx.HTTPError as e:
            turn.http_error = f"chat: {type(e).__name__}: {e}"
        finally:
            turn.seconds = time.monotonic() - start
        return turn


class Harness:
    """Sessions per (user, impersonator) plus approver sessions; decides approvals."""

    def __init__(self, base: str, approve: bool = False, timeout: float = 300.0, transport: httpx.BaseTransport | None = None):
        self.base = base
        self.approve = approve
        self.timeout = timeout
        self.transport = transport
        self._sessions: dict[tuple[str, str | None], Session] = {}
        self._approvers: dict[str, Session] = {}

    def close(self) -> None:
        for s in [*self._sessions.values(), *self._approvers.values()]:
            s.close()

    def health(self) -> None:
        try:
            with httpx.Client(timeout=5.0, transport=self.transport) as c:
                r = c.get(self.base.rstrip("/") + "/health")
            r.raise_for_status()
        except httpx.HTTPError as e:
            raise StewardError(f"backend not reachable at {self.base}: {e}") from e

    def session(self, user: str, impersonated_by: str | None = None) -> Session:
        key = (user, impersonated_by)
        if key not in self._sessions:
            s = Session(self.base, impersonated_by or user, self.timeout, self.transport)
            s.login()
            if impersonated_by:
                s.test_as(user)
                s.user = user
            self._sessions[key] = s
        return self._sessions[key]

    def approver(self, user: str) -> Session:
        if user not in self._approvers:
            s = Session(self.base, user, self.timeout, self.transport)
            s.login()
            self._approvers[user] = s
        return self._approvers[user]

    def _settle(self, event: dict[str, Any], requester: str, log: list[dict[str, Any]]) -> None:
        """Decide a held call: deny (default, the eval changes nothing) or approve with as many
        distinct approvers as the route needs (four-eyes: two)."""
        approval_id = str(event.get("approval_id", ""))
        approvers = [a for a in event.get("approvers", []) if a != requester]
        entry: dict[str, Any] = {"approval_id": approval_id, "tool": event.get("tool"), "rule": event.get("rule"), "votes": []}
        log.append(entry)
        if not approvers:
            entry["final"] = "no_approver"
            return
        for who in approvers[: (2 if self.approve else 1)]:
            sess = self.approver(who)
            # The inbox registers the request right before it publishes the event; poll briefly.
            for _ in range(40):
                if any(str(a.get("id")) == approval_id for a in sess.pending_approvals()):
                    break
                time.sleep(0.05)
            status, text = sess.decide(approval_id, self.approve)
            entry["votes"].append({"approver": who, "approve": self.approve, "status": status, "detail": text if status != 200 else ""})
            if not self.approve or status == 409:
                break
        entry["final"] = "pending"

    def ask(self, user: str, message: str, impersonated_by: str | None = None) -> Turn:
        s = self.session(user, impersonated_by)
        s.clear_history()
        log: list[dict[str, Any]] = []

        def on_event(e: dict[str, Any]) -> None:
            if e.get("type") == "approval_pending":
                self._settle(e, user, log)
            elif e.get("type") == "approval_decided":
                for entry in log:
                    if entry["approval_id"] == str(e.get("approval_id")):
                        entry["final"] = str(e.get("status", e.get("decision", ""))).lower()

        turn = s.chat(message, on_event)
        turn.approvals = log
        return turn
