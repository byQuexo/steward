"""Markdown report."""

from __future__ import annotations

import math
from typing import Any


def _pct(v: float) -> str:
    return "–" if v is None or (isinstance(v, float) and math.isnan(v)) else f"{100 * v:.1f} %"


def _num(v: float, digits: int = 2) -> str:
    return "–" if v is None or (isinstance(v, float) and math.isnan(v)) else f"{v:.{digits}f}"


def _cell(text: str, limit: int = 160) -> str:
    t = " ".join(str(text).split())
    if len(t) > limit:
        t = t[: limit - 1] + "…"
    return t.replace("|", "\\|")


def render(summary: dict[str, Any]) -> str:
    run = summary["run"]
    lines: list[str] = []
    add = lines.append
    add(f"# Steward quality eval: profile `{run['profile']}`")
    add("")
    add(f"- Backend: `{run['base']}` · model: **{run['model_mode']}** · started {run['started']}")
    add(
        f"- Questions: **{run['n_run']}** run of {run['n_total']} in the set"
        f" ({run['n_scripted_run']} scripted) · users: {', '.join(run['users'])}"
    )
    add(f"- Approvals held by Warden were **{'approved' if run['approve'] else 'denied'}** by the harness.")
    if run["only_scripted"]:
        add("")
        add(
            "> **Offline smoke run (`--only-scripted`).** Only questions that match a scripted demo turn were run, "
            "and the scripted model answers them with fixed texts. This validates the harness and the hard gates "
            "(Warden decisions, approvals, citations, leak checks run for real); it says nothing about answer quality."
        )
    elif run["model_mode"].startswith("scripted"):
        add("")
        add(
            f"> **No real model.** The backend runs the scripted model: {run['n_fallback']} of {run['n_run']} questions got "
            "the fixed fallback text, so correctness is low by construction. Gates are still computed on every answer."
        )
    add("")

    gates = summary["gates"]
    add("## Hard gates")
    add("")
    add(f"**{'PASSED' if summary['gates_passed'] else 'FAILED'}** (all must be 0)")
    add("")
    add("| Gate | Count | Questions | What it means |")
    add("|---|---:|---|---|")
    for g in gates:
        qs = ", ".join(f"`{q}`" for q in g["questions"][:8]) + (" …" if len(g["questions"]) > 8 else "")
        add(f"| {'✅' if g['passed'] else '❌'} `{g['gate']}` | {g['count']} | {qs or '–'} | {g['description']} |")
    add("")

    add("## Metrics (95 % CI, cluster bootstrap over documents, 2000 resamples, seed 0)")
    add("")
    add("| Metric | Mean | 95 % CI | n | Definition |")
    add("|---|---:|---|---:|---|")
    for m in summary["metrics"]:
        ci = "–" if m["n"] == 0 else f"[{_pct(m['lo'])}, {_pct(m['hi'])}]"
        add(f"| `{m['metric']}` | {_pct(m['mean'])} | {ci} | {m['n']} | {m['description']} |")
    add("")

    add("## Per category")
    add("")
    add("| Category | n | Rubric correct | Judge correct | Gate violations |")
    add("|---|---:|---:|---:|---:|")
    for c in summary["categories"]:
        add(f"| {c['category']} | {c['n']} | {_pct(c['rubric_correct'])} | {_pct(c['judge_correct'])} | {c['violations']} |")
    add("")

    add("## LLM judge and agreement")
    add("")
    j = summary["judge"]
    if j["enabled"]:
        add(
            f"Judge `{j['model']}` (prompt `{j['prompt_version']}`, temperature 0) graded {j['n_graded']} answers"
            f" ({j['n_errors']} errors). Tokens: {j['input_tokens']} in / {j['output_tokens']} out."
        )
        if j.get("reused"):
            add(f"{j['reused']} verdicts were reused from the replayed run (no new judge calls for them).")
    else:
        add(f"**Judge skipped:** {j['reason']}. Only the deterministic rubric was applied.")
    add("")
    add("| Pair | n | Raw agreement | Cohen's κ | Status |")
    add("|---|---:|---:|---:|---|")
    for k in summary["kappa"]:
        add(f"| {k['pair']} | {k['n']} | {_pct(k['agreement'])} | {_num(k['kappa'])} | {k['status']} |")
    add("")
    h = summary["human_labels"]
    if h["n"]:
        add(f"Human labels: {h['n']} rows from `{h['path']}`.")
    else:
        add(f"No human labels yet (`{h['path']}` has only its header); see its README for how to label 50 answers.")
    add(
        "Criteria whose κ is below 0.4 (or undefined) are reported only and never gated; the hard gates above are "
        "deterministic and do not depend on the judge."
    )
    add("")

    c = summary["cost"]
    add("## Cost")
    add("")
    add(f"- Assistant runs (sum of `done.eur`): **{c['assistant_eur']:.4f} EUR** for {run['n_run']} questions")
    if c.get("ledger_total_eur") is not None:
        add(f"- Ledger total reported by `/api/costs` (all runs on this backend in the window): {c['ledger_total_eur']:.4f} EUR")
    if c.get("judge_eur") is not None:
        add(f"- Judge (estimated from pricing.yaml): {c['judge_eur']:.4f} EUR")
    if c.get("judge_usd") is not None:
        add(f"- Judge (reported by the provider): {c['judge_usd']:.4f} USD")
    add(f"- Wall time: {run['seconds']:.1f} s")
    add("")

    fails = summary["failures"]
    add(f"## Failures ({len(fails)})")
    add("")
    if not fails:
        add("None.")
    else:
        add("| Question | User | Category | Expect | Why | Answer |")
        add("|---|---|---|---|---|---|")
        for f in fails:
            why = "; ".join(f["violations"] + f["reasons"])
            tag = " (scripted)" if f["scripted"] else ""
            add(f"| `{f['id']}`{tag} | {f['user']} | {f['category']} | {f['expect']} | {_cell(why, 220)} | {_cell(f['answer'])} |")
    add("")
    return "\n".join(lines)
