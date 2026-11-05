# Spikes (Phase 0)

Results of the Phase 0 spikes from the [plan](design/plan-de.md), checked against the crate
sources on 2026-11-05. Versions: rig-core / rig-agent / rig-rmcp / rig-cassette `=0.46.0`,
rmcp 3.8.0, rustc 1.99.

## 1. MCP per chat session with the user's token: rig-rmcp works, no fallback needed

The plan's open assumption was whether `rig-rmcp` can send a bearer token per connection
over Streamable HTTP. It can: rmcp 3.8's `StreamableHttpClientTransportConfig` has
`auth_header` (sent via reqwest `bearer_auth`, value without the `Bearer ` prefix) and
`custom_headers`.

```rust
use rmcp::transport::{StreamableHttpClientTransport, streamable_http_client::StreamableHttpClientTransportConfig};
let cfg = StreamableHttpClientTransportConfig::with_uri(gateway_url).auth_header(user_token);
let transport = StreamableHttpClientTransport::from_config(cfg);
// live tool list (re-fetched on notifications/tools/list_changed):
let handle = rig_agent::tool::server::ToolServer::new().run();
let conn = rig_rmcp::McpClientHandler::new(ClientConfig::default(), handle.clone()).connect(transport).await?;
let agent = AgentBuilder::new(model).tool_server_handle(handle) /* … */;
```

The struct is `#[non_exhaustive]`, so only the builder methods work. Keep `conn` alive for
the session: dropping it retires the tools. Features: `rmcp = { features = ["client",
"transport-streamable-http-client-reqwest", "reqwest"] }`.

Consequence: one MCP connection per chat session, opened with that session's access token.
The Warden gateway already filters `tools/list` per principal and sends `list_changed` when
an upstream's circuit opens, which `McpClientHandler` picks up.

## 2. Deterministic agent tests: scripted model, not cassettes

`rig_core::test_utils::MockCompletionModel` (feature `test-utils`) scripts model turns:
`from_turns([MockTurn::tool_call(..), MockTurn::text(..)])` for blocking runs and
`from_stream_turns([...MockStreamEvent::final_response(usage)])` for streaming runs (two
separate queues; a streamed turn must end with `final_response`). For replies that depend on
the request, implement `rig_core::driver::Transport<MockScript>`.

`rig-cassette` (`ProviderCassette`) records provider HTTP through a local proxy with exact
request matching. Any prompt or tool change breaks a recording, so Steward uses it only for
optional provider-wire checks. Replay tests of whole conversations use a scripted model
driven by the scenario files (`profiles/<p>/scenarios/*.yaml`). CI never needs an API key.

## 3. Agent runtime facts used by Steward

* `rig_agent::AgentBuilder::new(model)` takes any `DynModel<Completion>`; models are created
  from config with `rig_core::catalog::Catalog::builtin().connect_with("provider/model",
  ConnectOptions::new().api_key(..).base_url(..))`, so `models.yaml` needs no provider enum.
* Hooks: `add_hook(h)`. `AgentHook::on_dispatch` returns `DispatchAction::skip(msg)` to deny a
  call with a message the model sees (warden-rig's `ScopeHook` does this);
  `on_model_turn_finished` carries `usage` per turn (used by the budget hook).
* Streaming: `agent.prompt(p).stream()` yields `MultiTurnStreamItem` (`StreamAssistantItem` with
  `StreamEvent::Text`, `ToolCall`, `ToolResult`, `CompletionCall` with usage, `FinalResponse`);
  the BFF maps these to SSE events.
* `Usage` has input/output/cached tokens; cost is computed by Steward from `pricing.yaml`.

## 4. A2A server layer

`warden-a2a` already implements the proxy side (per-caller agent cards, `metadata.skillId`,
task ownership). Steward's agents need only the server side: JSON-RPC `message/send` and
`tasks/get` on axum, with the agent card generated from the profile. No `a2a-lf` dependency.

## 5. docrag-bench as the document service

`docrag serve --config <yaml>` (FastAPI, port 8000). `POST /query` with
`{question, thread_id?, doc_ids?}` returns `{answer, status, sources[{id, doc_id, page, quote,
page_image_url}], rejected_citations, cost_eur, input_tokens, output_tokens, …}`. `status` is
`supported | partially_supported | unsupported | abstained`; `sources` contains only
verified citations. Page images: `GET /pages/{doc_id}/{page}.png`. Doc ids are PDF file
stems; ingestion is `docrag ingest` over `DOCRAG_PDF_DIR` (OCR via `ocr: rapidocr|vlm`). The
API has no auth, so it stays on the internal network behind `docs-mcp`.

Steward's `docs` MCP server talks to this contract. For tests and keyless demos it ships a
built-in lexical backend that returns the same response shape and verifies every quote
against the page text, so the citation rules are exercised in CI.

Judge, kappa and bootstrap: `docrag.eval.stats.doc_bootstrap_ci` and `mcnemar` depend only on
numpy; `docrag.eval.agreement` computes kappa via scikit-learn. The package pins Python 3.12.
