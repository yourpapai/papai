# Design — Deferred-prompt proof checks (admin-runnable e2e probes)

See proposal.md — Why for motivation and the check catalogue; this document pins the HOW: seams, storage, gating, and test order. `skip_specs: true` — this change adds no capability deltas; everything here is disposable internal tooling.

## Context

- The five bugs reproduce only against the real pipeline (LLM turn, delivery, poller timing); the checks run e2e in prod and record verdicts. They must be **pass-before-fixes-is-fail**: against master each check records `fail`; after change 2's per-bug fixes, `pass`.
- Substrate already in master and reused, not rebuilt: the fail-closed admin gate `maybeAddDiagnosticsTools` (`src/tools/diagnostics.ts:179` — `isBotAdmin === true && contextType === 'dm' && mode === 'normal'`); the in-memory diagnosis buffers (`recentLlm` in `src/debug/llm-trace-collector.ts`, log buffer) with attribution-shaped egress (`shapeLlmTrace`, `ownTurnIdsForAdmin`); the debug event bus (`src/debug/event-bus.ts`) emitting `deferred:created/updated/cancelled/fired` — and `deferred:alerted` on the alert lane (`src/deferred-prompts/poller-alerts.ts:63`, with `lastTriggeredAt` on the alert row, not `deferred:fired`); the scheduled delivery seam at `src/deferred-prompts/poller.ts:68`.
- Constraints that shape the design: the infrastructure is disposable (deleted by change 2's final MR), must not change any end-user-observable behavior, must tolerate LLM nondeterminism (verdicts degrade to recorded outcomes, never throw), and results must stay re-readable from chat across a bot restart during a verification session.

## Goals / Non-Goals

**Goals:**

- One admin chat surface that runs all five checks e2e against the real pipeline, with recorded, re-readable results.
- Zero durable schema footprint: nothing enters SQLite; the store is removable with the module.
- Exposure identical to the diagnostics family: same fail-closed gate, no new prefs surface, no analytics surface change.
- Fully DI-testable async observation (fake clock/timers/event bus/handlers); isolation-clean tests with no wall-clock assertions.

**Non-Goals:**

- Fixing any of the five bugs (change 2).
- Instrumenting the alert delivery path (`poller-alerts.ts:109`): the optional `alert` variant observes via events + row reads only; no second prod-path touch.
- Dashboard/UI representation of proof results; durable storage beyond the capped JSONL; group-context or non-admin exposure.

## Decisions

### D1 — Assemble under the existing diagnostics gate

Both tools are built inside `maybeAddDiagnosticsTools`, inheriting the proven fail-closed gate (`isBotAdmin === true && contextType === 'dm' && mode === 'normal'`) and the existing admin-scoped descriptor-cache variant — no cache-key change, and the degraded `/context` fallback listing stays display-only. Alternatives rejected: a new gate (duplicates an invariant this change must not weaken) and a `/proof` chat command (commands are not the tool surface and get no recording/descriptor-cache integration).

### D2 — Tool surface, registrations, and tool-prefs impact

- `run_proof_check` (`src/tools/proof-check-run.ts`, factory `makeRunProofCheckTool`): inputs `check` (enum of the five ids, every value `.describe()`d), `variant?`, `wait_seconds?` (observation-window cap), `cleanup?` (boolean; sweeps leftover proof prompts instead of running a check — mutually exclusive with `check`). Sync checks return the finished record inline; async checks return `{ status: 'started', run_id }` and complete in the background.
- `read_proof_results` (`src/tools/proof-checks-read.ts`, factory `makeReadProofResultsTool`): `run_id?` filter, `limit?`; default lists the most recent runs with verdicts.
- Registrations in `src/tools/tool-metadata.ts`: runner `write('diagnostics', 'create')` (it creates real prompts and spends LLM tokens), reader `read('diagnostics')`.
- **Prefs impact:** `applyToolPreferences` runs after assembly, so prefs still govern the exposed tools — implicit default `allow`; the sticky settings-UI presets are risk-keyed, so a preset denying write-risk removes the runner from the admin's own set (intended; the runbook requires diagnostics-domain write allowed), and `ask` wraps each run in the confirmation flow. No new domain, so `src/analytics/tool-classification.ts` needs nothing. Guests are excluded **structurally** (the gate requires a bot admin in a DM; the hardcoded guest toolset never assembles these), not by prefs.
- The runner calls `executeCreate/executeUpdate/executeGet/executeCancel` as direct handler invocations, not tool executions — `tool_prefs` gate the exposed surface only, never these nested calls.
- Assembly binds `options.storageContextId`/`options.chatUserId` at assembly time (the readers' established pattern, safe under the gate). If the bound ids are empty the runner's execute degrades to a structured error result — mirrors the diagnostics `probe_error` philosophy.

### D3 — Marker namespace instead of a schema flag

Proof prompts carry a `[[proof-check:<runId>]]` prefix in the prompt text (`runId = crypto.randomUUID()`), plus a marker sentence embedding the runId in the `delivery_brief` (the executing LLM echoes it verbatim in a single no-tool turn — cheap, deterministic, delivery fidelity measurable). Why text markers over a DB column or a `proof` type: the proof prompt must be indistinguishable from a real one to the pipeline under test — no schema change, no behavior branch; the marker rides fields the pipeline already reads. Sweep/cleanup matches the prefix within the admin's own storage context only; collision with user-authored text is a UUID token, effectively impossible, and ownership is always filtered.

### D4 — Scope model: which ids key the new state

- Proof prompts are created with exactly the bindings `addDeferredPromptTools` uses for `create_reminder` in the admin's DM (`src/tools/deferred-tools-builder.ts`): owner id = `options.storageContextId`, delivery ctx `{ userId: options.chatUserId, storageContextId, contextType: 'dm' }`. They persist in the existing `scheduled_prompts`/`alert_prompts` rows — `created_by_user_id` / `delivery_context_id` = the admin's thread-scoped DM storage context (thread scope per `ENTITY_SCOPES` in `src/chat/context-scope.ts`). No new ids and no new tables are introduced; config context is only read (timezone, locale).
- The JSONL store is process-global and deliberately unkeyed: the gate guarantees a single admin principal, records carry `run_id`/`check`/`variant` plus admin-own observations only (proof prompt ids, proof-run texts, timestamps, deltas) — never other users' content, never secrets. The in-flight lock is module state; a restart mid-window is healed by the sweep (D8). `platformInstanceId` is not persisted by the checks — delivery resolves through the poller's existing `resolveProactivePlatformInstanceId`.

### D5 — Store: capped JSONL, not drizzle, not memory

`src/deferred-prompts/proof-store.ts` — append-only JSONL at `dirname(DB_PATH ?? 'papai.db')/proof-checks.jsonl` (mirrors `getDbPath` in `src/db/index.ts`), capped to the last ~50 runs (trim = write-temp + atomic rename), a single-writer promise chain serializing appends, and DI of `{ path, now }` so tests inject temp dirs. One record per run: `{ run_id, check, variant, started_at, finished_at, verdict: 'pass'|'fail'|'inconclusive'|'pending', observations[] }`.

- Existing-module check: the diagnosis buffers (`src/debug/log-buffer.ts`, `llm-trace-collector.ts`) are in-memory and volatile — a restart mid-verification would lose results; no durable diagnostics store exists today, so none covers this need.
- Why not a drizzle table: disposable infra would need migration 084 **plus** a teardown migration plus a no-op backfill, all reverted in change 2's final MR; the JSONL file is created lazily on first append and deleted with the module. There are **no DB changes and no backfill** in this change.

### D6 — Runner: single-flight lock, sync/async contract, DI seams

`src/deferred-prompts/proof-checks.ts` exports a `PROOF_CHECKS` registry (id → `{ kind: 'sync' | 'async', variants, run }`) and `runProofCheck(deps, input)`; a module-level lock yields a structured `busy` result for a second concurrent async run (one at a time, process-wide, across assembly instances).

- Sync checks (bug 4, bug 5) execute inline: the proof prompt is future-dated (`validateFutureFireAt` enforces strictly future, so `getScheduledPromptsDue` cannot pick it up mid-check) and cancelled immediately after the observation.
- Async checks: background observation via a DI-injectable timer plus event-bus subscription — `deferred:fired` **and** `deferred:alerted` (the alert lane emits the latter, `poller-alerts.ts:63`), filtered to `scope.kind === 'user'` with `data.promptId` matching the proof prompt, with `unsubscribe` guaranteed in teardown (no listener leak). Signals are dual: events plus row reads (`getScheduledPrompt.lastExecutedAt` / `getAlertPrompt.lastTriggeredAt`) at window close, so a missed event still yields a verdict.
- Window: default ≈ 2× the lane's poll interval (`SCHEDULED_POLL_MS` = 60 s → ~2 min; the alert variant ≈ 2× `ALERT_POLL_MS` = 10 min), hard cap 15 min, `wait_seconds` caps it. fire_at is derived from the effective window so a healthy pipeline fires inside it (≈ now + 90 s) — **except** bug 3, which pins fire_at ≈ now + 10 min so a correct pipeline never fires inside the window. Guaranteed teardown on completion/timeout/error: cancel the proof prompt, unsubscribe, append the final record; every caught failure appends an `inconclusive`/`pending` record — never an uncaught throw from a detached continuation.
- `ProofCheckDeps` (all injectable): `{ now, setTimeout, clearTimeout, subscribe, unsubscribe, executeCreate/executeUpdate/executeGet/executeCancel + alert variants, listScheduledPrompts/listAlertPrompts, getScheduledPrompt/getAlertPrompt, store, readRecentLlm, readCachedHistory }`. Tests inject fakes and poll for conditions (repo rule: no fixed-wall-clock timing assertions).

### D7 — Per-check observation points and verdict predicates

| Check | Observation | `fail` iff |
| --- | --- | --- |
| `bug4_create_response_mode` (sync) | real `executeCreate` → record returned `CreateResult` keys → cancel | `execution` / `execution.mode` absent |
| `bug5_update_preserves_prompt` (sync) | create → real `executeUpdate` with `prompt: ""` + changed `execution` → real `executeGet` → cancel; record stored text before/after | stored text was wiped |
| `bug3_fires_on_creation` (async, fire_at ≈ +10 min) | every observed execution ts (`deferred:fired` events + `lastExecutedAt`) | any execution before `fireAt` |
| `bug3_fires_on_creation` `variant: 'alert'` | create an alert matching a pre-existing task; `deferred:alerted` + `lastTriggeredAt` (first-poll semantics) | any execution inside the window; raw observations recorded for the change-2 lane decision |
| `bug2_context_time` (async) | the run's own trace (`recentLlm`, attribution + timestamp window after fire) identifies the run; the `<current_time>` anchor is read from the message stream the run consumed — `getCachedHistory(storageContextId)` at fire time, last `<current_time>` tag (the orchestrator bakes the tag into persisted history messages, `llm-orchestrator-attachments.ts:172`; the proactive trigger's user message carries none, `proactive-trigger.ts` `userLines`) | \|delta\| vs the real fire clock exceeds the tolerance (2× poll interval, recorded per run); no tag in history → `inconclusive` |
| `bug1_delivery_matches_execution` (async; `no_tools` \| `with_tool_probe`) | (a) the run's own trace: `generatedText`, `finishReason`, per-tool-call success flags; (b) the actually delivered markdown from the D9 delivery record | delivered text is the localized `completion.doneFallback` stub while the trace shows non-empty text with `finishReason: 'stop'` (and, in `no_tools`, no tool-failure cut), or the delivered text differs from the execution result; the stub wording is recorded verbatim for the fix reviewer, resolved from the dictionary for the run's locale at run time (no hardcoded string) |

Note on bug 2: the LLM trace does not carry input messages (`stepsDetail` holds per-step output only), so the anchor is read from the cached history the run replays — the same source `buildFullMessages` consumes. The trace still correlates the run (attribution + window) and powers bug 1's leg.

### D8 — Cleanup guarantees

Leftover proof prompts are cancelled (a) at the start of every run — list active scheduled + alert prompts owned by the admin's storage context, filter the `[[proof-check:` prefix, `executeCancel` each — and (b) via the explicit `cleanup` input, which returns the cancelled ids. The same sweep is the teardown safety net on window end/timeout/error and heals orphans left by a restart mid-window (the prompt is future-dated, so it can also be cancelled as an ordinary reminder).

### D9 — The one deliberate prod-path touch: poller delivery record

In `src/deferred-prompts/poller.ts`, immediately after `sendProactiveMessage` resolves `true` (line 68), when **every** prompt in the delivery group carries the marker, append `{ runId, responseText, delivered: true, at }` to the proof store (`runId` parsed from the marker). Pure record — never alters the message, the target, or control flow; mixed proof+real groups skip recording (a merged response cannot be attributed); the error-path delivery at line 61 is deliberately not instrumented (a thrown dispatch is a different failure mode, not bug 1's "good text discarded"). Marked as disposable instrumentation in a comment; deleted with the module.

### D10 — `with_tool_probe` mechanics

The delivery brief instructs one `web_fetch` call against a reserved loopback URL: the SSRF guard (`src/web/safe-fetch.ts` blockedHost for loopback/private ranges) throws deterministically before any network I/O, and the outer wrapper converts the throw into a structured tool-failure — exactly the leg bug 1 needs. Cost: one web-fetch quota slot (quota is enforced before the host check, `src/web/fetch-extract.ts:240`), from the admin's own per-user quota. A dedicated failing tool was rejected: adding a tool to the proactive set would alter the very surface under test.

### D11 — No new dependencies

`node:fs` (Bun runtime) for the JSONL store, Zod for input schemas, the AI SDK `tool()` factory, and the existing event bus, handlers, and buffers cover everything; timers are DI'd stdlib. Neither AI SDK, Grammy, discord.js, Zod, nor drizzle can be stretched to cover durable capped JSONL recording (drizzle is deliberately excluded, D5) — nothing new is added.

### D12 — TDD hook pipeline and test-first order

All four new `src/` modules plus the three modified files (`diagnostics.ts`, `tool-metadata.ts`, `poller.ts`) are gateable impl files (`isGateableImplFile`): the Write/Edit pipeline's write-policy gate, test-first nudge, test tracker, and import gate all apply. Test-first order (write the failing tests first so the tracker marks coverage before each impl write; the import gate requires each test file to import its impl module):

1. `tests/deferred-prompts/proof-store.test.ts` (append / cap / reload / DI temp path) → `src/deferred-prompts/proof-store.ts`.
2. `tests/deferred-prompts/proof-checks.test.ts` (runner plumbing with fake clock/timers/event bus/handlers; cleanup guarantees; the delivery-record observation exercised through the poller seam) → `src/deferred-prompts/proof-checks.ts` + the poller record line.
3. `tests/tools/proof-checks.test.ts` (gate matrix: absent for non-admin / group / proactive / guest, present in admin DM normal mode; inline vs `started` semantics; `busy` lock) → the two tool files, the `diagnostics.ts` assembly, and the `tool-metadata.ts` registrations.

The nudge is advisory; the hard CI gate is the mutation ratchet — the new files get seeded on the PR (`test:mutate:changed --update-baseline`), and `poller.ts` is judged against its existing floor, so the record line must be covered by the new tests.

## Risks / Trade-offs

- [Executed LLM ignores the brief (calls tools, doesn't echo the marker sentence)] → verdicts degrade to `inconclusive` with full observations; marker-echo presence is checked before any comparison; the brief is phrased imperatively and bounded to one no-tool turn.
- [Restart/crash mid-window orphans an active proof prompt] → future-dated prompt + sweep-by-marker at every run start + explicit `cleanup`; the orphan remains an ordinary cancellable reminder.
- [Marker collision with user-authored prompt text] → UUID-embedded reserved token + ownership filter (admin's own rows only); practically impossible.
- [Async runs spend real LLM tokens in prod] → single-flight lock, single-turn no-tool briefs, bounded window; at most one in-flight run.
- [The poller seam touches a hot, mutation-measured file] → one marker-gated pure-record line; `poller.ts` is ratchet-gated on the PR; the line never alters delivery.
- [Trace buffer is volatile (cap 65535) and lost on restart] → the observation window reads traces immediately after fire; row reads (`lastExecutedAt`/`lastTriggeredAt`) are the fallback signal.
- [`doneFallback` wording or locale drift breaks stub detection] → the dictionary is resolved at run time for the run's locale; the recorded stub wording is evidence, not an assertion constant.
- [Alert-variant early fire is arguably intended semantics (baseline-on-create)] → the check only records evidence and timestamps; the semantic decision belongs to change 2 per the handoff prompt.

## Migration Plan

- No DB migration and no backfill: nothing enters SQLite; the JSONL store is created lazily on first append and holds inert, admin-own data.
- Deploy: ordinary MR — the surface appears only for a bot admin in their own DM in normal mode. Rollback: revert the MR; any leftover proof prompt is an ordinary future-dated reminder (cancel via `cleanup`, the next run's sweep, or `cancel_reminder`); the JSONL file can simply be deleted.
- Removal (change 2's final MR, after all five checks record `pass` in prod): delete the four modules, the two `tool-metadata.ts` registrations, the `maybeAddDiagnosticsTools` assembly lines, the poller record line, the three test files, the two disposable doc bullets (`src/tools/CLAUDE.md`, `docs/architecture/tools.md`), and the JSONL file. No data migration; the ratchet baseline entries disappear with the files.

## Open Questions

None — window constants, the probe URL class, the bug-2 tolerance, and the verdict predicates are pinned above; the only remaining choice (exact marker-sentence wording) is an implementation detail that cannot change the approach or the task breakdown.
