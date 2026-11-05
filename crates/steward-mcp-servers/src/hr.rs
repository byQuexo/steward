//! HR: employees, absences, salaries. Salaries are only returned by `get_salary`, which
//! Warden restricts to HR leads and their own unit.

use serde_json::{json, Value};

use crate::{arg_str, opt_str, schema, Caller, McpServer, ToolDef, ToolError};

pub struct Hr {
    name: String,
    employees: Vec<Value>,
    absences: Vec<Value>,
}

impl Hr {
    pub fn new(name: &str, data: Value) -> Result<Self, String> {
        let list = |k: &str| data.get(k).and_then(Value::as_array).cloned().ok_or_else(|| format!("hr data: `{k}` missing"));
        Ok(Self { name: name.into(), employees: list("employees")?, absences: list("absences")? })
    }

    fn public(e: &Value) -> Value {
        let mut e = e.clone();
        if let Some(o) = e.as_object_mut() {
            o.remove("salary_eur");
            o.remove("band");
        }
        e
    }
}

#[async_trait::async_trait]
impl McpServer for Hr {
    fn name(&self) -> &str {
        &self.name
    }

    fn tools(&self) -> Vec<ToolDef> {
        vec![
            ToolDef {
                name: "search_employees",
                description: "Search employees by name, unit or title (no salary data).",
                input_schema: schema(json!({"query": {"type": "string"}, "unit": {"type": "string"}}), &[]),
            },
            ToolDef {
                name: "get_employee",
                description: "Master data of one employee (no salary data).",
                input_schema: schema(json!({"employee_id": {"type": "string"}}), &["employee_id"]),
            },
            ToolDef {
                name: "list_absences",
                description: "Absences of a unit.",
                input_schema: schema(json!({"unit": {"type": "string"}}), &["unit"]),
            },
            ToolDef {
                name: "get_salary",
                description: "Salaries of a unit, optionally of one employee.",
                input_schema: schema(json!({"unit": {"type": "string"}, "employee_id": {"type": "string"}}), &["unit"]),
            },
        ]
    }

    async fn call(&self, _caller: &Caller, tool: &str, args: &Value) -> Result<Value, ToolError> {
        let field = |e: &Value, k: &str| e.get(k).and_then(Value::as_str).unwrap_or_default().to_lowercase();
        match tool {
            "search_employees" => {
                let q = opt_str(args, "query").map(str::to_lowercase);
                let unit = opt_str(args, "unit");
                let hits: Vec<Value> = self
                    .employees
                    .iter()
                    .filter(|e| unit.is_none_or(|u| field(e, "unit") == u.to_lowercase()))
                    .filter(|e| q.as_ref().is_none_or(|q| field(e, "name").contains(q) || field(e, "title").contains(q)))
                    .take(25)
                    .map(Self::public)
                    .collect();
                Ok(json!({"employees": hits}))
            }
            "get_employee" => {
                let id = arg_str(args, "employee_id")?;
                self.employees.iter().find(|e| e["id"] == id).map(Self::public).ok_or_else(|| ToolError::NotFound(id.into()))
            }
            "list_absences" => {
                let unit = arg_str(args, "unit")?;
                Ok(json!({"absences": self.absences.iter().filter(|a| a["unit"] == unit).collect::<Vec<_>>()}))
            }
            "get_salary" => {
                let unit = arg_str(args, "unit")?;
                let only = opt_str(args, "employee_id");
                let rows: Vec<Value> = self
                    .employees
                    .iter()
                    .filter(|e| e["unit"] == unit && only.is_none_or(|id| e["id"] == id))
                    .map(|e| json!({"id": e["id"], "name": e["name"], "title": e["title"], "band": e["band"], "salary_eur": e["salary_eur"]}))
                    .collect();
                if rows.is_empty() {
                    return Err(ToolError::NotFound(format!("no employees for unit `{unit}`")));
                }
                Ok(json!({"unit": unit, "salaries": rows}))
            }
            _ => Err(ToolError::Invalid(format!("unknown tool `{tool}`"))),
        }
    }
}
