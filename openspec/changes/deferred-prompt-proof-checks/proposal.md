# Deferred-prompt proof checks — admin-runnable e2e probes from chat (issue #397, change 1 of 2)

## Goal

Split the issue-#397 work into two changes, per maintainer decision. **This change** adds internal infrastructure that lets the **bot admin prove each of the five deferred-prompt bugs in production, e2e, from chat directly**, with results **recorded** and re-readable from chat. The checks are **disposable**: they exist to demonstrate the bugs live (before fixes) and to verify the fixes in prod (after); a final MR removes them. No bug-fix behavior changes here — the five bugs stay exactly as they are; the checks must *pass-before-fixes-is-fail* (each check's recorded verdict is expected to be `fail` against master and `pass` after its fix).

Substrate already in master and reused, not rebuilt: admin-gated diagnostics assembly (`src/tools/diagnostics.ts:179` — `isBotAdmin === true && contextType === 'dm' && mode === 'normal'`, fail-closed), the diagnosis buffers/trace collector (`src/debug/llm-trace-collector.ts`, `log-buffer.ts`), the debug event bus (`src/debug/event-bus.ts` — `deferred:created/updated/cancelled/fired` via `emitUser`), and attribution-shaped own-content egress (`shapeLlmTrace`, `ownTurnIdsForAdmin`).

## Interface (chat-facing)

Two new tools assembled inside `maybeAddDiagnosticsTools` (same gate, same descriptor-cache keying, guest-excluded, never in proactive or `/context`):

- **`run_proof_check`** (one per file: `src/tools/proof-check-run.ts`) — inputs: `check` (enum, `.describe()`d), `variant?` (for bug 1: `no_tools` | `with_tool_probe`), `wait_seconds?` (observation window cap for async checks, default ~2× `SCHEDULED_POLL_MS`, hard cap ~15 min). Sync checks return the finished record inline; async checks return `{ status: 'started', run_id }` and complete in background. Second run while one is in flight → structured `busy` result (module-level lock, one async run at a time).
- **`read_proof_results`** (`src/tools/proof-checks-read.ts`) — read recorded runs from the store; `run_id?` filter, default lists the most recent runs with verdicts.

Both registered in `src/tools/tool-metadata.ts` under the existing `diagnostics` domain: the runner at a non-`read` risk tier (it creates real prompts and spends LLM tokens), the reader as `read('diagnostics')`.

## Check catalogue (check id → bug it proves)

All checks create proof prompts **in the admin's own DM storage context** (delivery lands in the admin's own DM), each prompt text carrying a reserved marker `[[proof-check:<runId>]]` prefix, and a `delivery_brief` instructing the executing LLM to echo a unique marker sentence verbatim in a single no-tool turn (so the execution is cheap, deterministic, and delivery fidelity is measurable). Leftover proof prompts are cancelled at the start of every run (list by marker) and via an explicit `cleanup` input.

1. **`bug4_create_response_mode`** (sync) — calls the real `executeCreate` handler (`src/deferred-prompts/tool-handlers.ts:167`) with a future-dated one-shot schedule, then cancels. Record: returned `CreateResult` keys; verdict `fail` iff `execution` / `execution.mode` is absent. Proves bug 4.
2. **`bug5_update_preserves_prompt`** (sync) — create → real `executeUpdate` with `prompt: ""` plus a changed `execution` field → real `executeGet` → cancel. Record: stored prompt text before/after; verdict `fail` iff the text was wiped. Proves bug 5.
3. **`bug3_fires_on_creation`** (async) — create a scheduled prompt with `fire_at` clearly in the future (well past `validateFutureFireAt`, e.g. +10 min), record `createdAt`/`fireAt`; observe via the `deferred:fired` event (filtered to the proof prompt id) and `getScheduledPrompt` status/`lastExecutedAt` over the bounded window; cancel at window end if unfired. Record every observed execution timestamp; verdict `fail` iff any execution happens before `fireAt`. Proves bug 3 (covers both suspected mechanisms: stale-clock `fire_at` stored at creation and alert-path first-poll firing — the latter optionally as a `variant: 'alert'` run matching a pre-existing task).
4. **`bug2_context_time`** (async) — rides a fired proof run: after the proactive execution, read the run's own LLM trace (`recentLlm`, `src/debug/llm-trace-collector.ts`; proactive turns are attributed to the admin, so own-content egress applies) and extract the `<current_time>` tag from the built user message; compare against the real clock at fire. Record both plus the delta; verdict `fail` iff |delta| exceeds a stated tolerance. Proves bug 2.
5. **`bug1_delivery_matches_execution`** (async; `variant: no_tools` isolates the delivery seam, `with_tool_probe` forces a tool step to reproduce the tool-failure leg) — after fire, record (a) the proactive run's `generatedText`, `finishReason`, and tool-failure flag from its own trace, and (b) the **actually delivered** markdown. Verdict `fail` iff delivered text is the neutral-fallback stub (i18n `completion.doneFallback`) while the trace shows non-empty text and no pending-tool-cut (`finishReason: 'stop'`), or iff the delivered text differs from the execution result; also records the stub wording so the fix reviewer can check it states *what the bot tried*. Proves bug 1.

## Recording results

- **`src/deferred-prompts/proof-store.ts`** (new) — append-only JSONL store under the runtime data directory (same directory convention as the SQLite db), capped to the last ~50 runs, DI-friendly (tests inject a temp path). One record per run: `{ run_id, check, variant, started_at, finished_at, verdict: 'pass'|'fail'|'inconclusive'|'pending', observations[] }` — timestamps, prompt ids, observed texts/keys, deltas. Admin's own data only; no other users' content, no secrets.
- **Delivery observation point (the one deliberate prod-path touch):** in the scheduled delivery seam `src/deferred-prompts/poller.ts:68` (after `dispatchExecution` output meets `sendProactiveMessage`), when the executed prompt text carries the proof marker, record `{ responseText, delivered, at }` into the proof store. Pure record — never alters the message, the target, or control flow; explicitly marked as disposable instrumentation to be deleted with the module. (Alert path `poller-alerts.ts:109` is out of scope unless the `alert` variant is added.)
- **Async runner plumbing** (`src/deferred-prompts/proof-checks.ts`) — background observation via DI-injectable timer + event-bus subscription, bounded window, guaranteed cleanup (`cancelScheduledPrompt`) on completion, timeout, and error paths; every failure degrades to a recorded `inconclusive`/`pending` record, never an uncaught throw.

## Files to touch

- New: `src/tools/proof-check-run.ts`, `src/tools/proof-checks-read.ts`, `src/deferred-prompts/proof-checks.ts`, `src/deferred-prompts/proof-store.ts`
- Modified (minimal): `src/tools/diagnostics.ts` (assemble the two tools in `maybeAddDiagnosticsTools`), `src/tools/tool-metadata.ts` (two registrations), `src/deferred-prompts/poller.ts` (marker-gated pure-record line at the delivery seam), `src/tools/CLAUDE.md` + `docs/architecture/tools.md` (one bullet each, marked disposable)
- Tests: `tests/tools/proof-checks.test.ts` (gate: absent for non-admin/group/proactive/guest, present in admin DM normal mode; inline vs started semantics; busy lock), `tests/deferred-prompts/proof-checks.test.ts` (check logic with fake clock/timers/event bus and fake handlers for runner plumbing; cleanup guarantees), `tests/deferred-prompts/proof-store.test.ts` (append/cap/reload)

## Intended behaviour change

None for end users: the toolset only changes for a bot admin in their own DM in normal mode (two new tools). No deferred-prompt pipeline behavior changes except the marker-gated record line, which is write-only observation. Verification per repo TDD hooks (red-first for gate/store/runner logic), `bun run test:affected` in the loop, full `bun run test` + `bun check:full` before finish, mutation ratchet via `test:mutate:changed` on the PR.

**Manual e2e runbook (the actual proof, recorded in the change log):** admin DMs the bot "run proof check bug4_create_response_mode" etc.; each run's verdict is read back from chat and pasted into the issue — expected against master: bug1 fail (stub delivered while generatedText non-empty), bug2 fail (time skew), bug3 fail (early fire), bug4 fail (mode missing), bug5 fail (text wiped). After change 2's fixes, the same checks record `pass`.

## Capabilities

None — skip_specs proposed because the proof checks are disposable internal diagnostic tooling intended for removal once the deferred-prompt fixes land; no durable downstream-observable system contract is added, changed, or removed.

## Non-goals

Fixing any of the five bugs (change 2); durable/persistent diagnostics storage beyond the capped JSONL; group-context or non-admin exposure; removing the checks inside this change (final MR of change 2 deletes the module, tool registrations, and the poller record line).

---

## Handoff prompt for the second change (paste into a new session)

> /opsx:explore — **Change 2 of issue #397: fix the five deferred-prompt bugs.** Prerequisite: change `deferred-prompt-proof-checks` (admin-runnable e2e proof checks, change 1) — its checks are the in-prod verification harness; each fix MR ends with the corresponding check recording `pass` from a live run.
>
> Fix five bugs, **one small MR per bug**, TDD: red reproducing test → fix → green → live proof-check run. No refactors outside these bugs.
>
> 1. **Bug 1 — execution without delivery:** `finalizeAndLog` (`src/deferred-prompts/proactive-llm-helpers.ts:134-146`) treats any tool failure as risky and discards non-empty good text; the verifier/neutral-fallback stub (`completion.doneFallback`) is delivered instead. Repro: unit test — good text + `finishReason: 'stop'` + injected tool failure must deliver the text verbatim, verifier not called. Also make the stub state what the bot attempted (include the failure context). Verify with proof check `bug1_delivery_matches_execution` (both variants).
> 2. **Bug 2 — stale time in proactive context:** the proactive trigger user message (`src/deferred-prompts/proactive-trigger.ts`, `userLines`) carries no fresh `<current_time>` tag, so replayed history's stale tags anchor the model's "now". Repro: trigger-contract test (fresh tag present, matches real fire time). Verify with `bug2_context_time`.
> 3. **Bug 3 — fires on creation:** two candidate mechanisms — (a) stale-clock `fire_at` stored at creation (`tool-handlers.ts:108-117`, `validateFutureFireAt` accepts still-future-but-too-soon times), (b) alert-path first-poll firing for pre-matching tasks (`poller-alerts-watch.ts:65-76`, enshrined by `SCN-deferred-fire-alert` — if the live evidence lands here, surface the baseline-on-create decision instead of changing semantics). Decide the lane from the bug-3 proof-check observations, then fix. Verify with `bug3_fires_on_creation`.
> 4. **Bug 4 — create response missing `execution.mode`:** `CreateResult` at `src/deferred-prompts/types.ts:211-214` (returned via `tool-handlers.ts:124-130` and `:164`) omits `execution`; add `execution.mode` (`scheduled` | `on_event`) to both created variants. Proven by inspection alone — no further forensics needed. Verify with `bug4_create_response_mode`.
> 5. **Bug 5 — update wipes prompt text:** `updateScheduledFields` (`tool-handlers.ts:226`) copies `prompt: ""` through (zod `.optional()` accepts it). Repro first: `update_reminder` with `prompt: ""` + another field must keep the stored text (treat empty string as no-op or reject it explicitly). Verify with `bug5_update_preserves_prompt`.
>
> Final MR: remove the disposable proof-check infrastructure (module, tool registrations, poller record line) once all five checks have recorded `pass` in prod.
