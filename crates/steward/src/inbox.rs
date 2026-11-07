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

/// Whose turn it is.
#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Awaiting {
    /// The user the call is for confirms (or cancels) it.
    Requester,
    /// The routed approvers decide.
    Approvers,
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
    /// Warden held the call for the requester's own confirmation (`approve_by: subject`).
    pub confirmation: bool,
    pub awaiting: Awaiting,
    /// The requester confirmed before the approvers were asked (`confirm_first`).
    pub confirmed: bool,
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

/// Expires a still-pending request when the webhook handler is dropped before it answered.
struct ExpireOnDrop<'a> {
    inbox: &'a Inbox,
    id: String,
    armed: bool,
}

impl Drop for ExpireOnDrop<'_> {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let expired = self.inbox.items.lock().ok().and_then(|mut items| {
            let (a, tx) = items.get_mut(&self.id)?;
            (a.status == Status::Pending).then(|| {
                a.status = Status::Expired;
                let _ = tx.send(Status::Expired);
                a.clone()
            })
        });
        if let Some(a) = expired {
            tracing::info!(approval = %a.id, "gateway stopped waiting, approval expired");
            self.inbox.publish_decided(&a);
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
    /// Only the requester can confirm or cancel at this stage.
    NotTheRequester,
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
        let confirmation = req["confirmation"].as_bool().unwrap_or(false);
        let (approvers, four_eyes) = if confirmation {
            (vec![requester.clone()], false)
        } else {
            let Some(route) = self.routing.route_for(&rule).cloned() else { return deny("no approval route for this rule") };
            let approvers = self.resolve(&route.approvers, &requester).await;
            if approvers.is_empty() || (route.four_eyes && approvers.len() < 2) {
                return deny("no eligible approver");
            }
            (approvers, route.four_eyes)
        };
        let awaiting = if confirmation || self.routing.confirm_first { Awaiting::Requester } else { Awaiting::Approvers };
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
            four_eyes,
            confirmation,
            awaiting,
            confirmed: false,
            votes: Vec::new(),
            status: Status::Pending,
            created: now(),
            args_hash: args_hash.clone(),
        };
        let (tx, mut rx) = watch::channel(Status::Pending);
        if let Ok(mut items) = self.items.lock() {
            items.insert(id.clone(), (approval.clone(), tx));
        }
        // If the gateway gives up first (its own timeout, a dropped connection), this future is
        // dropped mid-wait. The guard expires the request so no approver acts on a dead call.
        let mut guard = ExpireOnDrop { inbox: self, id: id.clone(), armed: true };
        if awaiting == Awaiting::Approvers {
            self.ask_approvers(&approval);
        }
        self.publish_pending(&approval);

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
        guard.armed = false;
        let Some(a) = final_state else { return deny("approval lost") };
        self.publish_decided(&a);
        let approvers_str = a.votes.iter().filter(|v| v.approve).map(|v| v.user.clone()).collect::<Vec<_>>().join("+");
        match a.status {
            Status::Approved => json!({"decision": "approve", "approver": approvers_str, "args_hash": a.args_hash}),
            Status::Denied => {
                let by = a.votes.iter().find(|v| !v.approve);
                json!({"decision": "deny", "approver": by.map(|v| v.user.clone()).unwrap_or_default(), "reason": by.and_then(|v| v.reason.clone()).unwrap_or_default(), "args_hash": a.args_hash})
            }
            _ => deny("approval timed out"),
        }
    }

    fn ask_approvers(&self, a: &Approval) {
        let event = json!({"type": "approval_requested", "approval": a});
        for u in &a.approvers {
            self.bus.publish(u, event.clone());
        }
    }

    /// The requester's view: sent when the call is held and again when it moves on to the approvers.
    fn publish_pending(&self, a: &Approval) {
        self.bus.publish(
            &a.requester,
            json!({"type": "approval_pending", "approval_id": a.id, "tool": a.action, "rule": a.rule, "approvers": a.approvers, "args": a.args,
                   "awaiting": a.awaiting, "confirmation": a.confirmation}),
        );
    }

    fn publish_decided(&self, a: &Approval) {
        let event = json!({"type": "approval_decided", "approval_id": a.id, "status": a.status, "votes": a.votes});
        self.bus.publish(&a.requester, event.clone());
        // For a confirmation the requester is also the only approver: tell them once.
        for u in a.approvers.iter().filter(|u| **u != a.requester) {
            self.bus.publish(u, event.clone());
        }
    }

    /// An approver decides.
    pub fn decide(&self, id: &str, user: &str, approve: bool, reason: Option<String>) -> Result<Approval, DecideError> {
        let mut items = self.items.lock().map_err(|_| DecideError::NotFound)?;
        let (a, tx) = items.get_mut(id).ok_or(DecideError::NotFound)?;
        if a.status != Status::Pending {
            return Err(DecideError::AlreadyDecided);
        }
        if a.awaiting == Awaiting::Requester {
            if a.requester != user {
                return Err(DecideError::NotTheRequester);
            }
            if !approve || a.confirmation {
                // Cancelled, or a confirmation (the requester is the one who decides).
                a.votes.push(Vote { user: user.into(), approve, reason });
                a.status = if approve { Status::Approved } else { Status::Denied };
                let _ = tx.send(a.status.clone());
                return Ok(a.clone());
            }
            // Confirmed: now the approvers decide.
            a.confirmed = true;
            a.awaiting = Awaiting::Approvers;
            let a = a.clone();
            drop(items);
            self.ask_approvers(&a);
            self.publish_pending(&a);
            return Ok(a);
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
            .filter(|a| {
                a.status == Status::Pending
                    && match a.awaiting {
                        Awaiting::Requester => a.requester == user,
                        Awaiting::Approvers => a.approvers.iter().any(|x| x == user) && !a.votes.iter().any(|v| v.user == user),
                    }
            })
            .cloned()
            .collect();
        let mine = items.values().map(|(a, _)| a).filter(|a| a.requester == user).rev().take(20).cloned().collect();
        (to_decide, mine)
    }

    pub fn all(&self) -> Vec<Approval> {
        self.items.lock().map(|i| i.values().map(|(a, _)| a.clone()).collect()).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use steward_config::ApprovalRoute;
    use steward_identity::{DirUser, IdentityError};

    use super::*;

    struct Users;

    #[async_trait::async_trait]
    impl Directory for Users {
        async fn users(&self) -> Result<Vec<DirUser>, IdentityError> {
            let u = |id: &str, role: &str| DirUser {
                id: id.into(),
                name: id.into(),
                email: format!("{id}@example.com"),
                roles: vec![role.into()],
                attrs: BTreeMap::new(),
                enabled: true,
            };
            Ok(vec![u("sven", "sales-rep"), u("sara", "sales-lead")])
        }
        async fn set_roles(&self, _: &str, _: &[String]) -> Result<(), IdentityError> {
            Ok(())
        }
    }

    fn inbox() -> Inbox {
        inbox_with(false)
    }

    fn inbox_with(confirm_first: bool) -> Inbox {
        let routing = ApprovalRouting {
            timeout_s: 300,
            confirm_first,
            routes: vec![ApprovalRoute { rule: "*".into(), approvers: vec!["role:sales-lead".into()], four_eyes: false }],
        };
        Inbox::new(routing, Arc::new(Users), Arc::new(Bus::default()), None)
    }

    async fn until_listed(inbox: &Inbox, user: &str) {
        while inbox.for_user(user).0.is_empty() {
            tokio::task::yield_now().await;
        }
    }

    /// Warden held a write for the user's own confirmation: only Sven decides, Sara cannot.
    #[tokio::test]
    async fn a_confirmation_goes_to_the_requester_alone() {
        let inbox = Arc::new(inbox());
        let i2 = inbox.clone();
        let mut req = request();
        req["confirmation"] = json!(true);
        let waiting = tokio::spawn(async move { i2.request(req).await });
        until_listed(&inbox, "sven").await;
        assert!(inbox.for_user("sara").0.is_empty(), "approvers never see a confirmation");
        assert!(matches!(inbox.decide("a1", "sara", true, None), Err(DecideError::NotTheRequester)));
        inbox.decide("a1", "sven", true, None).unwrap();
        let answer = waiting.await.unwrap();
        assert_eq!(answer["decision"], "approve");
        assert_eq!(answer["approver"], "sven");
    }

    /// confirm_first: Sven confirms, then Sara approves; Sara never sees a call Sven cancels.
    #[tokio::test]
    async fn confirm_first_asks_the_requester_before_the_approvers() {
        let inbox = Arc::new(inbox_with(true));
        let i2 = inbox.clone();
        let waiting = tokio::spawn(async move { i2.request(request()).await });
        until_listed(&inbox, "sven").await;
        assert!(inbox.for_user("sara").0.is_empty(), "not yet");
        let a = inbox.decide("a1", "sven", true, None).unwrap();
        assert!(a.confirmed && a.awaiting == Awaiting::Approvers && a.status == Status::Pending);
        assert!(matches!(inbox.decide("a1", "sven", true, None), Err(DecideError::SelfApproval)));
        inbox.decide("a1", "sara", true, None).unwrap();
        let answer = waiting.await.unwrap();
        assert_eq!(answer["decision"], "approve");
        assert_eq!(answer["approver"], "sara");

        let i3 = inbox.clone();
        let mut req = request();
        req["id"] = json!("a2");
        let cancelled = tokio::spawn(async move { i3.request(req).await });
        until_listed(&inbox, "sven").await;
        inbox.decide("a2", "sven", false, Some("not what I meant".into())).unwrap();
        let answer = cancelled.await.unwrap();
        assert_eq!(answer["decision"], "deny");
        assert_eq!(answer["approver"], "sven");
        assert!(inbox.for_user("sara").0.is_empty());
    }

    fn request() -> Value {
        json!({"id": "a1", "subject": "sven", "kind": "tool", "name": "crm.update_deal", "args": {"amount": 80000}, "rule": "big-deals", "args_hash": "h"})
    }

    /// The gateway gave up (its timeout, a dropped connection): the request must not stay in
    /// Sara's inbox, where approving it would do nothing.
    #[tokio::test]
    async fn a_dropped_webhook_expires_the_request() {
        let inbox = inbox();
        let waiting = tokio::time::timeout(Duration::from_millis(100), inbox.request(request())).await;
        assert!(waiting.is_err(), "still waiting for a decision");
        assert!(inbox.for_user("sara").0.is_empty(), "nothing left to decide");
        assert_eq!(inbox.all()[0].status, Status::Expired);
        assert!(matches!(inbox.decide("a1", "sara", true, None), Err(DecideError::AlreadyDecided)));
    }

    #[tokio::test]
    async fn an_approval_answers_the_waiting_gateway() {
        let inbox = Arc::new(inbox());
        let i2 = inbox.clone();
        let waiting = tokio::spawn(async move { i2.request(request()).await });
        while inbox.for_user("sara").0.is_empty() {
            tokio::task::yield_now().await;
        }
        assert!(matches!(inbox.decide("a1", "sven", true, None), Err(DecideError::SelfApproval)));
        inbox.decide("a1", "sara", true, None).unwrap();
        let answer = waiting.await.unwrap();
        assert_eq!(answer["decision"], "approve");
        assert_eq!(answer["approver"], "sara");
    }
}
