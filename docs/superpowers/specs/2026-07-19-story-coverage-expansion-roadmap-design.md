<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Story coverage-expansion roadmap

**Status:** approved

**Date:** 2026-07-19

## Context

The hermetic story harness (`tests/stories/`) is mechanically complete and green:
Docker-only sandbox, immutable snapshots, compat gate, 40 passing scenarios. But
catalog coverage is 29 of 126 scenarios executable (18 `SCN-coding-acp-*`, 11
`SCN-settings-*`). The other 97 pending scenarios carry the generic reason
"Awaiting branch audit before classifying an executable story" — phase 2 of the
tiering design (`2026-07-13-hermetic-story-hardening-and-tiering-design.md`,
delivery phases 2–5) was never executed.

The harness exists to qualify the `plugin-core-separation` refactor via the
frozen-harness compatibility proof. That proof is only as valuable as the
behavior it covers. This roadmap converts the pending set into classified,
seam-costed, sequenced family specs so the compatibility proof covers everything
the refactor can actually break. It is a **program document**: it produces one
machine-checked audit plus a family queue. Each family then gets its own
spec→plan→implementation cycle using the settings family
(`docs/superpowers/plans/2026-07-18-settings-story-family.md`) as the proven
template.

Research basis: per-family harness-gap analysis dated 2026-07-19 (existing
`given`/`when`/`then` surface, MemoryTaskProvider method gaps, capability-id
mechanics, missing seams).

## Deliverable 1: the structured audit

Every pending scenario id receives a structured audit record replacing the
generic reason string. The audit executes phase 2 of the tiering design.

Each record carries:

- **Classification** — one of:
  - `executable-as-is`: the harness already supports the scenario (research
    indicates most of `cmd-*`, `meta-*`, `memory-*`/`memo-*`, and parts of
    `task-*`);
  - `needs-seam:<name>`: a named seam from the inventory below (e.g.
    `assertPublicUrl` DI, `fake-mcp-server`, `debugEnabled` world option,
    MemoryTaskProvider method set);
  - `blocked:missing-implementation`: no production code exists to test
    (`nerv-*`, `supervise-*`).
- **Family assignment** (F1–F8 below).
- **Story mapping resolution** for the three unmapped core stories
  (`create-and-read-task`, `thread-scope`, `group-users`): map to an existing id,
  split an id, or document partial coverage explicitly. No silent force-mapping.
- **Reclassification rationale** for every status change.

The headline reclassification decision is `cmd-*`: today all 16 are blanket
`forward-only` because command _menu registration_ is platform-specific. Command
_behavior_ (authorization, replies, durable effects) runs through the real
dispatch, already proven by the ACP command story. The audit splits each cmd id:
the behavioral part becomes an executable candidate; the menu/registration part
stays with platform-adapter contract tests.

Audit records live in `tests/stories/catalog/coverage.ts` as typed data, checked
by the existing catalog contract test (counts, referenced stories exist, no stale
mappings). Coverage totals are printed into the runner manifest output so the PR
job surfaces the current number.

The audit lands first because it turns the roadmap from opinion into data: every
family spec afterwards starts with a known seam list and scenario count, and no
family invents a seam another family already needs.

## Deliverable 2: the family queue

Sequenced by refactor risk: what `plugin-core-separation` can break (tool
assembly/registration, command surface, plugin lifecycle) comes first; product-
risk families next; platform-adapter families last. Sizes are audit-validated
estimates; each family's own spec fixes the final count.

| #   | Family                                                                        | Est. scenarios | What the refactor can break                                                                        | Seam inventory / pre-work                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | `meta-*` + `cmd-*`                                                            | ~19            | Tool assembly, disclosure (`load_tool`/`search_tools`), compaction, command registration and authz | Capability ids (one line each in `src/tools/core-capabilities.ts`); compaction-trigger knob on MemoryTaskProvider; discovery task for `cmd-stop-graceful`/`abort` (the scripted LLM cannot block mid-turn today — these may stay pending with a documented reason)                                                                       |
| F2  | `task-*`                                                                      | 21             | Tool gating, `tool_prefs`, provider resolution, identity                                           | Largest pre-work: MemoryTaskProvider expansion (~15 method groups: delete, history, projects, statuses, worklog, sprints, saved queries, relations, watchers/votes, attachments, `applyCommand`, members) plus capability ids and `then` helpers. Split into two specs (lifecycle+policy, then provider-surface) decided by its own spec |
| F3  | `memory-*`/`memo-*` + `instructions-*` + `history-lookup` + `fetch-chat-link` | ~13            | Builtin tool registration, DB-backed storage                                                       | Capability ids; embeddings decision per scenario — fake embedding endpoint via the strict HTTP dispatcher vs. asserting the lexical-fallback degradation path; sweeps use the existing single-pass `sweepDirtyContexts(now)`/`sweepPromotions()` exports, no clock seam                                                                  |
| F4  | `http-*`                                                                      | 8              | Route dispatch, auth domains                                                                       | `debugEnabled` world option; `notify_token` seed fixture; dashboard-auth session fixture (admin/billing/stats are a separate trust domain from settings sessions); transcript-viewer via fake-magi (closes a catalog `gap`); `mattermost-action` stays forward-only                                                                      |
| F5  | `deferred-*`/`reminder-*`                                                     | 8              | Schedulers, proactive delivery                                                                     | No production clock seam: seed due rows (`fireAt`/`nextRun` in the past) and drive single-pass `tick`/`pollScheduledOnce`/`pollAlertsOnce`; proactive replies already captured by the scenario chat. Virtual-time injection deferred to tiering phase 5                                                                                  |
| F6  | `web-fetch`                                                                   | 2              | Tool registration, quota                                                                           | `assertPublicUrl` DI seam (small production change — it performs a real DNS lookup the I/O guard cannot intercept); quota seeding is already DB-backed                                                                                                                                                                                   |
| F7  | `settings-admin-mcp-*`                                                        | 2              | Settings routes, MCP adapter                                                                       | `fake-mcp-server` seam (already named in the catalog)                                                                                                                                                                                                                                                                                    |
| F8  | `interaction-*`                                                               | 4              | Interaction routing, permission prompts                                                            | Platform-adapter fakes (grammY API, discord.js client). `interaction-permission-decision` is promotable today via `when.interaction`; the other three stay forward-only unless the refactor touches chat adapters                                                                                                                        |

**Not queued:** `nerv-*` (10) and `supervise-*` (10) — the production
implementation does not exist, so no harness work can close them. They keep
`blocked:missing-implementation` audit records and are revisited when the code
lands. The single `contract-only` id needs no story by definition.

Projected outcome if F1–F7 land: ~75–95 executable scenarios (from 29), with
every remaining pend carrying a named, justified reason instead of a placeholder.

## Execution rules

Binding on every family spec that follows:

1. **One family per spec→plan cycle**, ~8–16 scenarios. F2's split is decided by
   its own spec, not here.
2. **Harness-seam task lands first** in every family plan and is reviewed
   independently. The audit's seam inventory is the reference; a new seam must be
   named in the family spec's deviations section.
3. **No assertion-only stories.** Every scenario qualifies through observable
   behavior: a reply, a durable state change observed on a following turn, an
   authorization flip, or an exact outbound payload — never a bare 200 or an
   internal call count (settings family precedent).
4. **Bugs found en route land separately** as their own commits (identity-
   keyspace precedent), never bundled into story PRs.
5. **Ledger updates ride with the stories** in the same PR: mapping entries,
   accurate `verifiedAt`, totals in manifest output. A family PR that leaves the
   catalog stale is incomplete.
6. **Reclassification is auditable:** every status change records its rationale
   in the audit record.
7. **Frozen-tree discipline:** harness changes in family PRs re-baseline the
   compat manifest only when intended; routine story additions must not touch
   runner/sandbox files.

## Success metrics

- Audit: 97 generic reasons → 0; every pend carries a classification plus a named
  seam or blocker.
- Coverage: 29 → ~75–95 executable across F1–F7, tracked per family in each
  spec's header (the settings template's quantified ledger delta).
- Refactor-proof value: with F1, F2, settings, and ACP done, every seam
  `plugin-core-separation` rewires — tool assembly, command surface, plugin
  lifecycle, capability catalog — has a behavioral tripwire before the
  compatibility run starts.

## Out of scope

- Writing any family scenarios (each family is its own cycle).
- `nerv-*`/`supervise-*` anything beyond their audit records.
- Tier 3 platform-integrated tests; virtual-time scheduler injection (phase 5).
- Provider-real Kaneo tier changes.

## Dependencies and risks

- **F5 seed-due-rows** could hit a production wall-clock read that bypasses
  seeding. Mitigation: a discovery task in the F5 spec; fallback is the phase-5
  clock seam.
- **F8** depends on nobody building platform fakes speculatively; they are only
  justified if the refactor touches the chat adapters.
- **Family specs may invalidate audit estimates**; the ledger totals rule (rule 5) keeps the catalog truthful as they do.
