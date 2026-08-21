<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Staged Attachments and BYOK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the four approved Phase 3 staged-attachment and BYOK persistence/security records with literal hermetic Tier-0 stories.

**Architecture:** Add two direct-runtime story files. Staged attachments use the real staged APIs, scenario SQLite state, group-scope IDs, and an in-memory blob store. BYOK uses the real settings route, encrypted store, and LLM resolver. Promote only these four records in the frozen ledger and contract.

**Tech Stack:** Bun, `bun:test`, TypeScript, Drizzle/SQLite, Tier-0 `scenario(...)` harness, frozen story catalog.

## Global Constraints

- Modify only the two new story files, `tests/stories/catalog/coverage.ts`, and `tests/stories/harness/catalog-coverage.test.ts`; do not change production code, fixtures, migrations, or existing unit tests.
- Create exactly four literal Tier-0 scenarios, one per approved catalog ID.
- Keep `SCN-task-attachments` and `SCN-settings-api-byok` limited to their existing claims.
- Search is exact-thread-only without `groupContextId`, sibling-thread-visible only with the matching group context, and never cross-group.
- A `null` downloader result is terminal for that staged row; re-staging the same platform-file/context row intentionally resets it to `staged`.
- Use opaque, non-production input and absence assertions for credentials. Never assert plaintext, decrypted payloads, ciphertext, or raw credential values.
- Unreadable enabled BYOK data must return an LLM resolver error without central-provider fallback.
- Do not add lint/type suppressions; use `.js` imports.

---

### Task 1: Specify the promotion in the frozen catalog contract

**Files:**
- Modify: `tests/stories/harness/catalog-coverage.test.ts:30-185, 285-333, 462-471, 548-597`

**Interfaces:**
- Consumes: `catalogCoverage`, `PHASE3_UNCATALOGUED_CLUSTER_IDS`, and literal `scenario(...)` IDs.
- Produces: exact contract coverage for twelve promoted Phase 3 records and nine pending Phase 3 records.

- [ ] **Step 1: Write the failing promotion contract**

Extend `PROMOTED_PHASE3_CATALOG_STORY_IDS` with:

```ts
'SCN-attachments-staged-scope-search':
  'tests/stories/runtime/staged-attachments.story.test.ts#SCN-attachments-staged-scope-search: staged search respects thread and group boundaries',
'SCN-attachments-staged-resolution':
  'tests/stories/runtime/staged-attachments.story.test.ts#SCN-attachments-staged-resolution: staged resolution is single-use, terminal, and re-sendable',
'SCN-byok-context-credentials':
  'tests/stories/settings/byok-credentials.story.test.ts#SCN-byok-context-credentials: context credentials merge and clear without disclosure',
'SCN-byok-unreadable-credentials':
  'tests/stories/settings/byok-credentials.story.test.ts#SCN-byok-unreadable-credentials: unreadable credentials fail closed without disclosure',
```

Remove only those four entries from `PHASE3_AUDIT_PROJECTION`. Change the Phase 3 assertion to twelve executable Tier-0 records and nine pending records. Change global totals to:

```ts
expect(catalogCoverage.filter((coverage) => coverage.kind === 'executable')).toHaveLength(181)
expect(pendingIds).toHaveLength(34)
expect(states.filter((state) => state === 'executable-as-is')).toHaveLength(3)
expect(states.filter((state) => state === 'needs-seam')).toHaveLength(9)
expect(states.filter((state) => state === 'blocked')).toHaveLength(22)
```

- [ ] **Step 2: Verify RED**

Run: `bun test:stories:contracts`

Expected: FAIL because the four story files/mappings do not exist yet.

- [ ] **Step 3: Commit the contract checkpoint**

```sh
git add tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): specify staged attachment and BYOK coverage"
```

### Task 2: Add the staged-attachment stories and ledger promotion

**Files:**
- Create: `tests/stories/runtime/staged-attachments.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts:360-405, 400-520, 1489-1510`

**Interfaces:**
- Consumes: `stageFileMetadata`, `searchStagedFiles`, `resolveStagedFile`, `ScenarioWorld.scopedStorageContextId`, and `ScenarioWorld.groupScopeId`.
- Produces: the two staged literal IDs from Task 1 and their executable ledger mappings.

- [ ] **Step 1: Write the failing scope-search scenario**

Create the file with SPDX header and imports for `expect`, staged APIs, `attachments`, `getDrizzleDb`, and `scenario`. Use two threads in group A and one thread in group B. Stage `alpha-plan.txt`, `alpha-notes.txt`, and `alpha-private.txt` with unique fixed platform file IDs.

```ts
expect(searchStagedFiles(a1Context, 'alpha').map(({ filename }) => filename)).toEqual(['alpha-plan.txt'])
expect(
  searchStagedFiles(a1Context, 'alpha', { groupContextId: world.groupScopeId(groupA) })
    .map(({ filename }) => filename).toSorted(),
).toEqual(['alpha-notes.txt', 'alpha-plan.txt'])

let downloads = 0
const result = await resolveStagedFile(a1.stagedId, b1Context, () => {
  downloads++
  return Promise.resolve(Buffer.from('must-not-download'))
}, { groupContextId: world.groupScopeId(groupB) })
expect(result).toMatchObject({ status: 'not_found' })
expect(downloads).toBe(0)
expect(getDrizzleDb().select().from(attachments).all()).toHaveLength(0)
```

The helper supplying staged metadata uses `sourceProvider: 'telegram'`, the scenario platform instance ID, fixed sender/filename/message fields, and null origin/forwarding fields.

- [ ] **Step 2: Write the failing resolution scenario**

Install `createInMemoryBlobStoreForTesting()` before the scenario actions and call `resetBlobStoreForTesting()` in `finally`. Stage `retry-me.txt`; resolve with a `null` downloader and then resolve the same ID with a downloader that increments a counter. Assert `download_failed`, exactly one downloader call, and no attachment row.

Re-stage the same platform file in the same context with a new message ID. Assert the returned staged ID equals the failed row ID and status is `staged`. Resolve it with fixed bytes and assert `available`; resolve again and assert `already_resolved` with the same attachment ID. Query `attachments` by that ID and assert one row. Do not create a new staged ID or a retry seam.

- [ ] **Step 3: Run the focused staged story**

Run: `bun test tests/stories/runtime/staged-attachments.story.test.ts`

Expected: PASS against the existing staged-file runtime. The RED checkpoint for this coverage-only task is Task 1's catalog-contract failure; a direct story test does not depend on catalog mappings.

- [ ] **Step 4: Promote only the staged records**

Leave `PURE_HELPER_SCENARIO_IDS` and `GAP_SCENARIO_IDS` unchanged: catalog status is not part of these new claims, while `EXECUTABLE_STORY_MAPPINGS` determines executable coverage. Add the exact Task 1 literal mappings to `EXECUTABLE_STORY_MAPPINGS`, each with `verifiedAt: '2026-07-29'` and `provingTier: '0'`. Delete only the two staged `AUDIT_RECORDS` entries.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```sh
bun test tests/stories/runtime/staged-attachments.story.test.ts
bun test:stories:contracts
```

Expected: PASS; the story proves scope isolation, group widening, terminal failure, and deliberate re-send behavior.

```sh
git add tests/stories/runtime/staged-attachments.story.test.ts tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): cover staged attachment persistence"
```

### Task 3: Add BYOK stories, promote them, and qualify frozen inputs

**Files:**
- Create: `tests/stories/settings/byok-credentials.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts:360-405, 400-520, 1489-1510`
- Generated, ignored: `reports/stories/manifest.json`, `reports/stories/junit.xml`

**Interfaces:**
- Consumes: `given.settingsSession`, `when.settingsRequest`, `byokLlmCredentials`, `getDrizzleDb`, and `resolveLlmConfig(configContextId)`.
- Produces: the two BYOK literal IDs from Task 1 and final frozen-story qualification evidence.

- [ ] **Step 1: Write the failing context-credentials scenario**

Create the file with SPDX header and imports for `expect`, `z`, the BYOK table/store resolver, and `scenario`. Create Alice and Bob DMs/sessions. Build opaque non-production credential input at runtime from fragments; retain it only for absence checks.

Enable Alice through `PATCH /settings/api/byok`; save required fields plus an optional small model; then PATCH only Alice with a new main model and `small_model: ''`. Assert Alice GET is enabled/complete, the main-model public field changed, and the small-model field has `hasValue: false`. Assert Bob GET is still its initial disabled state. Assert serialized PATCH/GET bodies and `JSON.stringify(world.events.all())` omit the opaque input. Do not read a decrypted config, ciphertext, or the stored credential value.

- [ ] **Step 2: Write the failing unreadable-data scenario**

Create a readable Alice context through the settings route, then insert one separate enabled unreadable row:

```ts
getDrizzleDb().insert(byokLlmCredentials).values({
  contextId: unreadableContextId,
  enabled: true,
  encryptedConfig: unreadableMarker,
  updatedAt: 1,
  updatedBy: 'scenario-writer',
}).run()
```


Read that context through its authorized settings session. Assert `enabled: true`, `complete: false`, `unreadable: true`, all required missing fields, empty fields/providers, and default-empty roles. Assert response/event output omits both opaque values. Assert:

```ts
expect(resolveLlmConfig(unreadableContextId)).toEqual({
  ok: false,
  type: 'error',
  source: 'byok',
  error: 'stored BYOK LLM credentials are unreadable',
})
```

Re-read Alice and assert it remains complete. Do not configure or inspect central credentials.

- [ ] **Step 3: Run the focused BYOK story**

Run: `bun test tests/stories/settings/byok-credentials.story.test.ts`

Expected: PASS against the existing settings/store/resolver behavior. The RED checkpoint for this coverage-only task is Task 1's catalog-contract failure; a direct story test does not depend on catalog mappings.

- [ ] **Step 4: Promote only the BYOK records**

Leave `PURE_HELPER_SCENARIO_IDS` and `GAP_SCENARIO_IDS` unchanged. Add the two Task 1 literal mappings to `EXECUTABLE_STORY_MAPPINGS` with `verifiedAt: '2026-07-29'` and `provingTier: '0'`; delete only the two BYOK `AUDIT_RECORDS` entries. The final Phase 3 assertion has twelve executable records and nine pending records.

- [ ] **Step 5: Verify GREEN, full Tier-0 lane, and commit**

Run:

```sh
bun test tests/stories/settings/byok-credentials.story.test.ts
bun test:stories:contracts
bun test:stories
bun test:stories:stress
```

Expected: PASS. The catalog reports 181 executable records, 34 pending records, and three remaining executable-as-is pending records.

```sh
git add tests/stories/settings/byok-credentials.story.test.ts tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): cover BYOK credential persistence"
```

- [ ] **Step 6: Record compatibility evidence after merge**

```sh
PAPAI_BASELINE_SHA="$(git rev-parse HEAD)"
bun test:stories:contracts
bun test:stories
bun test:stories:manifest
BASE_REF="$PAPAI_BASELINE_SHA" bun test:stories:compat --manifest-only
BASE_REF="$PAPAI_BASELINE_SHA" bun test:stories:compat
```

Expected: every command PASS. Record `PAPAI_BASELINE_SHA` and `treeHash` from `reports/stories/manifest.json` in the PR handoff; do not commit `reports/stories/**`.
