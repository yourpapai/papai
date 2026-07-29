<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Uncatalogued cluster — catalog foundation design

Date: 2026-07-29
Status: approved

## Problem

The scenario ledger can enforce only behavior that has a catalog id. Nine runtime
subsystems have no ids despite low frozen-story coverage, and the current coverage
report also identifies eleven zero-coverage source files. Consequently the catalog
cannot describe, require rationale for, or later prove their most important
invariants. Existing high-level records, including `SCN-task-attachments` and
`SCN-settings-api-byok`, prove adjacent user paths but do not claim these internal
runtime behaviors.

Phase 3 begins with a catalog-only foundation. It makes the uncatalogued behavior
visible and accountable before a story claims any coverage.

## Goals

- Add behavior-level ids at the lowest tier that can prove each uncatalogued behavior.
- Give every new id a precise pending audit record and future story seam.
- Preserve the catalog's one-to-one classification and literal-story mapping
  contract.
- Establish a small, ordered queue of follow-up story-family slices.

## Non-goals

- Add executable stories, fixtures, production changes, or runtime behavior changes.
- Broaden an existing catalog id to claim behavior it has not proved.
- Build a source-file-to-catalog auto-discovery system.

## Catalog model

The foundation changes only `tests/stories/catalog/coverage.ts` and its existing
catalog contract assertions. Each new id is added to `CATALOG_SCENARIO_IDS`, recorded
in `CATALOG_SOURCE` as this Phase 3 extension, and represented in `AUDIT_RECORDS`.

Every record starts as `catalogStatus: 'gap'` and `kind: 'pending'`. Pure behavior
that can be exercised directly with existing runtime dependencies is marked
`executable-as-is`. Runtime behavior whose deterministic exercise needs a clock,
persistence, encryption, downloader, delivery boundary, or platform adapter fake is
marked `needs-seam` with the narrowest named seam and its lowest proving tier. No new
executable mapping is added in this slice.

The following behavior records are the initial Phase 3 set:

| Id | Behavior |
| --- | --- |
| `SCN-memory-tool-pairing` | Retained history never starts with a tool result or splits a tool-call/result exchange. |
| `SCN-queue-coalescing` | Same-actor messages form one correctly ordered turn. |
| `SCN-queue-group-serialization` | An actor change flushes the prior batch and never overlaps turns in one thread. |
| `SCN-attachments-staged-scope-search` | Staged files are discoverable only in their permitted context/group scope. |
| `SCN-attachments-staged-resolution` | Resolution is single-use, preserves failure state, and a re-send intentionally creates a new attachment. |
| `SCN-byok-context-credentials` | Encrypted credentials merge and clear per context without disclosure. |
| `SCN-byok-unreadable-credentials` | Unreadable stored data fails closed and reports state without secrets. |
| `SCN-message-cache-persistence` | Eligible observed messages persist and later retrieval preserves chain and context boundaries. |
| `SCN-usage-accounting` | Idempotent event identity and persisted request/tool usage remain queryable in their intended window. |
| `SCN-announcement-delivery-fanout` | Subscribed users and groups receive one best-effort delivery, with successes and failures summarized independently. |
| `SCN-stats-anonymity` | `/stats/*` aggregation never exposes raw subject identity. |
| `SCN-stats-aggregate-window` | Aggregate/window results remain internally consistent. |
| `SCN-scheduler-execution-tracking` | Active executions are removed after both fulfillment and rejection. |
| `SCN-changelog-version-section` | Version extraction stops at the next release and returns `null` when the requested version is absent. |

The current coverage run identifies these eleven zero-line files:

```
src/attachments/staged-download.ts
src/changelog-reader.ts
src/chat/discord/commands.ts
src/chat/discord/format-chunking.ts
src/chat/discord/interaction-helpers.ts
src/chat/kontur-talk/reply-helpers.ts
src/chat/telegram/admin-helpers.ts
src/deferred-prompts/poller-lifecycle.ts
src/plugins/deny.ts
src/utils/changelog.ts
src/utils/scheduler.executions.ts
```

`staged-download.ts` and `changelog-reader.ts` are source evidence for the staged
resolution and changelog-section records above; they do not receive duplicate ids.
The remaining distinct behaviors add seven records:

| Id | Lowest tier and behavior |
| --- | --- |
| `SCN-interaction-discord-command-routing` | Tier 3 — Discord command helpers route a command into the runtime with the correct interaction acknowledgement. |
| `SCN-interaction-discord-format-chunking` | Tier 3 — oversized Discord output is split without reordering or data loss. |
| `SCN-interaction-discord-response-lifecycle` | Tier 3 — deferred/replied interaction helpers preserve the one-response lifecycle. |
| `SCN-interaction-kontur-reply-formatting` | Tier 3 — Kontur Talk replies use the platform's supported formatting and chunking boundaries. |
| `SCN-interaction-telegram-admin-authorization` | Tier 3 — Telegram admin helper decisions reflect the platform-admin response and fail safely. |
| `SCN-deferred-poller-lifecycle` | Tier 4 — a poller starts one controlled sweep and stops without leaving a live timer. |
| `SCN-plugin-deny-gating` | Tier 0 — denied plugin capabilities are absent before tool execution and leave no privileged escape path. |

This is an explicit behavior inventory, not a source-file-per-id rule.

## Follow-up ordering

The catalog lays out independently reviewable implementation slices in increasing
fixture cost:

1. Pure helpers: memory tool pairing, scheduler execution tracking, and changelog
   extraction.
2. Existing runtime flows: message queue, message cache, usage accounting, and plugin
   denial.
3. Persistence/credential flows: staged attachments and BYOK resolution.
4. Remote fan-out and aggregate privacy: announcements and stats.
5. Platform adapters and operational polling: the five Tier-3 platform records, then
   the Tier-4 poller lifecycle record.

Each slice moves only the ids it proves from `AUDIT_RECORDS` into
`EXECUTABLE_STORY_MAPPINGS`; it must use literal story ids and an implementation
verification date. A story may not claim a broad sibling behavior merely because it
shares a subsystem.

## Contract and verification

The existing `catalog-coverage.test.ts` remains the enforcement point. This change
updates its literal catalog and pending totals to the final audited count, and adds a
focused assertion that the Phase 3 records are unique, pending, assigned to their
lowest proving tier, and have nonblank rationales. The generic contract continues to require that
`AUDIT_RECORDS` exactly equals the pending set; a new id therefore cannot be minted
without an accountable audit record.

Because the catalog and harness are frozen story inputs, verification runs the
catalog contract suite first and then the sandboxed compatibility proof. The baseline
is re-recorded only for the intentional frozen catalog/harness byte change after both
checks show no runtime behavior changed.

## Risks and controls

- **Duplicate claims:** inspect adjacent records before minting; prefer a new id when
  the success, failure, isolation, or ordering assertion differs materially.
- **Overly broad IDs:** use one invariant per id, even when two invariants reside in
  the same module.
- **Coverage inflation:** retain every new record as pending until its own literal
  story mapping exists.
- **Invisible residual zero coverage:** audit all eleven reported zero-coverage files
  against the published behavior matrix before finalizing the literal total.
