//! The Keycloak admin REST API as a [`Directory`]: list users with realm roles and attributes,
//! change realm roles, end sessions. Authenticates as a service account (client credentials).

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::{DirUser, Directory, IdentityError};

pub struct KeycloakDirectory {
    /// e.g. `http://keycloak:8080`
    base: String,
    realm: String,
    client_id: String,
    client_secret: String,
    http: reqwest::Client,
    token: Mutex<Option<(String, Instant)>>,
    /// Realm roles the console manages (others, like `default-roles-*`, are left alone).
    managed_roles: Vec<String>,
}

fn http_err(e: impl std::fmt::Display) -> IdentityError {
    IdentityError::Http(e.to_string())
}

impl KeycloakDirectory {
    pub fn new(base: &str, realm: &str, client_id: &str, client_secret: &str, managed_roles: Vec<String>) -> Self {
        Self {
            base: base.trim_end_matches('/').into(),
            realm: realm.into(),
            client_id: client_id.into(),
            client_secret: client_secret.into(),
            http: reqwest::Client::builder().timeout(Duration::from_secs(10)).build().unwrap_or_default(),
            token: Mutex::new(None),
            managed_roles,
        }
    }

    async fn token(&self) -> Result<String, IdentityError> {
        let mut t = self.token.lock().await;
        if let Some((tok, until)) = t.as_ref() {
            if Instant::now() < *until {
                return Ok(tok.clone());
            }
        }
        let url = format!("{}/realms/{}/protocol/openid-connect/token", self.base, self.realm);
        let r: Value = self
            .http
            .post(&url)
            .basic_auth(&self.client_id, Some(&self.client_secret))
            .form(&[("grant_type", "client_credentials")])
            .send()
            .await
            .map_err(http_err)?
            .json()
            .await
            .map_err(http_err)?;
        let tok = r["access_token"].as_str().ok_or_else(|| IdentityError::Refused(format!("keycloak token: {r}")))?.to_string();
        let ttl = r["expires_in"].as_u64().unwrap_or(60).saturating_sub(10);
        *t = Some((tok.clone(), Instant::now() + Duration::from_secs(ttl)));
        Ok(tok)
    }

    fn admin(&self, path: &str) -> String {
        format!("{}/admin/realms/{}{path}", self.base, self.realm)
    }

    async fn get(&self, path: &str) -> Result<Value, IdentityError> {
        let tok = self.token().await?;
        let r = self.http.get(self.admin(path)).bearer_auth(tok).send().await.map_err(http_err)?;
        if !r.status().is_success() {
            return Err(IdentityError::Http(format!("GET {path}: HTTP {}", r.status())));
        }
        r.json().await.map_err(http_err)
    }

    async fn send(&self, method: reqwest::Method, path: &str, body: Value) -> Result<(), IdentityError> {
        let tok = self.token().await?;
        let r = self.http.request(method.clone(), self.admin(path)).bearer_auth(tok).json(&body).send().await.map_err(http_err)?;
        if !r.status().is_success() {
            return Err(IdentityError::Http(format!("{method} {path}: HTTP {}", r.status())));
        }
        Ok(())
    }

    async fn kc_id(&self, username: &str) -> Result<String, IdentityError> {
        let found = self.get(&format!("/users?username={username}&exact=true")).await?;
        found
            .as_array()
            .and_then(|a| a.first())
            .and_then(|u| u["id"].as_str())
            .map(str::to_string)
            .ok_or_else(|| IdentityError::UnknownUser(username.into()))
    }

    async fn realm_roles_of(&self, kc_id: &str) -> Result<Vec<Value>, IdentityError> {
        Ok(self.get(&format!("/users/{kc_id}/role-mappings/realm")).await?.as_array().cloned().unwrap_or_default())
    }
}

#[async_trait::async_trait]
impl Directory for KeycloakDirectory {
    async fn users(&self) -> Result<Vec<DirUser>, IdentityError> {
        let list = self.get("/users?max=500&briefRepresentation=false").await?;
        let mut out = Vec::new();
        for u in list.as_array().into_iter().flatten() {
            let username = u["username"].as_str().unwrap_or_default().to_string();
            if username.starts_with("service-account-") {
                continue;
            }
            let id = u["id"].as_str().unwrap_or_default();
            let roles: Vec<String> = self
                .realm_roles_of(id)
                .await?
                .iter()
                .filter_map(|r| r["name"].as_str().map(str::to_string))
                .filter(|r| self.managed_roles.contains(r))
                .collect();
            let mut attrs = BTreeMap::new();
            if let Some(a) = u["attributes"].as_object() {
                for (k, v) in a {
                    let list: Vec<Value> = v.as_array().cloned().unwrap_or_default();
                    let value = if k == "org_unit" { list.first().cloned().unwrap_or(Value::Null) } else { Value::Array(list) };
                    attrs.insert(k.clone(), value);
                }
            }
            let name = format!("{} {}", u["firstName"].as_str().unwrap_or_default(), u["lastName"].as_str().unwrap_or_default())
                .trim()
                .to_string();
            out.push(DirUser {
                id: username,
                name,
                email: u["email"].as_str().unwrap_or_default().into(),
                roles,
                attrs,
                enabled: u["enabled"].as_bool().unwrap_or(true),
            });
        }
        Ok(out)
    }

    async fn set_roles(&self, id: &str, roles: &[String]) -> Result<(), IdentityError> {
        let kc = self.kc_id(id).await?;
        let current = self.realm_roles_of(&kc).await?;
        let all = self.get("/roles").await?;
        let rep = |name: &str| all.as_array().and_then(|a| a.iter().find(|r| r["name"] == name)).cloned();
        let remove: Vec<Value> = current
            .iter()
            .filter(|r| r["name"].as_str().is_some_and(|n| self.managed_roles.iter().any(|m| m == n) && !roles.iter().any(|x| x == n)))
            .cloned()
            .collect();
        let add: Vec<Value> = roles.iter().filter(|r| !current.iter().any(|c| c["name"] == r.as_str())).filter_map(|r| rep(r)).collect();
        let path = format!("/users/{kc}/role-mappings/realm");
        if !remove.is_empty() {
            self.send(reqwest::Method::DELETE, &path, json!(remove)).await?;
        }
        if !add.is_empty() {
            self.send(reqwest::Method::POST, &path, json!(add)).await?;
        }
        Ok(())
    }

    async fn logout(&self, id: &str) -> Result<(), IdentityError> {
        let kc = self.kc_id(id).await?;
        self.send(reqwest::Method::POST, &format!("/users/{kc}/logout"), json!({})).await
    }
}
