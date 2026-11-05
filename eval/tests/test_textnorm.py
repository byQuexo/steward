from steward_eval.textnorm import contains, deal_ids, fact_present, ibans, norm, numbers, ws


def test_norm_unifies_numbers_currency_percent():
    assert norm("48.000 €") == "48000 euro"
    assert norm("48 000 EUR") == "48000 euro"
    assert norm("10 %") == "10 prozent"
    assert norm("180,00 Euro") == "180 euro"
    assert norm("**9.600 EUR**") == "9600 euro"


def test_norm_keeps_ip_dates_and_times():
    assert "10.20.0.53" in norm("DNS 10.20.0.53")
    assert "24.11.2026" in norm("am 24.11.2026")
    assert "10:00" in norm("10:00 Uhr")


def test_contains_is_phrase_bounded():
    assert contains("Es gibt 30 Urlaubstage.", "30")
    assert not contains("Es gibt 130 Tage.", "30")
    assert contains("Hotel: 180 € pro Nacht", "180 Euro")
    assert contains("bis zu 10% Rabatt", "10 Prozent")


def test_fact_alternatives():
    assert fact_present("Die Probezeit dauert 6 Monate.", ["sechs Monate", "6 Monate"])
    assert not fact_present("Die Probezeit dauert ein Jahr.", ["sechs Monate", "6 Monate"])


def test_numbers_formats():
    assert numbers("Gehalt: 112.500 Euro") == {112500}
    assert numbers("rund 133k bzw. 120 Tsd. Euro") == {133000, 120000}
    assert numbers("Port 51820, IP 10.20.0.53, Score 7.0456") == {51820}
    assert numbers('{"amount": 77500}') == {77500}


def test_ibans_and_deal_ids():
    assert ibans("IBAN DE89 3704 0044 0532 0130 00 bitte") == {"DE89370400440532013000"}
    assert ibans("keine Bankdaten") == set()
    assert deal_ids("Deal d-1012 und D-1003, nicht xd-1001") == {"d-1012", "d-1003"}


def test_ws_only_collapses_whitespace():
    assert ws("Stufe   Bezeichnung\n Minimum") == "Stufe Bezeichnung Minimum"
