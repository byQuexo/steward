//! OIDC authorization code flow with PKCE.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::IdentityError;

#[derive(Clone, Debug, Deserialize)]
pub struct Discovery {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    #[serde(default)]
    pub end_session_endpoint: Option<String>,
}

/// Tokens from the provider.
#[derive(Clone, Debug, Deserialize)]
pub struct Tokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub id_token: Option<String>,
    #[serde(default)]
    pub expires_in: Option<u64>,
}

struct Pending {
    verifier: String,
    nonce: String,
    created: Instant,
}

pub struct OidcClient {
    pub discovery: Discovery,
    /// Provider URLs as reachable from the server (container network), when they differ
    /// from the public ones in the discovery document.
    backchannel_token_endpoint: String,
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    http: reqwest::Client,
    pending: Mutex<HashMap<String, Pending>>,
}

fn random() -> String {
    URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>())
}

pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

impl OidcClient {
    /// `issuer` is the public issuer; `backchannel` optionally replaces its origin for
    /// server-side calls (e.g. `http://keycloak:8080` while the browser uses `localhost:8080`).
    pub async fn discover(
        issuer: &str,
        backchannel: Option<&str>,
        client_id: &str,
        client_secret: &str,
        redirect_uri: &str,
    ) -> Result<Self, IdentityError> {
        let http = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().map_err(|e| IdentityError::Http(e.to_string()))?;
        let base = backchannel.map(|b| {
            let path = issuer.splitn(4, '/').nth(3).unwrap_or("");
            format!("{}/{}", b.trim_end_matches('/'), path)
        });
        let url = format!("{}/.well-known/openid-configuration", base.as_deref().unwrap_or(issuer).trim_end_matches('/'));
        let discovery: Discovery = http
            .get(&url)
            .send()
            .await
            .map_err(|e| IdentityError::Http(format!("{url}: {e}")))?
            .json()
            .await
            .map_err(|e| IdentityError::Http(format!("{url}: {e}")))?;
        let backchannel_token_endpoint = match backchannel {
            Some(b) => {
                let origin = discovery.token_endpoint.splitn(4, '/').take(3).collect::<Vec<_>>().join("/");
                discovery.token_endpoint.replacen(&origin, b.trim_end_matches('/'), 1)
            }
            None => discovery.token_endpoint.clone(),
        };
        Ok(Self {
            discovery,
            backchannel_token_endpoint,
            client_id: client_id.into(),
            client_secret: client_secret.into(),
            redirect_uri: redirect_uri.into(),
            http,
            pending: Mutex::new(HashMap::new()),
        })
    }

    /// Where to send the browser; remembers state, nonce and PKCE verifier.
    pub fn authorize_url(&self) -> String {
        let (state, verifier, nonce) = (random(), random(), random());
        let challenge = pkce_challenge(&verifier);
        if let Ok(mut p) = self.pending.lock() {
            p.retain(|_, v| v.created.elapsed() < Duration::from_secs(600));
            p.insert(state.clone(), Pending { verifier, nonce: nonce.clone(), created: Instant::now() });
        }
        format!(
            "{}?response_type=code&client_id={}&redirect_uri={}&scope=openid%20profile%20email&state={}&nonce={}&code_challenge={}&code_challenge_method=S256",
            self.discovery.authorization_endpoint,
            urlencode(&self.client_id),
            urlencode(&self.redirect_uri),
            state,
            nonce,
            challenge
        )
    }

    /// Exchange the code from the callback. The state must be one we issued (one use only).
    pub async fn exchange(&self, code: &str, state: &str) -> Result<Tokens, IdentityError> {
        let pending = self
            .pending
            .lock()
            .ok()
            .and_then(|mut p| p.remove(state))
            .ok_or_else(|| IdentityError::Refused("unknown or used login state".into()))?;
        let form = [
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", self.redirect_uri.as_str()),
            ("code_verifier", pending.verifier.as_str()),
        ];
        let tokens: Tokens = self.token_request(&form).await?;
        if let Some(id) = &tokens.id_token {
            let nonce = jwt_claim(id, "nonce");
            if nonce.as_deref() != Some(pending.nonce.as_str()) {
                return Err(IdentityError::Refused("id_token nonce mismatch".into()));
            }
        }
        Ok(tokens)
    }

    pub async fn refresh(&self, refresh_token: &str) -> Result<Tokens, IdentityError> {
        self.token_request(&[("grant_type", "refresh_token"), ("refresh_token", refresh_token)]).await
    }

    /// Resource-owner password grant: only for smoke tests against the local demo realm.
    pub async fn password_grant(&self, username: &str, password: &str) -> Result<Tokens, IdentityError> {
        self.token_request(&[("grant_type", "password"), ("username", username), ("password", password), ("scope", "openid")]).await
    }

    async fn token_request(&self, form: &[(&str, &str)]) -> Result<Tokens, IdentityError> {
        let r = self
            .http
            .post(&self.backchannel_token_endpoint)
            .basic_auth(&self.client_id, Some(&self.client_secret))
            .form(form)
            .send()
            .await
            .map_err(|e| IdentityError::Http(e.to_string()))?;
        if !r.status().is_success() {
            let body = r.text().await.unwrap_or_default();
            return Err(IdentityError::Refused(format!("token endpoint: {body}")));
        }
        r.json().await.map_err(|e| IdentityError::Http(e.to_string()))
    }
}

/// A claim of a JWT **without verifying it**. Only for values the gateway verifies anyway
/// (display name, subject for routing) or that were just received over TLS from the provider.
pub fn jwt_claim(token: &str, claim: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    match v.get(claim)? {
        Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_s256_matches_rfc7636_example() {
        assert_eq!(pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn claims_are_read() {
        let payload = URL_SAFE_NO_PAD.encode(br#"{"sub":"sven","nonce":"n1"}"#);
        let token = format!("h.{payload}.s");
        assert_eq!(jwt_claim(&token, "sub").as_deref(), Some("sven"));
        assert_eq!(jwt_claim(&token, "missing"), None);
    }
}
