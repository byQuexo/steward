"""Text normalization shared by the rubric and the PII detector.

German answers write the same fact many ways: `48.000 €`, `48000 EUR`, `48 000 Euro`;
`10 %` and `10 Prozent`. We normalize both sides before matching so the rubric measures the
fact, not the formatting.
"""

from __future__ import annotations

import re
import unicodedata

_THOUSANDS = re.compile(r"(?<=\d)[.  '](?=\d{3}(?!\d))")
# A plain space separates thousands only after a 1-3 digit group that starts a number
# ("48 000"), never inside "d-1025 155.000" (two numbers).
_SPACED = re.compile(r"(?<![\w.,-])(\d{1,3})((?: \d{3})+)(?![\d])")
_DECIMAL_ZERO = re.compile(r"(?<=\d),-|(?<=\d)[.,]00(?!\d)")
_EUR = re.compile(r"€|\beur\b")
_PERCENT = re.compile(r"\s*%")
_WS = re.compile(r"\s+")
_DASHES = str.maketrans({"–": "-", "—": "-", "‑": "-", "­": None})


def norm(text: str) -> str:
    """Lowercase, unify dashes, thousands separators, currency and percent signs, whitespace."""
    s = unicodedata.normalize("NFKC", text or "").translate(_DASHES).lower()
    s = s.replace("**", "").replace("`", "")
    s = _SPACED.sub(lambda m: m.group(1) + m.group(2).replace(" ", ""), s)
    s = _THOUSANDS.sub("", s)
    s = _DECIMAL_ZERO.sub("", s)
    s = _EUR.sub(" euro", s)
    s = _PERCENT.sub(" prozent", s)
    return _WS.sub(" ", s).strip()


def ws(text: str) -> str:
    """Whitespace-normalized text (for verbatim quote checks: nothing else changes)."""
    return _WS.sub(" ", unicodedata.normalize("NFKC", text or "")).strip()


def contains(haystack: str, needle: str) -> bool:
    """`needle` occurs in `haystack` as a whole phrase after normalization."""
    n = norm(needle)
    if not n:
        return False
    return re.search(r"(?<![\w])" + re.escape(n) + r"(?![\w])", norm(haystack)) is not None


def fact_present(answer: str, fact: str | list[str]) -> bool:
    """A key fact is a string or a list of alternatives (any one suffices)."""
    if isinstance(fact, list):
        return any(contains(answer, f) for f in fact)
    return contains(answer, fact)


_NUM = re.compile(r"(?<![\w.,])(\d{4,7})(?![\w]|[.,]\d)")
_KILO = re.compile(r"(?<![\w.,])(\d{1,3}(?:[.,]\d)?)\s?(?:k|tsd\.?|tausend)(?![\w])")


def numbers(text: str) -> set[int]:
    """Amounts written in a text (4 to 7 digits, any thousands format, `133k`, `133 Tsd.`)."""
    s = norm(text)
    out = {int(m) for m in _NUM.findall(s)}
    for m in _KILO.findall(s):
        out.add(round(float(m.replace(",", ".")) * 1000))
    return out


_IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b")


def ibans(text: str) -> set[str]:
    """IBAN-shaped strings, spaces removed."""
    return {m.replace(" ", "") for m in _IBAN.findall(text or "")}


_DEAL_ID = re.compile(r"(?<![\w-])d-\d{4}(?![\w])", re.IGNORECASE)


def deal_ids(text: str) -> set[str]:
    return {m.lower() for m in _DEAL_ID.findall(text or "")}
