//! Tool names. Warden and MCP use dotted names (`crm.update_deal`); model providers accept only
//! `[A-Za-z0-9_-]`, so the model sees `crm__update_deal`. The mapping is lossless because
//! connector and tool names may not contain `__`.

pub fn to_model(qualified: &str) -> String {
    qualified.replace('.', "__")
}

pub fn to_qualified(model: &str) -> String {
    model.replace("__", ".")
}

/// Local tools the assistant provides itself (no dot, never sent to the gateway).
pub const MEMORY_RECALL: &str = "memory_recall";
pub const MEMORY_REMEMBER: &str = "memory_remember";
pub const MEMORY_FORGET: &str = "memory_forget";
pub const DELEGATE_RESEARCH: &str = "delegate_research";
pub const DELEGATE_ACTION: &str = "delegate_action";

pub fn is_local(model_name: &str) -> bool {
    !model_name.contains("__")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        assert_eq!(to_model("crm.update_deal"), "crm__update_deal");
        assert_eq!(to_qualified("crm__update_deal"), "crm.update_deal");
        assert!(is_local(MEMORY_REMEMBER) && !is_local("hr__get_salary"));
    }
}
