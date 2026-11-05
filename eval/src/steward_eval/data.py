"""Load a Steward profile directory: users, corpus, records, Warden policy and catalog,
demo scenarios and the eval questions."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

EXPECTS = ("answer", "abstain", "deny")


def normalize_prompt(text: str) -> str:
    """Same key as Steward's scripted model (crates/steward-agents/src/scripted.rs `normalize`):
    lowercase, collapse whitespace, strip trailing `?.! `."""
    return " ".join(text.lower().split()).rstrip("?.! ")


@dataclass(frozen=True)
class Gold:
    doc_id: str
    page: int | None = None


@dataclass
class Question:
    id: str
    user: str
    question: str
    expect: str
    category: str
    gold: Gold | None = None
    key_facts: list[str | list[str]] = field(default_factory=list)
    reference: str = ""
    protected: list[str] = field(default_factory=list)
    forbidden_tools: list[str] = field(default_factory=list)
    approval_required: bool = False
    must_not_contain: list[str] = field(default_factory=list)
    require_events: list[str] = field(default_factory=list)
    impersonated_by: str | None = None
    scripted: bool = False

    @property
    def cluster(self) -> str:
        """Bootstrap cluster: questions about one document are correlated (one bad parse fails
        all of them), so document questions share a cluster; the rest are their own."""
        return f"doc:{self.gold.doc_id}" if self.gold else f"q:{self.id}"


@dataclass
class Profile:
    root: Path
    meta: dict[str, Any]
    users: dict[str, dict[str, Any]]
    corpus: dict[str, dict[str, Any]]
    hr: dict[str, Any]
    crm: dict[str, Any]
    policy: dict[str, Any]
    catalog: dict[str, dict[str, Any]]
    scenarios: list[dict[str, Any]]
    models: dict[str, Any]
    pricing: dict[str, Any]

    # ---- documents
    def page_text(self, doc_id: str, page: int) -> str | None:
        doc = self.corpus.get(doc_id)
        if not doc:
            return None
        for p in doc["pages"]:
            if p["page"] == page:
                return p["text"]
        return None

    def doc_scope(self, user: str) -> list[str]:
        return list(self.users[user].get("attrs", {}).get("doc_scope", []))

    # ---- rights
    def scopes(self, user: str) -> set[str]:
        roles = self.policy.get("roles", {})
        return {s for r in self.users[user].get("roles", []) for s in roles.get(r, [])}

    def tenants(self, user: str) -> set[str]:
        return set(self.users[user].get("attrs", {}).get("tenants", []))

    def org_unit(self, user: str) -> str | None:
        return self.users[user].get("attrs", {}).get("org_unit")

    def agent_max(self, agent: str) -> set[str] | None:
        a = self.policy.get("agents", {}).get(agent)
        return set(a.get("max", [])) if a else None

    def may_delegate_to(self, agent: str) -> set[str]:
        a = self.policy.get("agents", {}).get(agent) or {}
        return set((a.get("delegation") or {}).get("may_delegate_to", []))

    @property
    def orchestrator_agent(self) -> str:
        return self.meta.get("agents", {}).get("orchestrator", {}).get("client_id", "acme-bot")

    # ---- scenarios
    def scripted_prompts(self) -> set[str]:
        """User texts the scripted model knows (demo scenario turns)."""
        return {normalize_prompt(t["user"]) for sc in self.scenarios for t in sc.get("turns", [])}

    def denied_message(self) -> str:
        return self.meta.get("messages", {}).get("denied", "")

    def abstained_message(self) -> str:
        return self.meta.get("messages", {}).get("abstained", "")

    def users_with_role(self, roles: list[str]) -> list[str]:
        return [u for u, d in self.users.items() if set(d.get("roles", [])) & set(roles)]


def _yaml(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


def _json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_catalog(warden_dir: Path) -> dict[str, dict[str, Any]]:
    """Flatten Warden catalog sections (tool, x-memory, x-docs-page, a2a_skill) into name -> entry."""
    out: dict[str, dict[str, Any]] = {}
    for name in ("catalog.yaml",):
        data = _yaml(warden_dir / name) or {}
        for section, entries in data.items():
            if section == "version" or not isinstance(entries, dict):
                continue
            for tool, entry in entries.items():
                out[tool] = {**(entry or {}), "kind": section}
    return out


def load_profile(root: Path) -> Profile:
    root = Path(root)
    data = root / "data"
    users = {u["id"]: u for u in _json(data / "users.json")}
    corpus = {d["doc_id"]: d for d in _json(data / "corpus.json")}
    scenarios = []
    demo = root / "scenarios" / "demo"
    if demo.is_dir():
        scenarios = [_yaml(p) for p in sorted(demo.glob("*.yaml"))]
    return Profile(
        root=root,
        meta=_yaml(root / "profile.yaml") or {},
        users=users,
        corpus=corpus,
        hr=_json(data / "hr.json"),
        crm=_json(data / "crm.json"),
        policy=_yaml(root / "warden" / "policy.yaml") or {},
        catalog=load_catalog(root / "warden"),
        scenarios=scenarios,
        models=_yaml(root / "models.yaml") if (root / "models.yaml").exists() else {},
        pricing=_yaml(root / "pricing.yaml") if (root / "pricing.yaml").exists() else {},
    )


class QuestionError(ValueError):
    pass


def parse_questions(raw: Any, profile: Profile | None = None) -> list[Question]:
    """Validate and parse the questions file. Raises QuestionError with every problem found."""
    items = raw.get("questions") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        raise QuestionError("questions file: expected a list under `questions`")
    problems: list[str] = []
    out: list[Question] = []
    seen: set[str] = set()
    scripted = profile.scripted_prompts() if profile else set()
    for i, q in enumerate(items):
        where = f"question #{i + 1} ({q.get('id', '?') if isinstance(q, dict) else '?'})"
        if not isinstance(q, dict):
            problems.append(f"{where}: not a mapping")
            continue
        missing = [k for k in ("id", "user", "question", "expect", "category") if not q.get(k)]
        if missing:
            problems.append(f"{where}: missing {', '.join(missing)}")
            continue
        if q["id"] in seen:
            problems.append(f"{where}: duplicate id")
        seen.add(q["id"])
        if q["expect"] not in EXPECTS:
            problems.append(f"{where}: expect must be one of {EXPECTS}")
        gold = None
        if q.get("gold"):
            gold = Gold(doc_id=q["gold"]["doc_id"], page=q["gold"].get("page"))
        if profile:
            if q["user"] not in profile.users:
                problems.append(f"{where}: unknown user {q['user']}")
            if q.get("impersonated_by") and q["impersonated_by"] not in profile.users:
                problems.append(f"{where}: unknown impersonator {q['impersonated_by']}")
            if gold:
                if gold.doc_id not in profile.corpus:
                    problems.append(f"{where}: unknown gold doc {gold.doc_id}")
                elif gold.page is not None and profile.page_text(gold.doc_id, gold.page) is None:
                    problems.append(f"{where}: gold page {gold.page} not in {gold.doc_id}")
                elif q["user"] in profile.users and gold.doc_id not in profile.doc_scope(q["user"]):
                    problems.append(f"{where}: gold doc {gold.doc_id} outside {q['user']}'s doc_scope")
        if q["expect"] == "answer" and gold and not q.get("key_facts"):
            problems.append(f"{where}: document answer without key_facts")
        out.append(
            Question(
                id=q["id"],
                user=q["user"],
                question=q["question"],
                expect=q["expect"],
                category=q["category"],
                gold=gold,
                key_facts=list(q.get("key_facts") or []),
                reference=q.get("reference", "") or "",
                protected=[str(p) for p in q.get("protected") or []],
                forbidden_tools=list(q.get("forbidden_tools") or []),
                approval_required=q.get("approval") == "required",
                must_not_contain=list(q.get("must_not_contain") or []),
                require_events=list(q.get("require_events") or []),
                impersonated_by=q.get("impersonated_by"),
                scripted=normalize_prompt(q["question"]) in scripted,
            )
        )
    if problems:
        raise QuestionError("\n".join(problems))
    return out


def load_questions(path: Path, profile: Profile | None = None) -> list[Question]:
    return parse_questions(_yaml(Path(path)), profile)
