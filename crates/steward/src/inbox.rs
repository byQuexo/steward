//! The approvals inbox. Warden's gateway holds a call that needs approval and POSTs the request
//! here (webhook protocol v1); the inbox routes it to the approvers named in `approvals.yaml`,
//! notifies them live, and answers the gateway when they decide (long-poll) or when the timeout
//! passes (deny). Four-eyes routes need two different approvers; the requester can never approve.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use hmac::{Hmac, Mac};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::Sha256;
use steward_config::ApprovalRouting;
use steward_identity::Directory;
use tokio::sync::{broadcast, watch};

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Pending,
    Approved,
    Denied,
    Expired,
}

#[derive(Clone, Debug, Serialize)]
pub struct Vote {
    pub user: String,
    pub approve: bool,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Approval {
    pub id: String,
    /// The user the call is for.
    pub requester: String,
    pub agent: String,
    pub act: Vec<String>,
    /// `kind:name`, e.g. `tool:crm.update_deal`.
    pub action: String,
    pub args: Value,
    pub rule: String,
    pub reason: String,
    pub approvers: Vec<String>,
    pub four_eyes: bool,
    pub votes: Vec<Vote>,
    pub status: Status,
    pub created: u64,
    #[serde(skip)]
    args_hash: String,
}

/// Live notifications per user (approval requests, decisions), merged into SSE streams.
#[derive(Default)]
pub struct Bus(Mutex<HashMap<String, broadcast::Sender<Value>>>);

impl Bus {
    pub fn subscribe(&self, user: &str) -> broadcast::Receiver<Value> {
        let mut m = match self.0.lock() {
            Ok(m) => m,
            Err(p) => p.into_inner(),
        };
        m.entry(user.to_string()).or_insert_with(|| broadcast::channel(256).0).subscribe()
    }

    pub fn publish(&self, user: &str, event: Value) {
        if let Ok(m) = self.0.lock() {
            if let Some(tx) = m.get(user) {
                let _ = tx.send(event);
            }
        }
    }
}

pub struct Inbox {
    routing: ApprovalRouting,
    directory: Arc<dyn Directory>,
    pub bus: Arc<Bus>,
    secret: Option<Vec<u8>>,
    items: Mutex<BTreeMap<String, (Approval, watch::Sender<Status>)>>,
    timeout: Duration,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[derive(Debug)]
pub enum DecideError {
    NotFound,
    NotAnApprover,
    SelfApproval,
    AlreadyDecided,
}

impl Inbox {
    pub fn new(routing: ApprovalRouting, directory: Arc<dyn Directory>, bus: Arc<Bus>, secret: Option<Vec<u8>>) -> Self {
        let timeout = Duration::from_secs(routing.timeout_s);
        Self { routing, directory, bus, secret, items: Mutex::new(BTreeMap::new()), timeout }
    }

    /// Verify `X-Warden-Signature` / `X-Agent-Scope-Signature: sha256=<hex>` over the raw body.
    pub fn verify_signature(&self, body: &[u8], header: Option<&str>) -> bool {
        let Some(secret) = &self.secret else { return true };
        let Some(sig) = header.and_then(|h| h.strip_prefix("sha256=")) else { return false };
        let Ok(sig) = hex::decode(sig) else { return false };
        let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret) else { return false };
        mac.update(body);
        mac.verify_slice(&sig).is_ok()
    }

    async fn resolve(&self, specs: &[String], requester: &str) -> Vec<String> {
        let users = self.directory.users().await.unwrap_or_default();
        let mut out: Vec<String> = Vec::new();
        for s in specs {
            if let Some(role) = s.strip_prefix("role:") {
                out.extend(users.iter().filter(|u| u.enabled && u.roles.iter().any(|r| r == role)).map(|u| u.id.clone()));
            } else if let Some(id) = s.strip_prefix("user:") {
                out.push(id.to_string());
            }
        }
        out.sort();
        out.dedup();
        out.retain(|u| u != requester);
        out
    }

    /// Handle one webhook request (already signature-checked): wait for the decision.
    pub async fn request(&self, req: Value) -> Value {
        let requester = req["subject"].as_str().unwrap_or_default().to_string();
        let rule = req["rule"].as_str().unwrap_or_default().to_string();
        let args_hash = req["args_hash"].as_str().unwrap_or_default().to_string();
        let deny = |reason: &str| json!({"decision": "deny", "approver": "steward-inbox", "reason": reason, "args_hash": args_hash});
        let Some(route) = self.routing.route_for(&rule).cloned() else { return deny("no approval route for this rule") };
        let approvers = self.resolve(&route.approvers, &requester).await;
        if approvers.is_empty() || (route.four_eyes && approvers.len() < 2) {
            return deny("no eligible approver");
        }
        let id = req["id"].as_str().map(str::to_string).unwrap_or_else(|| hex::encode(rand::random::<[u8; 8]>()));
        let approval = Approval {
            id: id.clone(),
            requester: requester.clone(),
            agent: req["agent"].as_str().unwrap_or_default().into(),
            act: req["act"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default(),
            action: format!("{}:{}", req["kind"].as_str().unwrap_or("tool"), req["name"].as_str().unwrap_or_default()),
            args: req["args"].clone(),
            rule,
            reason: req["reason"].as_str().unwrap_or_default().into(),
            approvers: approvers.clone(),
            four_eyes: route.four_eyes,
            votes: Vec::new(),
            status: Status::Pending,
            created: now(),
            args_hash: args_hash.clone(),
        };
        let (tx, mut rx) = watch::channel(Status::Pending);
        if let Ok(mut items) = self.items.lock() {
            items.insert(id.clone(), (approval.clone(), tx));
        }
        let event = json!({"type": "approval_requested", "approval": approval});
        for a in &approvers {
            self.bus.publish(a, event.clone());
        }
        self.bus.publish(
            &requester,
            json!({"type": "approval_pending", "approval_id": id, "tool": approval.action, "rule": approval.rule, "approvers": approvers, "args": approval.args}),
        );

        let decided = tokio::time::timeout(self.timeout, async {
            while *rx.borrow() == Status::Pending {
                if rx.changed().await.is_err() {
                    break;
                }
            }
        })
        .await;
        let final_state = match self.items.lock() {
            Ok(mut items) => {
                let entry = items.get_mut(&id);
                match (decided, entry) {
                    (Err(_), Some((a, _))) => {
                        a.status = Status::Expired;
                        Some(a.clone())
                    }
                    (_, Some((a, _))) => Some(a.clone()),
                    _ => None,
                }
            }
            Err(_) => None,
        };
        let Some(a) = final_state else { return deny("approval lost") };
        let approvers_str = a.votes.iter().filter(|v| v.approve).map(|v| v.user.clone()).collect::<Vec<_>>().join("+");
        let decision_event = json!({"type": "approval_decided", "approval_id": a.id, "status": a.status, "votes": a.votes});
        self.bus.publish(&a.requester, decision_event.clone());
        for u in &a.approvers {
            self.bus.publish(u, decision_event.clone());
        }
        match a.status {
            Status::Approved => json!({"decision": "approve", "approver": approvers_str, "args_hash": a.args_hash}),
            Status::Denied => {
                let by = a.votes.iter().find(|v| !v.approve);
                json!({"decision": "deny", "approver": by.map(|v| v.user.clone()).unwrap_or_default(), "reason": by.and_then(|v| v.reason.clone()).unwrap_or_default(), "args_hash": a.args_hash})
            }
            _ => deny("approval timed out"),
        }
    }

    /// An approver decides.
    pub fn decide(&self, id: &str, user: &str, approve: bool, reason: Option<String>) -> Result<Approval, DecideError> {
        let mut items = self.items.lock().map_err(|_| DecideError::NotFound)?;
        let (a, tx) = items.get_mut(id).ok_or(DecideError::NotFound)?;
        if a.status != Status::Pending {
            return Err(DecideError::AlreadyDecided);
        }
        if a.requester == user {
            return Err(DecideError::SelfApproval);
        }
        if !a.approvers.iter().any(|x| x == user) {
            return Err(DecideError::NotAnApprover);
        }
        if a.votes.iter().any(|v| v.user == user) {
            return Err(DecideError::AlreadyDecided);
        }
        a.votes.push(Vote { user: user.into(), approve, reason });
        let approvals = a.votes.iter().filter(|v| v.approve).count();
        a.status = if !approve {
            Status::Denied
        } else if approvals >= if a.four_eyes { 2 } else { 1 } {
            Status::Approved
        } else {
            Status::Pending
        };
        let _ = tx.send(a.status.clone());
        Ok(a.clone())
    }

    /// Pending approvals this user can decide, and the user's own requests.
    pub fn for_user(&self, user: &str) -> (Vec<Approval>, Vec<Approval>) {
        let Ok(items) = self.items.lock() else { return (vec![], vec![]) };
        let to_decide = items
            .values()
            .map(|(a, _)| a)
            .filter(|a| a.status == Status::Pending && a.approvers.iter().any(|x| x == user) && !a.votes.iter().any(|v| v.user == user))
            .cloned()
            .collect();
        let mine = items.values().map(|(a, _)| a).filter(|a| a.requester == user).rev().take(20).cloned().collect();
        (to_decide, mine)
    }

    pub fn all(&self) -> Vec<Approval> {
        self.items.lock().map(|i| i.values().map(|(a, _)| a.clone()).collect()).unwrap_or_default()
    }
}
