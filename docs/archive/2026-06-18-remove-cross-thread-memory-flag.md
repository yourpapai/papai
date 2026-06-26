<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Remove `cross_thread_memory` Feature Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the `cross_thread_memory` experimental flag and make provisional memory capture + the `recall` tool + promotion the always-on default; the per-context "Disable capture" memory-profile toggle becomes the only off switch.

**Architecture:** Remove the `crossThreadMemory` field from `ReductionFlags` and delete `resolveCrossThreadMemoryFlag`; drop the `flagEnabled` gate from the capture executor and debounce arm; register `recall` unconditionally in `normal` mode; remove the flag from the admin/settings UI (server + client). The scheduler sweeps, promotion, recall-cascade, and system-prompt need no logic change — they activate on their own once capture writes rows.

**Tech Stack:** Bun, TypeScript (strict), Zod v4, Vercel AI SDK, Svelte 5, Drizzle. Spec: `docs/superpowers/specs/2026-06-18-remove-cross-thread-memory-flag-design.md`.

---

## Write-hook & ordering notes (read before starting)

This repo enforces TDD via write hooks. Two facts drive the task ordering below:

1. **Editing an implementation file (`src/**`, `client/**` non-test) runs its _mapped_ test** (`src/foo.ts` → `tests/.../foo.test.ts`; `client/x/foo.ts|.svelte` → `tests/client/x/foo.test.ts`) and **blocks on failure**. Editing a test file verifies the changed test passes.
2. **Bun's test runner transpiles without typechecking.** Removing a field from `ReductionFlags` does NOT fail a per-file test run even while other files still reference it; those surface only at the final `bun typecheck` (Task 10). Plan ordering exploits this: each task keeps its own _mapped_ test green; cross-file type fallout is reconciled before the final typecheck.

**Deadlock avoidance.** Some mapped tests compare against a local constant via `toEqual(...)` or pass `flagEnabled` in a deps object. For those, neither "impl first" nor "test first" passes cleanly. Use this 3-move sequence per affected pair:

- **A — transitional test edit:** change the test into a state that PASSES against the _current (old)_ impl and will also pass against the new impl. Techniques: (i) relax `expect(x).toEqual(CONST)` to `expect(x).toMatchObject(CONST)` and drop the field from `CONST` (a subset still matches the old 4-key result); (ii) delete the test that asserts the soon-to-be-removed flag-off behavior; (iii) keep an explicit flag-on config in a test so it still passes pre-change.
- **B — impl edit:** make the production change. The mapped test (now tolerant) stays green.
- **C — cleanup test edit:** re-tighten `toMatchObject`→`toEqual` and remove vestigial lines. Both sides now agree.

Each task notes whether it needs the 3-move sequence. **Commit at the end of every task.** Deleting a whole test file uses `git rm` (Bash) — the write-hook does not fire on deletions.

---

## File structure

**Production files modified:**

- `src/tools/feature-flags.ts` — remove `crossThreadMemory` from `ReductionFlags`/`ALL_OFF`/parser; delete `resolveCrossThreadMemoryFlag`.
- `src/long-term-memory/capture.ts` — remove `flagEnabled` dep + guard + import.
- `src/long-term-memory/capture-debounce.ts` — remove `flagEnabled` dep + guard + import.
- `src/tools/provider-independent-tools-builder.ts` — register `recall` without the flag.
- `src/debug/admin-feature-flags.ts` — drop `cross_thread_memory` from `AdminFlagState` + `toWire`.
- `src/debug/settings/admin/feature-flags-routes.ts` — drop from `FlagsSchema`.
- `client/admin/feature-flags-fetcher-schemas.ts` — drop from the schema.
- `client/settings/sections/admin/AdminFeatureFlagsSection.svelte` — drop from `FLAG_KEYS`/`FLAG_LABELS`.
- `CLAUDE.md`, `src/tools/CLAUDE.md` — docs.

**Test files deleted:** `tests/tools/feature-flags-cross-thread.test.ts`, `tests/long-term-memory/flag-off-parity.test.ts`.

**Test files edited:** `tests/long-term-memory/capture.test.ts`, `tests/long-term-memory/capture-debounce.test.ts`, `tests/long-term-memory/stop-rediscovering.acceptance.test.ts`, `tests/tools/feature-flags.test.ts`, `tests/tools/provider-independent-tools-builder.test.ts`, `tests/llm-orchestrator-tools-compaction.test.ts`, `tests/llm-orchestrator-disclosure-wiring.test.ts`, `tests/debug/admin-feature-flags.test.ts`, `tests/debug/settings/admin/feature-flags-routes.test.ts`, `tests/client/admin/feature-flags-fetcher-schemas.test.ts`, `tests/client/settings/admin-fetchers.test.ts`, `tests/client/settings/sections/admin/AdminFeatureFlagsSection.test.ts`.

**No change (verify only):** `promotion.ts`, `promotion-sweep.ts`, `recall-cascade.ts`, `capture-sweep.ts`, `llm-history.ts`, `scheduler-instance.ts`, `system-prompt.ts`, `recall.ts`.

---

## Task 1: Always-on capture executor (`capture.ts`)

**Files:**

- Modify: `src/long-term-memory/capture.ts`
- Test: `tests/long-term-memory/capture.test.ts`

Mapped test runs on the impl edit. Uses the 3-move sequence (the "no-op when the flag is off" test calls `deps.flagEnabled()`, which throws once we drop the field; and removing the guard would make that test write rows).

- [ ] **Step 1 (move A): delete the flag-off test from `tests/long-term-memory/capture.test.ts`.** Remove the entire `test('no-op when the flag is off', ...)` block whose deps are:

```typescript
      {
        flagEnabled: () => false,
        extractMemoryPatch: () => Promise.resolve(patch),
        getEmbedding: () => Promise.resolve(null),
        now: () => 'x',
        randomUUID: () => 'y',
      },
```

Leave the other three tests (which pass `flagEnabled: () => true`) untouched for now.

- [ ] **Step 2: run the mapped test — still green against the unchanged impl.**

Run: `bun test tests/long-term-memory/capture.test.ts`
Expected: PASS (3 tests; flag-off test gone).

- [ ] **Step 3 (move B): edit `src/long-term-memory/capture.ts`.**

Remove the import (line 16):

```typescript
import { resolveCrossThreadMemoryFlag } from '../tools/feature-flags.js'
```

Remove the `flagEnabled` member from `RunMemoryCaptureDeps`:

```typescript
export type RunMemoryCaptureDeps = Readonly<{
  flagEnabled: (storageContextId: string) => boolean
  extractMemoryPatch: (input: CaptureExtractInput) => Promise<MemoryPatch>
```

→

```typescript
export type RunMemoryCaptureDeps = Readonly<{
  extractMemoryPatch: (input: CaptureExtractInput) => Promise<MemoryPatch>
```

Remove the `flagEnabled` line from `defaultDeps`:

```typescript
const defaultDeps: RunMemoryCaptureDeps = {
  flagEnabled: resolveCrossThreadMemoryFlag,
  extractMemoryPatch: defaultExtract,
```

→

```typescript
const defaultDeps: RunMemoryCaptureDeps = {
  extractMemoryPatch: defaultExtract,
```

Remove the guard line in `runMemoryCapture` (keep the group/thread guard on the next line):

```typescript
if (!deps.flagEnabled(input.storageContextId)) return
if (input.contextType !== 'group' || !hasThreadContextId(input.storageContextId)) return
```

→

```typescript
if (input.contextType !== 'group' || !hasThreadContextId(input.storageContextId)) return
```

- [ ] **Step 4: run the mapped test — green (remaining tests pass `flagEnabled: () => true`, now an ignored extra property).**

Run: `bun test tests/long-term-memory/capture.test.ts`
Expected: PASS.

- [ ] **Step 5 (move C): remove the vestigial `flagEnabled: () => true,` line from each of the three remaining deps objects in `tests/long-term-memory/capture.test.ts`** (the "writes provisional records…", "no-op for DM contexts", and "no-op for group context without thread segment" tests). Each block currently begins:

```typescript
      {
        flagEnabled: () => true,
        extractMemoryPatch: () => Promise.resolve(patch),
```

→

```typescript
      {
        extractMemoryPatch: () => Promise.resolve(patch),
```

- [ ] **Step 6: run + commit.**

Run: `bun test tests/long-term-memory/capture.test.ts`
Expected: PASS.

```bash
git add src/long-term-memory/capture.ts tests/long-term-memory/capture.test.ts
git commit -m "refactor(memory): always-on provisional capture executor (drop flagEnabled)"
```

---

## Task 2: Always-on debounce arm (`capture-debounce.ts`)

**Files:**

- Modify: `src/long-term-memory/capture-debounce.ts`
- Test: `tests/long-term-memory/capture-debounce.test.ts`

Same 3-move sequence (the "no-op when flag disabled" test calls `deps.flagEnabled()`).

- [ ] **Step 1 (move A): delete the `test('no-op when flag disabled', ...)` block from `tests/long-term-memory/capture-debounce.test.ts`** (its deps object has `flagEnabled: (): boolean => false` and asserts `expect(activity).toBe(0)`). Leave the "coalesces rapid arms…" test.

- [ ] **Step 2: run mapped test.**

Run: `bun test tests/long-term-memory/capture-debounce.test.ts`
Expected: PASS (coalesce test only).

- [ ] **Step 3 (move B): edit `src/long-term-memory/capture-debounce.ts`.**

Remove the import (line 7):

```typescript
import { resolveCrossThreadMemoryFlag } from '../tools/feature-flags.js'
```

Remove `flagEnabled` from `ArmCaptureDeps`:

```typescript
export type ArmCaptureDeps = Readonly<{
  flagEnabled: (storageContextId: string) => boolean
  markActivity: (input: RunMemoryCaptureInput, historyLen: number, now: string) => void
```

→

```typescript
export type ArmCaptureDeps = Readonly<{
  markActivity: (input: RunMemoryCaptureInput, historyLen: number, now: string) => void
```

Remove `flagEnabled` from `defaultDeps`:

```typescript
const defaultDeps: ArmCaptureDeps = {
  flagEnabled: resolveCrossThreadMemoryFlag,
  markActivity: (input, historyLen, now) => {
```

→

```typescript
const defaultDeps: ArmCaptureDeps = {
  markActivity: (input, historyLen, now) => {
```

Remove the guard line in `armMemoryCapture` (keep the group guard):

```typescript
if (!deps.flagEnabled(input.storageContextId)) return
if (input.contextType !== 'group') return
```

→

```typescript
if (input.contextType !== 'group') return
```

- [ ] **Step 4: run mapped test.**

Run: `bun test tests/long-term-memory/capture-debounce.test.ts`
Expected: PASS.

- [ ] **Step 5 (move C): remove the vestigial `flagEnabled: (): boolean => true,` line from the "coalesces rapid arms…" deps object** in the test:

```typescript
    const deps: ArmCaptureDeps = {
      flagEnabled: (): boolean => true,
      markActivity: (): void => undefined,
```

→

```typescript
    const deps: ArmCaptureDeps = {
      markActivity: (): void => undefined,
```

- [ ] **Step 6: run + commit.**

Run: `bun test tests/long-term-memory/capture-debounce.test.ts`
Expected: PASS.

```bash
git add src/long-term-memory/capture-debounce.ts tests/long-term-memory/capture-debounce.test.ts
git commit -m "refactor(memory): always arm debounced capture (drop flagEnabled)"
```

---

## Task 3: Register `recall` unconditionally (`provider-independent-tools-builder.ts`)

**Files:**

- Modify: `src/tools/provider-independent-tools-builder.ts`
- Test: `tests/tools/provider-independent-tools-builder.test.ts`

3-move sequence: the current tests assert recall is absent when the flag is OFF.

- [ ] **Step 1 (move A): rewrite the `recall registration` describe block in the test to set the flag ON in every case** (so it passes against the still-flag-gated impl). Replace the three `it(...)` blocks (keep any existing `beforeEach`/`describe` scaffolding and the `CROSS_THREAD_ON`/`setCachedConfig`/`REDUCTION_FLAGS_CONFIG_KEY` imports for now) with:

```typescript
it('registers recall in normal mode for a group context', () => {
  setCachedConfig('pitb-recall-group', REDUCTION_FLAGS_CONFIG_KEY, CROSS_THREAD_ON)
  const tools: ToolSet = {}
  addProviderIndependentTools(tools, optsFor('pitb-recall-group', 'normal', 'group'))
  expect(tools['recall']).toBeDefined()
})

it('registers recall in normal mode for a dm context', () => {
  setCachedConfig('pitb-recall-dm', REDUCTION_FLAGS_CONFIG_KEY, CROSS_THREAD_ON)
  const tools: ToolSet = {}
  addProviderIndependentTools(tools, optsFor('pitb-recall-dm', 'normal', 'dm'))
  expect(tools['recall']).toBeDefined()
})

it('omits recall in proactive mode', () => {
  setCachedConfig('pitb-recall-proactive', REDUCTION_FLAGS_CONFIG_KEY, CROSS_THREAD_ON)
  const tools: ToolSet = {}
  addProviderIndependentTools(tools, optsFor('pitb-recall-proactive', 'proactive', 'group'))
  expect(tools['recall']).toBeUndefined()
})
```

- [ ] **Step 2: run mapped test (passes against the flag-gated impl since every case sets the flag ON).**

Run: `bun test tests/tools/provider-independent-tools-builder.test.ts`
Expected: PASS.

- [ ] **Step 3 (move B): edit `src/tools/provider-independent-tools-builder.ts`.**

Change the import (line 18):

```typescript
import { resolveReductionFlags, resolveCrossThreadMemoryFlag } from './feature-flags.js'
```

→

```typescript
import { resolveReductionFlags } from './feature-flags.js'
```

Replace the recall guard (lines 120–127):

```typescript
if (
  contextId !== undefined &&
  contextType !== undefined &&
  mode === 'normal' &&
  resolveCrossThreadMemoryFlag(contextId)
) {
  tools['recall'] = makeRecallMemoryTool({ storageContextId: contextId, contextType })
}
```

→

```typescript
if (contextId !== undefined && contextType !== undefined && mode === 'normal') {
  tools['recall'] = makeRecallMemoryTool({ storageContextId: contextId, contextType })
}
```

- [ ] **Step 4: run mapped test.**

Run: `bun test tests/tools/provider-independent-tools-builder.test.ts`
Expected: PASS.

- [ ] **Step 5 (move C): remove the now-redundant `setCachedConfig(...CROSS_THREAD_ON)` line from each of the three tests, delete the `const CROSS_THREAD_ON = ...` line, and remove any import that is now unused** (`CROSS_THREAD_ON` is gone; `setCachedConfig`/`REDUCTION_FLAGS_CONFIG_KEY` only if no longer referenced elsewhere in the file).

After cleanup the three tests read:

```typescript
it('registers recall in normal mode for a group context', () => {
  const tools: ToolSet = {}
  addProviderIndependentTools(tools, optsFor('pitb-recall-group', 'normal', 'group'))
  expect(tools['recall']).toBeDefined()
})

it('registers recall in normal mode for a dm context', () => {
  const tools: ToolSet = {}
  addProviderIndependentTools(tools, optsFor('pitb-recall-dm', 'normal', 'dm'))
  expect(tools['recall']).toBeDefined()
})

it('omits recall in proactive mode', () => {
  const tools: ToolSet = {}
  addProviderIndependentTools(tools, optsFor('pitb-recall-proactive', 'proactive', 'group'))
  expect(tools['recall']).toBeUndefined()
})
```

- [ ] **Step 6: run + lint + commit.**

Run: `bun test tests/tools/provider-independent-tools-builder.test.ts`
Expected: PASS.
Run: `bunx oxlint src/tools/provider-independent-tools-builder.ts tests/tools/provider-independent-tools-builder.test.ts`
Expected: 0 errors (fix any unused-import findings before committing).

```bash
git add src/tools/provider-independent-tools-builder.ts tests/tools/provider-independent-tools-builder.test.ts
git commit -m "refactor(tools): register recall unconditionally in normal mode"
```

---

## Task 4: Delete the flag from `feature-flags.ts`

**Files:**

- Modify: `src/tools/feature-flags.ts`
- Test: `tests/tools/feature-flags.test.ts`
- Delete: `tests/tools/feature-flags-cross-thread.test.ts`

Prereq: Tasks 1–3 done (no production file imports `resolveCrossThreadMemoryFlag` anymore). 3-move sequence for `feature-flags.test.ts` (uses `toEqual(ALL_OFF)`).

- [ ] **Step 1: delete the cross-thread-only test file.**

```bash
git rm tests/tools/feature-flags-cross-thread.test.ts
```

- [ ] **Step 2 (move A): in `tests/tools/feature-flags.test.ts`, drop the field from the local constants AND relax the constant comparisons to subset matches** so it passes against the still-4-key impl.

`ALL_OFF` (lines 17–22):

```typescript
const ALL_OFF = {
  progressiveDisclosure: false,
  resultCompaction: false,
  semanticToolRetrieval: false,
  crossThreadMemory: false,
}
```

→

```typescript
const ALL_OFF = {
  progressiveDisclosure: false,
  resultCompaction: false,
  semanticToolRetrieval: false,
}
```

Change every `expect(resolveReductionFlags(...)).toEqual(ALL_OFF)` (lines 36, 68, 74, 80, 86, 96, 107, 113, 127) to `.toMatchObject(ALL_OFF)`.

Inline object (lines 140–145) — relax and drop the field:

```typescript
expect(flags).toEqual({
  resultCompaction: true,
  progressiveDisclosure: false,
  semanticToolRetrieval: false,
  crossThreadMemory: false,
})
```

→

```typescript
expect(flags).toMatchObject({
  resultCompaction: true,
  progressiveDisclosure: false,
  semanticToolRetrieval: false,
})
```

Inline `allOff` (lines 149–154) drop the field, and change the three `toEqual(allOff)` calls (155–158) to `toMatchObject(allOff)`:

```typescript
const allOff = {
  resultCompaction: false,
  progressiveDisclosure: false,
  semanticToolRetrieval: false,
  crossThreadMemory: false,
}
```

→

```typescript
const allOff = {
  resultCompaction: false,
  progressiveDisclosure: false,
  semanticToolRetrieval: false,
}
```

- [ ] **Step 3: run mapped test (subset matches still pass against the 4-key impl).**

Run: `bun test tests/tools/feature-flags.test.ts`
Expected: PASS.

- [ ] **Step 4 (move B): edit `src/tools/feature-flags.ts`.**

`ReductionFlags` (remove `crossThreadMemory: boolean`):

```typescript
export interface ReductionFlags {
  progressiveDisclosure: boolean
  resultCompaction: boolean
  semanticToolRetrieval: boolean
  crossThreadMemory: boolean
}
```

→

```typescript
export interface ReductionFlags {
  progressiveDisclosure: boolean
  resultCompaction: boolean
  semanticToolRetrieval: boolean
}
```

`ALL_OFF` (remove `crossThreadMemory: false,`):

```typescript
const ALL_OFF: ReductionFlags = {
  progressiveDisclosure: false,
  resultCompaction: false,
  semanticToolRetrieval: false,
  crossThreadMemory: false,
}
```

→

```typescript
const ALL_OFF: ReductionFlags = {
  progressiveDisclosure: false,
  resultCompaction: false,
  semanticToolRetrieval: false,
}
```

`parseReductionFlagsJson` return (remove the `crossThreadMemory` line):

```typescript
return {
  progressiveDisclosure: parsed['progressive_disclosure'] === true,
  resultCompaction: parsed['result_compaction'] === true,
  semanticToolRetrieval: parsed['semantic_tool_retrieval'] === true,
  crossThreadMemory: parsed['cross_thread_memory'] === true,
}
```

→

```typescript
return {
  progressiveDisclosure: parsed['progressive_disclosure'] === true,
  resultCompaction: parsed['result_compaction'] === true,
  semanticToolRetrieval: parsed['semantic_tool_retrieval'] === true,
}
```

Delete `resolveCrossThreadMemoryFlag` entirely, including its doc comment:

```typescript
/**
 * True when the cross-thread memory bridge is enabled for this storage context.
 * @public -- consumed by the memory capture executor + debounce manager (Plan 1 T7/T8).
 */
export function resolveCrossThreadMemoryFlag(storageContextId: string): boolean {
  return resolveReductionFlags(storageContextId).crossThreadMemory
}
```

(remove the whole block)

- [ ] **Step 5: run mapped test.**

Run: `bun test tests/tools/feature-flags.test.ts`
Expected: PASS.

- [ ] **Step 6 (move C): re-tighten the relaxed assertions in `tests/tools/feature-flags.test.ts` back to `toEqual`** (`.toMatchObject(ALL_OFF)`→`.toEqual(ALL_OFF)`, the inline `flags` object back to `toEqual`, and `.toMatchObject(allOff)`→`.toEqual(allOff)`). All three-key now.

- [ ] **Step 7: run + commit.**

Run: `bun test tests/tools/feature-flags.test.ts`
Expected: PASS.

```bash
git add src/tools/feature-flags.ts tests/tools/feature-flags.test.ts
git commit -m "refactor(flags): remove crossThreadMemory from ReductionFlags"
```

---

## Task 5: Remove flag from admin server surfaces

**Files:**

- Modify: `src/debug/admin-feature-flags.ts`, `src/debug/settings/admin/feature-flags-routes.ts`
- Test: `tests/debug/admin-feature-flags.test.ts`, `tests/debug/settings/admin/feature-flags-routes.test.ts`

Both mapped tests compare against local constants (`ALL_OFF` via spread/reference; `FLAGS_ON` via reference). 3-move per file.

- [ ] **Step 1 (move A): in `tests/debug/admin-feature-flags.test.ts`, drop `cross_thread_memory: false,` from the `ALL_OFF` constant (lines 19–24) and change the two direct comparisons to subset matches** — `expect(userRow).toEqual({...})` (line 56) and `expect(groupRow).toEqual({...})` (line 63) → `.toMatchObject({...})`. (Usages of `ALL_OFF` via spread/reference need no other change.)

- [ ] **Step 2 (move A): in `tests/debug/settings/admin/feature-flags-routes.test.ts`, drop `cross_thread_memory: false,` from `FLAGS_ON` (lines 20–25), drop `cross_thread_memory: z.boolean(),` from the inline local `FlagsSchema` (lines 96–101), and change `expect(row.flags).toEqual(FLAGS_ON)` (111) and `expect(...?.flags).toEqual(FLAGS_ON)` (116) to `.toMatchObject(FLAGS_ON)`.**

- [ ] **Step 3: run both mapped tests (subset matches pass against the still-4-key server).**

Run: `bun test tests/debug/admin-feature-flags.test.ts tests/debug/settings/admin/feature-flags-routes.test.ts`
Expected: PASS.

- [ ] **Step 4 (move B): edit `src/debug/admin-feature-flags.ts`.**

`AdminFlagState` (remove `cross_thread_memory: boolean`):

```typescript
export interface AdminFlagState {
  result_compaction: boolean
  progressive_disclosure: boolean
  semantic_tool_retrieval: boolean
  cross_thread_memory: boolean
}
```

→

```typescript
export interface AdminFlagState {
  result_compaction: boolean
  progressive_disclosure: boolean
  semantic_tool_retrieval: boolean
}
```

`toWire` (remove the `cross_thread_memory` line):

```typescript
const toWire = (flags: ReductionFlags): AdminFlagState => ({
  result_compaction: flags.resultCompaction,
  progressive_disclosure: flags.progressiveDisclosure,
  semantic_tool_retrieval: flags.semanticToolRetrieval,
  cross_thread_memory: flags.crossThreadMemory,
})
```

→

```typescript
const toWire = (flags: ReductionFlags): AdminFlagState => ({
  result_compaction: flags.resultCompaction,
  progressive_disclosure: flags.progressiveDisclosure,
  semantic_tool_retrieval: flags.semanticToolRetrieval,
})
```

- [ ] **Step 5 (move B): edit `src/debug/settings/admin/feature-flags-routes.ts` — remove `cross_thread_memory: z.boolean(),` from `FlagsSchema`:**

```typescript
const FlagsSchema = z
  .object({
    result_compaction: z.boolean(),
    progressive_disclosure: z.boolean(),
    semantic_tool_retrieval: z.boolean(),
    cross_thread_memory: z.boolean(),
  })
  .strict()
```

→

```typescript
const FlagsSchema = z
  .object({
    result_compaction: z.boolean(),
    progressive_disclosure: z.boolean(),
    semantic_tool_retrieval: z.boolean(),
  })
  .strict()
```

- [ ] **Step 6: run both mapped tests.**

Run: `bun test tests/debug/admin-feature-flags.test.ts tests/debug/settings/admin/feature-flags-routes.test.ts`
Expected: PASS.

- [ ] **Step 7 (move C): re-tighten the relaxed `toMatchObject` assertions in both test files back to `toEqual`.**

- [ ] **Step 8: run + commit.**

Run: `bun test tests/debug/admin-feature-flags.test.ts tests/debug/settings/admin/feature-flags-routes.test.ts`
Expected: PASS.

```bash
git add src/debug/admin-feature-flags.ts src/debug/settings/admin/feature-flags-routes.ts tests/debug/admin-feature-flags.test.ts tests/debug/settings/admin/feature-flags-routes.test.ts
git commit -m "refactor(admin): drop cross_thread_memory from feature-flags server surface"
```

---

## Task 6: Remove flag from client UI surfaces

**Files:**

- Modify: `client/admin/feature-flags-fetcher-schemas.ts`, `client/settings/sections/admin/AdminFeatureFlagsSection.svelte`
- Test: `tests/client/admin/feature-flags-fetcher-schemas.test.ts`, `tests/client/settings/admin-fetchers.test.ts`, `tests/client/settings/sections/admin/AdminFeatureFlagsSection.test.ts`

Client tests run with the happy-dom preload (`bun test:client`). The schema is non-`.strict()`, so fixtures with the extra key still parse; the Svelte/test pair is circular on the checkbox count + PATCH-body strings, so use moves A/B/C.

- [ ] **Step 1: drop `cross_thread_memory: ...` from every fixture in `tests/client/admin/feature-flags-fetcher-schemas.test.ts`** (5 occurrences: lines ~20, ~51, ~67, ~84, ~110). These assert `safeParse` success and don't depend on impl order, so this edit is safe immediately.

- [ ] **Step 2: edit `client/admin/feature-flags-fetcher-schemas.ts` — remove `cross_thread_memory: z.boolean(),` from the flag-state schema (line 12).**

- [ ] **Step 3: run the schema test.**

Run: `bun test:client -t "feature flag"`
Expected: PASS (matched feature-flags-fetcher-schemas tests).

- [ ] **Step 4: drop `cross_thread_memory: false,` from the three spots in `tests/client/settings/admin-fetchers.test.ts`** — the `flagsSnapshot` fixture (~82), the `saveAdminFeatureFlags` call flags (~123), and the inline `expect(seenBody).toEqual({...})` flags object (~135). This test mocks fetch and asserts the request body, independent of the Svelte component — safe immediately.

- [ ] **Step 5: run the admin-fetchers test.**

Run: `bun test:client -t "AdminFeatureFlags"`
Expected: PASS.

- [ ] **Step 6 (move A): edit `tests/client/settings/sections/admin/AdminFeatureFlagsSection.test.ts` into its final state** — but in a form that passes against the still-4-key Svelte component:
  - Drop `cross_thread_memory: false,` from `ALL_FLAGS_OFF` (lines 22–27) and from the `capturePatchMock` flags object (lines 62–81).
  - Change the checkbox-count assertion `expect(allCheckboxes.length).toBe(4)` (line 105) to `toBeGreaterThanOrEqual(3)` and update the comment (line 103) to list three keys.
  - Delete the entire `test('toggling cross_thread_memory checkbox issues PATCH with the key', ...)` block (lines 177–213).
  - In the surviving `toggling a checkbox enables Save` test, drop `cross_thread_memory: false,` from the expected `capturedPatchBody` JSON (lines 162–172).

  Note: `capturePatchMock` returns a row the component re-renders but does not strictly diff against `ALL_FLAGS_OFF`; with the 4-key component still rendering, `toBeGreaterThanOrEqual(3)` passes, the deleted test removes the 4-key string assertion, and the surviving PATCH-body assertion will match once the component is narrowed in Step 7. If this surviving assertion fails against the 4-key component at this step, temporarily skip it with `test.skip` and re-enable in Step 9.

- [ ] **Step 7 (move B): edit `client/settings/sections/admin/AdminFeatureFlagsSection.svelte`.**

`FLAG_KEYS` (line 15):

```svelte
  const FLAG_KEYS: FlagKey[] = ['result_compaction', 'progressive_disclosure', 'semantic_tool_retrieval', 'cross_thread_memory']
```

→

```svelte
  const FLAG_KEYS: FlagKey[] = ['result_compaction', 'progressive_disclosure', 'semantic_tool_retrieval']
```

`FLAG_LABELS` (remove the `cross_thread_memory` entry, line 20):

```svelte
    result_compaction: 'Compaction',
    progressive_disclosure: 'Disclosure',
    semantic_tool_retrieval: 'Semantic retrieval',
    cross_thread_memory: 'Cross-thread memory',
```

→

```svelte
    result_compaction: 'Compaction',
    progressive_disclosure: 'Disclosure',
    semantic_tool_retrieval: 'Semantic retrieval',
```

- [ ] **Step 8: run the section test.**

Run: `bun test:client -t "AdminFeatureFlags"`
Expected: PASS.

- [ ] **Step 9 (move C): tighten the count assertion back to `expect(allCheckboxes.length).toBe(3)` and re-enable any `test.skip` from Step 6.**

- [ ] **Step 10: run + build + commit.**

Run: `bun test:client -t "feature flag"` and `bun test:client -t "AdminFeatureFlags"`
Expected: PASS.
Run: `bun build:client`
Expected: builds with no errors (ships the Svelte change).

```bash
git add client/admin/feature-flags-fetcher-schemas.ts client/settings/sections/admin/AdminFeatureFlagsSection.svelte tests/client/admin/feature-flags-fetcher-schemas.test.ts tests/client/settings/admin-fetchers.test.ts tests/client/settings/sections/admin/AdminFeatureFlagsSection.test.ts
git commit -m "refactor(settings-ui): drop cross_thread_memory flag from admin UI"
```

---

## Task 7: Drop the field from orchestrator test stubs (typecheck cleanup)

**Files:**

- Test: `tests/llm-orchestrator-tools-compaction.test.ts`, `tests/llm-orchestrator-disclosure-wiring.test.ts`

These build `ReductionFlags` literals with the now-removed field (excess-property typecheck errors; runtime already fine). Test-only edits.

- [ ] **Step 1: edit `tests/llm-orchestrator-tools-compaction.test.ts` — drop `crossThreadMemory: false,` from the `flags` factory (lines 18–23).**

- [ ] **Step 2: edit `tests/llm-orchestrator-disclosure-wiring.test.ts` — drop `crossThreadMemory: false,` from the inline `resolveReductionFlags` stub (lines 22–27).**

- [ ] **Step 3: run both tests + commit.**

Run: `bun test tests/llm-orchestrator-tools-compaction.test.ts tests/llm-orchestrator-disclosure-wiring.test.ts`
Expected: PASS.

```bash
git add tests/llm-orchestrator-tools-compaction.test.ts tests/llm-orchestrator-disclosure-wiring.test.ts
git commit -m "test(orchestrator): drop crossThreadMemory from ReductionFlags stubs"
```

---

## Task 8: Acceptance test cleanup + delete flag-off parity test

**Files:**

- Test: `tests/long-term-memory/stop-rediscovering.acceptance.test.ts`
- Delete: `tests/long-term-memory/flag-off-parity.test.ts`

- [ ] **Step 1: delete the obsolete parity test.**

```bash
git rm tests/long-term-memory/flag-off-parity.test.ts
```

- [ ] **Step 2: edit `tests/long-term-memory/stop-rediscovering.acceptance.test.ts` — remove `flagEnabled: (): boolean => true,` from the `captureDeps` object (lines 35–41):**

```typescript
const captureDeps: RunMemoryCaptureDeps = {
  flagEnabled: (): boolean => true,
  extractMemoryPatch: (): Promise<MemoryPatch> => Promise.resolve(patch),
```

→

```typescript
const captureDeps: RunMemoryCaptureDeps = {
  extractMemoryPatch: (): Promise<MemoryPatch> => Promise.resolve(patch),
```

- [ ] **Step 3: run + commit.**

Run: `bun test tests/long-term-memory/stop-rediscovering.acceptance.test.ts`
Expected: PASS (fact captured across 3 threads is promoted and recalled).

```bash
git add tests/long-term-memory/stop-rediscovering.acceptance.test.ts
git commit -m "test(memory): drop flagEnabled from acceptance test; remove flag-off parity test"
```

---

## Task 9: Documentation

**Files:**

- Modify: `CLAUDE.md`, `src/tools/CLAUDE.md` (confirm), `README.md` (confirm)

- [ ] **Step 1: rewrite the "Cross-thread memory bridge (experimental, default OFF)" paragraph in `CLAUDE.md`.** Change the heading/lead to non-experimental and always-on; state the per-context "Disable capture" memory-profile toggle is the only off switch; remove the `resolveCrossThreadMemoryFlag` reference and the "Flag OFF ⇒ … reference-identical" clause. Suggested lead:

```markdown
**Cross-thread memory bridge (always on)** — the bot does not rediscover recurring facts in every new thread of a group. The mechanism lives in `src/long-term-memory/` and extends the long-term store: `memory_records` has a `provisional` status + `thread_context_id` (migration `056`). (1) **Capture** — an idle-debounce pipeline (`capture.ts` + `capture-debounce.ts`, armed every group-thread turn from `llm-history.ts`; `memory-capture-sweep` scheduler backstop over a `memory_extraction_state` watermark) runs the SMALL_MODEL extractor and writes provisional, thread-tagged, embedding-populated records. (2) **Recall** — the `recall` tool (registered in `normal` mode) runs a server-side cascade (`recall-cascade.ts`). (3) **Promotion** — when a provisional fact clusters across ≥`MEMORY_PROMOTION_MIN_THREADS` (3) distinct threads and a SMALL_MODEL confirms it is durable, it is promoted to `active` group memory (`promotion.ts`; `memory-promotion-sweep` backstop). Capture can be disabled per context via the settings Memory section "Disable capture" toggle (the memory-profile `enabled` flag); `TOOL_CONTEXT_REDUCTION_DISABLED` does **not** affect memory capture. The provisional/promotion store lives in `src/long-term-memory/provisional-store.ts` (shared `recordScopeCondition` in `record-conditions.ts`), re-exported from `store.ts`. The settings-UI Memory section surfaces provisional records in a separate **Pending (provisional)** subsection.
```

Also update the line in the module-map / reduction-flags area that implies four `tool_context_flags` flags so it lists the remaining three (`progressive_disclosure`, `result_compaction`, `semantic_tool_retrieval`). Grep first: `grep -n "cross_thread_memory\|crossThreadMemory\|four reduction\|resolveCrossThreadMemoryFlag" CLAUDE.md`.

- [ ] **Step 2: grep `src/tools/CLAUDE.md` and `README.md` and trim any `cross_thread_memory`/four-flags references; if none, no change.**

Run: `grep -n "cross_thread_memory\|crossThreadMemory" src/tools/CLAUDE.md README.md`
Expected: handle any hits; likely none in README.

- [ ] **Step 3: format + commit.**

Run: `bunx oxfmt CLAUDE.md src/tools/CLAUDE.md`

```bash
git add CLAUDE.md src/tools/CLAUDE.md README.md
git commit -m "docs: cross-thread memory bridge is now always-on (flag removed)"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: confirm no dangling references remain.**

Run: `grep -rn "crossThreadMemory\|cross_thread_memory\|resolveCrossThreadMemoryFlag" src client tests`
Expected: **no matches.**

- [ ] **Step 2: typecheck (catches any cross-file `ReductionFlags` excess-property fallout).**

Run: `bun typecheck`
Expected: no errors.

- [ ] **Step 3: lint, knip, format.**

Run: `bunx oxlint src client tests` (or `bun check:full`), `bun knip`, `bun run format:check`
Expected: clean.

- [ ] **Step 4: run the affected server suites.**

Run: `bun test tests/tools/ tests/long-term-memory/ tests/debug/admin-feature-flags.test.ts tests/debug/settings/admin/feature-flags-routes.test.ts tests/llm-orchestrator-tools-compaction.test.ts tests/llm-orchestrator-disclosure-wiring.test.ts`
Expected: all PASS.

- [ ] **Step 5: run the client suites.**

Run: `bun test:client`
Expected: all PASS.

- [ ] **Step 6: manual sanity (optional).** Start the bot, open the admin Feature flags section → exactly three toggles (Compaction, Disclosure, Semantic retrieval); a group thread produces provisional records visible in the settings Memory "Pending (provisional)" subsection with no flag set.

- [ ] **Step 7: final commit (only if Steps 1–5 surfaced fixes; otherwise nothing to commit).**

```bash
git status
# commit any verification fixes with a descriptive message
```
