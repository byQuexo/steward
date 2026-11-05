//! Who is using the assistant.
//!
//! * [`oidc::OidcClient`]: authorization code flow with PKCE (S256), state and nonce, against
//!   any OIDC provider (Keycloak in the compose stack). Tokens never reach the browser; the
//!   browser holds an opaque session cookie.
//! * [`SessionStore`]: server-side sessions with the user's tokens.
//! * [`Directory`]: users and roles. [`ProfileDirectory`] serves the seed users (dev and tests);
//!   [`keycloak::KeycloakDirectory`] uses the Keycloak admin API (users, realm roles, logout).
//! * [`TokenService`]: talks to `warden sts` for "test as user" (impersonation, read-only) and
//!   revocation (`revoke` by subject), so a role change applies on the next call.

pub mod keycloak;
pub mod oidc;
mod session;

use std::collections::BTreeMap;
use std::sync::RwLock;

use serde::Serialize;
use serde_json::Value;
use steward_config::DemoUser;

pub use session::{Session, SessionStore};

#[derive(Debug, thiserror::Error)]
pub enum IdentityError {
    #[error("{0}")]
    Http(String),
    #[error("unknown user `{0}`")]
    UnknownUser(String),
    #[error("{0}")]
    Refused(String),
}

/// A user as the console shows it.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct DirUser {
    pub id: String,
    pub name: String,
    pub email: String,
    pub roles: Vec<String>,
    pub attrs: BTreeMap<String, Value>,
    pub enabled: bool,
}

impl From<&DemoUser> for DirUser {
    fn from(u: &DemoUser) -> Self {
        Self {
            id: u.id.clone(),
            name: u.name.clone(),
            email: u.email.clone(),
            roles: u.roles.clone(),
            attrs: u.attrs.clone(),
            enabled: true,
        }
    }
}

/// Users and their roles.
#[async_trait::async_trait]
pub trait Directory: Send + Sync {
    async fn users(&self) -> Result<Vec<DirUser>, IdentityError>;
    async fn user(&self, id: &str) -> Result<DirUser, IdentityError> {
        self.users().await?.into_iter().find(|u| u.id == id).ok_or_else(|| IdentityError::UnknownUser(id.into()))
    }
    /// Replace the user's realm roles. Callers revoke the user's tokens afterwards.
    async fn set_roles(&self, id: &str, roles: &[String]) -> Result<(), IdentityError>;
    /// End the user's sessions at the identity provider (tokens stop introspecting as active).
    async fn logout(&self, _id: &str) -> Result<(), IdentityError> {
        Ok(())
    }
}

/// The profile's seed users, with role changes kept in memory (dev stack, tests).
pub struct ProfileDirectory(RwLock<Vec<DirUser>>);

impl ProfileDirectory {
    pub fn new(users: &[DemoUser]) -> Self {
        Self(RwLock::new(users.iter().map(DirUser::from).collect()))
    }
}

#[async_trait::async_trait]
impl Directory for ProfileDirectory {
    async fn users(&self) -> Result<Vec<DirUser>, IdentityError> {
        self.0.read().map(|u| u.clone()).map_err(|_| IdentityError::Http("poisoned".into()))
    }

    async fn set_roles(&self, id: &str, roles: &[String]) -> Result<(), IdentityError> {
        let mut users = self.0.write().map_err(|_| IdentityError::Http("poisoned".into()))?;
        let u = users.iter_mut().find(|u| u.id == id).ok_or_else(|| IdentityError::UnknownUser(id.into()))?;
        u.roles = roles.to_vec();
        Ok(())
    }
}

/// The token service (`warden sts`): impersonation and revocation.
#[derive(Clone)]
pub struct TokenService {
    pub token_url: String,
    pub revoke_url: String,
    http: reqwest::Client,
    /// The assistant's client (may impersonate).
    pub client_id: String,
    pub client_secret: String,
    /// The console's client (may revoke subjects).
    pub console_id: String,
    pub console_secret: String,
}

impl TokenService {
    pub fn new(base_url: &str, client: (&str, &str), console: (&str, &str)) -> Self {
        let base = base_url.trim_end_matches('/');
        Self {
            token_url: format!("{base}/token"),
            revoke_url: format!("{base}/revoke"),
            http: reqwest::Client::new(),
            client_id: client.0.into(),
            client_secret: client.1.into(),
            console_id: console.0.into(),
            console_secret: console.1.into(),
        }
    }

    /// A read-only token for `target`, issued against the operator's own token.
    pub async fn impersonate(&self, operator_token: &str, target: &DirUser) -> Result<String, IdentityError> {
        let mut claims = serde_json::Map::new();
        for (k, v) in &target.attrs {
            claims.insert(k.clone(), v.clone());
        }
        claims.insert("name".into(), Value::String(target.name.clone()));
        let roles = target.roles.join(" ");
        let claims = Value::Object(claims).to_string();
        let form = [
            ("grant_type", warden_identity::TOKEN_EXCHANGE_GRANT),
            ("subject_token", operator_token),
            ("impersonate", target.id.as_str()),
            ("roles", roles.as_str()),
            ("claims", claims.as_str()),
        ];
        let r = self
            .http
            .post(&self.token_url)
            .basic_auth(&self.client_id, Some(&self.client_secret))
            .form(&form)
            .send()
            .await
            .map_err(|e| IdentityError::Http(e.to_string()))?;
        let status = r.status();
        let body: Value = r.json().await.map_err(|e| IdentityError::Http(e.to_string()))?;
        if !status.is_success() {
            return Err(IdentityError::Refused(body["error_description"].as_str().unwrap_or("impersonation refused").into()));
        }
        body["access_token"].as_str().map(str::to_string).ok_or_else(|| IdentityError::Http("no access_token".into()))
    }

    /// A delegation token: the user's request handed to `agent` (A2A), with an `act` chain.
    pub async fn delegate(&self, user_token: &str, agent: &str, audience: &str) -> Result<String, IdentityError> {
        let form = [
            ("grant_type", warden_identity::TOKEN_EXCHANGE_GRANT),
            ("subject_token", user_token),
            ("delegate_to", agent),
            ("audience", audience),
        ];
        let r = self
            .http
            .post(&self.token_url)
            .basic_auth(&self.client_id, Some(&self.client_secret))
            .form(&form)
            .send()
            .await
            .map_err(|e| IdentityError::Http(e.to_string()))?;
        let status = r.status();
        let body: Value = r.json().await.map_err(|e| IdentityError::Http(e.to_string()))?;
        if !status.is_success() {
            return Err(IdentityError::Refused(body["error_description"].as_str().unwrap_or("delegation refused").into()));
        }
        body["access_token"].as_str().map(str::to_string).ok_or_else(|| IdentityError::Http("no access_token".into()))
    }

    /// Revoke every token of a subject at the token service.
    pub async fn revoke_subject(&self, subject: &str) -> Result<(), IdentityError> {
        let r = self
            .http
            .post(&self.revoke_url)
            .basic_auth(&self.console_id, Some(&self.console_secret))
            .form(&[("sub", subject)])
            .send()
            .await
            .map_err(|e| IdentityError::Http(e.to_string()))?;
        if r.status().is_success() {
            Ok(())
        } else {
            Err(IdentityError::Refused(format!("revoke: HTTP {}", r.status())))
        }
    }
}
