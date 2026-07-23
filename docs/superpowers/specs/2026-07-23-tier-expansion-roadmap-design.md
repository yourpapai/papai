<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Tier expansion roadmap

**Status:** proposed

**Date:** 2026-07-23

## Context

The story coverage-expansion roadmap
(`2026-07-19-story-coverage-expansion-roadmap-design.md`) has run to completion:
families F1–F8 all landed, taking the catalog from 29 executable scenarios to
**101 executable / 27 pending**. That roadmap's own success metric — "every
remaining pend carries a named, justified reason" — is met.

What it could not do is close pends that Tier 0 structurally cannot reach. Of the
27 remaining:

- **22** are `blocked:missing-implementation` (10 `nerv-*`, 10 `supervise-*`,
  `cmd-nerv`, `cmd-announce`) — no production code exists; no test tier fixes
  that.
- **5** need real chat-adapter code to execute (`interaction-telegram-callback`,
  both discord router ids, `fetch-chat-link`, `http-mattermost-action`) — that is
  Tier 3 by definition.

So the closable remainder is exactly the higher-tier work the tiering design
(`2026-07-13-hermetic-story-hardening-and-tiering-design.md`) deferred: its
delivery phase 5 ("Tier 4 scheduler scenarios with virtual time and Tier 3
platform checks"), plus Tiers 1 and 2, which were listed but never chartered in
detail.

Meanwhile the harness has grown a second, larger blind spot the F-queue created:
F2b1/F2b2 expanded `MemoryTaskProvider` to roughly 15 method groups, and 21
`task-*` stories now assert against it — but **nothing proves the fake behaves
like Kaneo**. If the fake drifts, all 21 stories stay green while production
breaks. That is a coverage regression introduced by success at Tier 0, and only
Tier 1 can detect it.

This is a **program document**, in the same form as its predecessor: it produces
one machine-checked deliverable plus a sequenced queue, and mandates that each
tier gets its own spec→plan→implementation cycle.

## Deliverable 1: the tier-aware ledger

Lands first, alone, reviewed independently — the analogue of the F-queue's
structured audit. It converts "which tier proves this?" from prose into checked
data before any tier is built.

### 1a. One canonical taxonomy

Two tier tables are currently live and they disagree.
`docs/superpowers/e2e-planning-workflow.md` defines Tier 2 as "Runtime E2E — real
papai runtime with controlled chat injection and deterministic model boundary",
which is precisely what Tier 0 does today, in-process and hermetically. Built as
written, Tier 2 would be a slower duplicate of Tier 0.

Resolution: the tiering design's table is canonical, Tier 2 is re-chartered
around the **process boundary**, and the planning-workflow table is demoted to a
pointer.

| Tier         | Charter (canonical)                                                                                                                           | Still fakes                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 0.1 / 0 / 0Q | hermetic in-process stories, harness contracts, frozen-harness compatibility proof                                                            | process, provider, platform, clock, LLM |
| 1            | provider-real: real Kaneo/YouTrack behind the normalized provider interface                                                                   | process, platform, clock, LLM           |
| 2            | **process-real smoke**: the built artifact boots and serves — migrations, env validation, plugin discovery/lifecycle, route binding, shutdown | platform, clock, LLM                    |
| 3            | platform-integrated: real grammY / discord.js / Mattermost client code against fake platform servers                                          | clock, LLM                              |
| 4            | operational: virtual clock, schedulers, recurrence, proactive delivery, restart recovery                                                      | LLM                                     |

Tier 2's former charter is deleted, not moved: Tier 0 owns controlled chat
injection and the deterministic model boundary.

### 1b. Schema migration in `tests/stories/catalog/coverage.ts`

Every catalog record gains a **proving tier** — the lowest tier that can prove
the behavior. `kind: 'executable'` becomes tier-qualified (`executable@0`,
`executable@3`, …), and every pend's `readiness` names the tier that unblocks it
in addition to its seam.

Baseline assignment is mechanical and follows from data already in the ledger:

- the 101 current executables → `@0`;
- the 5 platform-adapter pends → `@3`;
- the 22 `blocked:missing-implementation` ids → no tier (product work, not test
  work — a tier assignment would misrepresent them as reachable).

### 1c. Tier 0.1 contract extensions

Landing in the same PR as the migration:

- a record's mapped story file must live in its tier's suite directory;
- no record may claim a tier whose lane does not exist yet — a `planned` tier is
  permitted but counted separately, so projections never masquerade as coverage;
- per-tier totals print into the runner manifest, so PR output surfaces five
  numbers instead of one.

### 1d. 0Q remains Tier 0-only

The compatibility proof depends on byte-identical harness hashes; Docker-,
provider-, and platform-backed tiers cannot supply them. Tiers 1–4 are regression
lanes, not qualification instruments. Stated here explicitly so no later tier
spec extends 0Q by drift.

### 1e. Consequence: two tiers extend the catalog, not just re-tier it

Tier 2 and Tier 4 need scenario ids that do not exist. Startup, migration,
shutdown, and virtual-clock behaviors were never enumerated by the original
catalog, because the catalog was written from the conversational-behavior surface.
Those tiers therefore extend `CATALOG_SOURCE`, and their specs must justify each
minted id the way the F-queue's audit justified each reclassification.

## Deliverable 2: the tier queue

Ordered cheapest-first. Tier 1 already exists in some form, so retro-fitting it
validates the Deliverable 1 schema against real data before any new lane is
constructed.

Tier 1 today is `tests/e2e/*`: ten suites calling the Kaneo plugin's client
functions (`plugins/task-provider-kaneo/create-task.js` and siblings) directly
against a Dockerized Kaneo. It never crosses the orchestrator or the tool loop,
and it carries no catalog ids.

| #      | Tier                | Scope                                       | Charter and pre-work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Lane                  |
| ------ | ------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **T1** | Provider-real       | retrofit 10 suites + ~15–25 minted `@1` ids | **Fake-fidelity parity is the headline**: one expectation set executed twice — against `MemoryTaskProvider` (Tier 0) and against real Kaneo (Tier 1). Pre-work: mint provider-surface catalog ids (none exist); a shared parity-table harness; a pinned Kaneo image; a YouTrack decision (no usable image today — likely stays forward-only, resolved by T1's own spec).                                                                                                                                                                        | **PR gate**, budgeted |
| **T2** | Process-real        | ~6–10 minted `@2` ids                       | Prove what `world.ts` fakes: built artifact boots, migrations apply from an empty DB, required-env validation fails correctly, plugin discovery and lifecycle in the real process, settings/debug/admin/mcp surfaces bind, graceful shutdown drains. Plus exactly one full chat turn through the real process. Pre-work: an out-of-process deterministic LLM (OpenAI-compatible fake server replacing the in-process scripted-LLM DI) — new machinery T3 later reuses; a minimal controllable ingress; reuse of the existing `papai:e2e` image. | **PR gate**, hard cap |
| **T3** | Platform-integrated | 5 pends → `@3`                              | Closes the F-queue's unfinished business: `interaction-telegram-callback`, both discord router ids, `fetch-chat-link` (Mattermost REST resolver), `http-mattermost-action`. Pre-work: fake platform **servers** (HTTP/WS) rather than library-level fakes, so real grammY/discord.js/Mattermost client code executes end to end; the strict-HTTP dispatcher is the pattern to build on.                                                                                                                                                         | Nightly               |
| **T4** | Operational         | ~8–12 minted `@4` ids                       | Where F5 explicitly gave up: virtual clock, recurrence rollover across DST and timezones, scheduler at-least-once and idempotency, proactive delivery, restart recovery of due work. Pre-work: **the production clock seam** (tiering phase 5) — the program's only planned `src/` change, reviewed as its own commit. F5's seeded-due-row stories stay `@0` and are not migrated.                                                                                                                                                              | Nightly               |

**Projected ledger outcome:** 101 → roughly 135–150 executable across tiers;
pends 27 → 22, and every one of the remaining 22 is
`blocked:missing-implementation`. In other words, if T1–T4 land, **every closable
pend is closed** and the residue is product work.

## Execution rules

Binding on every tier spec that follows.

1. **One tier per spec→plan cycle.** A tier that exceeds its budget splits; T1's
   retrofit and its parity lane may split, decided by T1's own spec, not here.
2. **The ledger migration lands first and alone**, before T1 — the analogue of
   "harness-seam task lands first" in every family plan.
3. **No assertion-only stories, at any tier.** A green boot is not a Tier 2
   scenario; "the process serves a settings page after migrating an empty
   database" is. The settings-family precedent applies unchanged upward.
4. **No retries, ever.** A flaky PR-gate scenario is quarantined to the nightly
   lane in the same PR that observes it, with a ledger note recording why. A
   retried gate stops being a gate.
5. **A stated PR wall-clock budget.** T1 measures the current suite and sets the
   ceiling; it is not guessed in this document. A lane that exceeds its ceiling
   moves to nightly rather than slowing the inner loop.
6. **Frozen-tree discipline.** Tier 1–4 work must not touch runner or sandbox
   files, nor alter Tier 0 harness hashes. A tier PR that re-baselines the compat
   manifest is wrong until argued otherwise.
7. **Ledger updates ride with the tier's PR**: proving-tier assignments, per-tier
   totals in manifest output, accurate `verifiedAt`.
8. **Reclassification is auditable.** Every tier reassignment records its
   rationale, as rule 6 of the coverage roadmap.

## Success metrics

- Taxonomy: two conflicting tables → one; `e2e-planning-workflow.md` demoted to a
  pointer.
- Every catalog record carries a proving tier; the manifest prints five totals.
- Closable pends: 5 → 0. Remaining pends are 22, all
  `blocked:missing-implementation`.
- Fake fidelity: every `MemoryTaskProvider` method group asserted by a `task-*`
  story has a Tier 1 parity counterpart or a recorded reason it cannot.
- The PR-gate wall-clock delta stays inside the declared budget.

## Out of scope

- `nerv-*` / `supervise-*` (20 ids), plus `cmd-nerv` and `cmd-announce` — no
  production implementation, unchanged from the coverage roadmap.
- Real SaaS platform accounts or live Telegram/Discord/Mattermost tenants; Tier 3
  is fake-server-based.
- Extending 0Q beyond Tier 0.
- Rewriting existing Tier 0 stories to run at higher tiers. Tiers add coverage;
  they never migrate it.

## Dependencies and risks

| Risk                                                          | Mitigation                                                                                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker flake reaches every PR once T1/T2 gate                 | Rule 4 quarantine plus the rule 5 budget; T1 measures before promoting, and a lane that cannot hold green goes nightly                         |
| T2 and T3 fork two overlapping ingress fakes                  | Queue order forces T2 to build the shared deterministic-LLM server; T3's spec must extend it and say so in its deviations section              |
| The clock seam (T4) is a production `src/` change             | Reviewed as its own commit ahead of any T4 story; if it proves invasive, T4 stays partial and nightly rather than forcing the seam             |
| Kaneo drift silently breaks T1                                | Version-pinned image; a provider upgrade is a deliberate, reviewed ledger event                                                                |
| The schema migration destabilizes the compat-critical catalog | It lands alone (rule 2) with Tier 0.1 contracts extended in the same PR; all 101 existing records receive `@0` mechanically, with no judgement |
| Tier specs invalidate these estimates                         | Rule 7 keeps the ledger truthful as they do — the same mechanism that kept the F-queue honest when F2 became three specs                       |
