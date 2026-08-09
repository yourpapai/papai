<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0323: F8 Interaction Story Family — Promote the Permission-Decision Scenario to Executable, Park the Wire-Level Scenarios, and Close the Coverage-Expansion Program

## Status

Accepted

## Date

2026-07-23

## Context

The coverage-expansion roadmap sequences family **F8** (`interaction-*`) last, after F1–F7 — the **terminal family** of the program. F8's catalog slice is four scenarios: one permission-decision roundtrip and three wire-level scenarios (discord.js router-wrapped, discord.js standalone fallback, grammY callback).

Of the four, only `SCN-interaction-permission-decision` was reachable at Tier 0: the hermetic story harness (ADR-0284) enters interaction dispatch at `runtime.dispatchInteraction` — **below** the platform adapter — so the permission roundtrip was already exercisable via the existing `when.interaction` seam, while the three wire-level scenarios verify the platform-adapter wire _above_ that entry point (a raw grammY/discord.js callback decoded and routed into dispatch), which is Tier-3 platform-integrated territory the roadmap scopes out. The `platform-adapter-fakes` seam that would realize them was deliberately left unrealized (no speculative grammY API / discord.js client fakes).

The ask-gate dispatch path was also already production-complete and incidentally proven by `SCN-task-ask-confirm` — so the risk for the new story was redundancy: a story that merely re-asserts what the task-family story already proves. The distinctive checkpoint the task story omits is the **ADR-0182 self-finalization**: after a routed `perm:a:`/`perm:d:` callback, the interaction router emits an `ephemeral-confirm` toast (`Allowed create_task ✅` / `Denied create_task 🚫`) via `formatDecisionConfirmation` (`src/chat/permission-prompt.ts:159`) when both the ephemeral reply capability and the prompt handle exist (`src/chat/interaction-router.ts:29-37`). That event kind is not surfaced by `then.repliesTo` (which exposes only `text`/`formatted`/`replace-text`/`buttons`), so the story must observe it directly on the raw reply log (`world.chat.allReplies()`).

The design (`docs/superpowers/specs/2026-07-23-f8-interaction-story-family-design.md`) and plan (`docs/superpowers/plans/2026-07-23-f8-interaction-story-family.md`) chose a **zero-production-change** family (the F4 precedent, ADR-0306): one new story file, one ledger move (pending → executable), three sharpened forward-only rationale strings, contract-test total updates, and the roadmap's terminal F5–F8 amendment marking the program complete — ledger 100→101 executable / 28→27 pending (era totals; see Implementation Notes).

## Decision Drivers

- **Zero production `src/` change; no new harness seam.** F8 adds only test + doc changes. No new `STORY_SEAM_IDS` id, no new `given.*`/`when.*` seam — the story reuses `given.toolPrefs`, `given.taskInstance`, `when.interaction`, and the scripted-LLM `callCapability`/`answer` surfaces.
- **No assertion-only stories (rule 3).** Every checkpoint is observable behavior: a durable state change gated behind the routed callback (`then.task('Approved').exists()` / `then.task('Refused').absent()`) plus the prompt-finalization payload — never a bare call count.
- **Distinctive proof over the incidental coverage.** The story's subject is the interaction router; its unique assertion is the ADR-0182 self-finalization on the raw reply log, which `SCN-task-ask-confirm` never asserts. The story file carries its own local `waitForPermissionCallback` and finalization helpers — the harness does not export them, and importing another `*.story.test.ts` would execute its scenarios.
- **Ledger rides with the story (rule 5).** The `EXECUTABLE_STORY_MAPPINGS` entry, the removed `ready('F8', …)` audit record, and the contract-test totals land in the same PR as the story. An executable scenario must not also carry an audit record — the contract test asserts `Object.keys(AUDIT_RECORDS)` equals the pending id set.
- **`platform-adapter-fakes` stays deliberately unrealized.** The three wire-level scenarios keep their forward-only pends with rationale sharpened to name the dispatch-layer boundary, not merely the missing fake.
- **Frozen-tree discipline (rule 7).** Adding a file under the frozen `tests/stories/**` tree re-baselines the compat manifest `treeHash`; this is intended and recorded. Runner/sandbox files are untouched.

## Considered Options

### Option 1 — One dedicated story reusing existing seams, observed on the raw reply log + ledger update + terminal roadmap amendment (chosen)

Write `tests/stories/interactions/permission-decision.story.test.ts` (new `interactions/` group directory, sibling to `tasks/`) running the full ask-gate callback roundtrip over the hermetic task-create ask-gate in both arms — allow (`perm:a:` → task exists → `Allowed create_task ✅`) and deny (`perm:d:` → task absent → `Denied create_task 🚫`) — with the finalization read off `world.chat.allReplies()`; move the scenario to `EXECUTABLE_STORY_MAPPINGS`; sharpen the three parked rationale strings; update the contract-test totals; append the roadmap's F5–F8 amendment closing the program.

- **Pros:** zero production change; no new seam; the story's distinctive checkpoint (self-finalization) is genuinely additive over `SCN-task-ask-confirm`; the raw-reply-log read is the honest observation point for a reply kind the `then.*` DSL does not surface; the program closes with every one of the 128 catalog ids carrying either an executable mapping or a named, justified pend.
- **Cons:** the story reaches around the `then.*` DSL to the raw reply log, a pattern the DSL deliberately does not encourage; the local `waitForPermissionCallback` duplicates polling logic that could one day be promoted into the harness (promoting it now would violate the no-new-seam constraint).

### Option 2 — Extend the `then.*` DSL with a finalization assertion surface (rejected)

Add a harness `then.finalization(...)` seam (and a new `STORY_SEAM_IDS` id) so the story asserts the `ephemeral-confirm` through the DSL.

- **Pros:** keeps stories on the DSL; the helper is reusable if more finalization-observing stories appear.
- **Cons:** violates the family's hard constraint of no new seam for a single consumer; a one-scenario abstraction added to the frozen harness tree carries more re-baseline and review cost than a local helper in the story file.

### Option 3 — Build minimal platform-adapter fakes to promote all four scenarios (rejected)

Realize `platform-adapter-fakes` (fake grammY API / discord.js client) so the three wire-level scenarios also become executable.

- **Pros:** the full `interaction-*` family would be executable.
- **Cons:** the wire above `runtime.dispatchInteraction` is Tier-3 platform-integrated territory, explicitly out of the roadmap scope; building speculative fakes for parked scenarios contradicts the program's "no fakes built speculatively" rule and would be justified only if a future refactor touches the chat adapters.

## Decision

Option 1 shipped across three tasks (plus final verification):

1. **The executable interaction-routing story** (`tests/stories/interactions/permission-decision.story.test.ts`). Self-contained file with local `ReplyReader` type, `permissionCallback`/`waitForPermissionCallback` (200-attempt `setImmediate` poll over the reply log for a `perm:a:`/`perm:d:` button callback), and `finalizationConfirmations` (filters `kind === 'ephemeral-confirm'`). The scenario arms `create_task: 'ask'` via `given.toolPrefs`, runs the allow arm (task `Approved` created, `Allowed create_task ✅` finalized) and the deny arm (task `Refused` absent, `Denied create_task 🚫` finalized) in one scenario.
2. **Ledger update and sharpened rationale.** `SCN-interaction-permission-decision` moved from a `ready('F8', …)` audit record to `EXECUTABLE_STORY_MAPPINGS` (`tests/stories/catalog/coverage.ts:515-519`, `verifiedAt: '2026-07-23'`, story id matching the `scenario(...)` title exactly); the three `needs('F8', ['platform-adapter-fakes'], …)` rationale strings replaced with dispatch-layer-boundary wording (`coverage.ts:1186-1203`); the three contract-test totals updated (`catalog-coverage.test.ts`) and the `'marks only platform-adapter interaction scenarios as forward-only'` test strengthened to assert the fourth scenario's promotion to `executable`/`confirmed`.
3. **Roadmap terminal amendment.** The append-only "Reclassifications and amendments (F5–F8)" section landed on the roadmap doc (`docs/superpowers/specs/2026-07-19-story-coverage-expansion-roadmap-design.md:235+`): F5–F8 actuals, the seam-inventory drift table (`assertPublicUrl` realized, `fake-mcp-server` realized/exhausted, `platform-adapter-fakes` and `mattermost-action-fixture` deliberately unrealized), the final ledger trajectory (32/96 → **101/27**), and the "Program complete" note.

## Consequences

### Positive

- The permission-decision roundtrip now has a **dedicated behavioral tripwire**: a refactor that breaks callback routing, the deferred-tool resume/refuse path, or the ADR-0182 self-finalization branch fails a story, not just the incidental task-family coverage.
- The program ledger closed exactly on target: 101 executable / 27 pending with readiness split 0 executable-as-is / 5 needs-seam / 22 blocked — every pending id carries a named, justified reason; zero generic "awaiting branch audit" records remain.
- The three wire-level pends are now **honestly scoped**: their rationale names the dispatch-layer boundary (`runtime.dispatchInteraction`, below the platform adapter), so a future chat-adapter refactor can re-evaluate them on their actual dependency rather than a vague missing-fake note.
- Zero production change and zero new seams — the smallest possible terminal family; the frozen-tree re-baseline is limited to one new story file.

### Negative

- **DSL bypass.** The story reads `world.chat.allReplies()` directly because `then.repliesTo` does not surface the `ephemeral-confirm` kind; if the DSL later grows a finalization surface, this story is a migration candidate.
- **Local helper duplication.** `waitForPermissionCallback` lives only in this file; a second callback-polling story would argue for promoting it into the harness (a deliberate trade against the no-new-seam constraint).
- **Totals fragility by design.** The contract-test totals (101/27 at F8 time) are literals that every later catalog addition must reconcile — the shipped tree has since moved well past them (see Implementation Notes).

### Risks

- **Vacuous-pass risk on the finalization assertion** — mitigated by the plan's Step 3 guard (temporarily corrupting `'Allowed create_task ✅'` and confirming the story FAILs), proving the observable is actually asserted.
- **Determinism surface.** The 200-attempt `setImmediate` poll and the raw-reply-log observation are the stress-lane surface (`bun test:stories:stress`, deterministic seed `41021`); a future dispatch-ordering change could turn the poll flaky — the stress lane is the tripwire.

## Related Decisions

- [ADR-0320](0320-f7-mcp-story-family.md) — F7 MCP Story Family: the immediately preceding family; F8's ledger opens at F7's closing 100 executable, and F8 follows F7's plan-verified-against-tree ADR pattern.
- [ADR-0306](0306-f4-http-story-family.md) — F4 HTTP-Surfaces Story Family: the zero-production-change precedent F8 explicitly follows; also the source of the sibling parked seam `mattermost-action-fixture` recorded in the F5–F8 seam-drift table.
- [ADR-0304](0304-story-catalog-audit.md) — Story Catalog Audit: established the `EXECUTABLE_STORY_MAPPINGS` / `AUDIT_RECORDS` / readiness-state machinery F8's ledger move lands in, and the executable-scenarios-carry-no-audit-record contract.
- [ADR-0284](0284-scenario-catalog-hermetic-stories.md) — the hermetic Tier 0 story harness: defines the `when.interaction` entry point at `runtime.dispatchInteraction` that makes the permission-decision scenario executable and the three wire-level scenarios forward-only.
- [ADR-0211](0211-ephemeral-self-removing-ask-permission-prompts.md) — Ephemeral Self-Removing Ask-Permission Prompts: the ADR-0182-referenced self-finalization behavior (`ephemeral-confirm` toast on decision) that is this story's distinctive checkpoint.
- [ADR-0305](0305-f3-memory-story-family.md) / [ADR-0307](0307-f5-scheduling-story-family.md) — sibling story families whose actuals the terminal F5–F8 roadmap amendment records.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File                                                                                   | Role                                                                                                                                                                                                             | Evidence                                         |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `tests/stories/interactions/permission-decision.story.test.ts`                         | The one executable story; local `waitForPermissionCallback`, `finalizationConfirmations`, both arms with `Allowed create_task ✅` / `Denied create_task 🚫` assertions.                                          | `grep` confirms (`:33`, `:45-48`, `:80`, `:98`). |
| `tests/stories/catalog/coverage.ts:515-519`                                            | `EXECUTABLE_STORY_MAPPINGS` entry, `verifiedAt: '2026-07-23'`, story-id string matching the scenario title exactly.                                                                                              | `grep` confirms.                                 |
| `tests/stories/catalog/coverage.ts:1186-1203`                                          | Three `needs('F8', ['platform-adapter-fakes'], …)` records with the sharpened dispatch-layer-boundary rationale ("below the platform adapter … Tier-3 platform-integrated territory, out of the roadmap scope"). | `grep` confirms verbatim.                        |
| `tests/stories/catalog/coverage.ts`                                                    | No `ready('F8', …)` audit record remains for the promoted scenario.                                                                                                                                              | `grep` confirms (no match).                      |
| `tests/stories/harness/catalog-coverage.test.ts:119-134`                               | Strengthened `'marks only platform-adapter interaction scenarios as forward-only'` test asserting the promotion to `executable`.                                                                                 | `grep` confirms.                                 |
| `docs/superpowers/specs/2026-07-19-story-coverage-expansion-roadmap-design.md:235-287` | "Reclassifications and amendments (F5–F8)" section: F5–F8 actuals, seam-drift table, final ledger trajectory 101/27, "## Program complete".                                                                      | `grep` confirms.                                 |
| `docs/superpowers/specs/2026-07-23-f8-interaction-story-family-design.md`              | The design doc the plan implements.                                                                                                                                                                              | `glob` confirms.                                 |

Plan-vs-implementation notes:

- **Cumulative catalog totals exceed the era target.** The plan's ledger target was 100→101 executable / 28→27 pending (128 ids). Shipped, the catalog now carries **140 executable / 25 pending** (`catalog-coverage.test.ts:216,305`; `executable-as-is` still 0 at `:351`): the tier-expansion roadmap (`docs/superpowers/specs/2026-07-23-tier-expansion-roadmap-design.md`) and later families landed after F8. F8's own mapping at `verifiedAt: '2026-07-23'` and the three sharpened pends are present; the larger totals are cumulative state, not an F8 divergence.
- **The plan's own task checkboxes remain unchecked** in the plan file — the tracking syntax was not updated during execution, but every task's artifact is present in the codebase.
- **The production anchors the plan cited are intact**: the finalization branch at `src/chat/interaction-router.ts:29-37` and `formatDecisionConfirmation` at `src/chat/permission-prompt.ts:159` — no production change was needed or made.

The source plan `docs/superpowers/plans/2026-07-23-f8-interaction-story-family.md` and design `docs/superpowers/specs/2026-07-23-f8-interaction-story-family-design.md` remain in the legacy tree pending archival alongside this ADR to `docs/archive/`.
