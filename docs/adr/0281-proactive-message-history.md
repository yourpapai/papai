<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0281: Proactive Message History Recording

## Status

Implemented (with divergence)

## Date

2026-07-09

## Context

papai's LLM turn loop persists the bot's own replies into a per-thread `conversation_history` store keyed by the thread-scoped `storageContextId`, and reads them back on the next turn, so in normal conversation the LLM sees its own prior messages. However, the bot sends many messages **outside** that turn loop, and an audit found that almost none of them were persisted. The only non-turn path that recorded to history was the deferred-prompts/alerts success path (`src/deferred-prompts/proactive-llm-helpers.ts`), which deliberately calls `appendHistory` before delivery.

The observed symptom: **the bot had no memory of proactive/announcement messages it sent.** It would tell a user about a new release or a newly created recurring task, then on the next turn have zero record that it ever said so — leading to confused, repetitive, or contradictory follow-up.

The content-bearing proactive sites that fell through the gap were: release-notes broadcast (DM + group fan-out), admin free-text announce broadcast, the version-announcement review notice to admin, the "recurring task created" notification, external `notify` webhook pushes (e.g. magi milestones), and the deferred-prompt/alert **error-delivery** branch (the success branch already persisted). Live-status progress messages, command replies, and interaction chatter were deliberately left ephemeral.

A related, separate defect surfaced during the same audit: the turn-error path `handleLlmTurnError` called `saveHistory(contextId, baseHistory)`, rewinding the cached history to the pre-turn state and thereby **discarding even the user's own triggering message** for that turn.

The design (`docs/superpowers/specs/2026-07-09-proactive-message-history-design.md`) and plan (`docs/superpowers/plans/2026-07-09-proactive-message-history.md`) closed both gaps.

## Decision Drivers

- **The LLM must see what the user saw.** A proactive message delivered into a thread must be present in that same thread's history on the next turn, so the model's context matches the chat the user is looking at.
- **Correct bucket, not the group-shared one.** Persisted proactive messages go to the **thread-scoped `storageContextId`** the target's normal replies use — the `pi:<inst>:ctx:<native>[:thread:...]` form — never the bare native id and never the group-shared config-context id. This honors the scope model in `src/chat/context-scope.ts`.
- **Delivery is the product; history is best-effort.** These are fire-and-forget notifications, so a history-write failure must never block or duplicate the user-facing send. Persistence degrades gracefully to today's behavior (message delivered, just not remembered), logged at `warn`.
- **Persist only after a confirmed successful send.** Keying persistence to a per-recipient successful send gives broadcasts natural idempotency — a partial broadcast that retries will not double-persist to recipients that already succeeded. This intentionally differs from the deferred-LLM success path, which persists-before-send because there the persisted turn _is_ the product.
- **Faithful framing, no markers.** Store exactly the text the user saw, as a plain `assistant`-role `ModelMessage` — no `(proactive)` prefix and no synthetic preceding user turn. A dangling assistant message with no preceding user turn is well-tolerated by chat models, and faithful storage avoids leaking a marker into a real reply.
- **Do not unify delivery paths.** Delivery and platform-instance resolution genuinely differ across call sites; unifying them risks regressions for no benefit. Centralize only the persist concern.
- **Turn-error rollback must not discard the user's message.** The error path should rewind only the incomplete assistant turn, preserving history up to and including the user's triggering message.

## Considered Options

### Option 1 — One persist-only unit `recordProactiveInHistory`, called per-site after delivery (chosen)

Introduce a single small unit `recordProactiveInHistory(storageContextId, markdown)` that appends a faithful `assistant` `ModelMessage` at a caller-supplied scoped context id, best-effort (a persist failure is logged and swallowed). Every proactive send site calls it **only after a confirmed successful delivery** and **only with a correctly-scoped `pi:...` id**, computed at each site. Delivery code stays exactly as-is.

- **Pros:** smallest blast radius — delivery and platform-instance-resolution code is untouched; the centralized concern (faithful framing + best-effort + correct bucket) lives in one well-bounded, testable place; the next proactive path cannot silently forget to persist because the pattern is a single explicit call.
- **Cons:** each call site must compute the correct scoped id itself (no central resolution), so a future site could pass a wrong id; the persist call is still opt-in per site rather than enforced structurally.

### Option 2 — A send-and-record wrapper `sendRecordedProactive` (the approved spec's literal shape)

Build a wrapper extending the deferred pipeline's `sendProactiveMessage` that resolves the target's thread-scoped `storageContextId`, sends via `chat.sendMessage`, and on success appends the history entry. Route all content-bearing proactive callers through it.

- **Pros:** centralizes context-id resolution too, removing the per-site id-correctness burden.
- **Cons:** investigation revealed delivery paths and platform-instance resolution genuinely differ across call sites, so unifying delivery risks regressions; the `getStorageContextId` fallback does not reproduce the scoped `pi:...` history key (it falls back to the bare native id for DM targets), so persistence still requires an explicitly-scoped id computed at each site. The unification buys no real safety and adds regression surface.

### Option 3 — Persist at the `chat.sendMessage` / transport layer

Hook history recording into the chat transport so every send is automatically recorded.

- **Pros:** structurally impossible to forget.
- **Cons:** the transport cannot distinguish content-bearing proactive messages from the many deliberately-ephemeral sends (live-status edits, command replies, confirmation prompts, mid-run steering acks); recording everything would flood history with noise the user never saw as a final message and break the live-status deletion model. The non-goal set is large and transport-layer-uniform.

## Decision

The chosen Option 1 shipped. The centralized persist unit was realized as a within-Option-1 refinement of the spec's `sendRecordedProactive` intent (the plan's "Approach B" note): delivery stays per-site, persistence is the one centralized concern.

1. **One persist-only unit** (`src/proactive-history.ts`). `recordProactiveInHistory(storageContextId, markdown, deps?)` appends `{ role: 'assistant', content: markdown }` via `appendHistory`, wrapped in try/catch that logs at `warn` and swallows the error. It does not trigger history trimming — proactive messages are infrequent and the next normal turn runs the trim check over the combined history.
2. **Deferred-prompt scheduled error branch records** (`src/deferred-prompts/poller.ts`). When `dispatchExecution` throws before delivery, the error notice is sent, and on confirmed delivery it is recorded at `getStorageContextId(execCtx.deliveryTarget)` (poller targets always carry an explicit scoped `storageContextId`).
3. **Deferred-alert error branch records** (`src/deferred-prompts/poller-alerts.ts`). The alert-batch error branch records its error notice at the alert's scoped `storageContextId` on confirmed delivery.
4. **External `notify` webhook push records** (`src/debug/notify-route.ts`). After a confirmed successful `send`, the delivered markdown is recorded at the route's `contextId` (contractually the scoped `pi:...` id).
5. **"Recurring task created" notification records** (`src/scheduler-recurring.ts`). After a successful send, the notification is recorded at `userId` (the scoped config-context id), guarded by `parseScopedContextId(userId) !== null` so legacy bare ids are skipped rather than written to a wrong bucket.
6. **Admin free-text broadcast records per recipient** (`src/commands/announce-broadcast.ts`). Each successfully-delivered per-user DM is recorded at `toScopedContextId({ platformInstanceId, nativeContextId: user.platform_user_id })`.
7. **Release-notes broadcast records DM + group** (`src/announcements/broadcast.ts`). `defaultDeps.sendDm` records at the scoped DM bucket on success; `defaultDeps.sendGroup` records at the (already-scoped) `groupId` on success.
8. **Admin review notice records** (`src/announcements.ts`). After a successful send, the review notice is recorded at `toScopedContextId({ platformInstanceId, nativeContextId: adminUserId })`.
9. **Turn-error rollback preserves the user message** (`src/llm-orchestrator-support.ts` + `src/llm-orchestrator.ts`). `HandleLlmTurnErrorArgs` gained a `userHistoryMessage` field; `handleLlmTurnError` now persists `[...baseHistory, userHistoryMessage]`, restoring history to "user turn present, no assistant reply." The `runTurn` call site passes `turn.historyMessage`.

## Consequences

### Positive

- The bot now remembers its own proactive/announcement messages: a follow-up turn's assembled context includes prior release-notes pings, recurring-task notifications, external `notify` pushes, broadcast DMs, and deferred-error notices, so the model no longer contradicts or repeats them.
- The fix is structurally additive — delivery code paths are unchanged at every site, and the only new coupling is a single explicit persist call, so regression risk is confined to the id-correctness of each call's first argument.
- The turn-error path no longer silently drops the user's triggering message, so a failed turn can be retried or referenced without the user re-sending.
- Best-effort persistence means a history-store failure can never block or duplicate a user-facing delivery; behavior degrades gracefully to the pre-change state.
- Per-recipient, post-delivery persistence gives broadcasts natural idempotency under partial retry.

### Negative

- The persist call is opt-in per site: a future proactive path that sends via `chat.sendMessage` without adding the record call will silently forget to persist. There is no structural enforcement (Option 3 was rejected for its noise trade-off).
- Each call site owns its scoped-id computation. A site that passes a bare native id (rather than a `toScopedContextId(...)` expression or an explicitly-set `storageContextId`) would write to the wrong bucket; the recurring site's `parseScopedContextId` guard is the only runtime check.
- `conversation_history` rows grow with every proactive send. Because the record unit intentionally does not trim, the next normal turn bears the trim cost; for very-high-volume proactive paths this is a small latency shift on the subsequent turn.

### Risks

- **A dangling assistant message with no preceding user turn** is well-tolerated by current models, but if a future model is observed getting confused by un-prompted announcements, the spec's documented fallback (a lightweight system-context breadcrumb) is not yet implemented — the design starts faithful by intent.
- **The recurring-task `userId` is assumed to be a scoped config-context id** (`parseScopedContextId` guard). If a future change stores a different id shape there, the guard would silently skip recording rather than write a wrong bucket — a fail-safe but a silent one.
- **`getStorageContextId`'s bare-id fallback is never relied upon** by these call sites, but it still exists in `src/deferred-prompts/proactive-llm-helpers.ts` for other consumers; a future caller that trusts it for a DM target would get the bare native id. This plan did not narrow that function.

## Related Decisions

- **ADR-0026 / ADR-0027 — Proactive Assistance (Phase 7) + Review Fixes**, and **ADR-0030 — Deferred Prompts System** — established the proactive/deferred-prompt subsystem whose delivery targets these recordings key off, and whose success-path persist-before-send ordering is the reference implementation this plan deliberately did not alter.
- **ADR-0116 — Deferred Prompt Delivery Redesign (Same-Context Delivery, Personal vs Shared Audience)** — defined the `deliveryTarget` / `storageContextId` resolution that makes the poller and alert error-branch recordings land in the correct thread-scoped bucket.
- **ADR-0087 — Debug Dashboard Expansion (incl. Deferred / Recurring / Context analysis)** — the dashboard surface that motivated making proactive message delivery observable; this ADR makes those same deliveries memorable to the model.
- **ADR-0217 — papai Core Notify Endpoint** — introduced the external `notify` webhook route (`src/debug/notify-route.ts`) whose delivered pushes this ADR records.
- **ADR-0233 — Release Announcement Subscriptions** — introduced the subscribed-user / subscribed-group broadcast path (`src/announcements/broadcast.ts`) whose DM and group sends this ADR records.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `src/proactive-history.ts:31-45` | `recordProactiveInHistory` — appends `{ role:'assistant', content: markdown }` via `deps.persist`, try/catch logs `warn` and swallows; `RecordProactiveDeps` default wires `appendHistory`. | `read` confirms. |
| `src/proactive-history.ts:13-17` | `RecordProactiveDeps` shape + `defaultDeps = { persist: appendHistory }`; no trim invocation. | `read` confirms. |
| `src/deferred-prompts/poller.ts:12,66` | Scheduled-prompt error branch: imports the unit; records at `getStorageContextId(execCtx.deliveryTarget)` only after `delivered` is truthy. | `read` confirms. |
| `src/deferred-prompts/poller-alerts.ts:12,112` | Alert-batch error branch: imports the unit; records at the alert's `storageContextId` only after `errDelivered`. | `read` confirms. |
| `src/debug/notify-route.ts:22,133` | `notify` route: imports the unit; records at `contextId` after the `!sent` guard, before the success response. | `read` confirms. |
| `src/scheduler-recurring.ts:12,99` | `notifyUser`: imports the unit; records at `userId` guarded by `parseScopedContextId(userId) !== null`, after a successful send. | `read` confirms. |
| `src/commands/announce-broadcast.ts:12,41-44` | `broadcastMessage`: imports the unit; records each delivered DM at `toScopedContextId({ platformInstanceId, nativeContextId: user.platform_user_id })` inside the per-user closure. | `read` confirms. |
| `src/announcements/broadcast.ts:12,76,81` | `defaultDeps.sendDm` records at the scoped DM bucket on success; `defaultDeps.sendGroup` records at `groupId` on success. | `read` confirms. |
| `src/announcements/broadcast.ts:87-88` | Test-only export of the real deps (named `defaultBroadcastDepsForTest`). | `read` confirms. |
| `src/announcements.ts:21,68` | `sendAnnouncementToAdmin`: imports the unit; records at `toScopedContextId({ platformInstanceId, nativeContextId: adminUserId })` after `result !== false`. | `read` confirms. |
| `src/llm-orchestrator-support.ts:174-185` | `HandleLlmTurnErrorArgs` carries `userHistoryMessage: ModelMessage`. | `read` confirms. |
| `src/llm-orchestrator-support.ts:190` | `handleLlmTurnError` persists `saveHistory(contextId, [...baseHistory, args.userHistoryMessage])`. | `read` confirms. |
| `src/llm-orchestrator.ts:198-206` | `runTurn` call site passes `userHistoryMessage: turn.historyMessage` to `handleLlmTurnError`. | `read` confirms. |
| `tests/proactive-history.test.ts:13-40` | Unit tests: faithful append at the scoped id; best-effort swallow of a persist failure. | `grep` confirms. |
| `tests/deferred-prompts/poller.test.ts:575,599,649,678` | Poller error-branch recording assertions (record-on-deliver; no-record-on-failed-deliver). | `grep` confirms. |
| `tests/debug/notify-route.test.ts:184,202` | `notify` route recording assertions. | `grep` confirms. |
| `tests/scheduler-recurring.test.ts:118,149` | Recurring-notification recording assertions (record-on-deliver; no-record-on-refused). | `grep` confirms. |
| `tests/commands/announce-broadcast.test.ts:75` | Broadcast per-recipient recording assertion. | `grep` confirms. |
| `tests/announcements/broadcast.test.ts:152,169,184,199` | `defaultDeps` sendDm/sendGroup recording assertions. | `grep` confirms. |
| `tests/announcements.test.ts:298` | Admin review-notice recording assertion. | `grep` confirms. |
| `tests/llm-orchestrator-support.test.ts:135-157` | Turn-error rollback preserves `[...baseHistory, userHistoryMessage]`. | `read` confirms. |

Plan-vs-implementation notes:

- **The deferred-alert error branch moved to its own file.** The plan placed both error branches in `src/deferred-prompts/poller.ts` (named `executeSingleAlert`). Shipped, the alert path lives in a dedicated `src/deferred-prompts/poller-alerts.ts` and was reshaped from a single-alert `executeSingleAlert` (returning `{ matched, delivered }` and calling `markAlertDelivered(alert, ...)`) into a batched evaluator over `AlertEvaluation[]` (returning `boolean`, calling `markAlertsDelivered(evaluations, ...)`). The recording intent is preserved verbatim — record the error notice at the scoped `storageContextId` only after confirmed delivery — but it landed in `poller-alerts.ts:112` rather than `poller.ts`, inside the reshaped batch function.
- **Test-only export renamed.** The plan specified `__defaultBroadcastDepsForTest`; shipped it is `defaultBroadcastDepsForTest` (no `__` prefix) at `src/announcements/broadcast.ts:88`, and the broadcast tests import that name. Intent identical.
- **`handleLlmTurnError` does not destructure `userHistoryMessage`.** The plan's snippet destructured it from `args`; shipped omits it from the destructure and references `args.userHistoryMessage` at line 190. Functionally identical. The `emitLlmError` count remains `baseHistory.length + 1` (line 189), matching the plan.
- **`mainModel` accessor path differs.** The plan's call site used `resolvedLlm.mainModel`; shipped uses `resolvedLlm.main.model` (`src/llm-orchestrator.ts:200`). This is a concurrent orchestrator refactor unrelated to this plan; the value passed is equivalent.
- **The spec's `sendRecordedProactive` wrapper was deliberately not built.** As the plan's Architecture note records, investigation showed delivery/platform-instance resolution differs per site (regression risk) and `getStorageContextId`'s bare-id fallback does not reproduce the scoped `pi:...` key, so a persist-only unit realizing the spec's intent (Approach B) was the correct shape. This is a within-Option-1 refinement documented in the plan, not a post-hoc deviation.
- **No structural enforcement of the persist call.** By design (Option 3 rejected), each new proactive send site must opt in. The recurring-task site's `parseScopedContextId` guard is the only runtime id-correctness check; all other sites rely on caller-supplied scoped ids (`target.storageContextId`, `toScopedContextId(...)`, or the already-scoped `groupId`).

The source plan `docs/superpowers/plans/2026-07-09-proactive-message-history.md` and design `docs/superpowers/specs/2026-07-09-proactive-message-history-design.md` are archived alongside this ADR to `docs/archive/`.
