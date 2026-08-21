<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Story catalog census — design

Date: 2026-07-28
Status: approved, not yet planned

## Problem

The scenario catalog gate is one-directional. `tests/stories/harness/catalog-coverage.test.ts`
extracts every `scenario(...)` id under `tests/stories/**` and asserts that each Tier 0
executable record's `storyIds` resolves to a real one. Nothing checks the reverse: a story
scenario that no catalog record claims fails no test, in any lane.

Two consequences:

1. **Silent drift.** Coverage can land without being claimed, so the catalog understates
   what the lane proves and no longer functions as a census of it.
2. **No RED in story-first order.** The forward gate does produce a failing test when the
   catalog record is authored first (record points at a story that does not exist yet).
   It produces nothing when the story is authored first. Tasks on the
   `hermetic-stories-continue` branch were authored story-first and therefore never saw
   their expected failing step.

The gap is real today, not hypothetical, and it is actively widening. Measured on this
branch at HEAD `0fbda8ec7`: 130 Tier 0 scenarios observed, 111 claimed by records,
**19 orphans**.

```
tests/stories/chat-task/create-and-read-task.story.test.ts#creates and reads a task through the real chat tool loop
tests/stories/http/auth-claim.story.test.ts#SCN-http-settings-auth-validation: malformed exchanges and invalid logout sessions are rejected
tests/stories/http/dashboard.story.test.ts#SCN-http-dashboard-debug-gate: debug paths and the legacy dashboard redirect are hidden when disabled
tests/stories/http/dashboard.story.test.ts#SCN-http-debug-protected-surfaces: enabled diagnostic reads still require a dashboard session
tests/stories/integrations/coding-sessions/acp-mcp.story.test.ts#an unresolved MCP selection fails closed before Magi session startup
tests/stories/integrations/coding-sessions/acp-mcp.story.test.ts#malformed MCP settings fail closed before Magi session startup
tests/stories/integrations/coding-sessions/module-qualification.story.test.ts#configured ACP upstream failure does not persist a session or expose credentials
tests/stories/integrations/coding-sessions/start-session.story.test.ts#starts a coding session through the real capability and tool loop
tests/stories/integrations/plugins/eligibility.story.test.ts#plugin context eligibility
tests/stories/integrations/plugins/eligibility.story.test.ts#plugin isolation after lifecycle
tests/stories/integrations/runtime-extensions/tool-eligibility.story.test.ts#runtime extension ACP tool is offered and executed only in its eligible context
tests/stories/settings/debug-settings-api.story.test.ts#SCN-settings-api-tools: tool permissions reject untrusted writes and round-trip a domain setting
tests/stories/settings/debug-settings-api.story.test.ts#SCN-settings-api-byok: BYOK writes stay in the caller context and never disclose the submitted secret
tests/stories/settings/debug-settings-api.story.test.ts#SCN-settings-api-memory: invalid memory updates leave the view unchanged and valid capture writes persist
tests/stories/settings/debug-settings-api.story.test.ts#SCN-settings-api-plugins: plugin config rejects unknown keys and masks a persisted context secret
tests/stories/settings/debug-settings-api.story.test.ts#SCN-settings-api-mcp: endpoint validation preserves prior state and masks persisted authorization headers
tests/stories/settings/debug-settings-api.story.test.ts#SCN-settings-api-group: only a group administrator can update the group guest-mode setting
tests/stories/settings/debug-settings-api.story.test.ts#SCN-settings-api-release: only a group administrator can change a group release subscription
tests/stories/settings/task-instance-assignment.story.test.ts#settings task assignment changes the provider used by the next chat turn
```

**Ten of those nineteen accrued during the half-day this design was being written**, in
commits `a8be8512d`, `84b7e8019`, and `0fbda8ec7`. None of the three authors added a
catalog record; none of the three saw a failing test; the plan document behind the largest
of them never mentions the catalog at all. The drift rate is the argument for the gate.

## Goal

**Ledger integrity.** Every story scenario in every lane is accounted for: it either backs
a catalog record or carries an explicit, reviewed exemption. A guaranteed RED in
story-first authoring order falls out as a consequence, but integrity is the objective —
a workflow rule alone would not close the drift.

## Non-goals

- Cataloging non-story tests. `tests/e2e/` holds 12 test files of which only
  `parity/provider-parity.test.ts` is story-cataloged; the other 11 are legitimate
  non-story E2E tests and stay uncataloged.
- A cap or ratchet on the exemption list. See Risks.
- Any change to `check.sh` or new npm script. The census rides existing CI commands.

## What each tier already guarantees

| Tier | Story marker (observed set)                                | Reverse checked today? |
| ---- | ---------------------------------------------------------- | ---------------------- |
| 0    | `scenario()` / `executeScenario()` in `*.story.test.ts`     | No — the gap           |
| 1    | `PARITY_GROUPS` entries                                    | Yes, by construction   |
| 2    | `title(<key>)` in `*.smoke.ts`                             | Partially              |
| 3    | `title(<key>)` in `*.platform.ts`                          | Partially              |

Tier 1 derives both the catalog ids and the test names from `PARITY_GROUPS`, and
`catalog-coverage.test.ts` asserts the counts match. Tiers 2 and 3 derive test titles from
the `SMOKE_STORIES` / `PLATFORM_STORIES` registries via a local `title()` helper, so an
unregistered scenario has no title to use — unless an author bypasses the helper and
passes a literal.

Tier 0 titles are free-form strings. It is the only lane where orphans can accumulate
without anyone doing anything unusual, and the only lane where they have.

Current executable record counts: T0 111, T1 29, T2 8, T3 2 (150 total).

## Design

Uniform in *shape*, not in discovery. Each tier answers "what stories do I declare?" in
its own terms; the comparison and reporting are shared.

### Census core

`tests/stories/catalog/census.ts` — pure, no I/O, no imports from the lanes:

```ts
export type StoryCensus = Readonly<{
  tier: StoryTier
  orphans: readonly string[] // observed, neither claimed nor supporting
  dangling: readonly string[] // claimed or supporting, but not observed
  claimed: number
  supporting: number
}>

export function censusStories(
  input: Readonly<{
    tier: StoryTier
    observed: readonly string[]
    claimed: readonly string[]
    supporting: readonly string[]
  }>,
): StoryCensus
```

Both directions in one function. `dangling` subsumes what the forward gate checks today,
so a lane wires up one call instead of two and cannot accidentally be left half-blind.
The existing forward assertions stay — they carry per-record diagnostics the census
cannot.

### Exemption list

`tests/stories/catalog/supporting.ts`:

```ts
export const SUPPORTING_STORIES: Readonly<Record<string, PendingReason>>
```

Story id → rationale, reusing the existing `PendingReason` value object so a blank
rationale throws at module load rather than inside an assertion. Keyed by full story id
(`path#title`), which is globally unique across tiers, so one flat list serves all four
lanes.

A contract test asserts no id appears both in `SUPPORTING_STORIES` and in any record's
`storyIds` — exemption and claim are mutually exclusive.

### Observers

Each observer returns full story ids (`path#title`) so the core stays tier-agnostic.

**Tier 0** — reuses `loadCandidateStoryFiles(repoRoot)` + `extractStoryScenarios`, the
pair `catalog-coverage.test.ts:164` already uses. The extractor returns `[]` for
non-`*.story.test.ts` files, so ordinary unit tests under `tests/stories/` are correctly
not stories. Lives in a new `tests/stories/harness/catalog-census.test.ts` rather than
growing the existing 359-line file.

**Tier 1** — no I/O:

```ts
PARITY_GROUPS.map((group) => `tests/e2e/parity/provider-parity.test.ts#${group.title}`)
```

This buys something today's checks lack: a Tier 1 record pointing at some *other* `tests/e2e/`
file satisfies the `TIER_SUITE_ROOTS` prefix check but surfaces as `dangling`. The
existing per-group test stays; its diagnostics are better.

**Tiers 2 and 3** — a new `tests/smoke/harness/story-markers.ts`, shared with the platform
lane (which already imports from `tests/smoke/harness/`). AST scan using
`@typescript/typescript6`, the same dependency `scripts/story/scenarios.ts` uses,
returning per file:

- **marker keys** — the string literal inside `test(title('SCN-x'), …)`. Every call site
  is uniformly shaped, so the pattern match is narrow.
- **violations** — any `test(…)` whose first argument is not a `title(<literal>)` call.

Asserting `violations` is empty closes the bypass hole, and is the only part of the
all-lanes scope not already structurally guaranteed.

Observed ids map through the registries' existing `smokeStoryId()`. A marker key with no
registry entry has no id to map to and is reported as an orphan by key.

**Load-bearing detail:** Tier 2/3 file discovery is by glob —
`tests/smoke/scenarios/*.smoke.ts`, `tests/platform/scenarios/*.platform.ts` — not by
iterating the registry's file list. Deriving the file list from the registry would make a
new scenario file with no registry entry invisible to the census, which is the exact
failure mode being closed. The existing crosscheck iterates the registry; that is correct
for its forward direction and cannot be the census's input.

### Failure ergonomics

The assertion is `expect(census.orphans).toEqual([])`, so Bun prints the offending ids.
Each lane's test carries a comment naming the two legal remedies: add the id to a record's
`storyIds`, or declare it in `SUPPORTING_STORIES` with a rationale. That is the RED a
story-first task now hits.

## Disposing of the 19 existing orphans

No grandfather baseline. All 19 are classified as part of this work, so the gate lands with
zero deferred debt.

**Mint the id the title already declares.** Ten orphans carry a scenario title that already
follows the `SCN-<id>: <description>` convention — the author named a catalog id and simply
never added the record. These are mechanical: mint the declared id, point it at the story,
done. No judgment needed beyond confirming the id is well-formed and unclaimed.

- `SCN-http-settings-auth-validation`, `SCN-http-dashboard-debug-gate`,
  `SCN-http-debug-protected-surfaces`
- `SCN-settings-api-tools`, `SCN-settings-api-byok`, `SCN-settings-api-memory`,
  `SCN-settings-api-plugins`, `SCN-settings-api-mcp`, `SCN-settings-api-group`,
  `SCN-settings-api-release`

This bucket is also the clearest evidence for the design: the convention was followed, the
intent was recorded in the title, and the ledger still missed all ten.

**Attach as a second `storyId` on an existing record.** A record's `storyIds` is already a
non-empty tuple, and the uniqueness assertion at `catalog-coverage.test.ts:186` keeps each
story single-claimed.

| Orphan                                                                     | Record                    |
| -------------------------------------------------------------------------- | ------------------------- |
| `chat-task/create-and-read-task#creates and reads a task through the real chat tool loop` | `SCN-task-create-update`  |
| `start-session#starts a coding session through the real capability and tool loop`         | `SCN-coding-acp-start-fresh` |

**Mint a new SCN id.** These prove behavior no record covers. Every candidate record
describes a success path while these prove fail-closed paths, so attaching them would be a
false claim.

- `acp-mcp#an unresolved MCP selection fails closed…` + `acp-mcp#malformed MCP settings fail closed…`
  — one new id, two `storyIds`
- `module-qualification#configured ACP upstream failure does not persist a session or expose credentials`
- `runtime-extensions/tool-eligibility#runtime extension ACP tool is offered and executed only in its eligible context`
- `settings/task-instance-assignment#settings task assignment changes the provider used by the next chat turn`
  — no `SCN-settings-task-*` record exists among the 13 settings records

**Settle against the story body during planning.**
`plugins/eligibility#plugin context eligibility` and
`plugins/eligibility#plugin isolation after lifecycle`. These read as plugin-system
plumbing rather than user-facing behavior, making them `SUPPORTING_STORIES` candidates,
but the call should be made against what the scenarios actually assert. The plan settles
each; both outcomes are legal and neither blocks the gate.

### Ripple from minting

Minting extends `CATALOG_SOURCE`, which documents every prior extension by spec name; this
work adds its own entry alongside `tier2-process-smoke` and `t0-real-youtrack-provider`.

Minting also moves hardcoded totals: `CATALOG_SCENARIO_IDS` length (175), the executable
total (150, asserted in two tests), the Tier 0 per-tier count, and
`tests/scripts/story-coverage-totals.test.ts`. With roughly 15 ids minted across both
buckets this is the largest mechanical surface in the work — the plan fixes the final id
count before implementation starts rather than discovering it midway.

## Testing

The census core and the marker extractor are both pure, so the failing-test-first step is
available on day one and needs no temporary orphan committed to the tree:

- `censusStories` fed a synthetic observed set containing an unclaimed id, asserting it
  lands in `orphans`; and a claimed-but-unobserved id, asserting `dangling`.
- The marker extractor fed a fixture source string containing a bypassing
  `test('literal', …)`, asserting it lands in `violations`.
- `SUPPORTING_STORIES` with a blank rationale throws at construction (already guaranteed by
  `PendingReason`; asserted for the list's own boundary).
- The mutual-exclusion contract: an id both claimed and supporting fails.

## Lane placement

Default `bun test` excludes `tests/stories/**`, so the Tier 0 and Tier 1 censuses run under
`bun test:stories:contracts`, alongside the forward gate they complete. The Tier 2/3
censuses go into the existing `catalog-crosscheck.test.ts` files, which are plain
`.test.ts` under `tests/smoke/` and `tests/platform/` and already run in the default lane
without booting Docker — the `.smoke.ts` / `.platform.ts` suffixes keep container scenarios
out of discovery. The whole census is therefore enforced by CI's existing commands.

## Refactor-qualification impact

Adding `census.ts` and `supporting.ts` under `tests/stories/` changes the frozen tree hash,
so this lands like any story change: commit on master, record a new manifest `treeHash` and
baseline SHA, rebase any in-flight refactor onto it.

`scripts/story/**` is deliberately untouched. Placing the Tier 2/3 marker extractor under
`tests/smoke/harness/` instead of `scripts/story/` keeps it out of the sandbox snapshot's
import-reachability guard (`tests/scripts/story-enforcement-imports.test.ts`) entirely.

## Risks

**The exemption list is the pressure valve.** The census inverts who bears the cost of an
uncataloged story: free today, a required catalog decision at authoring time afterward. If
`SUPPORTING_STORIES` grows casually the gate degrades into a rubber stamp. The non-blank
rationale is the only thing making that visible in review. No cap or ratchet is proposed
(YAGNI), but it is the thing to watch.

**The orphan set is a moving target.** Ten orphans landed while this document was being
written. Any further story work merged before the gate adds to the classification backlog,
and the disposition tables above go stale. Re-run the orphan count at the start of
implementation rather than trusting the list here; the plan should treat classification as
sized-at-implementation-time, not fixed at 19.

## Alternatives considered

**One census test file for all four tiers.** Fewer files, but it pulls the Tier 2/3
assertions out of their own lanes into `tests/stories/`, and `catalog-coverage.test.ts` is
already 359 lines. Rejected on isolation grounds.

**A standalone `bun catalog:census` script gate in `check.sh`.** Nicer reporting and leaves
the frozen `tests/stories/` tree untouched, but it is not a test, so it produces no RED in
a normal `bun test` run — which defeats the reason for the work.

**No exemptions at all** — require every scenario to be claimed by some record. Simplest
gate, but forces false coverage claims for genuinely supporting stories.

**Frozen grandfather baseline for the existing orphans.** Lands the gate sooner at the cost
of deferred classification. Rejected: ten of the nineteen are mechanical id mints, and a
baseline that absorbs them would let the ledger stay wrong indefinitely — the drift rate
observed here suggests the burndown would never happen.
