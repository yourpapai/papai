<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0087: Debug Dashboard Expansion — Divergence Notes

> Companion document to ADR-0087. Captures deviations between the design spec, the implementation plan, and the actual implementation. Each deviation includes why it happened and whether correction is needed.

---

## Deviation 1: `file_relay:*` events entirely omitted

| Field              | Value                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task**      | Task 24 (identity + file_relay events)                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Spec reference** | §4 Event catalog (identity:_, file_relay:_), §8.2 Context panel data sources                                                                                                                                                                                                                                                                                                                                                             |
| **Expected**       | `file_relay:attached`, `file_relay:consumed`, `file_relay:dropped` emitted in attachment subsystem; `/file-relay?turnId=...` REST endpoint; file-relay section in Context panel                                                                                                                                                                                                                                                          |
| **Actual**         | No `file_relay` event type exists in the codebase. Attachment modules (`src/attachments/`) were not instrumented. The Context panel has identity, auth, group-settings, and config-editor sections, but no file-relay section.                                                                                                                                                                                                           |
| **Why**            | Attachment lifecycle is more complex than anticipated: files flow through ingest → workspace → S3 → task attachment manifests → relay. There is no single "file_relay" module; the closest is `src/attachments/` which has orchestrator-like dispatch. Emitting scoped events would require threading `userId`/`turnId` into the attachment workspace, which was not straightforward given the concurrent `p-limit` bounded upload path. |
| **Impact**         | Context panel cannot show file-relay turn contents per spec §5 Story 5. Admin must still inspect raw logs or check the task provider for attachment presence.                                                                                                                                                                                                                                                                            |
| **Correct?**       | No — spec requirement not met. Should be addressed in follow-up when attachment lifecycle instrumentation is prioritized.                                                                                                                                                                                                                                                                                                                |

---

## Deviation 2: REST endpoints lack 403 allow-list enforcement

| Field              | Value                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task**      | Task 22, 27 (REST endpoints)                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Spec reference** | §5 Admin-scope filter: "REST endpoints ... reject out-of-allow-list requests with 403"; §6 per-resource data plan: "`/recurring?userId=...` ... share the `isAuthorizedRequest` token gate, and additionally call `assertScopeAllowed(vis, params)`"                                                                                                                                                                              |
| **Expected**       | Every lazy-drill-down REST endpoint checks that the requested `userId` or `groupId` is within the connected admin's `AdminVisibility` allow-list, returning HTTP 403 for out-of-scope requests.                                                                                                                                                                                                                                   |
| **Actual**         | `/recurring`, `/deferred`, `/memos`, `/identity`, `/auth/groups`, `/turns/:id` all verify only the bearer token (`isAuthorizedRequest`). The `userId`/`groupId` query parameter is treated as a data lookup key, not a scope boundary. Out-of-scope requests return the queried user's data if the token is valid.                                                                                                                |
| **Why**            | `assertScopeAllowed(vis, params)` helper was never implemented. The server handler functions receive only a `URL`, not the `AdminVisibility` context of the token. Computing `AdminVisibility` inside each handler would require importing `state-collector` internals into server route handlers, which would introduce a circular dependency risk (`server.ts` → `state-collector.ts` → `turn-assembly.ts` → potentially back). |
| **Impact**         | Semantic gap — spec's strict default-deny at REST layer is unenforced. In practice this is low-risk because the debug server runs on localhost and the bearer token is already admin-only. But a leaked token would allow querying any user's data, not just admin-visible data.                                                                                                                                                  |
| **Correct?**       | No — should be fixed by computing `AdminVisibility` once at server startup (from `init(adminUserId)` which already has the admin user ID) and injecting it into handlers via closure.                                                                                                                                                                                                                                             |

---

## Deviation 3: `message:replied` not replaced by `reply:sent`

| Field              | Value                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task**      | Task 10 (reply:sent event)                                                                                                                                                                    |
| **Spec reference** | §4 Event catalog: "`reply:sent` ... supersedes today's opaque `message:replied`"                                                                                                              |
| **Expected**       | Remove `message:replied` emission; replace with `reply:sent` carrying richer payload (text preview, target, duration, turnId).                                                                |
| **Actual**         | Both events co-exist. `message:replied` is still emitted in `src/bot-reply-tracking.ts:112` alongside `reply:sent` at line 111. Old dashboard handlers continue to process `message:replied`. |
| **Why**            | Backward compatibility: existing dashboard logic and any external consumers listening for `message:replied` would break if removed. No consumer migration path was planned.                   |
| **Impact**         | Event duplication on every reply. Slightly higher SSE traffic. Not a functional issue.                                                                                                        |
| **Correct?**       | Acceptable deviation — can be cleaned up in a future deprecation cycle.                                                                                                                       |

---

## Deviation 4: Named snapshot getters absent

| Field              | Value                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task**      | Task 22 (snapshot getters and REST endpoints)                                                                                                                                                                                                           |
| **Spec reference** | §6: "New source-module getters (mirroring today's `getSessionSnapshots` pattern): `getRecurringSnapshot(vis)`, `getDeferredSnapshot(vis)`, `getConfigEditorSnapshot(vis)`, `getGroupSettingsSnapshot(vis)`, `getAdminAllowlistSnapshot(adminUserId)`"   |
| **Expected**       | Snapshot getter functions in each source module, accepting `AdminVisibility`, returning pre-filtered compact arrays.                                                                                                                                    |
| **Actual**         | No snapshot getters exist. REST handlers (`handleRecurring`, `handleDeferred`, etc.) call the source module's list/query functions directly (`listRecurringTasks(userId)`, `listScheduledPrompts(userId)`, etc.) and return raw data.                   |
| **Why**            | Snapshot getters add an extra abstraction layer over already-simple query functions. The source modules already accept `userId` filters. Adding a `vis`-aware wrapper duplicates the filtering logic (the caller already passes a specific `userId`). ` |
| **Impact**         | Minimal — data flows correctly. The snapshot abstraction would only matter if future instrumentation needed bulk visibility-filtered queries (e.g., "show all recurring tasks for all admin-visible users").                                            |
| **Correct?**       | Acceptable — spec called for getters as a pattern, but the implementation's direct-call approach is simpler and avoids unnecessary indirection.                                                                                                         |

---

## Deviation 5: `tool:failure_classified` emitted from `llm-orchestrator-invoke.ts`

| Field              | Value                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task**      | Task 12 (emit from `tool-failure.ts`)                                                                                                                                                                                                                                                                                                                                                                         |
| **Spec reference** | §4 Event catalog: "`tool:failure_classified` ... from `src/tool-failure.ts` / `src/error-analysis.ts`, reason code, retriable flag"                                                                                                                                                                                                                                                                           |
| **Expected**       | Emission in `src/tool-failure.ts`, specifically in `buildToolFailureResult`.                                                                                                                                                                                                                                                                                                                                  |
| **Actual**         | Emission is in `src/llm-orchestrator-invoke.ts:40` and `llm-orchestrator-invoke.ts:55`, inside the experimental `onToolCallFinish` hook wrapper. `tool-failure.ts` only builds result objects; it does not emit events.                                                                                                                                                                                       |
| **Why**            | The `onToolCallFinish` hook in `llm-orchestrator-invoke.ts` is where tool success vs failure is first known (it wraps the AI SDK's `generateText` call). `buildToolFailureResult` is called later with the same data, but emitting at the hook site ensures the event is sent even if `buildToolFailureResult` is bypassed for any reason. The source file differs; the event type and payload are identical. |
| **Impact**         | None — functionally identical behavior. Event is emitted exactly once per tool failure.                                                                                                                                                                                                                                                                                                                       |
| **Correct?**       | Acceptable — semantics preserved; only the call site location differs.                                                                                                                                                                                                                                                                                                                                        |

---

## Deviation 6: `ring-buffers.test.ts` merged into `turn-assembly.test.ts`

| Field         | Value                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task** | New test file: `tests/debug/ring-buffers.test.ts`                                                                                                                                                                                                       |
| **Expected**  | Standalone file covering notification ring (2048 cap) and tool-failure ring (1024 cap).                                                                                                                                                                 |
| **Actual**    | Same test content lives in `tests/debug/turn-assembly.test.ts` under `describe('notification ring buffer')` and `describe('tool failure ring buffer')` blocks.                                                                                          |
| **Why**       | Ring buffers are tightly coupled to Turn assembly — they're maintained in the same `turn-assembly.ts` module with shared `push` / `splice` helpers. A standalone file would need to import implementation internals that aren't exported independently. |
| **Impact**    | None — test coverage identical, just file organization differs.                                                                                                                                                                                         |
| **Correct?**  | Acceptable — spec/plan file names are suggestions, not contracts.                                                                                                                                                                                       |

---

## Deviation 7: `assertScopeAllowed` helper not implemented

| Field              | Value                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Plan task**      | Implicit in Task 22 and spec §6                                                                                              |
| **Spec reference** | §6: "REST endpoints ... share the `isAuthorizedRequest` token gate, and additionally call `assertScopeAllowed(vis, params)`" |
| **Expected**       | A shared helper `assertScopeAllowed(vis: AdminVisibility, params: { userId?: string; groupId?: string }): Response           | undefined` that returns HTTP 403 Response if the requested scope is outside the admin's allow-list. |
| **Actual**         | No such helper exists. REST endpoints trust the token gate only.                                                             |
| **Why**            | Same root cause as Deviation 2 — `AdminVisibility` is scoped to the collector, not shared with the server.                   |
| **Impact**         | Same as Deviation 2 — REST layer lacks scope enforcement.                                                                    |
| **Correct?**       | No — should be fixed alongside Deviation 2.                                                                                  |

---

## Deviation 8: `getAdminAllowlistSnapshot` not created

| Field              | Value                                                                                                                                                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task**      | Implicit in spec §6                                                                                                                                                                                                                                                                          |
| **Spec reference** | §6: "`getAdminAllowlistSnapshot(adminUserId)` in `src/debug/`"                                                                                                                                                                                                                               |
| **Expected**       | Snapshot getter returning `authorized-groups ∩ isGroupMember(..., adminUserId)`.                                                                                                                                                                                                             |
| **Actual**         | `handleAuthGroups()` in `src/debug/server.ts` calls `listAuthorizedGroups()` directly.                                                                                                                                                                                                       |
| **Why**            | The intersection with `isGroupMember` is handled by the `groupIds` set in `AdminVisibility`; the REST endpoint returns raw authorized groups and the client/context panel relies on the collector's filtering for SSE events. Lazy drill-down uses the full `listAuthorizedGroups()` result. |
| **Impact**         | The Context panel shows all authorized groups, not just admin-member groups, for REST-fetched data. SSE events are still filtered. Minor inconsistency.                                                                                                                                      |
| **Correct?**       | Minor — acceptable for debug-only endpoint; not a security boundary.                                                                                                                                                                                                                         |

---

## Summary Table

| #   | Deviation                                        | Severity   | Needs Correction                      |
| --- | ------------------------------------------------ | ---------- | ------------------------------------- |
| 1   | `file_relay:*` events omitted                    | **High**   | Yes — spec requirement unmet          |
| 2   | REST endpoints lack 403 allow-list               | **Medium** | Yes — security posture gap            |
| 3   | `message:replied` + `reply:sent` coexist         | Low        | No — back-compat, can deprecate later |
| 4   | Named snapshot getters absent                    | Low        | No — simpler direct calls work        |
| 5   | `tool:failure_classified` emitted from invoke.ts | None       | No — functionally equivalent          |
| 6   | Ring-buffer tests merged                         | None       | No — coverage identical               |
| 7   | `assertScopeAllowed` helper absent               | **Medium** | Yes — tied to #2                      |
| 8   | `getAdminAllowlistSnapshot` absent               | Low        | No — acceptable shortcut              |
