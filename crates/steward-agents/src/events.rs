//! What a chat turn emits, in order. The BFF streams these as SSE; the replay tests assert on
//! them; the UI renders them.

use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatEvent {
    /// A piece of the answer.
    Token {
        text: String,
    },
    /// The model wants to call a tool.
    ToolCall {
        id: String,
        tool: String,
        args: Value,
        agent: String,
    },
    /// Warden's decision for that call (second line, in process; the gateway decides again).
    Decision {
        tool: String,
        effect: String,
        rule: String,
        agent: String,
    },
    /// The tool ran (or was refused upstream).
    ToolResult {
        id: String,
        tool: String,
        ok: bool,
        preview: String,
    },
    /// The gateway holds a call for approval.
    ApprovalPending {
        approval_id: String,
        tool: String,
        rule: String,
        approvers: Vec<String>,
        args: Value,
    },
    ApprovalDecided {
        approval_id: String,
        decision: String,
        approver: String,
    },
    /// A verified citation from the document service.
    Citation {
        doc_id: String,
        title: String,
        page: u32,
        quote: String,
        url: String,
    },
    /// The document service found nothing that supports an answer.
    Abstained {
        tool: String,
    },
    /// A sub-agent took over (A2A).
    AgentHandoff {
        from: String,
        to: String,
        skill: String,
        task_id: Option<String>,
    },
    MemoryUsed {
        count: usize,
    },
    MemoryStored {
        fact: String,
    },
    MemoryRefused {
        reason: String,
    },
    /// One booked model call.
    Cost {
        eur: f64,
        input_tokens: u64,
        output_tokens: u64,
        model: String,
        agent: String,
    },
    BudgetExceeded {
        reason: String,
    },
    Error {
        message: String,
    },
    /// End of the turn.
    Done {
        answer: String,
        run_id: String,
        eur: f64,
    },
}

/// Where events go. Cloneable; sending never blocks.
#[derive(Clone)]
pub struct Events(Arc<dyn Fn(ChatEvent) + Send + Sync>);

impl Events {
    pub fn new(f: impl Fn(ChatEvent) + Send + Sync + 'static) -> Self {
        Self(Arc::new(f))
    }

    pub fn channel() -> (Self, tokio::sync::mpsc::UnboundedReceiver<ChatEvent>) {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        (Self::new(move |e| drop(tx.send(e))), rx)
    }

    pub fn none() -> Self {
        Self::new(|_| {})
    }

    pub fn emit(&self, e: ChatEvent) {
        (self.0)(e)
    }
}

impl std::fmt::Debug for Events {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Events")
    }
}
