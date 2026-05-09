# Behavior Audit Progress Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad hoc shared stdout writes in behavior-audit phases with a structured progress reporter that preserves task identity under parallel execution and renders cleanly in both TTY and non-TTY environments.

**Architecture:** Introduce a small progress-reporting layer in `scripts/behavior-audit/` that accepts semantic events such as phase start, item start, item success, item failure, and artifact write. Phase code will emit events keyed by stable IDs like file path, test key, feature key, or consolidated ID. The first renderer will be a deterministic text renderer; a second renderer will optionally use `listr2` for interactive TTY task display.

**Tech Stack:** Bun, TypeScript, existing behavior-audit scripts, optional `listr2`

---

## File Map

| File                                                        | Action | Purpose                                                                     |
| ----------------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| `scripts/behavior-audit/progress-reporter.ts`               | Create | Progress event types, reporter interface, text renderer, renderer selection |
| `scripts/behavior-audit.ts`                                 | Modify | Create one reporter per run and pass it into each phase                     |
| `scripts/behavior-audit/config.ts`                          | Modify | Add `BEHAVIOR_AUDIT_PROGRESS_RENDERER` support                              |
| `scripts/behavior-audit/extract.ts`                         | Modify | Emit structured Phase 1 progress events instead of direct stdout writes     |
| `scripts/behavior-audit/extract-phase1-helpers.ts`          | Modify | Stop direct console writes for artifact persistence lines                   |
| `scripts/behavior-audit/classify.ts`                        | Modify | Emit structured Phase 2a progress events                                    |
| `scripts/behavior-audit/consolidate.ts`                     | Modify | Emit structured Phase 2b progress events                                    |
| `scripts/behavior-audit/evaluate.ts`                        | Modify | Emit structured Phase 3 progress events                                     |
| `tests/scripts/behavior-audit/progress-reporter.test.ts`    | Create | Unit tests for reporter event formatting and renderer behavior              |
| `tests/scripts/behavior-audit-entrypoint.test.ts`           | Modify | Verify reporter selection and run-level wiring                              |
| `tests/scripts/behavior-audit-phase1-selection.test.ts`     | Modify | Verify Phase 1 emits attributed progress lines                              |
| `tests/scripts/behavior-audit-phase1-write-failure.test.ts` | Modify | Verify Phase 1 failure reporting remains correctly attributed               |
| `tests/scripts/behavior-audit-phase3.test.ts`               | Modify | Verify structured progress in later phases                                  |
| `tests/scripts/behavior-audit-incremental.test.ts`          | Modify | Verify incremental flows still work with reporter wiring                    |
| `package.json`                                              | Modify | Add `listr2` only if the interactive renderer is implemented                |

---

### Task 1: Create the progress reporter abstraction

**Files:**

- Create: `scripts/behavior-audit/progress-reporter.ts`
- Create: `tests/scripts/behavior-audit/progress-reporter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/scripts/behavior-audit/progress-reporter.test.ts` covering:

- stable item identity with `itemId`
- file/test attribution in text output
- success, failure, skipped, and reused outcomes
- file-attributed artifact write lines

Define the event model around semantic events instead of raw strings:

```typescript
type BehaviorAuditPhase = 'phase1' | 'phase2a' | 'phase2b' | 'phase3'

type ProgressEvent =
  | {
      readonly kind: 'item-start'
      readonly phase: BehaviorAuditPhase
      readonly itemId: string
      readonly context: string
      readonly title: string
      readonly index: number
      readonly total: number
    }
  | {
      readonly kind: 'item-finish'
      readonly phase: BehaviorAuditPhase
      readonly itemId: string
      readonly context: string
      readonly title: string
      readonly outcome: 'done' | 'failed' | 'skipped' | 'reused'
      readonly detail: string
    }
  | {
      readonly kind: 'artifact-write'
      readonly phase: BehaviorAuditPhase
      readonly context: string
      readonly detail: string
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/progress-reporter.test.ts`
Expected: FAIL because `progress-reporter.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/behavior-audit/progress-reporter.ts` with:

- `ProgressEvent` and `BehaviorAuditProgressReporter` types
- `createTextProgressReporter(log)`
- deterministic text formatting helpers

Use text lines that always carry enough identity to map metrics to the correct item:

```typescript
[Phase 1] [tests/group-settings/dispatch.test.ts] [3/32] "authFailed creates correct structure" — 0 tools, 905 tok in 17.1s (10 tok/s) ✓
[Phase 1] [tests/group-settings/dispatch.test.ts] wrote 7 behaviors
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/behavior-audit/progress-reporter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/progress-reporter.ts tests/scripts/behavior-audit/progress-reporter.test.ts
git commit -m "feat: add behavior audit progress reporter"
```

### Task 2: Wire reporter selection into the behavior-audit entrypoint

**Files:**

- Modify: `scripts/behavior-audit.ts`
- Modify: `scripts/behavior-audit/config.ts`
- Modify: `tests/scripts/behavior-audit-entrypoint.test.ts`
- Modify: `scripts/behavior-audit/progress-reporter.ts`

- [ ] **Step 1: Write the failing tests**

Add coverage for:

- default `auto` mode using text renderer in non-TTY/test environments
- explicit `BEHAVIOR_AUDIT_PROGRESS_RENDERER=text`
- explicit `BEHAVIOR_AUDIT_PROGRESS_RENDERER=listr2`
- reporter instance creation once per run and injection into all phases

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/behavior-audit-entrypoint.test.ts`
Expected: FAIL because reporter selection and injection do not exist.

- [ ] **Step 3: Write minimal implementation**

Add to `config.ts`:

```typescript
export let PROGRESS_RENDERER = 'auto'
```

Load via:

```typescript
PROGRESS_RENDERER = resolveStringOverride('BEHAVIOR_AUDIT_PROGRESS_RENDERER', 'auto')
```

In `scripts/behavior-audit.ts`, create one reporter and pass it into `runPhase1`, `runPhase2a`, `runPhase2b`, and `runPhase3` through deps.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/behavior-audit-entrypoint.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit.ts scripts/behavior-audit/config.ts scripts/behavior-audit/progress-reporter.ts tests/scripts/behavior-audit-entrypoint.test.ts
git commit -m "feat: wire configurable behavior audit progress renderer"
```

### Task 3: Refactor Phase 1 to emit structured events

**Files:**

- Modify: `scripts/behavior-audit/extract.ts`
- Modify: `scripts/behavior-audit/extract-phase1-helpers.ts`
- Modify: `tests/scripts/behavior-audit-phase1-selection.test.ts`
- Modify: `tests/scripts/behavior-audit-phase1-write-failure.test.ts`
- Modify: `tests/scripts/behavior-audit/progress-reporter.test.ts`

- [ ] **Step 1: Write the failing tests**

Add assertions for:

- every Phase 1 item line includes both file path and test title
- token/tool/time metrics are emitted on the same final line as the identified item
- `wrote N behaviors` lines are emitted with file attribution
- `writeStdout` no longer exists in `Phase1Deps`

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/behavior-audit-phase1-selection.test.ts tests/scripts/behavior-audit-phase1-write-failure.test.ts tests/scripts/behavior-audit/progress-reporter.test.ts`
Expected: FAIL because Phase 1 still uses direct logging.

- [ ] **Step 3: Write minimal implementation**

Refactor `extract.ts` to:

- emit `item-start` with `itemId = testKey`, `context = testFilePath`, `title = testCase.name`
- emit `item-finish` with the final suffix text from `formatPerItemSuffix(...)`
- emit failed/skipped lines through reporter events instead of `log.log`

Refactor `extract-phase1-helpers.ts` to stop writing directly to `console.log`. Return the persisted count or expose enough information for `extract.ts` to emit:

```typescript
[Phase 1] [tests/group-settings/dispatch.test.ts] wrote 7 behaviors
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/behavior-audit-phase1-selection.test.ts tests/scripts/behavior-audit-phase1-write-failure.test.ts tests/scripts/behavior-audit/progress-reporter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/extract.ts scripts/behavior-audit/extract-phase1-helpers.ts tests/scripts/behavior-audit-phase1-selection.test.ts tests/scripts/behavior-audit-phase1-write-failure.test.ts tests/scripts/behavior-audit/progress-reporter.test.ts
git commit -m "fix: add attributed progress output for behavior audit phase 1"
```

### Task 4: Refactor Phases 2a, 2b, and 3 to use the same reporter

**Files:**

- Modify: `scripts/behavior-audit/classify.ts`
- Modify: `scripts/behavior-audit/consolidate.ts`
- Modify: `scripts/behavior-audit/evaluate.ts`
- Modify: `tests/scripts/behavior-audit-phase3.test.ts`
- Modify: `tests/scripts/behavior-audit-incremental.test.ts`

- [ ] **Step 1: Write the failing tests**

Add assertions for:

- Phase 2a lines identify the classified behavior by context and title
- Phase 2b lines identify the feature key directly
- Phase 3 lines identify the evaluated consolidated item directly
- reused/skipped/failed outcomes are preserved without split writes

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/behavior-audit-phase3.test.ts tests/scripts/behavior-audit-incremental.test.ts`
Expected: FAIL because direct `writeStdout` patterns remain.

- [ ] **Step 3: Write minimal implementation**

Refactor:

- `classify.ts` to emit events keyed by `behaviorId`
- `consolidate.ts` to emit events keyed by `featureKey`
- `evaluate.ts` to emit events keyed by `consolidatedId`

Remove `writeStdout` from all phase dependency interfaces.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/behavior-audit-phase3.test.ts tests/scripts/behavior-audit-incremental.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/classify.ts scripts/behavior-audit/consolidate.ts scripts/behavior-audit/evaluate.ts tests/scripts/behavior-audit-phase3.test.ts tests/scripts/behavior-audit-incremental.test.ts
git commit -m "refactor: unify behavior audit progress reporting across phases"
```

### Task 5: Add optional `listr2` interactive renderer

**Files:**

- Modify: `package.json`
- Modify: `scripts/behavior-audit/progress-reporter.ts`
- Modify: `tests/scripts/behavior-audit/progress-reporter.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests for:

- text renderer remains the default in tests
- `listr2` renderer is selected only when configured and supported
- reporter API remains independent of `listr2` types

Do not snapshot animated terminal frames. Test the adapter contract and fallback behavior only.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/progress-reporter.test.ts`
Expected: FAIL because the `listr2` backend does not exist.

- [ ] **Step 3: Write minimal implementation**

Add dependency:

```json
"listr2": "^10.2.1"
```

Implement a backend adapter that:

- maps `item-start` to a tracked task row
- maps `item-finish` to the final task state
- uses text renderer automatically when `stdout.isTTY` is false
- keeps `listr2` contained inside the reporter boundary

If Bun runtime compatibility is problematic, stop after the text renderer and keep the backend hook unimplemented behind `auto`/`text` only.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/behavior-audit/progress-reporter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/behavior-audit/progress-reporter.ts tests/scripts/behavior-audit/progress-reporter.test.ts
git commit -m "feat: add listr2 renderer for behavior audit progress"
```

### Task 6: Verify end-to-end output behavior

**Files:**

- Modify only if needed: `docs/` operator-facing notes

- [ ] **Step 1: Run focused script tests**

Run:

```bash
bun test tests/scripts/behavior-audit-phase1-selection.test.ts tests/scripts/behavior-audit-phase1-write-failure.test.ts tests/scripts/behavior-audit-phase3.test.ts tests/scripts/behavior-audit-incremental.test.ts tests/scripts/behavior-audit-entrypoint.test.ts tests/scripts/behavior-audit/progress-reporter.test.ts
```

Expected: all PASS

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun typecheck
```

Expected: PASS

- [ ] **Step 3: Run one realistic text-mode audit**

Run:

```bash
BEHAVIOR_AUDIT_PROGRESS_RENDERER=text bun scripts/behavior-audit.ts
```

Expected:

- every item line includes enough identity to map metrics to the correct task
- no unattributed `wrote N behaviors`
- no split-line corruption from parallel processing

- [ ] **Step 4: Run one realistic auto/TTY audit**

Run:

```bash
BEHAVIOR_AUDIT_PROGRESS_RENDERER=auto bun scripts/behavior-audit.ts
```

Expected:

- clean interactive rendering in a TTY
- deterministic fallback in non-TTY environments

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "docs: verify and finalize behavior audit progress output"
```

## Decision Notes

- Use a local reporter abstraction even if `listr2` is adopted. The problem is semantic progress modeling first, renderer choice second.
- Keep concurrency limits unchanged during this work. This is an observability and UX correction, not a throughput change.
- Keep `formatPerItemSuffix(...)` as the source of truth for token/tool/time formatting.
- Treat non-TTY output as a first-class supported mode for CI and captured logs.
- Do not allow helper utilities to print directly to `console`; all operator-visible progress must go through the reporter.
