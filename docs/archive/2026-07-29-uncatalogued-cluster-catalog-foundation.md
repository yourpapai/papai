<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Uncatalogued Cluster Catalog Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add accountable, behavior-level scenario IDs for the Phase 3 uncatalogued cluster without claiming executable story coverage.

**Architecture:** Keep the ledger as the only source of truth. A new exported Phase 3 ID tuple is appended to the existing catalog, every member enters `AUDIT_RECORDS` as pending, and the frozen catalog-contract suite asserts the exact inventory, status, readiness, family, and tier/seam classification. No runtime, fixture, or story file changes.

**Tech Stack:** Bun, strict TypeScript, `bun:test`, frozen Tier-0 story catalog.

**Spec:** `docs/superpowers/specs/2026-07-29-uncatalogued-cluster-catalog-foundation-design.md`

## Global Constraints

- Runtime is **Bun**; imports use `.js` extensions.
- Change only `tests/stories/catalog/coverage.ts` and `tests/stories/harness/catalog-coverage.test.ts`; do not add stories, production code, fixtures, or mappings.
- Every new record stays `catalogStatus: 'gap'`, `kind: 'pending'`, and has no `storyIds`.
- Use `executable-as-is` for all fifteen Tier-0 candidates; use `needs-seam@3` with `platform-adapter-fakes` for the five platform records; use `needs-seam@4` with `scheduler-due-seed` and `scheduler-chat-di` for the poller lifecycle.
- `tests/stories/**` is frozen: run Docker-backed contracts and stories before the PR; establish the new compatibility baseline only after the merged master commit.
- Do not add lint/type suppressions. Preserve existing records and mappings exactly.

---

### Task 1: Make the Phase 3 catalog inventory a failing contract

**Files:**
- Modify: `tests/stories/harness/catalog-coverage.test.ts:11-18, 95-126, 126-130, 324-375`

**Interfaces:**
- Consumes: `PHASE3_UNCATALOGUED_CLUSTER_IDS: readonly CatalogScenarioId[]` exported by `../catalog/coverage.js`.
- Produces: a frozen-contract assertion that all 21 Phase 3 IDs are pending `gap` records and that their readiness/tier split is `15 ready / 9 seam / 22 blocked` globally.

- [ ] **Step 1: Add the failing import and Phase 3 assertion**

Add `PHASE3_UNCATALOGUED_CLUSTER_IDS` to the catalog import. Directly after the “classifies every catalog scenario exactly once” test, add:

```ts
  test('catalogs every Phase 3 uncatalogued behavior as a pending gap at its lowest proving tier', () => {
    expect(PHASE3_UNCATALOGUED_CLUSTER_IDS).toEqual([
      'SCN-memory-tool-pairing',
      'SCN-queue-coalescing',
      'SCN-queue-group-serialization',
      'SCN-attachments-staged-scope-search',
      'SCN-attachments-staged-resolution',
      'SCN-byok-context-credentials',
      'SCN-byok-unreadable-credentials',
      'SCN-message-cache-persistence',
      'SCN-usage-accounting',
      'SCN-announcement-delivery-fanout',
      'SCN-stats-anonymity',
      'SCN-stats-aggregate-window',
      'SCN-scheduler-execution-tracking',
      'SCN-changelog-version-section',
      'SCN-interaction-discord-command-routing',
      'SCN-interaction-discord-format-chunking',
      'SCN-interaction-discord-response-lifecycle',
      'SCN-interaction-kontur-reply-formatting',
      'SCN-interaction-telegram-admin-authorization',
      'SCN-deferred-poller-lifecycle',
      'SCN-plugin-deny-gating',
    ])

    const phase3Coverage = catalogCoverage.filter(({ scenarioId }) =>
      PHASE3_UNCATALOGUED_CLUSTER_IDS.includes(scenarioId),
    )
    expect(phase3Coverage).toHaveLength(21)
    expect(phase3Coverage.map(({ catalogStatus }) => catalogStatus)).toEqual(Array(21).fill('gap'))
    expect(phase3Coverage.map(({ kind }) => kind)).toEqual(Array(21).fill('pending'))
  })
```

Change the ledger total assertion to `expect(CATALOG_SCENARIO_IDS).toHaveLength(215)`, the pending total to `46`, and the readiness totals to `15`, `9`, and `22` respectively.

Replace the current seam-pending expectations with this deterministic projection:

```ts
    const seamPendingByTier = pendingCoverage.flatMap(({ scenarioId, audit }) =>
      audit.readiness.state === 'needs-seam' ? [`${scenarioId}@${audit.readiness.unblockedByTier}`] : [],
    )
    expect(
      seamPendingByTier.toSorted(),
    ).toEqual([
      'SCN-deferred-poller-lifecycle@4',
      'SCN-interaction-discord-command-routing@3',
      'SCN-interaction-discord-format-chunking@3',
      'SCN-interaction-discord-response-lifecycle@3',
      'SCN-interaction-discord-router-wrapped@3',
      'SCN-interaction-discord-standalone-fallback@3',
      'SCN-interaction-kontur-reply-formatting@3',
      'SCN-interaction-telegram-admin-authorization@3',
      'SCN-interaction-telegram-callback@3',
    ])
```

- [ ] **Step 2: Run the contract suite and verify RED**

Run: `bun test:stories:contracts`

Expected: FAIL because `PHASE3_UNCATALOGUED_CLUSTER_IDS` is not exported and the old ledger contains 194 IDs / 25 pending records. Preserve no generated report changes.

### Task 2: Add the 21 ledger records and their audit classification

**Files:**
- Modify: `tests/stories/catalog/coverage.ts:105, 108-313, 314-322, 1368-1380, 1380-1484`
- Modify: `tests/stories/harness/catalog-coverage.test.ts:95-114`

**Interfaces:**
- Produces: `PHASE3_UNCATALOGUED_CLUSTER_IDS: readonly CatalogScenarioId[]`.
- Produces: 15 `ready(family, rationale)` records, five `needs('F8', ['platform-adapter-fakes'], '3', rationale)` records, and one `needs('F5', ['scheduler-due-seed', 'scheduler-chat-di'], '4', rationale)` record.
- Consumes: existing `PendingReason`, `AuditReadiness`, `needs`, `GAP_SCENARIO_IDS`, and `FAMILY_QUEUE_EXPECTATIONS` conventions.

- [ ] **Step 1: Add all catalog IDs and the Phase 3 tuple**

Append this exact block immediately before the closing `] as const)` of `CATALOG_SCENARIO_IDS`:

```ts
  // Phase 3 — uncatalogued runtime cluster (catalog foundation)
  'SCN-memory-tool-pairing',
  'SCN-queue-coalescing',
  'SCN-queue-group-serialization',
  'SCN-attachments-staged-scope-search',
  'SCN-attachments-staged-resolution',
  'SCN-byok-context-credentials',
  'SCN-byok-unreadable-credentials',
  'SCN-message-cache-persistence',
  'SCN-usage-accounting',
  'SCN-announcement-delivery-fanout',
  'SCN-stats-anonymity',
  'SCN-stats-aggregate-window',
  'SCN-scheduler-execution-tracking',
  'SCN-changelog-version-section',
  'SCN-interaction-discord-command-routing',
  'SCN-interaction-discord-format-chunking',
  'SCN-interaction-discord-response-lifecycle',
  'SCN-interaction-kontur-reply-formatting',
  'SCN-interaction-telegram-admin-authorization',
  'SCN-deferred-poller-lifecycle',
  'SCN-plugin-deny-gating',
```

Immediately after that array, export the same ordered 21-string tuple as
`PHASE3_UNCATALOGUED_CLUSTER_IDS`, typed with `satisfies readonly CatalogScenarioId[]`.
Append `; extended 2026-07-29 with 21 uncatalogued-cluster behavior ids (@0/@3/@4) (phase3-catalog-foundation)` to `CATALOG_SOURCE`.

Add all 21 IDs to `GAP_SCENARIO_IDS`. This deliberately overrides the default
`confirmed` status for pending records; do not alter existing gap or forward-only IDs.

- [ ] **Step 2: Add the readiness helper, family routes, and audit records**

Add the helper beside `needs` and `blocked`:

```ts
const ready = (family: StoryFamily, rationale: string): AuditRecord =>
  auditRecord({ state: 'executable-as-is' }, family, rationale)
```

Extend `FAMILY_QUEUE_EXPECTATIONS` with these entries before the interaction rule:

```ts
  ['SCN-queue-', 'F1'],
  ['SCN-attachments-', 'F2'],
  ['SCN-byok-', 'F1'],
  ['SCN-message-cache-', 'F3'],
  ['SCN-usage-', 'F4'],
  ['SCN-announcement-', 'F1'],
  ['SCN-stats-', 'F4'],
  ['SCN-scheduler-', 'F5'],
  ['SCN-changelog-', 'F1'],
  ['SCN-plugin-', 'F7'],
```

Add this exact Phase 3 section at the start of `AUDIT_RECORDS`:

```ts
  // Phase 3 — uncatalogued runtime cluster; catalog-only until each record has a literal story mapping.
  'SCN-memory-tool-pairing': ready('F3', 'Pure retained-history normalization can be proven directly; no Tier-0 fixture seam is missing.'),
  'SCN-queue-coalescing': ready('F1', 'The existing queue runtime can prove same-actor batching and output ordering without a new seam.'),
  'SCN-queue-group-serialization': ready('F1', 'The existing queue runtime can prove actor-change flushing and one-run-per-thread serialization without a new seam.'),
  'SCN-attachments-staged-scope-search': ready('F2', 'The existing database-backed attachment runtime can prove context and group search isolation without a new seam.'),
  'SCN-attachments-staged-resolution': ready('F2', 'The existing attachment relay runtime can prove single-use resolution, terminal failure, and intentional re-send behavior.'),
  'SCN-byok-context-credentials': ready('F1', 'The existing encrypted configuration store can prove per-context merge and clear behavior while assertions omit secret values.'),
  'SCN-byok-unreadable-credentials': ready('F1', 'The existing encrypted configuration store can prove unreadable data fails closed without a new runtime seam.'),
  'SCN-message-cache-persistence': ready('F3', 'The existing message-cache persistence runtime can prove eligible persistence and chain/context retrieval boundaries.'),
  'SCN-usage-accounting': ready('F4', 'The existing usage recorder and query runtime can prove idempotent event identity and window-scoped reads.'),
  'SCN-announcement-delivery-fanout': ready('F1', 'The existing announcement broadcast dependency injection can prove independent fan-out success and failure accounting.'),
  'SCN-stats-anonymity': ready('F4', 'The existing stats aggregation and salt test helpers can prove that raw subject identity is not returned.'),
  'SCN-stats-aggregate-window': ready('F4', 'The existing stats query runtime can prove internally consistent windowed aggregates.'),
  'SCN-scheduler-execution-tracking': ready('F5', 'Pure promise tracking can be proven directly for both fulfilled and rejected executions.'),
  'SCN-changelog-version-section': ready('F1', 'Pure changelog section extraction can be proven directly for a matched version, next header, and absent version.'),
  'SCN-plugin-deny-gating': ready('F7', 'The existing plugin capability runtime can prove denied capabilities are absent before execution without a new seam.'),
  'SCN-interaction-discord-command-routing': needs('F8', ['platform-adapter-fakes'], '3', 'This verifies the discord.js command wire above the runtime boundary and needs a fake Discord client.'),
  'SCN-interaction-discord-format-chunking': needs('F8', ['platform-adapter-fakes'], '3', 'This verifies Discord transport formatting and chunk boundaries, which needs a fake Discord client.'),
  'SCN-interaction-discord-response-lifecycle': needs('F8', ['platform-adapter-fakes'], '3', 'This verifies discord.js deferred and replied interaction lifecycle behavior above the runtime boundary.'),
  'SCN-interaction-kontur-reply-formatting': needs('F8', ['platform-adapter-fakes'], '3', 'This verifies Kontur Talk platform reply formatting and chunk boundaries above the runtime boundary.'),
  'SCN-interaction-telegram-admin-authorization': needs('F8', ['platform-adapter-fakes'], '3', 'This verifies the grammY platform-admin helper wire and needs a fake Telegram API.'),
  'SCN-deferred-poller-lifecycle': needs('F5', ['scheduler-due-seed', 'scheduler-chat-di'], '4', 'This verifies timer lifecycle and controlled polling, requiring the operational virtual-clock lane.'),
```

- [ ] **Step 3: Run the contract suite and verify GREEN**

Run: `bun test:stories:contracts`

Expected: PASS. Its catalog line reads `story catalog: 169/215 executable (T0 129, T1 29, T2 8, T3 3, T4 0); pending 46 (15 executable-as-is, 9 needs-seam, 22 blocked)`.

- [ ] **Step 4: Commit the catalog foundation**

```bash
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): catalog uncatalogued runtime cluster"
```

### Task 3: Qualify the frozen catalog change and record master baseline evidence

**Files:**
- Modify: none.
- Generated, ignored: `reports/stories/manifest.json`, `reports/stories/junit.xml`.

**Interfaces:**
- Consumes: the committed catalog foundation from Task 2 and Docker’s pinned Bun image.
- Produces: a passing contract run, unchanged story behavior, and a master baseline SHA/tree hash recorded in the PR handoff.

- [ ] **Step 1: Run the complete Tier-0 story suite**

Run: `bun test:stories`

Expected: PASS. The catalog line remains `169/215 executable` and every existing story remains green; no Phase 3 ID is executable because this plan intentionally adds no story mapping.

- [ ] **Step 2: Generate the frozen manifest and inspect the only intended input changes**

Run: `bun test:stories:manifest && git diff --name-only HEAD^ HEAD -- tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts`

Expected: a new `reports/stories/manifest.json`; the committed frozen-code changes are exactly the ledger and catalog-contract files.

- [ ] **Step 3: After merge on master, establish the compatibility baseline**

On the merged master commit, run:

```bash
PAPAI_BASELINE_SHA="$(git rev-parse HEAD)"
bun test:stories:contracts
bun test:stories
bun test:stories:manifest
BASE_REF="$PAPAI_BASELINE_SHA" bun test:stories:compat --manifest-only
BASE_REF="$PAPAI_BASELINE_SHA" bun test:stories:compat
```

Expected: both compatibility commands PASS against the just-recorded master SHA. Record that SHA and the `treeHash` from `reports/stories/manifest.json` in the PR handoff; do not commit ignored `reports/stories/**` output.
