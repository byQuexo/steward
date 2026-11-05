use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::MemoryError;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Fact {
    pub id: i64,
    pub owner: String,
    pub team: Option<String>,
    pub text: String,
    /// Unix seconds.
    pub created_at: i64,
}

/// SQLite storage (file in production, in-memory in tests).
pub struct SqliteStore(Mutex<Connection>);

fn storage(e: rusqlite::Error) -> MemoryError {
    MemoryError::Storage(e.to_string())
}

impl SqliteStore {
    pub fn open(path: &Path) -> Result<Self, MemoryError> {
        Self::init(Connection::open(path).map_err(storage)?)
    }

    pub fn in_memory() -> Result<Self, MemoryError> {
        Self::init(Connection::open_in_memory().map_err(storage)?)
    }

    fn init(c: Connection) -> Result<Self, MemoryError> {
        c.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS facts (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               owner TEXT NOT NULL,
               team TEXT,
               text TEXT NOT NULL,
               created_at INTEGER NOT NULL);
             CREATE INDEX IF NOT EXISTS facts_owner ON facts(owner);
             CREATE INDEX IF NOT EXISTS facts_team ON facts(team);",
        )
        .map_err(storage)?;
        Ok(Self(Mutex::new(c)))
    }

    fn conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, MemoryError> {
        self.0.lock().map_err(|_| MemoryError::Storage("poisoned".into()))
    }

    pub fn insert(&self, owner: &str, team: Option<&str>, text: &str) -> Result<Fact, MemoryError> {
        let now = chrono::Utc::now().timestamp();
        let c = self.conn()?;
        c.execute("INSERT INTO facts (owner, team, text, created_at) VALUES (?1, ?2, ?3, ?4)", params![owner, team, text, now])
            .map_err(storage)?;
        Ok(Fact { id: c.last_insert_rowid(), owner: owner.into(), team: team.map(str::to_string), text: text.into(), created_at: now })
    }

    fn query(&self, sql: &str, arg: &str) -> Result<Vec<Fact>, MemoryError> {
        let c = self.conn()?;
        let mut stmt = c.prepare(sql).map_err(storage)?;
        let rows = stmt
            .query_map([arg], |r| Ok(Fact { id: r.get(0)?, owner: r.get(1)?, team: r.get(2)?, text: r.get(3)?, created_at: r.get(4)? }))
            .map_err(storage)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(storage)
    }

    pub fn list(&self, owner: &str) -> Result<Vec<Fact>, MemoryError> {
        self.query("SELECT id, owner, team, text, created_at FROM facts WHERE owner = ?1 ORDER BY id DESC", owner)
    }

    pub fn list_team(&self, team: &str) -> Result<Vec<Fact>, MemoryError> {
        self.query("SELECT id, owner, team, text, created_at FROM facts WHERE team = ?1 ORDER BY id DESC", team)
    }

    pub fn count(&self, owner: &str) -> Result<usize, MemoryError> {
        let c = self.conn()?;
        c.query_row("SELECT COUNT(*) FROM facts WHERE owner = ?1", [owner], |r| r.get::<_, i64>(0)).map(|n| n as usize).map_err(storage)
    }

    pub fn delete(&self, owner: &str, id: Option<i64>) -> Result<usize, MemoryError> {
        let c = self.conn()?;
        match id {
            Some(id) => c.execute("DELETE FROM facts WHERE owner = ?1 AND id = ?2", params![owner, id]),
            None => c.execute("DELETE FROM facts WHERE owner = ?1", params![owner]),
        }
        .map_err(storage)
    }

    pub fn purge_older_than(&self, days: u32) -> Result<usize, MemoryError> {
        let cutoff = chrono::Utc::now().timestamp() - i64::from(days) * 86_400;
        self.conn()?.execute("DELETE FROM facts WHERE created_at < ?1", [cutoff]).map_err(storage)
    }
}
