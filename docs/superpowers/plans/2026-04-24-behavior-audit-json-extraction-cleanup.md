# Behavior Audit JSON Extraction Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct regressions introduced during the `Output.object()` → `wrapWithJsonExtraction()` migration: remove a misplaced re-export shim, revert an unjustified keyword-count relaxation, and restore missing step-limit guards in two agents.

**Architecture:** Four independent cleanup tasks. Each is a self-contained commit with no cross-task dependencies.

**Tech Stack:** TypeScript, Bun, Vercel AI SDK (`stepCountIs`), Zod v4

---

## Context

The unstaged changes migrate all five behavior-audit agents from AI SDK's `Output.object({ schema })` structured output to `wrapWithJsonExtraction(model)` + manual `parseJsonText(text, schema)`. This is a valid architectural improvement — it increases provider portability and removes the `supportsStructuredOutputs: true` dependency. However, three regressions were introduced:

1. A root-level re-export shim (`scripts/behavior-audit-classify-agent.ts`) was created with no clear purpose, and the classify-agent test was pointed at it instead of the canonical module.
2. `extract-agent.ts` relaxed `candidateKeywords` minimum from 8 to 3 without plan justification.
3. `consolidate-agent.ts` and `evaluate-agent.ts` lost their `MAX_STEPS` / `stepCountIs` step-limit guards.

---

## File Structure

| File                                                  | Action | Change                                                  |
| ----------------------------------------------------- | ------ | ------------------------------------------------------- |
| `scripts/behavior-audit-classify-agent.ts`            | Delete | Remove misplaced re-export shim                         |
| `tests/scripts/behavior-audit-classify-agent.test.ts` | Modify | Revert import path to canonical module                  |
| `scripts/behavior-audit/extract-agent.ts`             | Modify | Restore `candidateKeywords` min 8                       |
| `scripts/behavior-audit/consolidate-agent.ts`         | Modify | Restore `MAX_STEPS` import and `stepCountIs` stop guard |
| `scripts/behavior-audit/evaluate-agent.ts`            | Modify | Restore `MAX_STEPS` import and `stepCountIs` stop guard |

---

### Task 1: Delete Root Re-Export Shim and Fix Test Import

**Files:**

- Delete: `scripts/behavior-audit-classify-agent.ts`
- Modify: `tests/scripts/behavior-audit-classify-agent.test.ts`

- [ ] **Step 1: Delete the root re-export shim**

```bash
rm scripts/behavior-audit-classify-agent.ts
```

- [ ] **Step 2: Revert the test import path**

In `tests/scripts/behavior-audit-classify-agent.test.ts`, change line 6:

```typescript
// Current (unstaged):
import type { ClassifyAgentDeps } from '../../scripts/behavior-audit-classify-agent.js'

// Revert to:
import type { ClassifyAgentDeps } from '../../scripts/behavior-audit/classify-agent.js'
```

- [ ] **Step 3: Verify the test compiles and passes**

```bash
bun test ./tests/scripts/behavior-audit-classify-agent.test.ts
```

Expected: All tests pass (they work against the unstaged `ClassifyAgentDeps` interface which already uses `{ text: string }`).

- [ ] **Step 4: Commit**

```bash
git add scripts/behavior-audit-classify-agent.ts tests/scripts/behavior-audit-classify-agent.test.ts
git commit -m "fix(behavior-audit): delete misplaced classify-agent re-export shim"
```

---

### Task 2: Restore `candidateKeywords` Minimum to 8

**Files:**

- Modify: `scripts/behavior-audit/extract-agent.ts`

- [ ] **Step 1: Update the Zod schema**

Change line 13:

```typescript
// Current (unstaged):
candidateKeywords: z.array(z.string()).min(3).max(16),

// Revert to:
candidateKeywords: z.array(z.string()).min(8).max(16),
```

- [ ] **Step 2: Update the SYSTEM_PROMPT**

Change line 37:

```typescript
// Current (unstaged):
- candidateKeywords: 3-16 canonical lowercase slug keywords describing the behavior

// Revert to:
- candidateKeywords: 8-16 canonical lowercase slug keywords describing the behavior
```

- [ ] **Step 3: Verify typecheck**

```bash
bun typecheck 2>&1 | grep "extract-agent"
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/behavior-audit/extract-agent.ts
git commit -m "fix(behavior-audit): restore candidateKeywords min 8 in extract-agent"
```

---

### Task 3: Restore Step-Limit Guard in `consolidate-agent.ts`

**Files:**

- Modify: `scripts/behavior-audit/consolidate-agent.ts`

- [ ] **Step 1: Re-add `MAX_STEPS` and `stepCountIs` to imports**

Replace the import lines (lines 1–7):

```typescript
// Current (unstaged):
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'

import { fetchWithoutTimeout, verboseGenerateText } from './agent-helpers.js'
import { BASE_URL, MAX_RETRIES, MODEL, PHASE2_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'
import { gatherConsolidationContext } from './file-reader.js'
import { parseJsonText, wrapWithJsonExtraction } from './json-output.js'

// Replace with:
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { stepCountIs } from 'ai'
import { z } from 'zod'

import { fetchWithoutTimeout, verboseGenerateText } from './agent-helpers.js'
import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE2_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'
import { gatherConsolidationContext } from './file-reader.js'
import { parseJsonText, wrapWithJsonExtraction } from './json-output.js'
```

- [ ] **Step 2: Add `maxOutputTokens` and `stopWhen` to the `verboseGenerateText` call**

In the `consolidateSingle` function, change the `verboseGenerateText` call (lines 95–99):

```typescript
// Current (unstaged):
const result = await verboseGenerateText({
  model,
  system: SYSTEM_PROMPT,
  prompt: fullPrompt,
  abortSignal: AbortSignal.timeout(timeout),
})

// Replace with:
const result = await verboseGenerateText({
  model,
  system: SYSTEM_PROMPT,
  prompt: fullPrompt,
  maxOutputTokens: 16384,
  stopWhen: stepCountIs(MAX_STEPS + 1),
  abortSignal: AbortSignal.timeout(timeout),
})
```

- [ ] **Step 3: Verify typecheck**

```bash
bun typecheck 2>&1 | grep "consolidate-agent"
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/behavior-audit/consolidate-agent.ts
git commit -m "fix(behavior-audit): restore step-limit guard in consolidate-agent"
```

---

### Task 4: Restore Step-Limit Guard in `evaluate-agent.ts`

**Files:**

- Modify: `scripts/behavior-audit/evaluate-agent.ts`

- [ ] **Step 1: Re-add `MAX_STEPS` and `stepCountIs` to imports**

Replace the import lines (lines 1–7):

```typescript
// Current (unstaged):
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'

import { fetchWithoutTimeout, verboseGenerateText } from './agent-helpers.js'
import { BASE_URL, MAX_RETRIES, MODEL, PHASE3_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'
import { gatherEvaluationContext } from './file-reader.js'
import { parseJsonText, wrapWithJsonExtraction } from './json-output.js'

// Replace with:
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { stepCountIs } from 'ai'
import { z } from 'zod'

import { fetchWithoutTimeout, verboseGenerateText } from './agent-helpers.js'
import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE3_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'
import { gatherEvaluationContext } from './file-reader.js'
import { parseJsonText, wrapWithJsonExtraction } from './json-output.js'
```

- [ ] **Step 2: Add `maxOutputTokens` and `stopWhen` to the `verboseGenerateText` call**

In the `evaluateSingle` function, change the `verboseGenerateText` call (lines 80–85):

```typescript
// Current (unstaged):
const result = await verboseGenerateText({
  model,
  system: SYSTEM_PROMPT,
  prompt: fullPrompt,
  abortSignal: AbortSignal.timeout(timeout),
})

// Replace with:
const result = await verboseGenerateText({
  model,
  system: SYSTEM_PROMPT,
  prompt: fullPrompt,
  maxOutputTokens: 16384,
  stopWhen: stepCountIs(MAX_STEPS + 1),
  abortSignal: AbortSignal.timeout(timeout),
})
```

- [ ] **Step 3: Verify typecheck**

```bash
bun typecheck 2>&1 | grep "evaluate-agent"
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/behavior-audit/evaluate-agent.ts
git commit -m "fix(behavior-audit): restore step-limit guard in evaluate-agent"
```

---

### Task 5: Final Verification

- [ ] **Step 1: Run the full behavior-audit test slice**

```bash
bun test ./tests/scripts/behavior-audit-classify-agent.test.ts \
         ./tests/scripts/behavior-audit-phase1-keywords.test.ts \
         ./tests/scripts/behavior-audit-phase1-selection.test.ts \
         ./tests/scripts/behavior-audit-phase2a.test.ts \
         ./tests/scripts/behavior-audit-phase2b.test.ts \
         ./tests/scripts/behavior-audit-phase3.test.ts \
         ./tests/scripts/behavior-audit-incremental.test.ts \
         ./tests/scripts/behavior-audit-storage.test.ts \
         ./tests/scripts/behavior-audit-entrypoint.test.ts
```

Expected: All PASS.

- [ ] **Step 2: Run repo-wide verification**

```bash
bun typecheck
bun lint
bun format:check
```

Expected: All PASS with zero suppressions.

- [ ] **Step 3: Static search for the deleted shim file**

```bash
test ! -f scripts/behavior-audit-classify-agent.ts && echo "DELETED" || echo "STILL EXISTS"
```

Expected: DELETED

- [ ] **Step 4: Confirm no stale import references**

```bash
rg "behavior-audit-classify-agent" tests/ scripts/
```

Expected: 0 matches.

---

## Rollback Considerations

- Each task is an independent commit. Any single task can be reverted with `git revert <sha>` without affecting others.
- Task 1 (delete shim + fix import) is the most critical — if the shim is needed for some undiscovered integration path, reverting it restores the shim and the test import.
- Task 2 (keyword min) could be adjusted to any value between 3 and 8 if an intermediate minimum is preferred.

## Success Criteria

- [ ] `scripts/behavior-audit-classify-agent.ts` is deleted
- [ ] No `behavior-audit-classify-agent` references remain in tests or runtime
- [ ] `extract-agent.ts` `candidateKeywords` minimum is 8
- [ ] `consolidate-agent.ts` has `MAX_STEPS` import and `stepCountIs(MAX_STEPS + 1)`
- [ ] `evaluate-agent.ts` has `MAX_STEPS` import and `stepCountIs(MAX_STEPS + 1)`
- [ ] Full behavior-audit test slice passes
- [ ] Typecheck, lint, and format checks pass
