"""Human labels: read `labels.csv`, and write a blind sheet of answers to label.

labels.csv columns: id, human_correct, human_faithful, labeler, notes. Only rows with a
parsable `human_correct` count. German Excel writes WAHR/FALSCH; both are accepted.
"""

from __future__ import annotations

import csv
import random
from pathlib import Path
from typing import Any

LABEL_HEADER = ["id", "human_correct", "human_faithful", "labeler", "notes"]
SHEET_HEADER = ["id", "user", "expect", "question", "reference", "system_answer", "evidence", *LABEL_HEADER[1:]]

_TRUE = {"true", "1", "1.0", "yes", "y", "ja", "wahr"}
_FALSE = {"false", "0", "0.0", "no", "n", "nein", "falsch"}


def parse_bool(value: Any) -> bool | None:
    text = str(value or "").strip().lower()
    return True if text in _TRUE else False if text in _FALSE else None


def read_labels(path: Path) -> dict[str, dict[str, bool | None]]:
    """id -> {correct, faithful}; empty if the file is missing or has only the header."""
    if not path.exists():
        return {}
    out: dict[str, dict[str, bool | None]] = {}
    with path.open(encoding="utf-8-sig", newline="") as f:
        sample = f.read(4096)
        f.seek(0)
        delim = ";" if sample.count(";") > sample.count(",") else ","
        for row in csv.DictReader(f, delimiter=delim):
            qid = (row.get("id") or "").strip()
            correct = parse_bool(row.get("human_correct"))
            if qid and correct is not None:
                out[qid] = {"correct": correct, "faithful": parse_bool(row.get("human_faithful"))}
    return out


def write_sheet(results: list[dict[str, Any]], path: Path, n: int = 50, seed: int = 0) -> int:
    """A BLIND sheet (no rubric or judge verdicts, so they cannot anchor the labeler) of up to
    `n` completed, non-fallback answers, sampled with a fixed seed. Returns the row count."""
    pool = [r for r in results if r["score"]["completed"] and not r["score"]["fallback"]]
    rng = random.Random(seed)
    sample = sorted(rng.sample(pool, min(n, len(pool))), key=lambda r: r["id"])
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(SHEET_HEADER)
        for r in sample:
            w.writerow(
                [
                    r["id"],
                    r["user"],
                    r["expect"],
                    r["question"],
                    r.get("reference", ""),
                    r["answer"],
                    r.get("evidence", ""),
                    "",
                    "",
                    "",
                    "",
                ]
            )
    return len(sample)
