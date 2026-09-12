# Stage 2 — self-diagnosis tool family (chat-facing buffer readers)

## Goal

Complete issue #303: let a bot admin ask the bot, in a DM, to investigate itself. All five foundation gaps are verified in master (unconditional log ring buffer `src/logger.ts:22-25`, persistent event-derived buffers in `src/debug/state-collector.ts` wired at `src/runtime/production-deps.ts:255`, admin gate `src/tools/diagnostics.ts:143-155`, `diagnostics` tool domain, per-session visibility policy with shapers `shapeLogEntry`/`shapeLlmTrace` and ADR-0426). Stage 2 is the feature itself: extend the existing `run_diagnostics` family with read-only tools that query the always-on in-process buffers and egress them under the visibility policy, bound to the **calling admin's** identity (`MakeToolsOptions.chatUserId`), not a dashboard session.

## New tools (all `read('diagnostics')`, snake_case, one tool per file under `src/tools/`)

1. **`read_recent_logs`** (`src/tools/diagnostics-logs.ts`, `makeReadRecentLogsTool`) — queries `logBuffer` (`src/debug/log-buffer.ts`). Inputs (all `.describe()`d, explicit optionality): min `level`, `scope` substring, `turnId`, `msg` text match, `limit` (default 50, hard cap ~200). Egress mirrors the REST `/logs` route exactly: resolve `ownTurnIdsForAdmin(adminChatUserId)` once, then per entry `isOwnLogEntry(entry, adminChatUserId, ownTurnIds) ? entry : shapeLogEntry(entry)` — foreign/unattributed entries keep only structural + numeric/boolean fields. Also returns `logBuffer.stats()` (`count`/`capacity`/`oldest`/`newest`) and a `history_starts_at_process_start: true` marker so the model never invents pre-restart history. Supports a `distinct_scopes: true` mode returning `logBuffer.distinctScopes()` for orientation queries.
2. **`read_llm_traces`** (`src/tools/diagnostics-llm-traces.ts`) — queries `recentLlm` tail (`src/debug/llm-trace-collector.ts`). Inputs: `errors_only`, `model`, `limit` (default 25, hard cap ~100, sliced from the tail like `STATE_INIT_LLM_TAIL`). Every trace egresses through `shapeLlmTrace(trace, adminChatUserId)`: the admin's own traces pass verbatim; foreign/unattributed ones lose `generatedText`, `stepsDetail`, tool `args`/`result`, and identity fields, keeping model ids, durations, token/step counters, tool names, and `error`.
3. **`read_recent_turns`** (`src/tools/diagnostics-turns.ts`) — queries `recentTurns`/`inFlightTurns` + optional single-turn fetch by id via `findTurnById` (`src/debug/turn-assembly.ts`). Inputs: `status` filter (`running|ok|error|cancelled`), `turn_id`, `limit` (default 25, cap 512 = buffer capacity). Entries whose scope is not `isVisibleToAdmin(scope, clientVisibility(adminChatUserId))` are excluded from listings; a fetched foreign/unknown `turn_id` returns `{ status: 'not_found' }` — 404-not-403, no existence leak. Turn payloads are already anonymous (`TurnSchema`: timings, status, tool names/durations/failureReason, error string).
4. **`read_recent_tool_failures`** (`src/tools/diagnostics-tool-failures.ts`) — queries `recentToolFailures`; same visibility filtering as turns; `limit` (default 25, cap 1024). Returns timestamp, scope, and the whitelisted `tool:failure_classified` data fields (toolName, durationMs, ok, failureReason, turnId).

## Behavior rules (all four tools)

- **Assembly/gating**: added inside the existing `maybeAddDiagnosticsTools` (`src/tools/diagnostics.ts`) — same fail-closed gate `isBotAdmin === true && contextType === 'dm' && mode === 'normal'`; they inherit descriptor-cache keying, queue/coalescing identity carry, guest exclusion, and `/context` display-only behavior from the already-shipped `admin-gated-diagnostics-tools` requirements because they assemble at the same point from the same `MakeToolsOptions`.
- **tool_prefs**: registered in `TOOL_METADATA` (`src/tools/tool-metadata.ts`) as `read('diagnostics')`; `deny` removes, `ask` wraps per-call, implicit `allow` default — same as `run_diagnostics`.
- **Secret-free**: never tokens, API keys, cookies, decrypted config bodies; log output metadata-only (counts/limits, never entry bodies). Raw secrets can't appear in shaped foreign content by construction; own-content verbatim matches the admin's dashboard session policy (ADR-0426).
- **Read-only, structured failures**: no buffer/state mutation (never `clear()`); per-probe try/catch degrades to `probe_error` markers / structured tool-failure results per the existing wrapper (`src/tools/wrap-tool-execution.ts`), never uncaught throws.
- **Volatile buffers are stated, not hidden**: restart empties history (explicit non-goal carried from `event-derived-buffers`); the stats + marker fields make that observable to the model. Cross-restart persistence is out of scope.
- **No new capture code**: import existing exports only (`logBuffer`, `recentLlm`, `recentTurns`, `recentToolFailures`, `findTurnById`, `shapeLogEntry`, `shapeLlmTrace`, `isVisibleToAdmin`, `clientVisibility`, `ownTurnIdsForAdmin`, `isOwnLogEntry`). Do **not** import `state-collector.ts` from tools (it drags scheduler/poller snapshot machinery); import the leaf modules. If a shared query/filter helper emerges, put it as a pure function next to the buffers (DI-friendly like `DiagnosticsDeps` in `diagnostics.ts`) so tests can inject fake buffers.
- **Result size**: results flow through the existing compaction wrap (`COMPACTION_THRESHOLD_BYTES` → envelope + `expand_result`), so no bespoke truncation beyond the hard caps above.

## Files to touch

- `src/tools/diagnostics-logs.ts`, `src/tools/diagnostics-llm-traces.ts`, `src/tools/diagnostics-turns.ts`, `src/tools/diagnostics-tool-failures.ts` (new; factories `Tool`-typed per `src/tools/CLAUDE.md`, DI deps for buffer access so tests need no live capture)
- `src/tools/diagnostics.ts` — extend `maybeAddDiagnosticsTools` to assemble the family (pass `options.chatUserId` as the visibility principal)
- `src/tools/tool-metadata.ts` — four `read('diagnostics')` entries
- `src/tools/CLAUDE.md`, `docs/architecture/tools.md` — surface the family
- `tests/tools/diagnostics-logs.test.ts`, `tests/tools/diagnostics-llm-traces.test.ts`, `tests/tools/diagnostics-turns.test.ts`, `tests/tools/diagnostics-tool-failures.test.ts` (new; extend `tests/tools/diagnostics.test.ts` for assembly/gating of the whole family)

## Verification

Red-first per tool: (1) gate — family absent for non-admin/group/proactive/guest, present in admin DM normal mode; (2) shaping — foreign log entries/trace content stripped, own (matching `chatUserId` / `ownTurnIds`) verbatim, unattributed shaped; (3) foreign `turn_id` → `not_found`, no existence leak; (4) bounds/caps and stats/marker fields; (5) prefs deny/ask resolution via `TOOL_METADATA`; (6) read-only (buffers byte-identical after invocation). Then full `bun run test`, `typecheck`, `lint`, `check:full`; mutation ratchet via `test:mutate:changed` on the PR.

## Capability delta (`specs/self-diagnosis-tools/spec.md`, ADDED only)

- **Requirement: Self-diagnosis buffer readers are admin-gated** — the four reader tools assemble only under the existing admin/DM/normal gate, fail-closed, identical across platform instances, never in guest toolsets or `/context` invocation.
- **Requirement: Log egress is attribution-shaped** — own entries verbatim, foreign/unattributed entries shaped to structural + numeric/boolean fields; bulk egress resolves turn attribution once per call.
- **Requirement: LLM trace egress is attribution-shaped** — own traces verbatim; others lose generated text, step detail, tool args/results, and identity fields.
- **Requirement: Turns, notifications, and tool failures are visibility-filtered** — listings exclude invisible scopes; direct id fetch returns `not_found` for foreign/unknown ids without distinguishing them.
- **Requirement: Readers expose buffer volatility honestly** — results carry buffer stats and a process-start marker; restart clears history and the tools report empty buffers rather than erroring.
- **Requirement: Readers are read-only, secret-free, and preference-governed** — no state mutation, no secret material in results or logs, structured failures, `tool_prefs` three-state applies.

## Non-goals

Cross-restart/persistent diagnosis buffers; write/repair actions (restart, config change) — diagnosis only; group-context exposure; new dashboard surfaces (HTTP API stays as-is); notification-buffer reader (fold in later if admins ask for it).
