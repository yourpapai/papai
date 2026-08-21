<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Global-refactor behavior-coverage roadmap

**Status:** approved

**Date:** 2026-08-04

## Goal

Make the test program sufficient to qualify a global production refactor: every
implemented, documented behavior has an auditable scenario inventory and is
proven at the cheapest tier that can exercise its regression boundary.

Qualification is not a claim that unimplemented product ideas work. Records
marked `blocked:missing-implementation` remain visible but cannot count as
coverage for production behavior.

## Current state

The repository already has five defined tiers and a bidirectional scenario
catalog. Tier 0 is a frozen, hermetic, full-stack compatibility proof; Tiers
1-4 cover provider-real, process-real, platform-adapter, and operational
boundaries respectively.

The current ledger reports 202 executable records out of 224, with 22 blocked
records. The Tier 0 story coverage command currently executes all stories but
fails its ratchet: 66.02% lines and 62.08% functions are below committed floors
of 71% and 70%. The current branch's merge-base predates frozen harness inputs,
so it cannot serve as a compatibility baseline.

The catalog's bidirectional census prevents an authored story from being
uncataloged, but it cannot reveal a documented behavior that was never made a
catalog record. The documented behavior inventory contains such gaps, including
mid-turn steering, live status lifecycle, open-DM identity provisioning and
blocking, alert edge triggering, participant resolution, the release-note
workflow, and analytics governance.

## Coverage model

Introduce one canonical implemented-behavior ledger. It reconciles the
documented behavior inventory with the existing scenario catalog rather than
only reconciling scenarios that already exist.

Each behavior record contains:

- a stable behavior ID and source declaration;
- domain and refactor-risk class;
- implementation state: `implemented`, `blocked:missing-implementation`, or
  `retired`;
- the required scenario matrix for its boundary: primary behavior,
  authorization/routing, failure/recovery, persistence/scope, and any external
  boundary case;
- the cheapest proving tier, executable story IDs, and explicit non-E2E proof
  only where a scenario is unnecessary;
- verification freshness and the change surface that requires revalidation.

A contract test enforces that every implemented behavior is represented, every
executable scenario is claimed or explicitly supporting, and every behavior has
the required matrix entries or a specific inapplicability rationale. A new
behavior, scenario, or tier claim without a ledger decision fails CI.

Tier 0 remains the sole frozen-harness compatibility instrument. Tiers 1-4 are
regression lanes: they prove boundaries Tier 0 deliberately fakes and do not
replace the compatibility proof.

## Delivery phases

### Phase 0: Repair the qualification baseline

Rebase qualifying refactors onto a committed baseline that contains every
frozen input, record its SHA and manifest tree hash, and require compatibility
preflight followed by execution. Diagnose the Tier 0 coverage shortfall and
restore the existing 71% line and 70% function floors without lowering them.

The diagnosis changed the second half of that instruction; see
[Foundation baseline](#foundation-baseline) for what was recorded and why the
floors were re-recorded rather than restored in place.

The global-refactor admission command set is initially:

1. `bun test:stories:contracts`
2. `bun test:stories:coverage`
3. `BASE_REF=<recorded-baseline> bun test:stories:compat --manifest-only`
4. `BASE_REF=<recorded-baseline> bun test:stories:compat`

### Phase 1: Reconcile the behavior inventory

Create the ledger from the documented behavior declarations and reconcile it
with the 224 existing catalog records and all T0-T4 declared scenarios. Classify
every behavior as implemented, blocked, or retired; classify every implemented
behavior by risk and proving tier. This phase adds no speculative test seams.

The reconciliation gate is complete only when no implemented behavior lacks a
record, no executable scenario lacks an accountable record, and every matrix
exception states why that dimension does not apply.

### Phase 2: Close Tier 0 in-process behavior gaps

Add hermetic full-stack stories for the highest-risk uncovered runtime paths:

- mid-turn steering at a tool boundary, one active run per context, graceful
  and forced interruption, and honest partial-effect reporting;
- live-status creation, tool labels, timing coalescence, preparing-response
  placeholder, error cleanup, and disabled or unsupported-status capability;
- pending username rebinding, open-DM user provisioning, blocked-user denial,
  and group-member resolution denial;
- alert initial-match, unchanged-match suppression, leave/re-entry, and
  cooldown behavior;
- participant-resolution ranking, fallback labels, scope, and delivery mention
  population;
- release-note discovery, central-model-only humanization, admin review,
  opt-in delivery, idempotency, and failure isolation;
- analytics in-process governance: kill switch, lane selection, guest
  restrictions, fail-closed pseudonymous eligibility, and no-disclosure
  assertions.

Stories use existing world and fixture boundaries where possible. Any new seam
is narrow, deterministic, and introduced in its own reviewed task before the
stories that depend on it. The frozen harness may change only on master before a
new compatibility baseline is recorded.

### Phase 3: Close provider and process boundaries

Tier 1 expands parity only for normalized provider capabilities not already
covered by the shared expectation set, with a recorded exclusion for any
provider-specific impossibility. It remains responsible for real Kaneo API and
container behavior.

Tier 2 expands the built-process matrix for configuration validation, migrations,
plugin discovery and lifecycle, protected route binding, deterministic model
ingress, graceful shutdown, and failure exits. A process scenario must assert an
observable result, not merely that a container booted.

### Phase 4: Close platform and operational boundaries

Tier 3 covers real adapter behavior against deterministic platform fakes:
Telegram and Discord reply-to-bot routing, commands and callbacks; Mattermost
permalink, action, and response behavior; Kontur formatting and lifecycle.

Tier 4 adds a production clock seam only if it is required to prove operational
semantics. It covers recurrence across time zones and DST, at-least-once and
idempotent scheduler execution, proactive delivery, poller lifecycle, and
restart recovery of due work.

### Phase 5: Refactor admission and sustained assurance

Define a checked changed-surface-to-lane map. A global production refactor always
runs the Phase-0 Tier 0 qualification commands plus every tier selected by its
changed runtime surfaces. Tier 3 and Tier 4 stay nightly by default, but a
focused scenario moves into PR gating for a refactor that changes its boundary.

The ledger update, story coverage ratchet, mutation ratchet, and selected-lane
evidence are required in the same change. Periodic stress, cross-tier
consistency, and baseline recertification keep the evidence current.

## Scenario oracles and failure rules

Every scenario has both a user-visible oracle and a system oracle. User-visible
oracles are replies, status transitions, authorization outcomes, callback
responses, or proactive deliveries. System oracles are durable state observed on
a later turn, exact sanitized outbound requests, normalized provider results,
process/route behavior, or absence of leakage and duplicate delivery.

Denials must leave no durable mutation. External failures must be translated
without exposing credentials. Scheduler and delivery cases prove the production
idempotency and recovery semantics rather than adding retry behavior solely for
tests. Hermetic scenarios retain strict undeclared-I/O, environment, timer,
listener, and fixture-consumption enforcement.

## What closes a dimension

Since `ledger-dimension-tiers`, evidence is keyed by the coverage dimension it
proves, which makes "when may a dimension flip from open to proven?" a question
the ledger asks on every record. The spec's `Ledger entries are evidence-bearing`
requirement answers only the negative half — `blocked:missing-implementation`,
`retired` and `partial` are not evidence — so the positive bar is set here.

**A dimension closes on one scenario per distinct claim that dimension makes.**
Not one scenario per dimension, and not one per sub-behavior of the documented
bullet.

That rule is read off the ledger rather than imposed on it. The thirteen
dimensions closed before this section was written carry sixteen scenarios, and
the five that carry two carry two because the dimension makes two claims:
`thread-scoped-contexts` proves persistence-scope over both thread-shared config
and Discord's channel resolution; `guest-readonly` proves authorization-routing
over both a denied tool and an admin-only toggle; `settings-only-configuration`
proves primary over both first-run configuration and the single-use link. The
dimensions that carry one make one claim.

The alternative bar — a dimension closes when its whole `docs/architecture/behaviors.md`
bullet is covered — is rejected, because it would apply only to records written
after it. `repo-catalogue`'s bullet carries roughly ten items and its three
dimensions closed on three scenarios; holding Phase 2's behaviors to the bullet
would make `implemented` mean one thing for records written before the change and
another for records written after, and a ledger whose green cells are not
comparable cannot admit a refactor. Raising the bar is legitimate, but it is a
retro-fit that reopens the five implemented records, not a Phase 2 decision.

The bar is calibrated to what this instrument is for. The ledger admits a
**refactor**, so its question is whether restructuring production code breaks
something observable, and Tier 0 stories run the full stack from chat input
through real composition — which is what detects wiring and composition damage.
Branch-semantics drift is caught by the blocking mutation ratchet, which judges
the whole branch diff, and external-boundary damage by the Tier 1-4 regression
lanes. Making the ledger carry all three duplicates gates already paid for, in
the most expensive currency available: every frozen-input edit retires the
qualification baseline.

**A closing rationale states what the scenario proves and what remains unproven
within that dimension.** Open records already name their residue precisely; the
natural edit when a dimension closes deletes that sentence, and nothing in
`coverageGaps()` would notice, since it checks only that the rationale is
non-blank. The residue must survive the close, so that a later decision to raise
the bar has something to work from.

This calibration assumes a structural refactor — moving, renaming and
recomposing. A refactor that rewrites decision logic in place weakens the
wiring/semantics split above, and should revisit this section before relying on
it.

## Completion criteria

The roadmap is complete when:

1. Every implemented documented behavior is present in the ledger with its
   required scenario matrix.
2. The Tier 0 coverage command is green at or above its committed floors.
3. The global-refactor compatibility baseline is valid, frozen, and produces a
   green preflight and execution proof.
4. Every lane selected by the checked refactor-impact map is green.
5. All remaining uncovered records are explicitly retired or
   `blocked:missing-implementation`; neither state is used as evidence for an
   implemented behavior.

## Non-goals

- Claiming that live SaaS tenants or a real LLM are required for refactor
  qualification.
- Replacing Tier 0 compatibility with slower external-boundary lanes.
- Lowering coverage thresholds to obtain a green build.
- Implementing blocked product features merely to remove ledger records.
- Rewriting unrelated unit coverage or existing stable harness mechanics.

## Delivery constraints

- Each phase is decomposed into independent spec, plan, and implementation
  cycles; this program document is not one implementation plan.
- Every scenario is assigned to the lowest tier that proves its boundary.
- No retries mask flaky evidence. A flaky PR-gate test is fixed or moved to an
  explicitly non-qualifying lane with a ledger note.
- Harness, catalog, and baseline changes land on master before branches rely on
  them for a compatibility claim.

## Foundation baseline

Recorded 2026-08-21 from `origin/master` at the merge of PR #322, superseding
`2e1630c0609744a3ec4f87f15a47735657419cef` (tree hash
`04d272db4dac667d4736c3f6d5a949fc5bb1c9787c1cbb2118d4c244347cdfee`), retired by
`ledger-dimension-tiers` — keying behavior-ledger evidence by coverage dimension
edits two frozen inputs, `tests/stories/catalog/behaviors.ts` and
`tests/stories/harness/behavior-coverage.test.ts`. That baseline in turn
superseded two taken on 2026-08-20 and retired the same way:
`b8badfbbfa02485e4fa2d6a0818682dbd8a4c12a` (tree hash
`5f5db4a39db11d56d084612836b827bd271579ee04dcb6271ef43592288809f1`) and
`cfe3da15087e40950b3a2ff94ef65cc4d5fe97f9` (tree hash
`c289d710ca91c37534d7450ded5e7550cc11dee84d04c4ea04d54f233b295e04`). A
qualifying refactor measures against the literals below.

| field | value |
| --- | --- |
| `baselineSha` | `d17459ee57588a5ff5e4dfb5edfc9b6b525e4273` |
| `treeHash` | `d05c67bc673db27449dacc9b7aa23dc2fd07b3785c88689c7be0ea1d9f980034` |
| frozen inputs | 173 files |
| manifest scenarios | 192 |
| bun | 1.3.13 |
| story seed | 41021 |

Verified green on that commit:

1. `bun test:stories:contracts` — 453 pass, 0 fail, 24 files
2. `bun test:stories:coverage` — 191 pass, 0 fail; lines 72.68%, functions
   71.14%, against floors 0.72 / 0.70
3. `bun test:stories:manifest` — 232/254 catalog records executable
   (T0 178, T1 29, T2 8, T3 16, T4 1)
4. `BASE_REF=d17459ee57588a5ff5e4dfb5edfc9b6b525e4273 bun test:stories:compat --manifest-only`
5. `BASE_REF=d17459ee57588a5ff5e4dfb5edfc9b6b525e4273 bun test:stories:compat`

The lane measures a little above the numbers the floors were ratcheted from
because the merge brought master's files into scope; the floors are left where
`story-coverage-floor-climb` set them rather than re-ratcheted from a merge
measurement.

### Why the floors read 0.72 / 0.70

The earlier baseline re-recorded the floors at 0.68 / 0.65 rather than restoring
the 0.71 / 0.70 that `a20e59c06` had raised from a green run over **895** scoped
source files. The tree had grown to 1104 files (1048 after the runtime-code
filter) while the story lane gained only 8 story files, and `meanMetric` is an
unweighted mean of per-file ratios with unloaded files seeded at 0%, so the file
count moved the number by itself. That floor measured a materially smaller tree,
not this one.

`openspec/changes/story-coverage-floor-climb/` closed the 43.3-function-unit gap
that restatement named, by writing Tier 0 stories over the zero-function files in
`plugins/task-provider-kaneo/`, `plugins/task-provider-youtrack/`,
`src/analytics/governance/`, `src/analytics/derive/` and
`src/debug/settings/admin/`. The ratchet then wrote 0.72 / 0.70 from the green
run above, using its own epsilon convention
`floor((measured - 0.005) * 100) / 100` (`nextFloor` in
`scripts/coverage/ratchet-lib.ts`). The lines floor lands one hundredth above the
change's 0.71 target because the sections bought to clear functions carried lines
with them. `meanMetric` and `story-scope.ts` were not touched.

### Scope of this baseline

`scripts/story/coverage-floor.json` is **not** a frozen input — it is absent
from the manifest's 173 files. The compatibility proof is behavioral, so a
refactor is measured against the frozen suite rather than against whatever
floor was in force when the baseline was taken. Changing the floor value alone
does not retire this baseline; editing anything under `tests/stories/**`,
`scripts/story/**`, or the other frozen inputs does.

This SHA is a master commit, so the Delivery constraint that a baseline other
branches cite must sit on master is satisfied on the day it is recorded: any
branch may rebase onto it and claim compatibility, with no intervening PR.
