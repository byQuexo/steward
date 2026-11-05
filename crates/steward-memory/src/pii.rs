//! Detectors for data that must never be stored. Validated where a checksum exists (IBAN
//! mod-97, card numbers Luhn) to keep false positives on ordinary numbers low.

use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PiiKind {
    Iban,
    CreditCard,
    Email,
    Phone,
}

impl PiiKind {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "iban" => PiiKind::Iban,
            "credit_card" => PiiKind::CreditCard,
            "email" => PiiKind::Email,
            "phone" => PiiKind::Phone,
            _ => return None,
        })
    }
}

impl std::fmt::Display for PiiKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            PiiKind::Iban => "an IBAN",
            PiiKind::CreditCard => "a card number",
            PiiKind::Email => "an e-mail address",
            PiiKind::Phone => "a phone number",
        })
    }
}

fn re(cell: &'static OnceLock<Option<Regex>>, pattern: &str) -> Option<&'static Regex> {
    cell.get_or_init(|| Regex::new(pattern).ok()).as_ref()
}

fn iban_valid(raw: &str) -> bool {
    let s: String = raw.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_uppercase();
    if !(15..=34).contains(&s.len()) {
        return false;
    }
    let rearranged = format!("{}{}", &s[4..], &s[..4]);
    let mut rem: u32 = 0;
    for c in rearranged.chars() {
        let digits = match c {
            '0'..='9' => c.to_string(),
            'A'..='Z' => (c as u32 - 'A' as u32 + 10).to_string(),
            _ => return false,
        };
        for d in digits.chars() {
            rem = (rem * 10 + d.to_digit(10).unwrap_or(0)) % 97;
        }
    }
    rem == 1
}

fn luhn(raw: &str) -> bool {
    let digits: Vec<u32> = raw.chars().filter_map(|c| c.to_digit(10)).collect();
    if !(13..=19).contains(&digits.len()) {
        return false;
    }
    let sum: u32 = digits
        .iter()
        .rev()
        .enumerate()
        .map(|(i, d)| {
            if i % 2 == 1 {
                let x = d * 2;
                if x > 9 {
                    x - 9
                } else {
                    x
                }
            } else {
                *d
            }
        })
        .sum();
    sum.is_multiple_of(10)
}

/// Every kind of PII found in `text`.
pub fn detect(text: &str) -> Vec<PiiKind> {
    static IBAN: OnceLock<Option<Regex>> = OnceLock::new();
    static CARD: OnceLock<Option<Regex>> = OnceLock::new();
    static EMAIL: OnceLock<Option<Regex>> = OnceLock::new();
    static PHONE: OnceLock<Option<Regex>> = OnceLock::new();
    let mut out = Vec::new();
    let mut rest = text.to_string();
    // A candidate may run into the following word ("… 00 bitte"), so every prefix is tried.
    if let Some(r) = re(&IBAN, r"(?i)\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}") {
        let found: Vec<String> = r
            .find_iter(text)
            .filter_map(|m| {
                let chars: Vec<char> = m.as_str().chars().collect();
                (15..=chars.len()).rev().map(|n| chars[..n].iter().collect::<String>()).find(|c| !c.ends_with(' ') && iban_valid(c))
            })
            .collect();
        if !found.is_empty() {
            out.push(PiiKind::Iban);
            for f in found {
                rest = rest.replace(&f, " ");
            }
        }
    }
    if let Some(r) = re(&CARD, r"\b(?:\d[ -]?){13,19}\b") {
        let found: Vec<String> = r.find_iter(&rest).filter(|m| luhn(m.as_str())).map(|m| m.as_str().to_string()).collect();
        if !found.is_empty() {
            out.push(PiiKind::CreditCard);
            for f in found {
                rest = rest.replace(&f, " ");
            }
        }
    }
    // E-mail and phone are checked on what is left, so IBAN digits are not also a "phone number".
    if re(&EMAIL, r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b").is_some_and(|r| r.is_match(&rest)) {
        out.push(PiiKind::Email);
    }
    if re(&PHONE, r"(?:\+|\b0)\d[\d /-]{6,}\d\b").is_some_and(|r| r.is_match(&rest)) {
        out.push(PiiKind::Phone);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_with_checksums() {
        assert_eq!(detect("IBAN DE89 3704 0044 0532 0130 00 bitte"), vec![PiiKind::Iban]);
        assert!(detect("Ticket DE12 3456 7890 1234 5678 90").is_empty(), "wrong checksum is not an IBAN");
        assert_eq!(detect("Karte 4111 1111 1111 1111"), vec![PiiKind::CreditCard]);
        assert!(detect("Deal über 80000 Euro, Port 51820").is_empty());
        assert_eq!(detect("schreib an sven@acme.example"), vec![PiiKind::Email]);
        assert_eq!(detect("ruf +49 221 1234567 an"), vec![PiiKind::Phone]);
    }
}
