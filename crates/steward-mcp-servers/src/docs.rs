//! Documents with cited answers.
//!
//! Two backends behind one tool contract:
//! * **docrag-bench** (`docrag serve`): hybrid retrieval, reranking, OCR for scans, LLM answers
//!   whose citations are verified against the source text.
//! * **lexical**: a built-in extractive backend over the seed corpus. No model, no network;
//!   every quote is a verbatim sentence of the cited page. Used by tests and the offline demo.
//!
//! Access is cut twice: Warden checks `doc_ids ⊆ doc_scope` before the call reaches this server,
//! and the server intersects with the caller's `doc_scope` again (an empty request means "all
//! documents I may read").

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};
use warden_core::AttrValue;

use crate::{arg_str, principal, schema, Caller, McpServer, ToolDef, ToolError};

struct Page {
    doc_id: String,
    page: u32,
    text: String,
    terms: Vec<String>,
}

pub struct Docs {
    name: String,
    titles: BTreeMap<String, String>,
    pages: Vec<Page>,
    docrag: Option<(String, reqwest::Client)>,
    page_prefix: String,
}

const STOP: &[&str] = &[
    "der", "die", "das", "und", "oder", "ist", "sind", "wie", "was", "wer", "wann", "wo", "ein", "eine", "einen", "einem", "einer", "den",
    "dem", "des", "mit", "von", "für", "auf", "im", "in", "zu", "zum", "zur", "bei", "nach", "aus", "über", "ich", "du", "wir", "sie",
    "es", "man", "mein", "meine", "darf", "kann", "muss", "soll", "werden", "wird", "hat", "haben", "gibt", "nicht", "auch", "noch", "nur",
    "bis", "ab", "hoch", "viel", "viele", "welche", "welcher", "welches", "gilt", "bitte", "the", "and", "for", "what", "how", "is", "are",
    "of", "to", "my", "can", "i",
];

fn stem(w: &str) -> String {
    let mut w = w.to_string();
    if w.chars().count() > 5 {
        for suf in ["ungen", "ung", "en", "er", "es", "e", "n", "s"] {
            if w.ends_with(suf) && w.chars().count() - suf.chars().count() >= 4 {
                w.truncate(w.len() - suf.len());
                break;
            }
        }
    }
    w
}

/// How well query term `t` matches page term `x`: exact 1; one the head or tail of the other
/// (a German compound) 0.5, e.g. "hotel" in "hotelkosten" or "beleg" in "reisebeleg"; else 0.
fn hit(t: &str, x: &str) -> f64 {
    if x == t {
        return 1.0;
    }
    let (short, long) = if t.len() < x.len() { (t, x) } else { (x, t) };
    if short.chars().count() >= 4 && (long.starts_with(short) || long.ends_with(short)) {
        0.5
    } else {
        0.0
    }
}

fn tf(t: &str, terms: &[String]) -> f64 {
    terms.iter().map(|x| hit(t, x)).sum()
}

pub(crate) fn terms(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !(c.is_alphanumeric()))
        .filter(|w| (w.chars().count() >= 3 || (w.len() >= 2 && w.chars().any(|c| c.is_ascii_digit()))) && !STOP.contains(w))
        .map(stem)
        .collect()
}

fn sentences(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    for line in text.lines() {
        let mut start = 0;
        let bytes: Vec<(usize, char)> = line.char_indices().collect();
        for (i, (pos, c)) in bytes.iter().enumerate() {
            let next_is_space = bytes.get(i + 1).is_none_or(|(_, n)| n.is_whitespace());
            if matches!(c, '.' | '!' | '?') && next_is_space {
                // "1. Juli", "3. OG", "1. WireGuard installieren": a period after a one- or
                // two-digit number is an ordinal, not the end of a sentence.
                let digits = bytes[..i].iter().rev().take_while(|(_, c)| c.is_ascii_digit()).count();
                let before_digits = i.checked_sub(digits + 1).map(|j| bytes[j].1);
                if *c == '.' && (1..=2).contains(&digits) && before_digits.is_none_or(|b| b.is_whitespace()) {
                    continue;
                }
                let s = line[start..pos + c.len_utf8()].trim();
                if !s.is_empty() {
                    out.push(s);
                }
                start = pos + c.len_utf8();
            }
        }
        let rest = line[start..].trim();
        if !rest.is_empty() {
            out.push(rest);
        }
    }
    out
}

impl Docs {
    pub fn new(name: &str, corpus: Value, docrag_url: Option<String>, page_prefix: Option<String>) -> Result<Self, String> {
        let docs = corpus.as_array().ok_or("docs corpus must be a list")?;
        let mut titles = BTreeMap::new();
        let mut pages = Vec::new();
        for d in docs {
            let id = d["doc_id"].as_str().ok_or("doc_id missing")?.to_string();
            titles.insert(id.clone(), d["title"].as_str().unwrap_or(&id).to_string());
            for p in d["pages"].as_array().into_iter().flatten() {
                let text = p["text"].as_str().unwrap_or_default().to_string();
                pages.push(Page { doc_id: id.clone(), page: p["page"].as_u64().unwrap_or(1) as u32, terms: terms(&text), text });
            }
        }
        let docrag = docrag_url.map(|u| (u.trim_end_matches('/').to_string(), reqwest::Client::new()));
        Ok(Self { name: name.into(), titles, pages, docrag, page_prefix: page_prefix.unwrap_or_else(|| "/api/docs/pages".into()) })
    }

    /// The caller's readable documents (`doc_scope` claim). No verified caller → nothing.
    fn allowed(&self, caller: &Caller) -> BTreeSet<String> {
        match principal(caller).and_then(|p| p.subject.attrs.get("doc_scope")) {
            Some(AttrValue::List(l)) => l.iter().filter(|d| self.titles.contains_key(*d)).cloned().collect(),
            Some(AttrValue::String(s)) => [s.clone()].into_iter().filter(|d| self.titles.contains_key(d)).collect(),
            _ => BTreeSet::new(),
        }
    }

    fn scope(&self, caller: &Caller, args: &Value) -> Result<BTreeSet<String>, ToolError> {
        let allowed = self.allowed(caller);
        let requested: Vec<String> = match args.get("doc_ids") {
            None | Some(Value::Null) => Vec::new(),
            Some(Value::Array(a)) => a
                .iter()
                .map(|v| v.as_str().map(str::to_string).ok_or_else(|| ToolError::Invalid("doc_ids must be strings".into())))
                .collect::<Result<_, _>>()?,
            Some(_) => return Err(ToolError::Invalid("doc_ids must be a list".into())),
        };
        Ok(if requested.is_empty() { allowed } else { requested.into_iter().filter(|d| allowed.contains(d)).collect() })
    }

    fn page_url(&self, doc_id: &str, page: u32) -> String {
        format!("{}/{doc_id}/{page}.png", self.page_prefix)
    }

    fn lexical(&self, question: &str, scope: &BTreeSet<String>) -> Value {
        let q: BTreeSet<String> = terms(question).into_iter().collect();
        let candidates: Vec<&Page> = self.pages.iter().filter(|p| scope.contains(&p.doc_id)).collect();
        if q.is_empty() || candidates.is_empty() {
            return abstain(0.0);
        }
        // BM25 over the pages in scope.
        let n = candidates.len() as f64;
        let avg = candidates.iter().map(|p| p.terms.len()).sum::<usize>() as f64 / n;
        let idf = |t: &str| {
            let df = candidates.iter().filter(|p| tf(t, &p.terms) > 0.0).count() as f64;
            ((n - df + 0.5) / (df + 0.5) + 1.0).ln()
        };
        let mut best: Option<(&Page, f64, usize)> = None;
        for p in &candidates {
            let mut score = 0.0;
            let mut matched = 0;
            for t in &q {
                let tf = tf(t, &p.terms);
                if tf > 0.0 {
                    matched += 1;
                    score += idf(t) * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * p.terms.len() as f64 / avg.max(1.0)));
                }
            }
            if best.is_none_or(|(_, s, _)| score > s) {
                best = Some((p, score, matched));
            }
        }
        let Some((page, score, matched)) = best else { return abstain(0.0) };
        // Abstain unless at least half of the question's content words occur on the page.
        let coverage = matched as f64 / q.len() as f64;
        if matched == 0 || coverage < 0.5 {
            return abstain(score);
        }
        let mut ranked: Vec<(f64, &str)> = sentences(&page.text)
            .into_iter()
            .filter(|s| s.chars().count() > 12)
            .map(|s| {
                let st: Vec<String> = terms(s).into_iter().collect::<BTreeSet<_>>().into_iter().collect();
                let overlap: f64 = q.iter().map(|t| tf(t, &st).min(1.0)).sum();
                (overlap + st.len().min(30) as f64 * 0.001, s)
            })
            .filter(|(s, _)| *s >= 1.0)
            .collect();
        ranked.sort_by(|a, b| b.0.total_cmp(&a.0));
        let Some((_, quote)) = ranked.first().copied() else { return abstain(score) };
        let title = self.titles.get(&page.doc_id).cloned().unwrap_or_default();
        let mut answer = quote.to_string();
        if let Some((_, second)) = ranked.get(1) {
            answer = format!("{answer} {second}");
        }
        json!({
            "status": "supported",
            "answer": answer,
            "sources": [{
                "id": format!("{}:p{}", page.doc_id, page.page),
                "doc_id": page.doc_id,
                "title": title,
                "page": page.page,
                "quote": quote,
                "page_image_url": self.page_url(&page.doc_id, page.page),
            }],
            "backend": "lexical",
            "top_score": score,
            "cost_eur": 0.0,
        })
    }

    async fn docrag(&self, url: &str, http: &reqwest::Client, question: &str, scope: &BTreeSet<String>) -> Result<Value, ToolError> {
        let body = json!({"question": question, "doc_ids": scope.iter().collect::<Vec<_>>()});
        let resp = http
            .post(format!("{url}/query"))
            .json(&body)
            .timeout(std::time::Duration::from_secs(90))
            .send()
            .await
            .map_err(|e| ToolError::Internal(format!("docrag: {e}")))?;
        if resp.status().as_u16() == 402 {
            return Err(ToolError::Internal("docrag budget exhausted".into()));
        }
        if !resp.status().is_success() {
            return Err(ToolError::Internal(format!("docrag: HTTP {}", resp.status())));
        }
        let r: Value = resp.json().await.map_err(|e| ToolError::Internal(format!("docrag: {e}")))?;
        let status = r["status"].as_str().unwrap_or("abstained");
        if status == "abstained" || r["abstained_before_llm"] == true {
            return Ok(abstain(r["top_score"].as_f64().unwrap_or(0.0)));
        }
        // Only sources inside the caller's scope survive (docrag already verified the quotes).
        let sources: Vec<Value> = r["sources"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|s| s["doc_id"].as_str().is_some_and(|d| scope.contains(d)))
            .map(|s| {
                let doc = s["doc_id"].as_str().unwrap_or_default();
                let page = s["page"].as_u64().unwrap_or(1) as u32;
                json!({"id": s["id"], "doc_id": doc, "title": self.titles.get(doc), "page": page, "quote": s["quote"], "page_image_url": self.page_url(doc, page)})
            })
            .collect();
        if sources.is_empty() {
            return Ok(abstain(r["top_score"].as_f64().unwrap_or(0.0)));
        }
        Ok(json!({
            "status": status,
            "answer": r["answer"],
            "sources": sources,
            "backend": "docrag",
            "rejected_citations": r["rejected_citations"],
            "cost_eur": r["cost_eur"],
            "input_tokens": r["input_tokens"],
            "output_tokens": r["output_tokens"],
        }))
    }
}

fn abstain(score: f64) -> Value {
    json!({"status": "abstained", "answer": Value::Null, "sources": [], "top_score": score, "cost_eur": 0.0})
}

#[async_trait::async_trait]
impl McpServer for Docs {
    fn name(&self) -> &str {
        &self.name
    }

    fn tools(&self) -> Vec<ToolDef> {
        vec![
            ToolDef {
                name: "search",
                description: "Answer a question from company documents with verified citations. `doc_ids` limits the search; empty means all documents you may read. Returns status `abstained` when nothing supports an answer.",
                input_schema: schema(json!({"question": {"type": "string"}, "doc_ids": {"type": "array", "items": {"type": "string"}}}), &["question", "doc_ids"]),
            },
            ToolDef { name: "list_documents", description: "Documents you may read, with titles.", input_schema: schema(json!({}), &[]) },
        ]
    }

    async fn call(&self, caller: &Caller, tool: &str, args: &Value) -> Result<Value, ToolError> {
        match tool {
            "list_documents" => {
                let docs: Vec<Value> = self.allowed(caller).iter().map(|d| json!({"doc_id": d, "title": self.titles.get(d)})).collect();
                Ok(json!({"documents": docs}))
            }
            "search" => {
                let question = arg_str(args, "question")?;
                let scope = self.scope(caller, args)?;
                if scope.is_empty() {
                    return Ok(abstain(0.0));
                }
                match &self.docrag {
                    Some((url, http)) => self.docrag(url, http, question, &scope).await,
                    None => Ok(self.lexical(question, &scope)),
                }
            }
            _ => Err(ToolError::Invalid(format!("unknown tool `{tool}`"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use warden_core::{Principal, Subject};

    fn docs() -> Docs {
        let corpus = json!([
            {"doc_id": "it-vpn", "title": "VPN", "pages": [
                {"page": 1, "text": "VPN-Einrichtung\nAcme nutzt WireGuard für den Fernzugriff. Der Server ist vpn.acme.example auf Port 51820."},
                {"page": 2, "text": "Fehlerbehebung\nMeldung handshake did not complete: Die Systemzeit des Geräts weicht ab. Zeit synchronisieren und neu verbinden."}
            ]},
            {"doc_id": "hr-salary", "title": "Gehälter", "pages": [{"page": 1, "text": "Die Gehaltsbänder gelten ab 1. Januar 2026.
Stufe   Bezeichnung   Minimum   Mitte   Maximum
E2   Professional   58.000   67.000   76.000
E3   Senior   72.000   83.000   94.000"}]},
            {"doc_id": "finance-travel", "title": "Reiserichtlinie", "pages": [{"page": 1, "text": "Übernachtung
        Die Hotelkosten sind auf 150 Euro pro Nacht begrenzt, in München und Hamburg auf 180 Euro."},
                {"page": 2, "text": "Spesen
        Das Verpflegungsgeld beträgt 28 Euro für volle Abwesenheitstage. Belege werden innerhalb von 30 Tagen im Spesentool eingereicht."}]}
        ]);
        Docs::new("docs", corpus, None, None).unwrap()
    }

    fn caller(scope: &[&str]) -> Caller {
        Caller::of(Principal::new(
            Subject::user("ivo").with_attr("doc_scope", AttrValue::List(scope.iter().map(|s| s.to_string()).collect())),
            "acme-bot",
        ))
    }

    #[tokio::test]
    async fn answers_with_a_verbatim_quote_from_the_right_page() {
        let d = docs();
        let r = d
            .call(&caller(&["it-vpn"]), "search", &json!({"question": "VPN meldet handshake did not complete", "doc_ids": []}))
            .await
            .unwrap();
        assert_eq!(r["status"], "supported", "{r}");
        assert_eq!(r["sources"][0]["page"], 2);
        let quote = r["sources"][0]["quote"].as_str().unwrap();
        assert!(d.pages[1].text.contains(quote), "quote must be verbatim: {quote}");
        assert_eq!(r["sources"][0]["page_image_url"], "/api/docs/pages/it-vpn/2.png");
    }

    #[tokio::test]
    async fn out_of_scope_documents_are_invisible() {
        let d = docs();
        let r = d
            .call(&caller(&["it-vpn"]), "search", &json!({"question": "Gehaltsbänder Stufe E3 Senior", "doc_ids": ["hr-salary"]}))
            .await
            .unwrap();
        assert_eq!(r["status"], "abstained", "{r}");
        let list = d.call(&caller(&["it-vpn"]), "list_documents", &json!({})).await.unwrap();
        assert_eq!(list["documents"].as_array().unwrap().len(), 1);
        // No verified caller, no documents.
        let anon = d.call(&Caller::anonymous(), "search", &json!({"question": "VPN WireGuard Server", "doc_ids": []})).await.unwrap();
        assert_eq!(anon["status"], "abstained");
    }

    /// Real users ask "Hotel-Limit", the policy says "Hotelkosten … begrenzt".
    #[tokio::test]
    async fn compound_words_match_their_parts() {
        let r = docs()
            .call(&caller(&["finance-travel"]), "search", &json!({"question": "Wie hoch ist das Hotel-Limit in München?", "doc_ids": []}))
            .await
            .unwrap();
        assert_eq!(r["status"], "supported", "{r}");
        assert!(r["answer"].as_str().unwrap().contains("180 Euro"), "{r}");
    }

    /// "E3" is two characters; the band row must still be found, and quoted.
    #[tokio::test]
    async fn short_codes_with_digits_count() {
        let r = docs()
            .call(&caller(&["hr-salary"]), "search", &json!({"question": "Wie hoch ist das Minimum im Gehaltsband E3?", "doc_ids": []}))
            .await
            .unwrap();
        assert_eq!(r["status"], "supported", "{r}");
        assert!(r["answer"].as_str().unwrap().contains("72.000"), "{r}");
    }

    /// The question's compound ("Reisebelege") contains the page's word ("Belege").
    #[tokio::test]
    async fn page_words_inside_question_compounds_match() {
        let r = docs()
            .call(
                &caller(&["finance-travel"]),
                "search",
                &json!({"question": "Innerhalb welcher Frist müssen Reisebelege eingereicht werden?", "doc_ids": []}),
            )
            .await
            .unwrap();
        assert_eq!(r["status"], "supported", "{r}");
        assert!(r["answer"].as_str().unwrap().contains("30 Tagen"), "{r}");
    }

    #[tokio::test]
    async fn unrelated_questions_abstain() {
        let r = docs()
            .call(&caller(&["it-vpn"]), "search", &json!({"question": "Wie hoch ist das Kantinenbudget im Dezember?", "doc_ids": []}))
            .await
            .unwrap();
        assert_eq!(r["status"], "abstained", "{r}");
    }

    #[test]
    fn sentence_split_keeps_dates_and_numbers() {
        let s = sentences("Gültig ab 1. Juli 2026. Preis 48.000 EUR.");
        assert_eq!(s, vec!["Gültig ab 1. Juli 2026.", "Preis 48.000 EUR."]);
    }
}
