"""The seed is deterministic, matches the committed data, and derives ACLs from the profile."""

from pathlib import Path

import pytest

from steward_seed import cli, docs, records

ROOT = Path(__file__).resolve().parents[2]
PROFILES = sorted(p for p in (ROOT / "profiles").iterdir() if (p / "seed" / "seed.yaml").exists())


@pytest.mark.parametrize("profile", PROFILES, ids=lambda p: p.name)
def test_generation_is_deterministic(profile: Path) -> None:
    assert cli.generate(profile) == cli.generate(profile)


@pytest.mark.parametrize("profile", PROFILES, ids=lambda p: p.name)
def test_committed_data_is_current(profile: Path) -> None:
    assert cli.main(["--profile", str(profile), "--check"]) == 0


def test_doc_scope_follows_the_acl() -> None:
    acl = {"hr": ["handbook-*", "hr-*"], "sales": ["handbook-*", "sales-*"]}
    ids = ["handbook-a", "hr-salaries", "sales-pricing", "it-vpn"]
    assert records.doc_scope(["hr"], acl, ids) == ["handbook-a", "hr-salaries"]
    assert records.doc_scope(["hr", "sales"], acl, ids) == ["handbook-a", "hr-salaries", "sales-pricing"]
    assert records.doc_scope(["nobody"], acl, ids) == []


def test_markdown_tables_and_lists_become_lines() -> None:
    lines = docs.plain("# T\n\nA\nB\n\n| a | b |\n1. step")
    assert lines == [("h1", "T"), ("p", "A B"), ("row", "a   b"), ("p", "1. step")]
