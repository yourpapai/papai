<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0304: Story Catalog Audit — Structured Machine-Checked Pending Records

## Status

Implemented (with divergence)

## Date

2026-07-19

## Context

Before this plan, the story catalog (`tests/stories/catalog/coverage.ts`) carried 97 pending scenario records whose entire rationale was the blanket string "Awaiting branch audit". There was no machine-checkable classification of *why* a scenario was pending, no notion of which story family would own its eventual implementation, and no enforced link between a pending id and the test seam (or missing production implementation) that blocked it. The coverage-expansion roadmap (F1–F8) needed to run on data rather than opinion, so the catalog had to become a typed ledger: every pending id annotated with a readiness state, an owning family, and a concrete rationale, plus a builder that throws if any pending id lacks an audit record.

The plan (`docs/superpowers/plans/2026-07-19-story-catalog-audit.md`) is Deliverable 1 of the shared roadmap design (`docs/superpowers/specs/2026-07-19-story-coverage-expansion-roadmap-design.md`). Its scope was threefold: (1) introduce a typed audit model and a complete `AUDIT_RECORDS` table covering every pending id, reclassifying `SCN-cmd-*` (no longer blanket forward-only) and promoting `SCN-interaction-permission-decision`; (2) map the two context core stories (`SCN-context-thread-scope`, `SCN-context-group-identity`); and (3) print a coverage tally into runner output.

## Decision Drivers

- **Replace blanket "Awaiting branch audit" with machine-checked records.** A pending id must carry a readiness state, an owning story family, and a non-blank rationale, and the builder must throw if any pending id is missing its audit record — otherwise the ledger cannot drive the F1–F8 family plans.
- **Readiness as a three-state discriminated union.** `executable-as-is` (works today, just needs a story), `needs-seam` (blocked on a named test seam), and `blocked:missing-implementation` (no production code exists).
- **Reclassify by evidence, not by prefix.** `SCN-cmd-*` ids were blanket forward-only via a `scenarioId.startsWith('SCN-cmd-')` clause in `catalogStatusFor`; that masked which commands were actually ready. The clause is removed so each id classifies by set membership alone. `SCN-cmd-announce` stays `gap` via `GAP_SCENARIO_IDS`.
- **Promote `SCN-interaction-permission-decision` off forward-only.** Permission roundtrips already run via `when.interaction` in the ACP control stories, so it is no longer wire-only; removing it from `FORWARD_ONLY_SCENARIO_IDS` lets it classify as a real story.
- **Map the two context core stories.** `SCN-context-thread-scope` and `SCN-context-group-identity` cover the thread-isolated/group-shared scope model and group identity; both already had executable Tier-0 stories, so they get catalog ids and executable mappings.
- **A coverage-totals module the runner prints.** `scripts/story/coverage-totals.ts` tallies the ledger and `scripts/story/test-stories.ts` prints the summary line from `verifyCompatibility`, so every `--manifest-only` and full run reports executable vs pending counts and readiness totals.

## Considered Options

### Option 1 — Typed audit model with a complete enforced audit table + runner totals (chosen)

Add `AuditRecord` = `readiness × family × rationale` plus the `STORY_FAMILIES`/`STORY_SEAM_IDS` registries, write one `AUDIT_RECORDS` entry per pending id, make the builder throw on a missing record, reclassify `SCN-cmd-*`/`SCN-interaction-permission-decision`, add the two context ids, and emit a totals line from the runner.

- **Pros:** the catalog becomes a self-checking ledger the family plans can consume; a missing audit record fails the contract suite, not a human; readiness totals are visible on every manifest run.
- **Cons:** a large inline table (~96 rows on landing) pressures the file's `max-lines` lint; the audit is a point-in-time snapshot that the family plans must re-baseline as they resolve pends.

### Option 2 — Keep the blanket reason, add only the counts (rejected)

Leave the "Awaiting branch audit" string and only add a totals module.

- **Pros:** smallest change; no table to maintain.
- **Cons:** no machine-checkable readiness, family, or seam data — the F1–F8 roadmap cannot be driven from the catalog, and the divergences between the ledger and reality stay invisible.

## Decision

The chosen Option 1 shipped across the catalog model, the audit table, the reclassifications, the context mappings, and the runner totals.

1. **Audit model added.** `STORY_FAMILIES`/`StoryFamily`, `STORY_SEAM_IDS`/`StorySeamId`, `AuditReadiness` (a three-state discriminated union), and `AuditRecord` (`readiness × family × rationale`) were added to `coverage.ts`; the pending arm of `CatalogCoverage` now carries `audit: AuditRecord`.
2. **`AUDIT_RECORDS` table + enforced builder.** One `AuditRecord` per pending id, built via terse helpers; the pending branch of the `catalogCoverage` builder throws if a pending id has no audit record, so the contract suite catches any drift.
3. **`SCN-cmd-*` reclassified.** The `|| scenarioId.startsWith('SCN-cmd-')` clause was removed from `catalogStatusFor`; command ids now classify by set membership alone, with `SCN-cmd-announce` kept `gap` via `GAP_SCENARIO_IDS`.
4. **`SCN-interaction-permission-decision` promoted.** Removed from `FORWARD_ONLY_SCENARIO_IDS`, so the four interaction ids are 3 forward-only (the platform-adapter wires) + 1 confirmed.
5. **Two context ids mapped.** `SCN-context-thread-scope` and `SCN-context-group-identity` were added to `CATALOG_SCENARIO_IDS` and `EXECUTABLE_STORY_MAPPINGS`, both Tier-0 executable, verified 2026-07-19.
6. **Coverage totals in runner output.** `scripts/story/coverage-totals.ts` tallies the ledger and `scripts/story/test-stories.ts` prints `formatStoryCoverageTotals()` from `verifyCompatibility`, covering both `--manifest-only` and full runs.

## Consequences

### Positive

- The catalog is a self-checking ledger: the builder throws on a missing audit record, every pending rationale is non-blank, every referenced seam is in `STORY_SEAM_IDS`, and every pending id is assigned a known family — all asserted by `tests/stories/harness/catalog-coverage.test.ts`.
- The F1–F8 family plans consume structured readiness/family/seam data instead of a blanket string, so coverage expansion runs on data.
- A coverage-totals line is printed on every manifest/full run, so the executable-vs-pending split and readiness totals are visible without running the stories.
- Reclassifying `SCN-cmd-*` and promoting `SCN-interaction-permission-decision` stopped masking ready command stories behind a prefix rule.

### Negative

- The `AUDIT_RECORDS` table is a point-in-time snapshot: it is not maintained as the family plans resolve pends, so it was re-baselined by the F1–F5 plans (see Implementation Notes). The plan itself documents this with a "snapshot note."
- On landing the inline table (~96 rows) plus the executable mappings pushed `coverage.ts` toward its `max-lines` lint budget; the plan anticipated a possible split into `audit.ts` (which did not happen — see Implementation Notes).

### Risks

- A pending id gaining an audit record but losing its executable story (or vice versa) can silently shift counts; the contract suite guards the `AUDIT_RECORDS` ↔ pending-ids equality and the non-blank/seam/family invariants, but it cannot guard the semantic correctness of an individual rationale.
- The readiness classification is human-authored; a misclassified `executable-as-is` (actually needs a seam) would mislead the family plan that consumes it. Mitigated by the named-seam requirement on `needs-seam` records, which forces the author to name the blocker.

## Related Decisions

- [ADR-0293](0293-settings-story-family.md) — Settings Story Family: the first family plan that consumed this audit's structured records to resolve settings pends into executable stories.
- [ADR-0297](0297-f1-command-meta-story-family.md) — F1 Command & Meta Story Family: re-baselined the F1/cmd/meta pends this audit classified (e.g. resolved the `cmd-stop-*` pair, dropped `compaction-trigger`).
- [ADR-0298](0298-f2a-task-lifecycle-story-family.md) — F2a Task Lifecycle Story Family: consumed the F2 `task-*` readiness records this audit produced.
- [ADR-0299](0299-f2b1-task-provider-surface-story-family.md) — F2b1 Task Provider Surface Story Family.
- [ADR-0300](0300-f2b2-task-integration-surface-story-family.md) — F2b2 Task Integration Surface Story Family.
- [ADR-0284](0284-scenario-catalog-hermetic-stories.md) — Scenario Catalog Hermetic Story Coverage Ledger: established the catalog/coverage ledger this audit re-baselined. See also the hermetic-story harness line: [ADR-0166](0166-storybook-harness-pr1.md), [ADR-0282](0282-hermetic-e2e-master-baseline.md), [ADR-0283](0283-hermetic-story-process-sandbox-phase-1.md), [ADR-0285](0285-hermetic-story-app-local-dependencies.md), [ADR-0286](0286-hermetic-story-docker-all-hosts.md).
- Shared roadmap design: `docs/superpowers/specs/2026-07-19-story-coverage-expansion-roadmap-design.md` (Deliverable 1 is this plan; stays in place for the other roadmap deliverables).

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `tests/stories/catalog/coverage.ts:35-36` | `STORY_FAMILIES`/`StoryFamily` — F1–F8 + `unqueued`. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:38-57` | `STORY_SEAM_IDS`/`StorySeamId` named-seam registry (gained `scheduler-chat-di`, see divergence). | `read` confirms. |
| `tests/stories/catalog/coverage.ts:59-62` | `AuditReadiness` — `executable-as-is` / `needs-seam` / `blocked`; `needs-seam` now carries `unblockedByTier` (see divergence). | `read` confirms. |
| `tests/stories/catalog/coverage.ts:64-68` | `AuditRecord` = `readiness × family × rationale`. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:97-103` | `CatalogCoverage` pending arm carries `audit: AuditRecord`. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:235-236` | `SCN-context-thread-scope`, `SCN-context-group-identity` added to `CATALOG_SCENARIO_IDS`. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:283-287` | `GAP_SCENARIO_IDS` keeps `SCN-cmd-announce` (and the nerv/supervise gaps) `gap`. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:289-296` | `FORWARD_ONLY_SCENARIO_IDS` — `SCN-interaction-permission-decision` removed; 6 entries remain. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:298-303` | `catalogStatusFor` — no `SCN-cmd-` prefix clause; classifies by set membership alone. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:503-514` | Two context ids mapped executable (Tier 0, verified 2026-07-19). | `read` confirms. |
| `tests/stories/catalog/coverage.ts:515-520` | `SCN-interaction-permission-decision` mapped executable (verified 2026-07-23, see divergence). | `read` confirms. |
| `tests/stories/catalog/coverage.ts:1162-1173` | `auditRecord`/`needs`/`blocked` helpers (`needs` takes `unblockedByTier`; `ready` dropped, see divergence). | `read` confirms. |
| `tests/stories/catalog/coverage.ts:1175-1279` | `AUDIT_RECORDS` table (25 entries today, see divergence). | `read` confirms. |
| `tests/stories/catalog/coverage.ts:1281-1304` | `catalogCoverage` builder pending arm — throws on a missing audit record (`:1296`). | `read` confirms. |
| `tests/stories/harness/catalog-coverage.test.ts:11-24` | Imports `AUDIT_RECORDS`/`STORY_FAMILIES`/`STORY_SEAM_IDS` from `../catalog/coverage.js`. | `read` confirms. |
| `tests/stories/harness/catalog-coverage.test.ts:270-277` | `promotes command scenarios…` — 16 cmd ids, 15 confirmed + `announce` gap. | `read` confirms. |
| `tests/stories/harness/catalog-coverage.test.ts:279-300` | `maps the context core stories…` — both context ids executable. | `read` confirms. |
| `tests/stories/harness/catalog-coverage.test.ts:302-307` | `audit records cover exactly the pending scenarios` — `AUDIT_RECORDS` keys == pending ids (25 today, see divergence). | `read` confirms. |
| `tests/stories/harness/catalog-coverage.test.ts:321-329` | `references only known seams` — every seam in `STORY_SEAM_IDS`. | `read` confirms. |
| `tests/stories/harness/catalog-coverage.test.ts:348-354` | `audit readiness totals match the audit outcome` — 0/3/22 today (see divergence). | `read` confirms. |
| `scripts/story/coverage-totals.ts:23-46` | `storyCoverageTotals` tallies the ledger; now also per-tier (see divergence). | `read` confirms. |
| `scripts/story/coverage-totals.ts:52-58` | `formatStoryCoverageTotals` — multi-segment format line (see divergence). | `read` confirms. |
| `scripts/story/test-stories.ts:11,189` | Imports + calls `formatStoryCoverageTotals()` inside `verifyCompatibility`. | `read` confirms. |
| `tests/scripts/story-coverage-totals.test.ts:11-28` | Totals/format contract — 165/140/25 today (see divergence). | `read` confirms. |

Plan-vs-implementation notes:

- **The audit table was re-baselined by the F1–F5 family plans.** The plan's Task 1 wrote a complete 96-row `AUDIT_RECORDS` table (18 `executable-as-is`, 56 `needs-seam`, 22 `blocked`) against 128 ids / 81 executable / 47 pending. Shipped, `AUDIT_RECORDS` (`coverage.ts:1175-1279`) holds only 25 entries (0 `executable-as-is`, 3 `needs-seam`, 22 `blocked`) against 165 ids / 140 executable / 25 pending (`story-coverage-totals.test.ts:11-20`). The family plans resolved nearly all `executable-as-is`/`needs-seam` pends into real executable stories (F1's `cmd-stop-*` pair and dropped `compaction-trigger`, F2's three-way split into F2a/F2b1/F2b2, F3's `fetch-chat-link` correction, F4's `http-mcp-plugin`→F7), shrinking the pending set; the structural model this plan introduced (`AuditRecord` readiness × family × rationale, the enforced builder, the family/seam registries) is preserved verbatim. The plan's own "snapshot note" flags that the table is a point-in-time snapshot, not maintained as families execute.
- **`AuditReadiness.needs-seam` gained `unblockedByTier: StoryTier`.** The plan's `needs-seam` arm was `{ state; seams }`. Shipped (`coverage.ts:61`) it is `{ state: 'needs-seam'; seams; unblockedByTier: StoryTier }`, and the `needs` helper (`coverage.ts:1166-1171`) takes the tier positionally; the contract suite asserts it (`catalog-coverage.test.ts:331-346`). This ties each seam-pending to the tier that will unblock it (part of the tier-expansion work layered on top), which the plan did not model. The `ready` helper from the plan is gone because no `executable-as-is` records remain (all were resolved into executable stories).
- **`STORY_SEAM_IDS` grew.** The plan defined 16 seam ids; shipped has 17 — `scheduler-chat-di` (`coverage.ts:51`) was added by later scheduling work.
- **`SCN-interaction-permission-decision` became executable, not merely "ready".** The plan promoted it off forward-only and left it a pending `ready` audit record. Shipped it has a real executable Tier-0 story mapping (`coverage.ts:515-520`, verified 2026-07-23), so it is no longer pending at all — resolved by the F8 interaction work.
- **`coverage-totals.ts` outgrew the single summary line.** The plan's module returned `{ total, executable, pending, readiness }` and a one-line format. Shipped it also returns `executableByTier`/`pendingByUnblockingTier` tallies and a three-segment format line (per-tier executable, readiness, pending-unblocked-by-tier); the original readiness totals are preserved as a segment.
- **The catalog grew past 128 ids via later lanes.** The plan landed at 128 ids; shipped `CATALOG_SCENARIO_IDS` has 165, enlarged by the `@1` provider-real parity lane (12+17 ids), the `@2` process-real smoke lane (8 ids), and the `@3` platform-adapter lane, all layered on after this audit. The two context ids and the cmd/interaction reclassifications this plan added are all still present.
- **`coverage.ts` was not split.** The plan's Step 4 file-size note anticipated a possible `max-lines` split into `audit.ts`. Shipped, `coverage.ts` is a single 1305-line file (the table is far smaller than planned because of the re-baselining, which is why the split was unnecessary); no `audit.ts` exists.

The source plan `docs/superpowers/plans/2026-07-19-story-catalog-audit.md` is archived alongside this ADR to `docs/archive/`; this plan had no dedicated design doc (it is Deliverable 1 of the shared roadmap spec `docs/superpowers/specs/2026-07-19-story-coverage-expansion-roadmap-design.md`, which stays in place for the other roadmap deliverables).
