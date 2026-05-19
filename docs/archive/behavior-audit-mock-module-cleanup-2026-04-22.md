# Behavior Audit Mock Module Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining avoidable `mock.module()` usage from the behavior-audit test suite while preserving the one startup/import-order case that still justifies delayed-import module mocking.

**Architecture:** Extend the existing behavior-audit dependency-injection seams instead of adding more Bun-specific reset rules. Add one new `ClassifyAgentDeps` seam for the agent module, one `Phase2aDeps` seam for the phase-2 orchestrator, migrate the related tests to direct dependency injection, and leave `behavior-audit-incremental.test.ts` on narrow module mocks only where the test is explicitly validating module-evaluation startup behavior.

**Tech Stack:** Bun, TypeScript, Bun test runner (`bun:test`), Vercel AI SDK (`generateText`, `Output.object`, `stepCountIs`), Zod v4.

**References:** `tests/CLAUDE.md`, `docs/adr/0048-global-mock-reset-preload.md`, `docs/adr/0054-mock-isolation-guardrails.md`, `docs/adr/0057-dependency-injection-test-refactor.md`, `tests/scripts/behavior-audit-integration.support.ts`.

---

## File Structure

### Modify

- `scripts/behavior-audit/classify-agent.ts` — replace module-scope hard bindings with injectable dependencies and keep current production defaults.
- `scripts/behavior-audit/classify.ts` — inject classifier and persistence dependencies into `runPhase2a()` so tests do not need to mock `classify-agent.js`.
- `tests/scripts/behavior-audit-classify-agent.test.ts` — rewrite to call the agent through injected fakes instead of mocking `config.js`, `ai`, and `@ai-sdk/openai-compatible`.
- `tests/scripts/behavior-audit-phase2a.test.ts` — rewrite to pass `classifyBehaviorWithRetry` as a direct dependency.
- `tests/scripts/behavior-audit-incremental.test.ts` — reduce leftover module mocks only if the startup test can still exercise the same import-order behavior with `BehaviorAuditDeps`; otherwise keep the current config/import-order mocks and add an in-file comment explaining why.
- `tests/scripts/behavior-audit-integration.support.ts` — add any minimal type guards/helpers needed by the migrated tests.

### Keep Intentionally

- `tests/scripts/behavior-audit-incremental.test.ts` startup/import-order coverage for `config.js` plus entrypoint delayed import, if removing those mocks would stop the test from proving that manifest state is written during module-evaluated startup wiring.

---

## Decisions Locked Before Implementation

1. Prefer `deps` parameters with real defaults over expanding `tests/mock-reset.ts`.
2. Do not add test-only setters for this work; ADR-0057 selects `deps` for AI-facing modules.
3. Keep production callers unchanged by defaulting every new dependency object to the real imports.
4. Preserve the current delayed-import pattern only where module evaluation order is the thing under test.
5. Do not convert `behavior-audit-incremental.test.ts` just for style if a remaining mock is still the narrowest correct boundary.

---

### Task 1: Add DI to `classify-agent.ts`

**Files:**

- Modify: `scripts/behavior-audit/classify-agent.ts`
- Test: `tests/scripts/behavior-audit-classify-agent.test.ts`

- [ ] **Step 1: Write the failing test for resumed retry behavior without module mocks**

Replace the current module-mock test body in `tests/scripts/behavior-audit-classify-agent.test.ts` with a direct-deps test like this:

```typescript
test('classifyBehaviorWithRetry does not sleep before the first resumed retry attempt', async () => {
  const events: string[] = []
  const classifyAgent = await loadClassifyAgentModule(crypto.randomUUID())

  const result = await classifyAgent.classifyBehaviorWithRetry('prompt', 1, {
    config: {
      BASE_URL: 'http://localhost:1234/v1',
      MODEL: 'qwen3-30b-a3b',
      PHASE2_TIMEOUT_MS: 300_000,
      MAX_RETRIES: 3,
      RETRY_BACKOFF_MS: [25, 50, 75] as const,
      MAX_STEPS: 20,
    },
    generateText: () => {
      events.push('generate')
      return Promise.resolve({
        output: {
          visibility: 'user-facing',
          candidateFeatureKey: 'task-creation',
          candidateFeatureLabel: 'Task creation',
          supportingBehaviorRefs: [],
          relatedBehaviorHints: [],
          classificationNotes: 'Immediate resumed success.',
        },
      })
    },
    buildModel: () => 'mock-model',
    outputObject: ({ schema }) => ({ schema }),
    stepCountIs: (value) => value,
    sleep: () => {
      events.push('sleep')
      return Promise.resolve()
    },
    createAbortSignal: () => AbortSignal.timeout(1),
  })

  expect(result === null ? null : result.candidateFeatureKey).toBe('task-creation')
  expect(events).toEqual(['generate'])
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-classify-agent.test.ts
```

Expected: FAIL because `classifyBehaviorWithRetry()` does not yet accept an injected dependency object.

- [ ] **Step 3: Add `ClassifyAgentDeps` with real defaults**

Refactor `scripts/behavior-audit/classify-agent.ts` so the module-scope provider/model creation moves behind injectable helpers:

```typescript
export interface ClassifyAgentDeps {
  readonly config: {
    readonly BASE_URL: string
    readonly MODEL: string
    readonly PHASE2_TIMEOUT_MS: number
    readonly MAX_RETRIES: number
    readonly RETRY_BACKOFF_MS: readonly number[]
    readonly MAX_STEPS: number
  }
  readonly generateText: typeof generateText
  readonly outputObject: typeof Output.object
  readonly stepCountIs: typeof stepCountIs
  readonly buildModel: (baseUrl: string, model: string, apiKey: string) => unknown
  readonly sleep: (ms: number) => Promise<void>
  readonly createAbortSignal: (timeout: number) => AbortSignal
}

const defaultClassifyAgentDeps: ClassifyAgentDeps = {
  config: {
    BASE_URL,
    MODEL,
    PHASE2_TIMEOUT_MS,
    MAX_RETRIES,
    RETRY_BACKOFF_MS,
    MAX_STEPS,
  },
  generateText,
  outputObject: Output.object,
  stepCountIs,
  buildModel: (baseUrl, model, apiKey) =>
    createOpenAICompatible({
      name: 'behavior-audit-classify',
      apiKey,
      baseURL: baseUrl,
      supportsStructuredOutputs: true,
    })(model),
  sleep,
  createAbortSignal: (timeout) => AbortSignal.timeout(timeout),
}
```

Update `classifySingle()`, `getRetryBackoff()`, `classifyAttempt()`, `retryClassification()`, and `classifyBehaviorWithRetry()` to take `deps: ClassifyAgentDeps` and read all config from `deps.config`.

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
bun test ./tests/scripts/behavior-audit-classify-agent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the adjacent suite to catch regressions**

Run:

```bash
bun test ./tests/scripts/behavior-audit-phase2a.test.ts
```

Expected: PASS or a new failure showing the next seam needed in `classify.ts`.

---

### Task 2: Add DI to `runPhase2a()` and remove the `classify-agent.js` module mock

**Files:**

- Modify: `scripts/behavior-audit/classify.ts`
- Modify: `tests/scripts/behavior-audit-phase2a.test.ts`
- Optional helper update: `tests/scripts/behavior-audit-integration.support.ts`

- [ ] **Step 1: Write the failing phase-2a DI test**

In `tests/scripts/behavior-audit-phase2a.test.ts`, stop calling `mock.module('../../scripts/behavior-audit/classify-agent.js', ...)` in `beforeEach()` and instead pass the fake classifier into `runPhase2a()`:

```typescript
const dirty = await classify.runPhase2a(
  {
    progress,
    selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
    manifest,
  },
  {
    classifyBehaviorWithRetry: (...args) => {
      classifyBehaviorWithRetryCalls += 1
      return classifyBehaviorWithRetryImpl(...args)
    },
  },
)
```

Apply the same pattern to the resumed-run and retry-budget tests.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-phase2a.test.ts
```

Expected: FAIL because `runPhase2a()` does not yet accept a dependency override object.

- [ ] **Step 3: Add `Phase2aDeps` with real defaults**

Refactor `scripts/behavior-audit/classify.ts` so all external helpers used in the test are injectable:

```typescript
export interface Phase2aDeps {
  readonly classifyBehaviorWithRetry: typeof classifyBehaviorWithRetry
  readonly readClassifiedFile: typeof readClassifiedFile
  readonly writeClassifiedFile: typeof writeClassifiedFile
  readonly saveManifest: typeof saveManifest
  readonly saveProgress: typeof saveProgress
  readonly getFailedClassificationAttempts: typeof getFailedClassificationAttempts
  readonly markClassificationDone: typeof markClassificationDone
  readonly setClassificationFailedAttempts: typeof setClassificationFailedAttempts
}

const defaultPhase2aDeps: Phase2aDeps = {
  classifyBehaviorWithRetry,
  readClassifiedFile,
  writeClassifiedFile,
  saveManifest,
  saveProgress,
  getFailedClassificationAttempts,
  markClassificationDone,
  setClassificationFailedAttempts,
}
```

Update `classifySelectedBehavior()`, `writeSingleClassification()`, `persistSuccessfulClassification()`, and `runPhase2a()` to use `resolvedDeps`.

- [ ] **Step 4: Run the focused suite to verify it passes**

Run:

```bash
bun test ./tests/scripts/behavior-audit-phase2a.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the broader behavior-audit suite**

Run:

```bash
bun test ./tests/scripts/behavior-audit-*.test.ts
```

Expected: PASS.

---

### Task 3: Reduce `behavior-audit-incremental.test.ts` mocks selectively and document the intentional leftover

**Files:**

- Modify: `tests/scripts/behavior-audit-incremental.test.ts`
- Optional helper update: `tests/scripts/behavior-audit-integration.support.ts`

- [ ] **Step 1: Write the narrowest failing test change**

Identify the startup-oriented test that still imports the behavior-audit entrypoint with delayed import:

```typescript
test('startup writes lastStartCommit to the manifest before phase execution', async () => {
  await loadBehaviorAuditEntryPoint(`startup-${crypto.randomUUID()}`)
  expect(phase1Calls).toBe(1)
  expect(phase1ManifestSnapshot).toContain('"lastStartCommit": "')
})
```

Attempt to remove only the `extract.js`, `evaluate.js`, and `consolidate.js` mocks by replacing them with direct `BehaviorAuditDeps` entrypoint tests if the assertion still proves the same startup contract.

- [ ] **Step 2: Verify whether the module mock is still required**

Run either:

```bash
bun test ./tests/scripts/behavior-audit-incremental.test.ts --test-name-pattern "startup writes lastStartCommit to the manifest before phase execution"
```

or the equivalent focused test after your local refactor.

Expected:

- If the assertion still passes with `runBehaviorAudit(deps)`, remove the now-unnecessary mocks.
- If the assertion only makes sense with delayed import and module evaluation order, keep the remaining mock(s).

- [ ] **Step 3: Keep only the justified mock boundary and document it inline**

If delayed import remains necessary, add a short comment above the leftover `mock.module()` block:

```typescript
// This suite intentionally keeps narrow module mocks because it is verifying
// entrypoint startup behavior that happens during delayed module import.
```

Do not add this comment if the test can be migrated cleanly.

- [ ] **Step 4: Run the incremental suite**

Run:

```bash
bun test ./tests/scripts/behavior-audit-incremental.test.ts
```

Expected: PASS.

- [ ] **Step 5: Confirm the remaining `mock.module()` inventory**

Run:

```bash
rg "mock\.module\(" tests/scripts/behavior-audit-*.test.ts
```

Expected: only the explicitly justified delayed-import startup coverage remains, or zero matches if the last startup mock was removable.

---

### Task 4: Final verification and cleanup

**Files:**

- Verify: `scripts/behavior-audit/classify-agent.ts`
- Verify: `scripts/behavior-audit/classify.ts`
- Verify: `tests/scripts/behavior-audit-classify-agent.test.ts`
- Verify: `tests/scripts/behavior-audit-phase2a.test.ts`
- Verify: `tests/scripts/behavior-audit-incremental.test.ts`

- [ ] **Step 1: Run lint on the touched files**

Run:

```bash
bun lint tests/scripts/behavior-audit-*.test.ts tests/scripts/behavior-audit-integration.support.ts scripts/behavior-audit/classify-agent.ts scripts/behavior-audit/classify.ts
```

Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 2: Run formatting and type checks**

Run:

```bash
bun format:check
bun typecheck
```

Expected: both commands exit successfully.

- [ ] **Step 3: Run the full repo verification command**

Run:

```bash
bun check:verbose
```

Expected: all parallel checks complete successfully.

- [ ] **Step 4: Commit the cleanup**

Run:

```bash
git add scripts/behavior-audit/classify-agent.ts scripts/behavior-audit/classify.ts tests/scripts/behavior-audit-classify-agent.test.ts tests/scripts/behavior-audit-phase2a.test.ts tests/scripts/behavior-audit-incremental.test.ts tests/scripts/behavior-audit-integration.support.ts
git commit -m "test(behavior-audit): replace remaining avoidable module mocks"
```

Expected: one commit containing the DI migration and any explicitly documented leftover startup mock rationale.

---

## Self-Review

- Covered each remaining hotspot returned by `rg "mock\.module\(" tests/scripts/behavior-audit-*.test.ts`.
- Kept the plan aligned with ADR-0057 by preferring `deps` parameters over more preload/reset infrastructure.
- Explicitly preserved the ADR-0054 exception path for the one import-order test if it remains justified after verification.
- Avoided placeholders by naming the exact files, seams, commands, and expected outputs.

Plan complete and saved to `docs/superpowers/plans/2026-04-22-behavior-audit-mock-module-cleanup.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
