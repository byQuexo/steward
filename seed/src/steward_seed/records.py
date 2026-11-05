"""Structured records: users, HR, CRM, tickets and the mock systems.

Every generator takes the section of seed.yaml it needs and a seeded ``random.Random``/``Faker``
pair, so the output depends only on the seed file.
"""

from __future__ import annotations

import fnmatch
import random
import re
from datetime import date, timedelta
from typing import Any

from faker import Faker

BASE_DATE = date(2026, 11, 2)  # fixed "today" for the seed, never the wall clock


def faker_for(locale: str, seed: int) -> Faker:
    fake = Faker(locale)
    fake.seed_instance(seed)
    return fake


def doc_scope(teams: list[str], acl: dict[str, list[str]], doc_ids: list[str]) -> list[str]:
    patterns = [p for t in teams for p in acl.get(t, [])]
    return sorted({d for d in doc_ids if any(fnmatch.fnmatchcase(d, p) for p in patterns)})


def users(cfg: dict[str, Any], acl: dict[str, list[str]], doc_ids: list[str]) -> list[dict[str, Any]]:
    out = []
    for u in cfg["demo_users"]:
        attrs: dict[str, Any] = {"org_unit": u["unit"], "teams": list(u["teams"])}
        if u.get("tenants"):
            attrs["tenants"] = list(u["tenants"])
        # Any further claims the profile's policy uses (repos, channels, cost centers, ...).
        for k, v in (u.get("attrs") or {}).items():
            attrs[k] = list(v) if isinstance(v, list) else v
        attrs["doc_scope"] = doc_scope(u["teams"], acl, doc_ids)
        out.append(
            {
                "id": u["id"],
                "name": u["name"],
                "email": f"{u['id']}@{cfg['email_domain']}",
                "title": u["title"],
                "roles": list(u["roles"]),
                "teams": list(u["teams"]),
                "attrs": attrs,
                # Local demo realm only; production uses the company IdP.
                "password": u["id"],
            }
        )
    return out


# Academic and professional titles Faker's de_DE provider adds to names ("Dipl.-Ing. … B.Eng.").
_NAME_TITLES = re.compile(r"^(?:(?:Dr|Prof|Univ\.Prof|Dipl\.-[A-Za-z]+|Ing|med|B\.[A-Za-z]+|M\.[A-Za-z]+|MBA|MBA\.)\.?$)")


def gendered(title: str, name: str, fake: Faker) -> str:
    """Pick `masculine|feminine` by the first name (Faker's own name lists); unknown → first."""
    if "|" not in title:
        return title
    m, f = title.split("|", 1)
    first = name.split()[0].split("-")[0]
    female_names = {n for prov in fake.providers for n in getattr(prov, "first_names_female", ())}
    return f if first in female_names else m


def plain_name(name: str) -> str:
    """A person's name without academic titles."""
    return " ".join(p for p in name.split() if not _NAME_TITLES.match(p))


def hr(cfg: dict[str, Any], demo: list[dict[str, Any]], seed: int, locale: str) -> dict[str, Any]:
    section = cfg["hr"]
    rng = random.Random(seed * 10 + 1)
    fake = faker_for(locale, seed * 10 + 1)
    bands = section["salary_bands"]
    employees = []
    n = 1
    demo_by_unit: dict[str, list[dict[str, Any]]] = {}
    for u in demo:
        demo_by_unit.setdefault(u["attrs"]["org_unit"], []).append(u)
    # Job titles per unit and band; a separate generator so the other values stay stable.
    titles = section.get("titles") or {}
    title_rng = random.Random(seed * 10 + 7)
    # Fixed HR records for demo users (optional), e.g. `hr: { band: E5, salary: 128000 }`.
    fixed = {u["id"]: u.get("hr") or {} for u in cfg.get("demo_users", [])}
    for unit in section["units"]:
        people = []
        for u in demo_by_unit.get(unit, []):
            people.append((u["name"], u["title"], u["id"]))
        while len(people) < section["employees_per_unit"]:
            name, _ = fake.name(), fake.job()
            people.append((plain_name(name), None, None))
        for name, title, login in people:
            # Draw order matters: it keeps every other seeded value stable.
            band = rng.choice(list(bands))
            lo, hi = bands[band]
            start = BASE_DATE - timedelta(days=rng.randint(60, 3650))
            location = rng.choice(["Köln", "Hamburg", "München"])
            salary = int(round(rng.uniform(lo, hi) / 500.0) * 500)
            if login and fixed.get(login):
                band = fixed[login].get("band", band)
                salary = int(fixed[login].get("salary", salary))
            if title is None:
                options = (titles.get(unit) or {}).get(band) or [f"Mitarbeiter:in {unit}"]
                title = gendered(title_rng.choice(options), name, fake)
            employees.append(
                {
                    "id": f"e-{n:03d}",
                    "name": name,
                    "unit": unit,
                    "title": title,
                    "login": login,
                    "location": location,
                    "start_date": start.isoformat(),
                    "band": band,
                    "salary_eur": salary,
                    "vacation_days_left": rng.randint(0, 30),
                }
            )
            n += 1
    absences = []
    for e in rng.sample(employees, k=min(10, len(employees))):
        start = BASE_DATE + timedelta(days=rng.randint(-5, 30))
        absences.append(
            {
                "employee_id": e["id"],
                "unit": e["unit"],
                "kind": rng.choice(["Urlaub", "Fortbildung", "Elternzeit"]),
                "from": start.isoformat(),
                "to": (start + timedelta(days=rng.randint(1, 14))).isoformat(),
            }
        )
    absences.sort(key=lambda a: (a["from"], a["employee_id"]))
    return {"employees": employees, "absences": absences}


def crm(cfg: dict[str, Any], seed: int, locale: str) -> dict[str, Any]:
    section = cfg["crm"]
    rng = random.Random(seed * 10 + 2)
    fake = faker_for(locale, seed * 10 + 2)
    owners = {t: [u["id"] for u in cfg["demo_users"] if t in u.get("tenants", [])] or ["unassigned"] for t in section["tenants"]}
    accounts = []
    fixed = section.get("fixed_deals", [])
    fixed_accounts = {(d["tenant"], d["account"]) for d in fixed}
    for tenant, name in sorted(fixed_accounts):
        accounts.append({"id": f"a-{len(accounts) + 1:03d}", "tenant": tenant, "name": name, "city": fake.city()})
    for tenant in section["tenants"]:
        while sum(1 for a in accounts if a["tenant"] == tenant) < section["accounts_per_tenant"]:
            accounts.append({"id": f"a-{len(accounts) + 1:03d}", "tenant": tenant, "name": fake.company(), "city": fake.city()})
    fixed_ids = {d["id"] for d in fixed}
    deals = []
    for d in fixed:
        acc = next(a for a in accounts if a["tenant"] == d["tenant"] and a["name"] == d["account"])
        deals.append({**{k: v for k, v in d.items() if k != "account"}, "account_id": acc["id"], "account": acc["name"]})
    next_id = 1001
    products = ["Acme Flow Starter", "Acme Flow Business", "Acme Flow Enterprise", "Acme Insight Add-on"]
    for tenant in section["tenants"]:
        while sum(1 for d in deals if d["tenant"] == tenant) < section["deals_per_tenant"]:
            while f"d-{next_id}" in fixed_ids:
                next_id += 1
            acc = rng.choice([a for a in accounts if a["tenant"] == tenant])
            deals.append(
                {
                    "id": f"d-{next_id}",
                    "tenant": tenant,
                    "title": rng.choice(products),
                    "amount": rng.randrange(8000, 160000, 500),
                    "stage": rng.choice(section["stages"]),
                    "owner": rng.choice(owners[tenant]),
                    "account_id": acc["id"],
                    "account": acc["name"],
                }
            )
            next_id += 1
    deals.sort(key=lambda d: d["id"])
    return {"accounts": accounts, "deals": deals}


def tickets(cfg: dict[str, Any], demo: list[dict[str, Any]], seed: int, locale: str) -> dict[str, Any]:
    section = cfg["tickets"]
    rng = random.Random(seed * 10 + 3)
    fake = faker_for(locale, seed * 10 + 3)
    it_people = [u["id"] for u in demo if "it" in u["teams"]]
    requesters = [u["id"] for u in demo]
    out = []
    fixed_ids = {t["id"] for t in section.get("fixed", [])}
    for t in section.get("fixed", []):
        out.append(
            {
                "id": t["id"],
                "title": t["title"],
                "body": t["body"],
                "category": t["category"],
                "requester": t["requester"],
                "assignee": rng.choice(it_people) if it_people else None,
                "status": "offen",
                "priority": "hoch",
                "created": (BASE_DATE - timedelta(days=1)).isoformat(),
                "comments": [],
            }
        )
    n = 2001
    titles = {
        "VPN": ["VPN trennt alle paar Minuten", "Kein Zugriff auf Intranet über VPN"],
        "Hardware": ["Notebook-Akku hält nur eine Stunde", "Monitor flackert"],
        "Zugang": ["Zugriff auf Laufwerk Vertrieb benötigt", "Passwort abgelaufen"],
        "Software": ["Excel stürzt beim Öffnen ab", "Lizenz für Acme Insight fehlt"],
        "Drucker": ["Scanner sendet keine E-Mails", "Toner leer im 2. OG"],
    }
    while len(out) < section["count"]:
        while f"t-{n}" in fixed_ids:
            n += 1
        cat = rng.choice(section["categories"])
        out.append(
            {
                "id": f"t-{n}",
                "title": rng.choice(titles.get(cat, [f"Problem mit {cat}"])),
                "body": fake.paragraph(nb_sentences=3),
                "category": cat,
                "requester": rng.choice(requesters),
                "assignee": rng.choice(it_people) if it_people else None,
                "status": rng.choice(["offen", "offen", "in Arbeit", "geschlossen"]),
                "priority": rng.choice(["niedrig", "mittel", "hoch"]),
                "created": (BASE_DATE - timedelta(days=rng.randint(1, 60))).isoformat(),
                "comments": [],
            }
        )
        n += 1
    out.sort(key=lambda t: t["id"])
    return {"tickets": out}


def jira(cfg: dict[str, Any], seed: int, locale: str) -> dict[str, Any]:
    section = cfg["jira"]
    rng = random.Random(seed * 10 + 4)
    fake = faker_for(locale, seed * 10 + 4)
    issues = []
    for i in range(section["issues"]):
        project = section["projects"][i % len(section["projects"])]
        issues.append(
            {
                "key": f"{project}-{100 + i}",
                "project": project,
                "summary": fake.sentence(nb_words=6).rstrip("."),
                "status": rng.choice(["To Do", "In Progress", "Done"]),
            }
        )
    return {"projects": section["projects"], "issues": issues}


def chat(cfg: dict[str, Any], demo: list[dict[str, Any]], seed: int, locale: str) -> dict[str, Any]:
    section = cfg["chat"]
    rng = random.Random(seed * 10 + 5)
    fake = faker_for(locale, seed * 10 + 5)
    messages = []
    for i in range(section["messages"]):
        messages.append(
            {
                "id": f"m-{i + 1:03d}",
                "channel": rng.choice(section["channels"]),
                "author": rng.choice(demo)["id"],
                "text": fake.sentence(nb_words=10),
                "ts": (BASE_DATE - timedelta(hours=rng.randint(1, 200))).isoformat(),
            }
        )
    messages.sort(key=lambda m: m["id"])
    return {"channels": section["channels"], "messages": messages}


def github(cfg: dict[str, Any], seed: int, locale: str) -> dict[str, Any]:
    section = cfg["github"]
    rng = random.Random(seed * 10 + 6)
    fake = faker_for(locale, seed * 10 + 6)
    issues, pulls = [], []
    for repo in section["repos"]:
        for i in range(section["issues_per_repo"]):
            issues.append(
                {
                    "repo": repo,
                    "number": i + 1,
                    "title": fake.sentence(nb_words=5).rstrip("."),
                    "state": rng.choice(["open", "open", "closed"]),
                    "labels": rng.sample(["bug", "feature", "docs", "security"], k=rng.randint(0, 2)),
                }
            )
        for i in range(section["pulls_per_repo"]):
            pulls.append(
                {
                    "repo": repo,
                    "number": 100 + i,
                    "title": fake.sentence(nb_words=5).rstrip("."),
                    "state": "open",
                    "base": "main",
                    "author": rng.choice(section.get("authors", ["dev"])),
                }
            )
    return {"repos": section["repos"], "issues": issues, "pulls": pulls}
