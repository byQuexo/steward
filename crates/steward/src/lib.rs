//! Steward: a company assistant whose every tool call is authorized by Warden.
//!
//! This crate is the application: the backend-for-frontend (login, chat over SSE, approvals
//! inbox, admin console API) and the in-process [`stack`] used by the demo and the tests.

pub mod profile_cmd;
pub mod stack;
