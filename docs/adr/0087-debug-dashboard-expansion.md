# ADR-0087: Debug Dashboard Expansion — Memo Lifecycle, Recurring Tasks, Deferred Prompts, Reply Content, Per-Turn Transitions, Context, and Tool-Failure Analysis

## Status

Accepted

## Date

2026-05-15

## Context

The existing debug dashboard (covering sessions, wizards, scheduler/poller indicators, LLM traces, and structured logs) could not surface large parts of the bot's internal state needed during incident investigation. The gaps were:

- Memo lifecycle (create / archive / promote / search)
- Recurring tasks and deferred prompts — next-fire time, last-fire outcome, pause state, skipped/alerted occurrences
- What the bot actually said to the user (reply text, target, typing heartbeat)
- Per-turn transitions (queue → dequeue → orchestrator → tool → confirmation → execution → result → reply) as one cohesive object
- Group / identity / auth context (authorized groups, group-settings target, identity mappings, file-relay turn contents)
- Tool-failure / error-analysis outcomes as first-class records
- Log cross-linking from a specific session / trace / turn / reminder

In addition, the existing `isAdminEvent` filter (passing events when `userId` was absent or matched the admin's) was insufficient for group-scoped and unscoped events. It also allowed new source modules to silently leak data by emitting unscoped events.

## Decision Drivers

1. **Observability parity**: Each subsystem (recurring, deferred, memos, identity, auth, group-settings, config-editor) must emit lifecycle events.
2. **Per-turn tracing**: A single turn ID must correlate all events from message receipt through LLM call, tool execution, confirmation gating, error handling, and reply delivery.
3. **Admin-scoped visibility**: Events must carry explicit scope (user/group/global) so the collector can default-deny and only surface data for the admin's own context and groups where the admin is a member.
4. **Zero dashboard rewrite**: Reuse existing SSE server, log buffer, and plain-DOM HTML shell.
5. **Test fidelity**: TDD hooks enforce red→green for every change; each task requires passing tests.

## Considered Options

### Option 1: External observability platform

Use Datadog, Sentry, or an OpenTelemetry collector for async trace correlation, memo state, and alert timeline.

- **Pros**: Professional toolchains, dashboards out-of-the-box, team experience from other projects.
- **Cons**: External dependency, cost, privacy concerns (LLM prompts and task content must not leave the host), network latency, no admin-scoped visibility guarantees at the query layer.
- **Verdict**: Rejected — violates self-hosted data-control requirement and would require rewriting visibility rules in the external system's query language.

### Option 2: Extend existing in-memory SSE + ring-buffer architecture (Accepted)

Build on ADR-0037's Bun.serve() / SSE / state-collector foundation. Add typed emit helpers, `turnId` correlation, admin-visibility allow-list, ring buffers, and new dashboard panels.

- **Pros**: Zero new dependencies, zero overhead when no SSE client is connected (listeners set stays empty), admin-scoped filtering at the source (collector), plain DOM means no framework bundling cost.
- **Cons**: In-memory ring buffers are ephemeral (acceptable for a debug tool), no historical persistence beyond existing SQLite.
- **Verdict**: Accepted — best fit for a self-hosted bot with strict debug-only access.

### Option 3: Add a separate analytics database

Persist every debug event to SQLite or DuckDB for rich historical queries.

- **Pros**: Persistent history, powerful ad-hoc queries with SQL/DuckDB syntax.
- **Cons**: Schema migration overhead for each new event type, disk growth, no live SSE streaming, separate persistence model for the same data.
- **Verdict**: Rejected — out of scope; the spec explicitly excluded persistent historical stores.

## Decision

Implement the **Debug Dashboard Expansion** in four mergeable phases on top of the existing debug infrastructure from ADR-0037 → ADR-0040:

1. **Phase 1 — Cross-cutting infra**: Replace bare `emit()` with scope-typed `emitUser` / `emitGroup` / `emitGlobal`, add `__scope` + optional `turnId` to the event envelope. Introduce `AdminVisibility` default-deny filter replacing `isAdminEvent`. Migrate 39 existing emit sites in 12 source files.

2. **Phase 2 — Turns, tool failures, notifications**: Mint `turnId = crypto.randomUUID()` at the message-queue flush boundary. Thread it through orchestrator, tool execution, confirmation gate, and reply tracking. Add Turn assembly with 512-entry ring buffer, Notification ring (2048) and ToolFailure ring (1024). New dashboard panels: Turns, Notifications, Tool failures.

3. **Phase 3 — Reminders and memos**: Add `recurring:*`, `deferred:*`, `memo:*` lifecycle events. Add `/recurring`, `/deferred`, `/memos` REST endpoints. New panels: Reminders, Memos.

4. **Phase 4 — Context and log cross-links**: Add identity, group-settings, config-editor, auth, and group-member events. New Context panel. Add `turnId` to structured log entries (via pino child logger) and to `/logs` query param. Cross-links from every panel row to filtered log view.

## Rationale

- **Scope-explicit events** prevent future code from silently leaking data — new emit calls must choose `emitUser`/`emitGroup`/`emitGlobal`, so the runtime filter always has a scope to evaluate.
- **Turn correlation at the message-queue boundary** is the right seam: it's where coalesced inbound messages become a single orchestrator invocation, which is also the earliest point where a UUID can bracket the entire lifecycle.
- **Default-deny filtering** at the collector is correct because the event-bus is an internal pub/sub layer; the collector's broadcast is the only data-exit point that reaches SSE clients.
- **Plain DOM** is retained intentionally — no React/Vue bundle adds KB to the dashboard and no framework reconciliation complexity is needed for a read-heavy live-debug UI.

## Consequences

### Positive

- Incident investigation now has per-turn timeline, reply content, notification history, and tool-failure classification visible in one dashboard.
- Typed emit helpers are unambiguous — every call site explicitly declares user, group, or global scope.
- Admin-scoped visibility is enforced at the data source (collector), not in the UI, preventing accidental cross-user leakage.
- Structured log lines carry `turnId` via pino child logger, enabling precise filtering with a single query parameter.
- Four mergeable phases mean incremental delivery; Phase 1 is inert (no UI change) so it can be merged safely.

### Negative

- **Event volume amplification**: Per-turn events (queue, tool request/confirm/execute, typing, reply) multiply SSE traffic under load. Mitigation: existing 500ms debounced stats broadcast; `typing:*` events are only start/stop pairs.
- **`turnId` parameter threading**: Added `turnId` to orchestrator signature and tool-execute wrappers changes many call signatures. Mitigation: default to a fresh UUID when absent so existing tests that don't care keep working.
- **REST endpoints lack 403 allow-list enforcement** (see Divergence Notes below): lazy-drill-down endpoints (`/recurring`, `/deferred`, `/memos`, `/identity`) check only `isAuthorizedRequest` (token-gate). They do not assert that the requested `userId` is within the admin's `AdminVisibility` allow-list, creating a theoretical gap if an admin token is used to query another user's data.
- **`file_relay:*` events not implemented** (see Divergence Notes below): attachment lifecycle events specified in the design spec were not emitted, so file-relay contents are not surfaced in the Context panel.
- **No persistent historical store**: In-memory ring buffers are lost on restart. This is by design but limits long-term trend analysis.

## Divergence Notes

Implementation diverged from the spec in the following ways, documented here rather than in the spec or plan (both are now archived):

| Deviation                                                           | Details                                                                                                                         | Impact                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `file_relay:*` events omitted                                       | No `file_relay:attached` / `consumed` / `dropped` emissions in any attachment module; no `/file-relay` REST endpoint            | Context panel lacks file-relay section; spec Requirement §8.2 not fully met               |
| REST endpoints lack 403 allow-list check                            | `/recurring`, `/deferred`, `/memos`, `/identity` return 400 on missing `userId` but do not return 403 for out-of-scope `userId` | Semantic gap between spec §5/§6 and implementation; security posture weaker than designed |
| `message:replied` not replaced by `reply:sent`                      | Both event types coexist; `message:replied` still emitted for back-compat, `reply:sent` is new                                  | Minor — `message:replied` carries same data; can be deprecated in future cleanup          |
| Named snapshot getters absent                                       | No `getRecurringSnapshot(vis)`, `getDeferredSnapshot(vis)`, etc. — REST handlers call source module functions directly          | REST endpoints still return data, but the snapshot abstraction layer is missing           |
| `tool:failure_classified` emitted from `llm-orchestrator-invoke.ts` | Plan specified `tool-failure.ts` as the source; actual emission is in the invoke wrapper                                        | Functionally equivalent — same event type, same payload shape                             |
| Ring-buffer tests not in standalone file                            | `ring-buffers.test.ts` from plan merged into `turn-assembly.test.ts`                                                            | Test coverage same, just file name differs                                                |
| `assertScopeAllowed` helper                                         | Spec called for `assertScopeAllowed(vis, params)`; not implemented                                                              | Replaced by implicit `userId` parameter validation; 403 enforcement missing               |
| `getAdminAllowlistSnapshot`                                         | Spec §6 listed this getter; not created                                                                                         | `listAuthorizedGroups()` used directly in `/auth/groups` handler                          |

Full divergence documentation lives in `docs/superpowers/notes/0087-debug-dashboard-expansion-divergences.md`.

## Implementation Status

Implemented (with divergence).

### Verification Evidence

| Verification           | Command                                                  | Result               |
| ---------------------- | -------------------------------------------------------- | -------------------- |
| Debug module tests     | `bun test tests/debug/`                                  | 158 pass, 0 fail     |
| Dashboard client tests | `bun test --preload tests/client-setup.ts tests/client/` | 87 pass, 0 fail      |
| Full test suite        | `bun test`                                               | 4316 pass, 0 fail    |
| Linter                 | `bun lint`                                               | 0 warnings, 0 errors |
| Type check             | `bun typecheck`                                          | clean                |

### Commits

Phase 1:

- `c49b1d71` feat(debug): add Scope type and typed emit helpers to event-bus
- `82477888` feat(debug): add AdminVisibility type and isVisibleToAdmin filter
- `b140deee` feat(debug): replace isAdminEvent with scope-based isVisibleToAdmin
- `76cb7809` feat(debug): migrate all emit sites to typed helpers

Phase 2:

- `4067dac9` feat(debug): mint turnId, emit turn:start/end and queue:\* events
- `c494772a` feat(debug): thread turnId through orchestrator, add tool/reply/typing/notify events
- `26505195` feat(debug): add Turn assembly, ring buffers, and /turns/:id endpoint
- `4c4b73f8` feat(debug): add context switcher, panel grid, Turns/Notifications/Tool-failures panels

Phase 3:

- `be36c09e` feat(debug): add recurring:_, deferred:_, memo:\* lifecycle events
- `7dc95b5a` feat(debug): add recurring/deferred/memo REST endpoints and Reminders/Memos panels

Phase 4:

- `4e09039f` feat(debug): add Context panel, turnId log filter, remove bare emit()

## Related Decisions

- ADR-0037: Debug Tracing Tool — Session 1: Event Bus + Server Skeleton
- ADR-0038: Debug Tracing Tool — Session 2: Pino Log Pipeline
- ADR-0039: Debug Tracing Tool — Session 3: Instrument Source Modules
- ADR-0040: Debug Dashboard HTML — Session 4: Live Debug Dashboard UI
- ADR-0049: Client Build Pipeline for Debug Dashboard

## Design References

- Spec: Archived at `docs/archive/2026-04-20-debug-dashboard-expansion-design.md`
- Implementation Plan: Archived at `docs/archive/2026-05-15-debug-dashboard-expansion-implementation.md`
