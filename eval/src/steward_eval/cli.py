"""`steward-eval`: run the question set against a Steward backend and write report + JSON.

    uv run steward-eval --base http://127.0.0.1:8000 --profile ../profiles/acme \\
        --report report.md --json results.json [--gate] [--judge-model openrouter/...] \\
        [--limit N] [--only-scripted]

Exit codes: 0 ok, 1 a hard gate failed (with --gate), 2 usage or setup error.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
import time
from pathlib import Path
from typing import Any

from steward_eval import evaluate
from steward_eval.client import Harness, StewardError
from steward_eval.data import Profile, Question, QuestionError, load_profile, load_questions
from steward_eval.judge import PROMPT_VERSION, Judge, default_judge_model, render_evidence
from steward_eval.labels import read_labels, write_sheet
from steward_eval.pii import PiiDetector
from steward_eval.report import render
from steward_eval.rubric import score
from steward_eval.turn import Turn


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="steward-eval", description="Quality eval for Steward (rubric, LLM judge, kappa, CIs, gates).")
    p.add_argument("--base", default="http://127.0.0.1:8000", help="Steward backend URL")
    p.add_argument("--profile", type=Path, default=Path("../profiles/acme"), help="profile directory")
    p.add_argument("--questions", type=Path, help="questions file (default: <profile>/eval/questions.yaml)")
    p.add_argument("--labels", type=Path, help="human labels (default: <profile>/eval/labels.csv)")
    p.add_argument("--report", type=Path, default=Path("report.md"), help="markdown report path")
    p.add_argument("--json", type=Path, dest="json_out", help="per-question results JSON path")
    p.add_argument("--gate", action="store_true", help="exit 1 if a hard gate fails")
    p.add_argument("--judge-model", help="judge model, e.g. openrouter/deepseek/deepseek-v4.1-flash (default: models.yaml routes.judge)")
    p.add_argument("--no-judge", action="store_true", help="never call the LLM judge")
    p.add_argument("--limit", type=int, help="run only the first N selected questions")
    p.add_argument("--only-scripted", action="store_true", help="only questions with a scripted demo turn (offline smoke)")
    p.add_argument("--only", help="comma-separated question ids")
    p.add_argument("--approve", action="store_true", help="approve held calls instead of denying them (changes backend state)")
    p.add_argument("--replay", type=Path, help="re-score the turns of an earlier --json file instead of calling the backend")
    p.add_argument("--rejudge", action="store_true", help="with --replay: call the judge again instead of reusing stored verdicts")
    p.add_argument("--label-sheet", type=Path, help="also write a blind CSV of 50 answers to label by hand")
    p.add_argument("--timeout", type=float, default=300.0, help="per-turn HTTP timeout in seconds")
    p.add_argument("-q", "--quiet", action="store_true")
    return p


def select(questions: list[Question], args: argparse.Namespace) -> list[Question]:
    qs = questions
    if args.only:
        wanted = {x.strip() for x in args.only.split(",") if x.strip()}
        qs = [q for q in qs if q.id in wanted]
    if args.only_scripted:
        qs = [q for q in qs if q.scripted]
    if args.limit is not None:
        qs = qs[: args.limit]
    return qs


def _log(args: argparse.Namespace, msg: str) -> None:
    if not args.quiet:
        print(msg, file=sys.stderr, flush=True)


def run_turns(qs: list[Question], args: argparse.Namespace) -> dict[str, Turn]:
    if args.replay:
        data = json.loads(args.replay.read_text(encoding="utf-8"))
        by_id = {r["id"]: Turn.from_json(r["turn"]) for r in data["results"]}
        return {q.id: by_id.get(q.id, Turn(http_error="not in replay file")) for q in qs}
    h = Harness(args.base, approve=args.approve, timeout=args.timeout)
    try:
        h.health()
        turns: dict[str, Turn] = {}
        for i, q in enumerate(qs, 1):
            try:
                t = h.ask(q.user, q.question, q.impersonated_by)
            except StewardError as e:
                t = Turn(http_error=str(e))
            turns[q.id] = t
            status = "ok" if t.completed else "ERROR " + "; ".join(t.errors)[:120]
            _log(args, f"[{i:>3}/{len(qs)}] {q.user:<7} {q.id:<28} {t.seconds:5.1f}s {status}")
        return turns
    finally:
        h.close()


def previous_verdicts(args: argparse.Namespace, model: str | None) -> dict[str, dict[str, Any]]:
    """Judge verdicts stored in the --replay file, if they came from the same judge model."""
    if not args.replay:
        return {}
    data = json.loads(args.replay.read_text(encoding="utf-8"))
    prev = (data.get("summary") or {}).get("judge") or {}
    if not prev.get("enabled") or (model and prev.get("model") != model):
        return {}
    return {r["id"]: r["judge"] for r in data["results"] if r.get("judge") and not r["judge"].get("error")}


def ledger_total(args: argparse.Namespace, profile: Profile) -> float | None:
    """Total from /api/costs, read as a user with a cost role (profile.yaml cost_roles)."""
    if args.replay:
        return None
    users = profile.users_with_role(profile.meta.get("cost_roles", []))
    if not users:
        return None
    h = Harness(args.base, timeout=30)
    try:
        data = h.session(users[0]).get("/api/costs", days=1)
        return float(data["total_eur"]) if "total_eur" in data else None
    except Exception:  # noqa: BLE001 - cost page is informative only
        return None
    finally:
        h.close()


def judge_price_eur(profile: Profile, route: str, tin: int, tout: int) -> float | None:
    price = (profile.pricing.get("models") or {}).get(route)
    if not price:
        return None
    return tin / 1e6 * float(price.get("input_per_mtok", 0)) + tout / 1e6 * float(price.get("output_per_mtok", 0))


def _clean(v: Any) -> Any:
    """JSON without NaN (null instead)."""
    if isinstance(v, float) and math.isnan(v):
        return None
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_clean(x) for x in v]
    return v


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    started = dt.datetime.now(dt.UTC).strftime("%Y-%m-%d %H:%M UTC")
    t0 = time.monotonic()
    try:
        profile = load_profile(args.profile)
        questions = load_questions(args.questions or args.profile / "eval" / "questions.yaml", profile)
    except (OSError, QuestionError) as e:
        print(f"steward-eval: {e}", file=sys.stderr)
        return 2
    qs = select(questions, args)
    if not qs:
        print("steward-eval: no questions selected", file=sys.stderr)
        return 2

    try:
        turns = run_turns(qs, args)
    except StewardError as e:
        print(f"steward-eval: {e}", file=sys.stderr)
        return 2

    pii = PiiDetector(profile)
    results: list[dict[str, Any]] = []
    for q in qs:
        t = turns[q.id]
        s = score(q, t, profile, pii)
        results.append(
            {
                "id": q.id,
                "user": q.user,
                "impersonated_by": q.impersonated_by,
                "category": q.category,
                "expect": q.expect,
                "scripted": q.scripted,
                "question": q.question,
                "reference": q.reference,
                "answer": t.answer,
                "citations": t.citations,
                "decisions": t.decisions,
                "tool_calls": t.tool_calls,
                "tool_results": t.tool_results,
                "approvals": t.approvals,
                "eur": t.eur,
                "seconds": t.seconds,
                "errors": t.errors,
                "evidence": render_evidence(t, profile),
                "score": s.to_json(),
                "judge": None,
                "turn": t.to_json(),
            }
        )

    # ---- judge
    judge_info: dict[str, Any] = {"enabled": False, "reason": "", "model": None, "prompt_version": PROMPT_VERSION}
    model = args.judge_model or default_judge_model(profile)
    # A replayed run keeps its verdicts (no new API calls) unless --rejudge.
    reused = {} if (args.no_judge or args.rejudge) else previous_verdicts(args, model)
    for r in results:
        if r["id"] in reused:
            r["judge"] = reused[r["id"]]
    judge = None if args.no_judge else Judge.from_env(model)
    if args.no_judge:
        judge_info["reason"] = "disabled with --no-judge"
    elif judge is None and not reused:
        judge_info["reason"] = "no API key (set OPENROUTER_API_KEY)" if model else "no judge model configured"
    tin = tout = 0
    usd = 0.0
    have_usd = False
    n_graded, n_err = len(reused), 0
    if reused:
        judge_info.update(enabled=True, model=model, reused=len(reused))
    if judge is not None:
        judge_info.update(enabled=True, model=judge.route)
        try:
            for i, (q, r) in enumerate(zip(qs, results, strict=True), 1):
                if not r["score"]["completed"] or q.id in reused:
                    continue
                v = judge.grade(q, turns[q.id], profile)
                r["judge"] = v.to_json()
                tin += v.input_tokens
                tout += v.output_tokens
                if v.cost_usd is not None:
                    usd += v.cost_usd
                    have_usd = True
                if v.error:
                    n_err += 1
                else:
                    n_graded += 1
                _log(args, f"judge [{i:>3}/{len(qs)}] {q.id:<28} correct={v.correct} faithful={v.faithful}{' ' + v.error if v.error else ''}")
        finally:
            judge.close()
    judge_info.update(n_graded=n_graded, n_errors=n_err, input_tokens=tin, output_tokens=tout)

    labels_path = args.labels or args.profile / "eval" / "labels.csv"
    human = read_labels(labels_path)

    gates = evaluate.gate_table(results)
    models_seen = sorted({str(e.get("model")) for t in turns.values() for e in t.of("cost") if e.get("model")})
    if not models_seen:
        mode = "unknown"
    elif models_seen == ["scripted"]:
        mode = "scripted (no API key)"
    else:
        mode = ", ".join(models_seen)
    summary: dict[str, Any] = {
        "run": {
            "profile": profile.meta.get("name", args.profile.name),
            "base": args.base if not args.replay else f"replay of {args.replay}",
            "model_mode": mode,
            "started": started,
            "n_total": len(questions),
            "n_run": len(qs),
            "n_scripted_run": sum(q.scripted for q in qs),
            "n_fallback": sum(r["score"]["fallback"] for r in results),
            "users": sorted({q.user for q in qs}),
            "only_scripted": args.only_scripted,
            "approve": args.approve,
            "seconds": time.monotonic() - t0,
        },
        "gates": gates,
        "gates_passed": all(g["passed"] for g in gates),
        "metrics": evaluate.metric_table(results),
        "categories": evaluate.category_table(results),
        "kappa": evaluate.kappa_table(results, human),
        "human_labels": {"path": str(labels_path), "n": len(human)},
        "judge": judge_info,
        "cost": {
            "assistant_eur": sum(r["eur"] for r in results),
            "ledger_total_eur": ledger_total(args, profile),
            "judge_eur": judge_price_eur(profile, judge_info["model"], tin, tout) if judge_info["enabled"] else None,
            "judge_usd": usd if have_usd else None,
        },
        "failures": evaluate.failures(results),
    }
    summary["run"]["seconds"] = time.monotonic() - t0

    args.report.write_text(render(summary), encoding="utf-8")
    if args.json_out:
        args.json_out.write_text(json.dumps(_clean({"summary": summary, "results": results}), ensure_ascii=False, indent=1), encoding="utf-8")
    if args.label_sheet:
        n = write_sheet(results, args.label_sheet)
        _log(args, f"label sheet: {n} rows -> {args.label_sheet}")

    rc = summary["metrics"][0]
    _log(
        args,
        f"\n{len(qs)} questions | rubric correct {100 * rc['mean']:.1f} % | gates "
        f"{'PASSED' if summary['gates_passed'] else 'FAILED'} | report -> {args.report}",
    )
    for g in gates:
        if not g["passed"]:
            _log(args, f"  gate {g['gate']}: {g['count']} ({', '.join(g['questions'][:6])})")
    if args.gate and not summary["gates_passed"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
