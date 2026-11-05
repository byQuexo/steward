//! The orchestrator's side of A2A: get a delegation token from the token service (the policy's
//! `may_delegate_to` is enforced there and the `act` chain is recorded), call the sub-agent
//! through Warden's A2A proxy, and replay the sub-agent's events into the user's chat stream.

use std::collections::HashMap;

use steward_agents::{ChatEvent, Delegator, Events};
use steward_config::AgentRole;
use steward_identity::TokenService;

pub struct A2aDelegator {
    tokens: TokenService,
    /// role → (agent client id, Warden A2A proxy URL)
    endpoints: HashMap<AgentRole, (String, String)>,
    proxy_audience: String,
    orchestrator: String,
}

impl A2aDelegator {
    pub fn new(
        tokens: TokenService,
        endpoints: HashMap<AgentRole, (String, String)>,
        proxy_audience: String,
        orchestrator: String,
    ) -> Self {
        Self { tokens, endpoints, proxy_audience, orchestrator }
    }
}

#[async_trait::async_trait]
impl Delegator for A2aDelegator {
    async fn delegate(&self, role: AgentRole, skill: &str, input: &str, user_token: &str, events: &Events) -> Result<String, String> {
        let (agent, url) = self.endpoints.get(&role).ok_or_else(|| format!("no {} agent configured", role.as_str()))?;
        events.emit(ChatEvent::AgentHandoff { from: self.orchestrator.clone(), to: agent.clone(), skill: skill.into(), task_id: None });
        let token = self.tokens.delegate(user_token, agent, &self.proxy_audience).await.map_err(|e| format!("delegation refused: {e}"))?;
        let resp = steward_a2a::send(url, &token, skill, input).await?;
        if let Some(e) = resp.get("error") {
            let msg = e["message"].as_str().unwrap_or("not permitted").to_string();
            events.emit(ChatEvent::Decision { tool: skill.into(), effect: "deny".into(), rule: "a2a".into(), agent: agent.clone() });
            return Err(msg);
        }
        let task = &resp["result"];
        events.emit(ChatEvent::Decision { tool: skill.into(), effect: "allow".into(), rule: "a2a.skill".into(), agent: agent.clone() });
        for e in task["metadata"]["events"].as_array().into_iter().flatten() {
            if let Ok(ev) = serde_json::from_value::<ChatEvent>(e.clone()) {
                events.emit(ev);
            }
        }
        let answer = task["status"]["message"]["parts"][0]["text"].as_str().unwrap_or_default().to_string();
        if task["status"]["state"] != "completed" {
            return Err(if answer.is_empty() { "the sub-agent failed".into() } else { answer });
        }
        Ok(answer)
    }
}
