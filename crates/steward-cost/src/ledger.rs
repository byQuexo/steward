use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::CostError;

/// One booked cost.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct CostEntry {
    pub run_id: String,
    pub user: String,
    pub team: Option<String>,
    /// Warden agent (OAuth client) that spent it.
    pub agent: String,
    /// Model route, or the paid tool (`docs.search`).
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cached_input_tokens: u64,
    pub eur: f64,
    /// Unix seconds; set by the ledger when 0.
    pub ts: i64,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct Totals {
    pub key: String,
    pub eur: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub calls: u64,
}

pub struct Ledger(Mutex<Connection>);

fn storage(e: rusqlite::Error) -> CostError {
    CostError::Storage(e.to_string())
}

impl Ledger {
    pub fn open(path: &Path) -> Result<Self, CostError> {
        Self::init(Connection::open(path).map_err(storage)?)
    }

    pub fn in_memory() -> Result<Self, CostError> {
        Self::init(Connection::open_in_memory().map_err(storage)?)
    }

    fn init(c: Connection) -> Result<Self, CostError> {
        c.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS costs (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               ts INTEGER NOT NULL, run_id TEXT NOT NULL, user TEXT NOT NULL, team TEXT, agent TEXT NOT NULL,
               model TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
               cached_input_tokens INTEGER NOT NULL, eur REAL NOT NULL);
             CREATE INDEX IF NOT EXISTS costs_run ON costs(run_id);
             CREATE INDEX IF NOT EXISTS costs_user_ts ON costs(user, ts);
             CREATE INDEX IF NOT EXISTS costs_team_ts ON costs(team, ts);",
        )
        .map_err(storage)?;
        Ok(Self(Mutex::new(c)))
    }

    fn conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, CostError> {
        self.0.lock().map_err(|_| CostError::Storage("poisoned".into()))
    }

    pub fn record(&self, mut e: CostEntry) -> Result<CostEntry, CostError> {
        if e.ts == 0 {
            e.ts = chrono::Utc::now().timestamp();
        }
        self.conn()?
            .execute(
                "INSERT INTO costs (ts, run_id, user, team, agent, model, input_tokens, output_tokens, cached_input_tokens, eur)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    e.ts,
                    e.run_id,
                    e.user,
                    e.team,
                    e.agent,
                    e.model,
                    e.input_tokens as i64,
                    e.output_tokens as i64,
                    e.cached_input_tokens as i64,
                    e.eur
                ],
            )
            .map_err(storage)?;
        Ok(e)
    }

    fn sum(&self, sql: &str, p: &[&dyn rusqlite::ToSql]) -> Result<f64, CostError> {
        self.conn()?.query_row(sql, p, |r| r.get::<_, Option<f64>>(0)).map(|v| v.unwrap_or(0.0)).map_err(storage)
    }

    pub fn run_total(&self, run_id: &str) -> Result<f64, CostError> {
        self.sum("SELECT SUM(eur) FROM costs WHERE run_id = ?1", &[&run_id])
    }

    pub fn user_today(&self, user: &str) -> Result<f64, CostError> {
        let start = chrono::Utc::now().date_naive().and_hms_opt(0, 0, 0).map(|d| d.and_utc().timestamp()).unwrap_or(0);
        self.sum("SELECT SUM(eur) FROM costs WHERE user = ?1 AND ts >= ?2", &[&user, &start])
    }

    pub fn team_this_month(&self, team: &str) -> Result<f64, CostError> {
        let now = chrono::Utc::now().date_naive();
        let start = chrono::NaiveDate::from_ymd_opt(chrono::Datelike::year(&now), chrono::Datelike::month(&now), 1)
            .and_then(|d| d.and_hms_opt(0, 0, 0))
            .map(|d| d.and_utc().timestamp())
            .unwrap_or(0);
        self.sum("SELECT SUM(eur) FROM costs WHERE team = ?1 AND ts >= ?2", &[&team, &start])
    }

    /// Totals grouped by `user`, `team`, `agent`, `model` or `day`, optionally since a timestamp.
    pub fn totals_by(&self, group: &str, since: i64) -> Result<Vec<Totals>, CostError> {
        let key = match group {
            "user" => "user",
            "team" => "COALESCE(team, '-')",
            "agent" => "agent",
            "model" => "model",
            "day" => "date(ts, 'unixepoch')",
            _ => return Err(CostError::Storage(format!("unknown grouping `{group}`"))),
        };
        let sql = format!(
            "SELECT {key} AS k, SUM(eur), SUM(input_tokens), SUM(output_tokens), COUNT(*) FROM costs WHERE ts >= ?1 GROUP BY k ORDER BY SUM(eur) DESC"
        );
        let c = self.conn()?;
        let mut stmt = c.prepare(&sql).map_err(storage)?;
        let rows = stmt
            .query_map([since], |r| {
                Ok(Totals {
                    key: r.get(0)?,
                    eur: r.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
                    input_tokens: r.get::<_, i64>(2)? as u64,
                    output_tokens: r.get::<_, i64>(3)? as u64,
                    calls: r.get::<_, i64>(4)? as u64,
                })
            })
            .map_err(storage)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(storage)
    }

    pub fn total_since(&self, since: i64) -> Result<f64, CostError> {
        self.sum("SELECT SUM(eur) FROM costs WHERE ts >= ?1", &[&since])
    }

    /// Most recent entries (newest first).
    pub fn recent(&self, limit: usize) -> Result<Vec<CostEntry>, CostError> {
        let c = self.conn()?;
        let mut stmt = c
            .prepare("SELECT run_id, user, team, agent, model, input_tokens, output_tokens, cached_input_tokens, eur, ts FROM costs ORDER BY id DESC LIMIT ?1")
            .map_err(storage)?;
        let rows = stmt
            .query_map([limit as i64], |r| {
                Ok(CostEntry {
                    run_id: r.get(0)?,
                    user: r.get(1)?,
                    team: r.get(2)?,
                    agent: r.get(3)?,
                    model: r.get(4)?,
                    input_tokens: r.get::<_, i64>(5)? as u64,
                    output_tokens: r.get::<_, i64>(6)? as u64,
                    cached_input_tokens: r.get::<_, i64>(7)? as u64,
                    eur: r.get(8)?,
                    ts: r.get(9)?,
                })
            })
            .map_err(storage)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(storage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(run: &str, user: &str, team: &str, eur: f64) -> CostEntry {
        CostEntry {
            run_id: run.into(),
            user: user.into(),
            team: Some(team.into()),
            agent: "acme-bot".into(),
            model: "m".into(),
            input_tokens: 100,
            output_tokens: 10,
            cached_input_tokens: 0,
            eur,
            ts: 0,
        }
    }

    #[test]
    fn sums_by_run_user_team() {
        let l = Ledger::in_memory().unwrap();
        l.record(entry("r1", "sven", "sales", 0.01)).unwrap();
        l.record(entry("r1", "sven", "sales", 0.02)).unwrap();
        l.record(entry("r2", "sara", "sales", 0.5)).unwrap();
        assert!((l.run_total("r1").unwrap() - 0.03).abs() < 1e-9);
        assert!((l.user_today("sven").unwrap() - 0.03).abs() < 1e-9);
        assert!((l.team_this_month("sales").unwrap() - 0.53).abs() < 1e-9);
        let by_user = l.totals_by("user", 0).unwrap();
        assert_eq!(by_user[0].key, "sara");
        assert_eq!(by_user[1].calls, 2);
        assert!(l.totals_by("nope", 0).is_err());
    }
}
