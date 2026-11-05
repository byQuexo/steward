//! Steward: a company assistant whose every tool call is authorized by Warden.
//!
//! This crate is the application: the backend-for-frontend (login, chat over SSE, approvals
//! inbox, admin console API) and the in-process [`stack`] used by the demo and the tests.

// Handlers return `Result<_, Response>` for early exits; responses are built once per request.
#![allow(clippy::result_large_err)]

pub mod admin;
pub mod app;
pub mod chat;
pub mod delegate;
pub mod dev;
pub mod inbox;
pub mod pages;
pub mod profile_cmd;
pub mod replay;
pub mod stack;
