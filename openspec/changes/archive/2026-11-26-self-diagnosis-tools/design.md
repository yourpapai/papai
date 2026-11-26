## Context

Stage 1 landed every foundation this feature reads: the unconditional log ring buffer with its anonymity-safe shaper (`src/debug/log-buffer.ts`), the persistent event-derived buffers (`recentLlm`, `recentTurns`, `recentToolFailures`, `inFlightTurns`, `findTurnById` in `src/debug/llm-trace-collector.ts` / `turn-assembly.ts`), the per-admin visibility policy (`src/debug/visibility.ts`: `isVisibleToAdmin`, `clientVisibility`, `ownTurnIdsForAdmin`, `isOwnLogEntry`), the trace shaper (`shapeLlmTrace`), and the admin-gated assembly point `maybeAddDiagnosticsTools` (`src/tools/diagnostics.ts:143`) with its `read('diagnostics')` metadata entry. The REST/SSE dashboard surfaces already egress these buffers under ADR-0426, and their order of operations is normative: `handleLogs` shapes every entry for the session admin first, then filters post-shaping content (`src/debug/log-routes.ts:29-31`) so a text filter can never probe stripped foreign content. See `proposal.md` for motivation and the capability delta; see `specs/self-diagnosis-tools/spec.md` for the normative requirements this design implements.

## Goals / Non-Goals

**Goals:**

- Chat egress that is byte-for-byte governed by the same shaping/attribution code paths as the dashboard REST routes, so the two surfaces cannot drift.
- Tool factories testable with injected fake buffers — no live event capture, no `mock.module()`.
- Zero new capture code, zero schema/persistence changes, zero new dependencies.

**Non-Goals:**

- No changes to the dashboard HTTP API or its payloads — chat readers are a parallel consumer of the same buffers.
- No new visibility semantics: chat inherits the ADR-0426 per-admin policy exactly as the dashboard session policy defines it.
- No paging/cursor protocol — hard caps plus the existing compaction/`expand_result` envelope handle bulk results.

## Decisions

### 1. Assemble inside `maybeAddDiagnosticsTools`; visibility principal is `MakeToolsOptions.chatUserId`

The four factories mount at the existing assembly point in `src/tools/diagnostics.ts`, right beside `run_diagnostics`, passing `options.chatUserId` as the visibility principal (dashboard sessions use their `adminUserId`; the chat equivalent is the calling admin's real chat actor id). This inherits, unchanged: the fail-closed gate (`isBotAdmin === true && contextType === 'dm' && mode === 'normal'`, with `mode` normalized the same way), descriptor-cache keying (admin-scoped cache variants already exist), queue/coalescing identity carry, guest exclusion, and `/context` display-only behavior.

Binding the principal at assembly time via closure is safe here: these tools only assemble in a DM, whose `storageContextId` is the admin's own DM context with that same admin's `chatUserId` — closure state can never disagree with the cache key. Group threads never assemble the family, so the thread-vs-config scope split is irrelevant to these tools.

*Alternatives:* a separate `maybeAddBufferReaderTools` builder would duplicate the gate and drift from `run_diagnostics`; resolving the principal per-call from `ToolExecutionOptions.context` fights the descriptor cache for no benefit.

### 2. Import leaf `src/debug/*` modules — never `state-collector.ts`

Every needed export already lives in (or is re-exported through) leaf modules: `logBuffer`/`shapeLogEntry`, `shapeLlmTrace`/`recentLlm`, `recentTurns`/`recentToolFailures`/`inFlightTurns`/`findTurnById`, and the four visibility helpers. Importing `state-collector.ts` instead would drag the scheduler/poller snapshot machinery and the SSE client registry into the tool module graph and couple tool tests to collector startup. Two tiny leaf changes support the stats surface (decision 6): export the capacity constants (`RECENT_TURNS_CAPACITY`, `RECENT_TOOL_FAILURES_CAPACITY`, `LLM_TRACE_CAPACITY`) so tools report capacity from a single source of truth instead of hardcoding duplicates. No shared query helper is warranted yet; if one emerges, it goes next to the buffers as a pure function, `DiagnosticsDeps`-style.

### 3. Egress pipeline: shape first, filter second, with the shared filter model

`read_recent_logs` mirrors `handleLogs` exactly: resolve `ownTurnIdsForAdmin(chatUserId)` once per call (O(turns), not O(entries×turns)), shape every entry (`isOwnLogEntry(...) ? entry : shapeLogEntry(entry)`), then apply the caller's filters to the **post-shaping** entries, then slice to the limit. This ordering is a security property, not a style choice: filtering raw entries before shaping would let a `msg` text filter act as a boolean oracle for content that was stripped from foreign entries. Filters reuse the existing `LogFilter`/`entryMatchesFilter`/`matchesScope` model from `src/debug/log-filter-model.ts` — the tool constructs a `LogFilter` structurally from its Zod inputs (scope substring → single include pattern; `msg` match → `q`; plus level/turnId) rather than going through the URLSearchParams parser. `distinct_scopes: true` short-circuits to `logBuffer.distinctScopes()`, matching `handleLogScopes`.

LLM traces follow the same shape-then-filter order through `shapeLlmTrace(trace, chatUserId)`, sliced from the tail like `STATE_INIT_LLM_TAIL` in the dashboard init frame.

### 4. Visibility filtering and the no-existence-leak fetch

Turn and tool-failure listings filter with `isVisibleToAdmin(scope, clientVisibility(chatUserId))` — identical to `buildInitData` in the collector. A single-turn fetch by id checks visibility after `findTurnById` and returns `{ status: 'not_found' }` for foreign, invisible, and unknown ids alike — the same 404-not-403 contract as `get_message`/`get_message_context`. Missing/empty `chatUserId` fails safe through the existing policy functions: `clientVisibility(undefined)` yields empty visibility and `isOwnLogEntry` with an undefined admin returns false, so everything is shaped or filtered out — fail closed, never fail open, with no bespoke guard needed.

### 5. Per-tool DI deps; one tool per file; factories return `Tool`

Each new file exports `make<Name>Tool(deps)` where `deps` is a `Partial<Readonly<{...}>>` of buffer-access lambdas resolved against the real leaf-module accessors by default, copying the `DiagnosticsDeps`/`resolveDeps`/`runProbe` pattern already proven in `diagnostics.ts` — including per-probe try/catch degrading to the `probe_error` marker so a throwing probe never escalates to an uncaught throw (the finalize wrapper remains the backstop). Tests inject fake buffers through the deps object, per the repo's DI-over-`mock.module()` preference. One tool per file is the `src/tools/CLAUDE.md` naming rule and keeps every file far under `max-lines` as `diagnostics.ts` grows by only the four assembly lines.

### 6. Volatility surface: stats and the process-start marker

Every result carries the queried buffer's stats. Logs use `logBuffer.stats()` (count/capacity/oldest/newest) plus `history_starts_at_process_start: true`. The array-backed buffers have no `stats()` accessor, so the tools derive count/capacity/oldest-newest structurally from the array and the newly exported capacity constants (decision 2) — a derived, read-only view; no buffer module changes beyond the constant exports. Empty-after-restart falls out naturally: zero counts, `null` bounds, successful completion.

### 7. Gating and `tool_prefs` impact

The four names register in `TOOL_METADATA` as `read('diagnostics')` alongside `run_diagnostics`. Consequences, all inherited rather than rebuilt: implicit `allow` default; `deny` removes the tool from the `ToolSet` via the final `applyToolPreferences` pass in `makeTools()`; `ask` wraps each call so the admin gets the confirmation flow (approve → execute, decline → structured `permission_denied` result); the settings-UI presets' diagnostics-domain defaults apply unchanged; the analytics classifier already maps the `diagnostics` domain. No provider-capability checks are involved — exposure is governed solely by the admin gate, like `run_diagnostics`. The risk tier stays `read`, so no preset or risk-default semantics shift.

**Scope-model impact:** no new persisted state of any kind — the tools read volatile in-process buffers and persist nothing keyed by storage context, config context, platform instance, or user. `tool_prefs` resolution keys on the admin's DM `storageContextId` exactly as for every other tool.

**DB impact:** none — no drizzle migration, no backfill.

**New dependencies:** none — buffers, shapers, visibility policy, filter model, compaction, and confirmation machinery all exist in-repo; the AI SDK `tool()` factory plus Zod cover the rest.

### 8. Result size: hard caps, then the existing compaction wrap

Limits: logs default 50 / cap 200; traces default 25 / cap 100; turns default 25 / cap 512 (= turn buffer capacity); tool failures default 25 / cap 1024 (= failure buffer capacity). Oversized limits clamp to the cap without error. Beyond the caps, `applyResultCompaction` (threshold → envelope + `expand_result`) owns bulk handling; the tools add no bespoke truncation.

### 9. Metadata-only logging

Tool logs carry counts, limits, and filter presence — never entry bodies, never shaped or raw buffer content — matching the `run_diagnostics` convention and the never-log-secrets policy. Secret-freeness of results is by construction: foreign content is shaped by the shared shapers (which drop non-numeric free text), and own content verbatim matches the admin's dashboard-session policy.

## Risks / Trade-offs

- [Chat egress can be much larger than a dashboard page] → hard caps bound the worst case; compaction + `expand_result` page anything over the threshold; the model, not the tool, decides whether to expand.
- [An attribution mistake leaks foreign content verbatim] → reuse the exact functions the REST route uses (shared code path, shared test coverage); per-tool tests mirror the route's own/foreign/unattributed parity cases; missing `chatUserId` degrades to shape-all/filter-all via the existing fail-safe semantics.
- [Filter-order drift between chat and REST re-opens the probing oracle] → decision 3 pins both to shape-then-filter; a test asserts a text filter cannot match content that shaping strips.
- [Model misreads an empty buffer as "no events ever"] → stats plus the process-start marker make volatile emptiness explicit (spec: buffer-volatility requirement).
- [Descriptor cache serves a pre-upgrade toolset after deploy] → unavoidable and already true of `run_diagnostics`; cache invalidation carries the new names with no code change since the assembly point is unchanged.
- [Coupling tools to buffer internals] → acceptable: those exports are already `@public` and consumed by the server routes; the only leaf edits are constant exports.

## Migration Plan

Single deploy: the four tools are additive, assemble behind the existing gate, touch no schema or stored data, and appear only in bot-admin DMs in normal mode. No feature flag is needed — exposure is already scoped to admins by the gate. Rollback is reverting the commit; there is no state to clean up, since the buffers are in-process and volatile by design.

## Hook / TDD Interactions

All new `src/tools/` and `tests/tools/` files pass through the Write/Edit TDD hook pipeline (red first: the failing test file must exist before the implementation file may be written). Order of work: per tool — `tests/tools/diagnostics-logs.test.ts` red → `src/tools/diagnostics-logs.ts` green — then the same for llm-traces, turns, tool-failures; then extend `tests/tools/diagnostics.test.ts` with family assembly/gating cases before extending `maybeAddDiagnosticsTools` and the four `TOOL_METADATA` entries (their pref-resolution tests come with the metadata change). Docs (`src/tools/CLAUDE.md`, `docs/architecture/tools.md`) ride last. Use `bun run test:affected` in the loop; the full suite, `check:full`, and the mutation ratchet close the change per the proposal's verification section.
