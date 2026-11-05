//! Steward's agents on rig 0.46.
//!
//! A turn connects to the **Warden gateway** over MCP with the user's token (rig-rmcp), so the
//! model only ever sees tools this user may use, and every call is decided again by the
//! gateway. In the loop, a [`guard::GuardHook`] checks each call in process first (second line),
//! [`steward_cost::BudgetHook`] books cost and stops at budgets, and the stream is mapped to
//! [`events::ChatEvent`]s for the UI.
//!
//! Models come from the profile (`models.yaml`); the [`scripted`] model replays demo scenarios
//! through the same loop, so demo and CI need no API key.

pub mod events;
pub mod guard;
pub mod models;
pub mod names;
pub mod runner;
pub mod scripted;
pub mod tools;

pub use events::{ChatEvent, Events};
pub use models::ModelFactory;
pub use runner::{Runtime, TurnInput, TurnOutput};
pub use scripted::ScriptBook;
pub use tools::Delegator;
