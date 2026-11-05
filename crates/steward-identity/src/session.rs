use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};

/// A logged-in browser session. Tokens stay on the server.
#[derive(Clone, Debug)]
pub struct Session {
    pub id: String,
    pub user: String,
    pub name: String,
    /// Bearer for the gateway (the user's token, or an impersonation token).
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<Instant>,
    /// Set for "test as user" sessions: the operator's id.
    pub impersonated_by: Option<String>,
    /// The operator's own session, restored when the test session ends.
    pub parent: Option<String>,
    pub created: Instant,
}

/// In-memory sessions with an idle limit.
pub struct SessionStore {
    sessions: RwLock<HashMap<String, (Session, Instant)>>,
    idle: Duration,
}

pub fn random_id() -> String {
    hex::encode(rand::random::<[u8; 24]>())
}

impl SessionStore {
    pub fn new(idle: Duration) -> Self {
        Self { sessions: RwLock::new(HashMap::new()), idle }
    }

    pub fn create(
        &self,
        user: &str,
        name: &str,
        access_token: String,
        refresh_token: Option<String>,
        expires_in: Option<Duration>,
    ) -> Session {
        let s = Session {
            id: random_id(),
            user: user.into(),
            name: name.into(),
            access_token,
            refresh_token,
            expires_at: expires_in.map(|d| Instant::now() + d),
            impersonated_by: None,
            parent: None,
            created: Instant::now(),
        };
        self.put(s.clone());
        s
    }

    pub fn put(&self, s: Session) {
        if let Ok(mut m) = self.sessions.write() {
            m.insert(s.id.clone(), (s, Instant::now()));
        }
    }

    /// The session, if it exists and has been used within the idle limit (touches it).
    pub fn get(&self, id: &str) -> Option<Session> {
        let mut m = self.sessions.write().ok()?;
        let fresh = m.get(id).is_some_and(|(_, last)| last.elapsed() < self.idle);
        if !fresh {
            m.remove(id);
            return None;
        }
        let entry = m.get_mut(id)?;
        entry.1 = Instant::now();
        Some(entry.0.clone())
    }

    pub fn remove(&self, id: &str) {
        if let Ok(mut m) = self.sessions.write() {
            m.remove(id);
        }
    }

    /// End every session of a user (role change, revocation).
    pub fn remove_user(&self, user: &str) -> usize {
        let Ok(mut m) = self.sessions.write() else { return 0 };
        let before = m.len();
        m.retain(|_, (s, _)| s.user != user);
        before - m.len()
    }

    pub fn update_tokens(&self, id: &str, access: String, refresh: Option<String>, expires_in: Option<Duration>) {
        if let Ok(mut m) = self.sessions.write() {
            if let Some((s, _)) = m.get_mut(id) {
                s.access_token = access;
                if refresh.is_some() {
                    s.refresh_token = refresh;
                }
                s.expires_at = expires_in.map(|d| Instant::now() + d);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_sessions_expire_and_users_can_be_logged_out() {
        let store = SessionStore::new(Duration::from_millis(50));
        let s = store.create("sven", "Sven", "t".into(), None, None);
        assert!(store.get(&s.id).is_some());
        let other = store.create("sven", "Sven", "t2".into(), None, None);
        assert_eq!(store.remove_user("sven"), 2);
        assert!(store.get(&other.id).is_none());
        let s = store.create("ivo", "Ivo", "t".into(), None, None);
        std::thread::sleep(Duration::from_millis(80));
        assert!(store.get(&s.id).is_none());
    }
}
