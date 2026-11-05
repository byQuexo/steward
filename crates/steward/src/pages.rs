//! Page images (ACL-checked on every fetch), memory and costs.

use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use warden_core::{Action, ActionKind, Effect};

use crate::app::{err, Authed, Shared};

fn safe(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) && !s.contains("..")
}

/// `GET /api/docs/pages/{doc}/{n}.png`: Warden decides (`x-docs-page`, rule `page-in-scope`)
/// before a single byte is read, so a guessed URL shows nothing.
pub async fn page_image(State(st): State<Shared>, a: Authed, Path((doc, file)): Path<(String, String)>) -> Response {
    let Some(page) = file.strip_suffix(".png").and_then(|p| p.parse::<u32>().ok()) else {
        return err(StatusCode::NOT_FOUND, "no such page");
    };
    if !safe(&doc) {
        return err(StatusCode::BAD_REQUEST, "invalid document id");
    }
    let action = Action::new(ActionKind::Custom("x-docs-page".into()), "docs.page", json!({"doc_id": doc, "page": page}));
    let d = st.engine.check(&a.principal, &action, &st.context());
    if d.effect != Effect::Allow {
        tracing::info!(user = %a.principal.subject.id, %doc, rule = %d.rule, "page image denied");
        return err(StatusCode::FORBIDDEN, st.profile.meta.messages.denied.clone());
    }
    let local = st.profile.data_dir().join("pages").join(&doc).join(format!("{page}.png"));
    let bytes = if local.exists() {
        std::fs::read(&local).ok()
    } else if let Some(url) = &st.docrag_url {
        match reqwest::get(format!("{}/pages/{doc}/{page}.png", url.trim_end_matches('/'))).await {
            Ok(r) if r.status().is_success() => r.bytes().await.ok().map(|b| b.to_vec()),
            _ => None,
        }
    } else {
        None
    };
    match bytes {
        Some(b) => ([(header::CONTENT_TYPE, "image/png"), (header::CACHE_CONTROL, "private, max-age=300")], b).into_response(),
        None => err(StatusCode::NOT_FOUND, "no such page"),
    }
}

pub async fn memory_list(State(st): State<Shared>, a: Authed) -> Response {
    match st.memory.recall(&a.principal, &st.context()) {
        Ok(f) => Json(json!({"facts": f, "retention_days": st.profile.meta.memory.retention_days})).into_response(),
        Err(e) => err(StatusCode::FORBIDDEN, e.to_string()),
    }
}

pub async fn memory_forget(State(st): State<Shared>, a: Authed, Path(id): Path<i64>) -> Response {
    match st.memory.forget(&a.principal, Some(id), &st.context()) {
        Ok(n) => Json(json!({"forgotten": n})).into_response(),
        Err(e) => err(StatusCode::FORBIDDEN, e.to_string()),
    }
}

pub async fn memory_forget_all(State(st): State<Shared>, a: Authed) -> Response {
    match st.memory.forget(&a.principal, None, &st.context()) {
        Ok(n) => Json(json!({"forgotten": n})).into_response(),
        Err(e) => err(StatusCode::FORBIDDEN, e.to_string()),
    }
}

#[derive(Deserialize)]
pub struct CostQuery {
    #[serde(default = "days")]
    pub days: i64,
}

fn days() -> i64 {
    30
}

/// Costs by user, team, agent, model and day (admins and cost roles), or the caller's own.
pub async fn costs(State(st): State<Shared>, a: Authed, Query(q): Query<CostQuery>) -> Response {
    let since = chrono_like_now() - q.days.clamp(1, 366) * 86_400;
    let me = &a.principal.subject.id;
    if !st.can_see_costs(&a.principal) {
        let today = st.ledger.user_today(me).unwrap_or(0.0);
        return Json(json!({"scope": "me", "today_eur": today, "budget_daily_eur": st.profile.pricing.budgets.per_user_daily}))
            .into_response();
    }
    let group = |g: &str| st.ledger.totals_by(g, since).unwrap_or_default();
    Json(json!({
        "scope": "all",
        "currency": st.profile.pricing.currency,
        "total_eur": st.ledger.total_since(since).unwrap_or(0.0),
        "by_user": group("user"),
        "by_team": group("team"),
        "by_agent": group("agent"),
        "by_model": group("model"),
        "by_day": group("day"),
        "recent": st.ledger.recent(25).unwrap_or_default(),
        "budgets": st.profile.pricing.budgets,
        "prices": st.profile.pricing.models,
    }))
    .into_response()
}

fn chrono_like_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}
