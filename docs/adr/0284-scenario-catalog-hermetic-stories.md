<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0284: Scenario Catalog Hermetic Story Coverage Ledger

## Status

Implemented (with divergence)

## Date

2026-07-13

## Context

The hermetic full-stack story harness (ADR-0282) and its OS sandbox (ADR-0225, ADR-0283) gave papai a deterministic, kernel-isolated Tier 0 lane that proves a chat/HTTP message produces the same user-visible outcome end to end. What that lane did **not** have was an inventory: it could prove *a* story, but it could not answer "which user-visible behaviors in the product are actually covered, and which are still gaps?" The authoritative behavior list lived in an **external** scenario catalog (`~/Projects/kontur/kiss-code_review-papai/papai/scenarios/catalog.md`) — a peer workspace — holding 126 records tagged `confirmed` (102), `forward-only` (19), `gap` (4), and `contract-only` (1). That catalog was review evidence, never a test dependency: reading it at test time would make the suite non-hermetic and would let a record silently look "covered" because a component unit test touched it.

The design (`docs/superpowers/specs/2026-07-13-scenario-catalog-hermetic-stories-design.md`) and plan (`docs/superpowers/plans/2026-07-13-scenario-catalog-hermetic-stories.md`) therefore required a **repository-local, machine-checked coverage ledger** that captures the catalog snapshot identity (so the suite stays hermetic) and classifies **every** scenario ID exactly once as either *executable* (names a literal `SCN-*` story that runs through the real runtime) or *pending* (with a concrete, non-blank reason and the missing feature or fake seam). Pending had to be reporting data — never `test.skip`, an expected failure, or a way to make an unsupported path look tested. Each reachable record would prove both the happy result and its safety oracle (no mutation / no outbound request / no capability advertisement on the failure branch); records absent from the branch would stay pending with branch-audit evidence rather than a false test.

## Decision Drivers

- **Hermetic inventory.** The catalog is external review evidence; the suite must never read it at runtime. Its IDs and provenance are snapshotted into the repository so a green run means a real, reproducible proof.
- **Every record classified exactly once.** The ledger must account for the entire catalog — no orphans, no duplicates — so the covered-vs-pending total is always visible and honest.
- **Pending is explicit evidence, not silence.** An unimplemented, gap, or contract-only record carries a precise reason and, where applicable, the missing feature or fake transport needed to make it executable. There must be no way to construct an unreasoned pending entry.
- **Literal story identity links catalog to code.** Each reachable record maps to a declared `scenario('SCN-…')` whose name begins with the catalog ID, giving the story manifest a stable, human-readable link without forcing one file per record.
- **Real runtime path only.** A record counts as executable only when its story drives the real in-process composition (chat/HTTP ingress → authorization → capability assembly → scripted LLM tool loop → real tool/store/strict-HTTP fake → reply). Calling a production tool directly to claim end-to-end coverage is forbidden.
- **Happy path + safety oracle.** Coverage means the requested result *and* the relevant safety boundary (no write, no forbidden side effect, no credential exposure) are both asserted from catalog variants, not duplicated generic error tests.
- **Branch-honest classification.** A `confirmed` catalog status is necessary but not sufficient; a record becomes executable only after the actual branch path and required hermetic fake are verified.

## Considered Options

### Option 1 — repository-local machine-checked ledger + discriminated executable/pending classification + literal `SCN-*` story identity through the real runtime (chosen)

Snapshot the catalog IDs into a frozen `CATALOG_SCENARIO_IDS` array; build one `CatalogCoverage` entry per ID as a discriminated union (`executable` → literal story ids; `pending` → non-blank reason + readiness state). A harness contract test validates every ID appears exactly once, no executable entry references an undeclared story id, and every pending entry has a reason. Stories reuse `ScenarioWorld` and only its public `given`/`when`/`then` API through the real `PapaiRuntime`.

- **Pros:** keeps the suite hermetic (no peer-workspace read); makes the covered/pending total machine-checkable; a missing or stale story reference fails the contract; pending is honest reporting, never a skipped test; literal IDs give a stable catalog→code link.
- **Cons:** requires hand-maintaining the snapshot and audit reasons as the catalog and branch evolve; the contract test is only as honest as the audit reasons an author writes.

### Option 2 — read the external catalog at test time and assert against it

Have the suite load `scenarios/catalog.md` and derive coverage from it.

- **Pros:** no snapshot drift; the catalog is the single source of truth.
- **Cons:** makes the peer workspace an undeclared test dependency — the suite is no longer hermetic and a checkout without the sibling repo fails; the catalog carries no machine-checkable link from an ID to the story that proves it; explicitly rejected by the design as a non-goal ("Editing/reading the external scenario catalog").

### Option 3 — one story file per catalog record

Mirror the catalog's record granularity in the file tree.

- **Pros:** trivial 1:1 record↔file mapping.
- **Cons:** explodes the file count (126+); happy and unhappy branches that share fixtures must duplicate setup; the design explicitly allows a record to share a file with its counterpart ("Stories may share setup and reside in feature-family files").

### Option 4 — `test.skip` / expected-failures for unimplemented records

Represent pending coverage as skipped or expected-to-fail tests.

- **Pros:** every record appears in the test runner output.
- **Cons:** explicitly forbidden by the design — skipped tests are a way to "make an unsupported path look tested" and do not carry branch-audit evidence; they also pollute pass/fail semantics and the story manifest.

## Decision

The chosen Option 1 landed as a frozen catalog ledger, a discriminated-union coverage type, a harness contract that machine-checks the whole inventory, deterministic task-provider capability families, and a broad literal-story corpus. What shipped:

1. **Frozen catalog snapshot** (`tests/stories/catalog/coverage.ts`). `CATALOG_SOURCE` records the 2026-07-13 catalog snapshot provenance (plus later parity/smoke/platform extensions); `CATALOG_SCENARIO_IDS` is a `Object.freeze`d literal array of every scenario ID in catalog order. The catalog is review evidence, not a runtime read.
2. **Discriminated coverage union** (`tests/stories/catalog/coverage.ts`). `CatalogCoverage` is `executable` (scenarioId, catalogStatus, kind, provingTier, verifiedAt, storyIds) or `pending` (scenarioId, catalogStatus, kind, verifiedAt, audit). `catalogCoverage` builds one frozen entry per ID; an executable record with a mapping becomes `executable`, otherwise a missing `AUDIT_RECORDS` entry throws `Missing audit record for pending catalog scenario: …`, so an unreasoned pending entry is unconstructable.
3. **Catalog-status classifier** (`tests/stories/catalog/coverage.ts`). `catalogStatusFor` resolves `gap` / `forward-only` / `contract-only` from explicit sets; everything else is `confirmed`. `GAP_SCENARIO_IDS`, `FORWARD_ONLY_SCENARIO_IDS`, and the `SCN-coding-nerv-forge-event-source` contract-only marker encode the catalog's own status flags.
4. **Pending audit records** (`tests/stories/catalog/coverage.ts`). `AUDIT_RECORDS` attaches an `AuditRecord` (`readiness` ∈ `executable-as-is` / `needs-seam` / `blocked`, plus `family` and a non-blank `PendingReason`) to every pending ID. `PendingReason.from` rejects blank strings at construction.
5. **Executable story mappings** (`tests/stories/catalog/coverage.ts`). `EXECUTABLE_STORY_MAPPINGS` maps each reachable catalog ID to its literal `tests/stories/…story.test.ts#SCN-…` manifest id and a `verifiedAt` date, so the contract can resolve every reference against the story manifest.
6. **Machine-checked harness contract** (`tests/stories/harness/catalog-coverage.test.ts`). Asserts every catalog scenario is classified exactly once, every pending entry has a non-blank reason and known family, every executable Tier-0 reference resolves to a declared literal story, executable records carry a live proving tier, and audit-readiness totals match the outcome.
7. **Deterministic task-provider capability families** (`tests/stories/harness/memory-task-provider.ts`). A `capabilities?: readonly TaskCapability[]` option and a `supportedMemoryTaskCapabilities` allow-list expose optional families (labels, relations, projects, statuses, worklog, sprints, saved queries, attachments, etc.) only when configured, with deterministic maps/counters and sanitized `ScenarioEvent`s. Production capability gating is exercised because unsupported methods are simply absent.
8. **Capability-fixture provider contract** (`tests/stories/harness/memory-task-provider.test.ts`, `scenario.test.ts`). Parameterized tests start each family absent, configure one, and assert both the normalized return value and a sanitized event — the TDD seam the plan's Task 2 required before feature stories relied on it.
9. **Literal `SCN-*` story corpus** under `tests/stories/{tasks,memory,context,commands,interactions,settings,http,scheduling,web,meta,integrations/…}/`. Each reachable record declares a `scenario('SCN-…: …')` driven through the real `PapaiRuntime`; happy paths assert reply + persisted state + sanitized event, and safety branches assert no mutation / no forbidden request / no advertised capability.
10. **Manifest extractor resolution** (`scripts/story/inputs.ts`, `scripts/story/scenarios.ts`). `loadCandidateStoryFiles` + `extractStoryScenarios` resolve the literal story ids the ledger references, so the contract fails on any stale or renamed scenario.

## Consequences

### Positive

- The catalog is now an auditable Tier 0 regression inventory: the covered-vs-pending total is machine-checked on every contract run, and a record can never silently look covered — an executable entry must name a declared literal story, and a pending entry must carry a concrete reason.
- The suite stays hermetic: the external catalog is snapshotted into the repository rather than read at runtime, so a checkout without the sibling peer workspace still runs green and reproducibly.
- Pending coverage is honest reporting data. Absent features (`nerv`, `supervision`), documented gaps (`/announce`, `self-review`), contract-only non-triggers, and platform-adapter-only seams are each named with their blocker and the tier/seam that would unblock them — never a skipped test.
- The deterministic task-provider capability families let task stories exercise real production capability gating (a context that omits a capability does not advertise it) without a second task-domain implementation.
- The ledger became the backbone for later coverage growth: parity, smoke, and platform lanes plugged into the same inventory by adding tier-tagged executable mappings.

### Negative

- The snapshot and audit reasons are hand-maintained: as the external catalog or the branch changes, an author must update `CATALOG_SCENARIO_IDS`, the executable mappings, and the pending audit records, or the contract fails. There is no automatic drift detection against the peer-workspace catalog (by design).
- The story corpus and ledger now span many files and a 1300-line coverage module; navigating "which record lives where" requires the contract test or the ledger rather than a 1:1 file layout.
- Sanitized event assertions couple stories to the structural event vocabulary; a refactor that renames a sanitized event kind must update the assertions that state the safety oracle.

### Risks

- **Audit-reason staleness.** A pending reason written against one branch state may become inaccurate after the feature lands; the contract only enforces that a reason is non-blank and family-known, not that it is still true. Mitigated by the `verifiedAt`/`provingTier` stamps and by moving a record to executable only after re-verification.
- **Catalog snapshot divergence.** The frozen `CATALOG_SCENARIO_IDS` can drift from the authoritative peer-workspace catalog if a catalog edit is not mirrored here. The `CATALOG_SOURCE` provenance string is the only reconciliation hint; there is no CI link between the two workspaces.
- **Pending as a coverage ceiling.** A large pending set (e.g. the unimplemented `nerv`/`supervision` families) is correct but can read as low coverage; the ledger mitigates this by naming the exact missing implementation, not by hiding it.
- **Safety-oracle completeness.** The ledger enforces that a story exists and resolves; whether a given story asserts *the right* safety boundary is a per-story review concern the contract cannot fully mechanize.

## Related Decisions

- **ADR-0282** — Hermetic E2E Master Baseline; shipped the `ScenarioWorld`, the real `PapaiRuntime` composition, the deterministic boundary kit, and the walking-skeleton corpus this ledger inventories. ADR-0282 noted the per-scenario catalog as "added beyond this plan"; this decision records that catalog as a realized, machine-checked inventory.
- **ADR-0283** — Hermetic Story Process Sandbox, Phase 1; the required OS sandbox that makes the Tier 0 lane hermetic at the kernel level, so an executable record's green run is a real deterministic proof rather than a JS-guard hope.
- **ADR-0225** — Hermetic Story Execution — Docker-Only OS Sandbox; supersedes the JS guard and records the execution-integrity baseline (and the 19-of-126 starting point) this ledger then grew.
- **ADR-0050** — E2E Planning Workflow with Realism Tiers; the tier model the ledger's `provingTier` field slots into (Tier 0 hermetic in-process, Tier 1 provider-real parity, Tier 2 process smoke, Tier 3 platform-adapter).
- **The f1–f8 story-family plans** (`docs/superpowers/plans/2026-07-19-f1-command-meta-story-family.md`, `…-f2a-task-lifecycle…`, `…-f2b1-task-provider-surface…`, `…-f2b2-task-integration-surface…`, `…-f3-memory…`, `…-f4-http…`, `…-f5-scheduling…`, `…-f6-web-fetch…`, `…-f7-mcp…`, `…-f8-interaction…`) — the staged delivery vehicles that filled the ledger's executable mappings family by family; `STORY_FAMILIES` (`F1`–`F8`, `unqueued`) and `FAMILY_QUEUE_EXPECTATIONS` in the contract encode the same grouping.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `tests/stories/catalog/coverage.ts:105-106` | `CATALOG_SOURCE` — 2026-07-13 catalog snapshot provenance (plus later parity/smoke/platform extensions). | `read` confirms. |
| `tests/stories/catalog/coverage.ts:108-281` | `CATALOG_SCENARIO_IDS` — `Object.freeze`d literal array of every scenario ID in catalog order. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:283-303` | `GAP_SCENARIO_IDS`, `FORWARD_ONLY_SCENARIO_IDS`, `catalogStatusFor` — gap / forward-only / contract-only / confirmed classifier. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:70-86` | `PendingReason` — private constructor + `from()` rejects blank strings (`Pending reason must not be empty`). | `read` confirms. |
| `tests/stories/catalog/coverage.ts:88-103` | `CatalogCoverage` discriminated union (`executable` \| `pending`); pending carries `audit: AuditRecord`. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:316-1160` | `EXECUTABLE_STORY_MAPPINGS` — each reachable ID → literal `tests/stories/…#SCN-…` manifest id + `verifiedAt` (+ optional `provingTier`). | `read` confirms. |
| `tests/stories/catalog/coverage.ts:1175-1279` | `AUDIT_RECORDS` — `AuditRecord` (`readiness`/`family`/`PendingReason`) for every pending ID. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:1281-1305` | `catalogCoverage` builder — one frozen entry per ID; executable if mapped, else pending; throws `Missing audit record for pending catalog scenario: …` on an unreasoned gap. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:8-57` | `STORY_TIERS`/`LIVE_STORY_TIERS`/`TIER_SUITE_ROOTS`, `STORY_FAMILIES` (`F1`–`F8`, `unqueued`), `STORY_SEAM_IDS` — tier/family/seam vocabulary added beyond the plan. | `read` confirms. |
| `tests/stories/harness/catalog-coverage.test.ts:111-117` | `classifies every catalog scenario exactly once` — ledger length and uniqueness enforced (shipped total grew beyond the plan's 126). | `read` confirms. |
| `tests/stories/harness/catalog-coverage.test.ts:164-187` | references resolve to declared literal Tier-0 stories; every pending entry has a non-blank reason. | `read` confirms. |
| `tests/stories/harness/catalog-coverage.test.ts:215-228` | executable coverage total + every executable record stamped with a live proving tier (no off-lane tiers). | `read` confirms. |
| `tests/stories/harness/catalog-coverage.test.ts:302-354` | audit-readiness totals — pending count, `needs-seam` vs `blocked` split, seam-unblocking tiers. | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:48,97,244-260` | `supportedMemoryTaskCapabilities` allow-list; `capabilities?` option; `get`/`setCapabilities` with unsupported-rejection. | `read` confirms. |
| `tests/stories/harness/memory-task-provider.test.ts:18-51` | Capability-family provider contracts (start absent, configure one, assert return + sanitized event). | `read` confirms. |
| `tests/stories/tasks/lifecycle-and-policy.story.test.ts:48` | `scenario('SCN-task-create-update: …')` — literal catalog-id story through the real tool loop. | `read` confirms. |
| `tests/stories/memory/memos.story.test.ts:12` | `scenario('SCN-memo-save: …')` — proactive/memory family literal story. | `read` confirms. |
| `tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts` et al. | ACP family literal stories (start-on-pr, list-sessions, finish-push/pr, cancel, continue, self-hosted preflight, …). | `glob` confirms. |
| `scripts/story/inputs.ts:183` | `loadCandidateStoryFiles` — manifest candidate extractor (plan referenced `scripts/story-manifest-candidate.js`); resolves the ledger's literal Tier-0 references. | `read` confirms. |
| `scripts/story/scenarios.ts:47` | `extractStoryScenarios` — AST scenario extractor (plan referenced `scripts/story-manifest-scenarios.js`). | `read` confirms. |

Plan-vs-implementation notes:

- **The catalog grew far beyond the plan's 126 records.** The plan and design fixed the inventory at the 2026-07-13 catalog of 126 IDs (102 confirmed / 19 forward-only / 4 gap / 1 contract-only). Shipped `CATALOG_SCENARIO_IDS` (`coverage.ts:108-281`) now holds 165 IDs — the original 126 plus a provider-real parity lane (`SCN-parity-*`, Tier 1), a process-real smoke lane (`SCN-boot-*`/`SCN-required-env-*`/…, Tier 2), and a platform-adapter lane (`SCN-fetch-chat-link`, `SCN-http-mattermost-action`, Tier 3) added by later family/tier plans. The classification, contract, and pending-audit machinery are exactly as designed; only the totals moved.
- **A multi-tier proving system was added beyond the plan's Tier-0-only model.** The plan's realism tier was "Tier 0 hermetic full-stack stories" exclusively. Shipped adds `provingTier` (with `LIVE_STORY_TIERS` `['0','1','2','3']` and `TIER_SUITE_ROOTS`) so an executable record may be proved by a higher lane, and the contract enforces every executable story sits under its own tier's suite root. The Tier-0-only literal-story check is scoped accordingly (`catalog-coverage.test.ts:172-174`). This is the tier-expansion roadmap (`docs/superpowers/specs/2026-07-23-tier-expansion-roadmap-design.md`) layered on top of this ledger; the ledger's original intent (classify every ID exactly once; executable names a real story; pending carries a reason) is preserved verbatim.
- **The story file structure diverged from the plan's named files.** The plan prescribed `tests/stories/chat-task/{core,collaboration,workflow}.story.test.ts`, `tests/stories/context/policy.story.test.ts`, `tests/stories/assistant/{memos-recurring,deferred-memory,web-instructions-meta}.story.test.ts`, `tests/stories/commands/core.story.test.ts`, `tests/stories/settings/{auth-context,coding-admin}.story.test.ts`, and `tests/stories/http/{notify-mcp,operator-surfaces}.story.test.ts`. Shipped groups by product surface instead: `tests/stories/tasks/{lifecycle-and-policy,provider-surface,integration-surface}.story.test.ts`, `tests/stories/memory/{memos,memory,instructions}.story.test.ts`, `tests/stories/commands/surface.story.test.ts`, `tests/stories/scheduling/{recurring,deferred}.story.test.ts`, `tests/stories/web/web-fetch.story.test.ts`, `tests/stories/meta/disclosure-and-compaction.story.test.ts`, `tests/stories/settings/{context-and-instances,identity,coding-surfaces,admin-surfaces,module-settings-qualification}.story.test.ts`, and `tests/stories/http/{notify,dashboard,transcript-viewer,auth-claim}.story.test.ts`. Every catalog ID the plan assigned is still covered by a literal `SCN-*` story; only the file bucketing changed, which the design explicitly permitted ("Stories may share setup and reside in feature-family files").
- **Pending readiness is richer than the plan's reason string.** The plan's pending shape was `{ scenarioId, catalogStatus, kind: 'pending', verifiedAt, reason, requiredSeam? }`. Shipped pending carries an `AuditRecord` with a three-state `readiness` (`executable-as-is` / `needs-seam` with named `seams` + `unblockedByTier` / `blocked: missing-implementation`), a `family` queue, and a branded `PendingReason`. The non-blank-reason invariant is preserved (and strengthened — blank reasons are rejected at construction), and `STORY_SEAM_IDS` / `FAMILY_QUEUE_EXPECTATIONS` make the unblocking path machine-checkable.
- **`SCN-settings-admin-mcp-catalog` and the MCP family landed after this plan.** The destination matrix predates the sandbox-MCP-broker work (ADRs 0275–0280); the `tests/stories/integrations/mcp/` family and its `verifiedAt: 2026-07-22` mappings were added by the later F7 MCP story-family plan.
- **The contract imports moved with the manifest extractor.** The plan's contract imported `loadCandidateStoryFiles` from `scripts/story-manifest-candidate.js` and `extractStoryScenarios` from `scripts/story-manifest-scenarios.js`. Shipped resolves them from `scripts/story/inputs.ts` and `scripts/story/scenarios.ts` (the runner was consolidated into a `scripts/story/` package by ADR-0282); the literal-story invariants are unchanged.

The source plan `docs/superpowers/plans/2026-07-13-scenario-catalog-hermetic-stories.md` and design `docs/superpowers/specs/2026-07-13-scenario-catalog-hermetic-stories-design.md` are archived alongside this ADR to `docs/archive/`.
