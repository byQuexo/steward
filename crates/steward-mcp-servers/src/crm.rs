//! CRM: accounts and deals per tenant. `query` runs SQL on an in-memory SQLite copy that is
//! opened read-only; Warden has already checked that the SQL is a single SELECT on allowed tables.

use std::sync::Mutex;

use rusqlite::Connection;
use serde_json::{json, Map, Value};

use crate::{arg_str, opt_str, schema, Caller, EffectLog, McpServer, ToolDef, ToolError};

pub struct Crm {
    name: String,
    deals: Mutex<Vec<Value>>,
    accounts: Vec<Value>,
    effects: EffectLog,
}

impl Crm {
    pub fn new(name: &str, data: Value, effects: EffectLog) -> Result<Self, String> {
        let list = |k: &str| data.get(k).and_then(Value::as_array).cloned().ok_or_else(|| format!("crm data: `{k}` missing"));
        Ok(Self { name: name.into(), deals: Mutex::new(list("deals")?), accounts: list("accounts")?, effects })
    }

    fn deals(&self) -> Result<std::sync::MutexGuard<'_, Vec<Value>>, ToolError> {
        self.deals.lock().map_err(|_| ToolError::Internal("state poisoned".into()))
    }

    /// SQL over one tenant's rows only: the query database holds nothing else, so no SQL can
    /// reach another tenant (Warden pins `tenant` to the caller's tenants).
    fn query(&self, tenant: &str, sql: &str) -> Result<Value, ToolError> {
        let db = Connection::open_in_memory().map_err(|e| ToolError::Internal(e.to_string()))?;
        let internal = |e: rusqlite::Error| ToolError::Internal(e.to_string());
        db.execute_batch(
            "CREATE TABLE accounts (id TEXT PRIMARY KEY, tenant TEXT, name TEXT, city TEXT);
             CREATE TABLE deals (id TEXT PRIMARY KEY, tenant TEXT, title TEXT, amount INTEGER, stage TEXT, owner TEXT, account_id TEXT, account TEXT);",
        )
        .map_err(internal)?;
        for a in self.accounts.iter().filter(|a| a["tenant"] == tenant) {
            db.execute("INSERT INTO accounts VALUES (?1, ?2, ?3, ?4)", [&a["id"], &a["tenant"], &a["name"], &a["city"]].map(text))
                .map_err(internal)?;
        }
        for d in self.deals()?.iter().filter(|d| d["tenant"] == tenant) {
            db.execute(
                "INSERT INTO deals VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    text(&d["id"]),
                    text(&d["tenant"]),
                    text(&d["title"]),
                    d["amount"].as_i64().unwrap_or(0),
                    text(&d["stage"]),
                    text(&d["owner"]),
                    text(&d["account_id"]),
                    text(&d["account"])
                ],
            )
            .map_err(internal)?;
        }
        // Defense in depth: the connection cannot write, whatever the SQL says.
        db.execute_batch("PRAGMA query_only = ON;").map_err(internal)?;
        let mut stmt = db.prepare(sql).map_err(|e| ToolError::Invalid(format!("SQL: {e}")))?;
        let cols: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
        let mut rows = stmt.query([]).map_err(|e| ToolError::Invalid(format!("SQL: {e}")))?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(|e| ToolError::Invalid(format!("SQL: {e}")))? {
            let mut m = Map::new();
            for (i, c) in cols.iter().enumerate() {
                let v: rusqlite::types::Value = row.get(i).map_err(internal)?;
                m.insert(
                    c.clone(),
                    match v {
                        rusqlite::types::Value::Null => Value::Null,
                        rusqlite::types::Value::Integer(n) => json!(n),
                        rusqlite::types::Value::Real(f) => json!(f),
                        rusqlite::types::Value::Text(s) => json!(s),
                        rusqlite::types::Value::Blob(_) => json!("<blob>"),
                    },
                );
            }
            out.push(Value::Object(m));
            if out.len() >= 200 {
                break;
            }
        }
        Ok(json!({"rows": out}))
    }
}

fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

#[async_trait::async_trait]
impl McpServer for Crm {
    fn name(&self) -> &str {
        &self.name
    }

    fn tools(&self) -> Vec<ToolDef> {
        vec![
            ToolDef {
                name: "list_deals",
                description: "Deals of a tenant, optionally filtered by stage.",
                input_schema: schema(json!({"tenant": {"type": "string"}, "stage": {"type": "string"}}), &["tenant"]),
            },
            ToolDef {
                name: "get_deal",
                description: "One deal.",
                input_schema: schema(json!({"tenant": {"type": "string"}, "deal_id": {"type": "string"}}), &["tenant", "deal_id"]),
            },
            ToolDef {
                name: "update_deal",
                description: "Change the amount (EUR) and/or stage of a deal.",
                input_schema: schema(
                    json!({"tenant": {"type": "string"}, "deal_id": {"type": "string"}, "amount": {"type": "number"}, "stage": {"type": "string"}}),
                    &["tenant", "deal_id", "amount"],
                ),
            },
            ToolDef {
                name: "export_deals",
                description: "All deals of a tenant as CSV.",
                input_schema: schema(json!({"tenant": {"type": "string"}}), &["tenant"]),
            },
            ToolDef {
                name: "query",
                description: "Read-only SQL over one tenant: tables deals(id, tenant, title, amount, stage, owner, account_id, account) and accounts(id, tenant, name, city).",
                input_schema: schema(json!({"tenant": {"type": "string"}, "sql": {"type": "string"}}), &["tenant", "sql"]),
            },
        ]
    }

    async fn call(&self, caller: &Caller, tool: &str, args: &Value) -> Result<Value, ToolError> {
        match tool {
            "list_deals" => {
                let tenant = arg_str(args, "tenant")?;
                let stage = opt_str(args, "stage");
                let deals: Vec<Value> =
                    self.deals()?.iter().filter(|d| d["tenant"] == tenant && stage.is_none_or(|s| d["stage"] == s)).cloned().collect();
                Ok(json!({"tenant": tenant, "deals": deals}))
            }
            "get_deal" => {
                let (tenant, id) = (arg_str(args, "tenant")?, arg_str(args, "deal_id")?);
                self.deals()?.iter().find(|d| d["id"] == id && d["tenant"] == tenant).cloned().ok_or_else(|| ToolError::NotFound(id.into()))
            }
            "update_deal" => {
                let (tenant, id) = (arg_str(args, "tenant")?, arg_str(args, "deal_id")?);
                let amount =
                    args.get("amount").and_then(Value::as_f64).ok_or_else(|| ToolError::Invalid("`amount` (number) is required".into()))?;
                let mut deals = self.deals()?;
                let deal =
                    deals.iter_mut().find(|d| d["id"] == id && d["tenant"] == tenant).ok_or_else(|| ToolError::NotFound(id.into()))?;
                let before = deal.clone();
                deal["amount"] = json!(amount.round() as i64);
                if let Some(s) = opt_str(args, "stage") {
                    deal["stage"] = json!(s);
                }
                let after = deal.clone();
                drop(deals);
                self.effects.push(&self.name, tool, caller, args);
                Ok(json!({"updated": after, "before": {"amount": before["amount"], "stage": before["stage"]}}))
            }
            "export_deals" => {
                let tenant = arg_str(args, "tenant")?;
                let mut csv = String::from("id;account;title;amount;stage;owner\n");
                for d in self.deals()?.iter().filter(|d| d["tenant"] == tenant) {
                    csv.push_str(&format!(
                        "{};{};{};{};{};{}\n",
                        text(&d["id"]),
                        text(&d["account"]),
                        text(&d["title"]),
                        text(&d["amount"]),
                        text(&d["stage"]),
                        text(&d["owner"])
                    ));
                }
                self.effects.push(&self.name, tool, caller, args);
                Ok(json!({"tenant": tenant, "csv": csv}))
            }
            "query" => self.query(arg_str(args, "tenant")?, arg_str(args, "sql")?),
            _ => Err(ToolError::Invalid(format!("unknown tool `{tool}`"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn crm() -> Crm {
        let data = json!({
            "accounts": [{"id": "a-1", "tenant": "dach", "name": "Müller AG", "city": "Köln"}],
            "deals": [{"id": "d-1", "tenant": "dach", "title": "Flow", "amount": 1000, "stage": "Demo", "owner": "sven", "account_id": "a-1", "account": "Müller AG"}]
        });
        Crm::new("crm", data, EffectLog::default()).unwrap()
    }

    #[tokio::test]
    async fn sql_is_read_only_even_if_the_policy_failed() {
        let c = crm();
        let r = c.call(&Caller::anonymous(), "query", &json!({"tenant": "dach", "sql": "SELECT id, amount FROM deals"})).await.unwrap();
        assert_eq!(r["rows"][0]["amount"], 1000);
        assert!(c.call(&Caller::anonymous(), "query", &json!({"tenant": "dach", "sql": "DELETE FROM deals"})).await.is_err());
        // Another tenant's query database is empty: no SQL reaches dach's rows.
        let other = c.call(&Caller::anonymous(), "query", &json!({"tenant": "nordics", "sql": "SELECT id FROM deals WHERE tenant = 'dach'"})).await.unwrap();
        assert_eq!(other["rows"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn update_records_an_effect() {
        let effects = EffectLog::default();
        let mut c = crm();
        c.effects = effects.clone();
        let args = json!({"tenant": "dach", "deal_id": "d-1", "amount": 80000});
        let r = c.call(&Caller::anonymous(), "update_deal", &args).await.unwrap();
        assert_eq!(r["updated"]["amount"], 80000);
        assert!(effects.executed("crm.update_deal"));
        let wrong_tenant = json!({"tenant": "nordics", "deal_id": "d-1", "amount": 1});
        assert!(c.call(&Caller::anonymous(), "update_deal", &wrong_tenant).await.is_err());
    }
}
