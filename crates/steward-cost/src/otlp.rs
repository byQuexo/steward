//! Model calls as OpenTelemetry spans (OTLP/HTTP JSON), with OpenInference attributes so
//! Phoenix shows them as LLM spans. Best effort: export never blocks or fails a chat.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::hook::RunInfo;
use crate::CostEntry;

pub struct LlmSpan {
    pub run: RunInfo,
    pub start: SystemTime,
    pub end: SystemTime,
    pub entry: CostEntry,
}

#[derive(Clone)]
pub struct SpanExporter {
    tx: mpsc::Sender<LlmSpan>,
}

fn nanos(t: SystemTime) -> String {
    t.duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos().to_string()
}

fn attr(k: &str, v: Value) -> Value {
    let value = match v {
        Value::String(s) => json!({"stringValue": s}),
        Value::Number(n) if n.is_i64() || n.is_u64() => json!({"intValue": n.to_string()}),
        Value::Number(n) => json!({"doubleValue": n.as_f64()}),
        Value::Bool(b) => json!({"boolValue": b}),
        other => json!({"stringValue": other.to_string()}),
    };
    json!({"key": k, "value": value})
}

/// Trace id of a run: stable, so all model calls of one chat turn share a trace.
pub fn trace_id(run_id: &str) -> String {
    let mut h: u128 = 0xcbf2_9ce4_8422_2325;
    for b in run_id.bytes() {
        h = (h ^ u128::from(b)).wrapping_mul(0x0000_0000_0100_0000_0000_0000_0000_013B);
    }
    format!("{h:032x}")
}

pub fn span_json(s: &LlmSpan, service: &str) -> Value {
    let e = &s.entry;
    let mut attrs = vec![
        attr("openinference.span.kind", json!("LLM")),
        attr("llm.model_name", json!(e.model)),
        attr("llm.token_count.prompt", json!(e.input_tokens)),
        attr("llm.token_count.completion", json!(e.output_tokens)),
        attr("llm.token_count.total", json!(e.input_tokens + e.output_tokens)),
        attr("user.id", json!(e.user)),
        attr("steward.agent", json!(e.agent)),
        attr("steward.cost_eur", json!(e.eur)),
        attr("steward.run_id", json!(e.run_id)),
    ];
    if let Some(t) = &e.team {
        attrs.push(attr("steward.team", json!(t)));
    }
    if let Some(sess) = &s.run.session {
        attrs.push(attr("session.id", json!(sess)));
    }
    json!({
        "resourceSpans": [{
            "resource": {"attributes": [attr("service.name", json!(service))]},
            "scopeSpans": [{
                "scope": {"name": "steward", "version": env!("CARGO_PKG_VERSION")},
                "spans": [{
                    "traceId": trace_id(&e.run_id),
                    "spanId": hex::encode(rand::random::<[u8; 8]>()),
                    "name": format!("llm {}", e.model),
                    "kind": 3,
                    "startTimeUnixNano": nanos(s.start),
                    "endTimeUnixNano": nanos(s.end),
                    "attributes": attrs,
                    "status": {"code": 1}
                }]
            }]
        }]
    })
}

impl SpanExporter {
    /// Spawn the exporter. `endpoint` is the OTLP/HTTP traces URL (`…/v1/traces`).
    pub fn spawn(endpoint: String, service: String) -> Self {
        let (tx, mut rx) = mpsc::channel::<LlmSpan>(1024);
        tokio::spawn(async move {
            let http = reqwest::Client::builder().timeout(Duration::from_secs(5)).build().unwrap_or_default();
            while let Some(span) = rx.recv().await {
                let body = span_json(&span, &service);
                if let Err(e) = http.post(&endpoint).json(&body).send().await {
                    tracing::debug!(error = %e, "span export failed");
                }
            }
        });
        Self { tx }
    }

    pub fn export(&self, span: LlmSpan) {
        let _ = self.tx.try_send(span);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spans_carry_openinference_attributes() {
        let run = RunInfo {
            run_id: "r".into(),
            user: "sven".into(),
            team: None,
            agent: "bot".into(),
            model: "m".into(),
            session: Some("s".into()),
        };
        let entry = CostEntry {
            run_id: "r".into(),
            user: "sven".into(),
            team: None,
            agent: "bot".into(),
            model: "m".into(),
            input_tokens: 5,
            output_tokens: 7,
            cached_input_tokens: 0,
            eur: 0.01,
            ts: 1,
        };
        let v = span_json(&LlmSpan { run, start: UNIX_EPOCH, end: UNIX_EPOCH, entry }, "steward");
        let s = v.to_string();
        assert!(s.contains("openinference.span.kind") && s.contains("\"intValue\":\"12\""), "{s}");
        assert_eq!(trace_id("r").len(), 32);
        assert_eq!(trace_id("r"), trace_id("r"));
    }
}
