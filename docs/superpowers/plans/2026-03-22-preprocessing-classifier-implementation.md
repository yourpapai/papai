<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Pre-processing Classifier Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task.

**Date:** 2026-03-22  
**Status:** Draft  
**Depends on:** Custom Instructions feature (storage layer, `user_instructions` table, cache)

## Summary

Add a pre-processing classification step using the already-configured `small_model` to detect
behavioral instructions in user messages **before** the main LLM call. When a behavioral
instruction is detected, it is extracted, stored via the existing custom instructions
persistence layer, and the main LLM receives a signal to produce a brief confirmation alongside
any normal task work.

## Relationship to Custom Instructions

This plan **extends** the approved custom instructions design
(`2026-03-22-custom-instructions-design.md`). It does **not** replace the LLM tools approach —
`save_instruction`, `list_instructions`, and `delete_instruction` tools remain available for
explicit instruction management. The pre-processing classifier adds **implicit** detection so
users don't need to rely on the LLM spontaneously deciding to call the tool.

## Architecture

```
User message
    │
    ▼
┌──────────────────────────────┐
│  classifyMessage()           │  ← small_model (generateText + Output.object)
│  Returns:                    │
│    classification: enum      │
│    instruction?: string      │
│    passthrough: string       │
└──────────────────────────────┘
    │
    ├── classification = "instruction" or "mixed"
    │     → saveInstruction(contextId, extracted text)
    │     → inject hint into history for main LLM
    │
    ├── classification = "normal"
    │     → pass through unchanged
    │
    ▼
┌──────────────────────────────┐
│  callLlm() (existing)       │  ← main_model
│  system prompt includes      │
│  === Custom instructions === │
│  block (from design doc)     │
└──────────────────────────────┘
    │
    ▼
  Reply to user
```

**Key design decisions:**

1. **No tools exposed for classification** — the small model uses structured output
   (`Output.object` with Zod schema), not tool calls.
2. **Graceful degradation** — if `small_model` is not configured or the classifier call fails,
   the message passes through to the main LLM unchanged. No user-visible error.
3. **Mixed messages supported** — a message like "always use high priority, and create a task
   to deploy the app" is classified as `"mixed"`: the instruction is extracted and stored,
   and the full original message is still forwarded to the main LLM.
4. **Deduplication** — the existing `isDuplicate()` Jaccard similarity check in
   `src/instructions.ts` prevents storing near-identical instructions.
5. **Override/revoke** — revocation phrases ("stop doing X", "forget that rule") are classified
   as `"revocation"` and handled by listing instructions and deleting the best match.

## User Story Mapping

| User Story                                                    | Task(s)                                     |
| ------------------------------------------------------------- | ------------------------------------------- |
| US-1: Automatic detection of behavioral instructions          | Tasks 1, 2, 3                               |
| US-2: Persistent storage of extracted preferences             | Task 2 (reuses instructions storage layer)  |
| US-3: Confirmation of learned preferences                     | Tasks 3, 4                                  |
| US-4: Transparent processing without delay perception         | Tasks 2, 3 (graceful fallback)              |
| US-5: Overriding previously learned preferences               | Task 5                                      |
| US-6: Separation of instruction detection from task execution | Task 3 (classifier runs before callLlm)     |
| US-7: Classification accuracy for ambiguous messages          | Task 1 (prompt engineering), Task 6 (tests) |

---

## Tech Stack

Bun, TypeScript strict mode, Drizzle ORM (bun-sqlite), Vercel AI SDK (`generateText`,
`Output.object` from `ai`), Zod v4, pino logger.

---

### Task 1: Classification module with structured output schema

**Files:**

- Create: `src/classifier.ts`
- Test: `tests/classifier.test.ts`

**Covers:** US-1, US-7

**Step 1: Write failing tests**

Create `tests/classifier.test.ts`:

```typescript
import { mock, describe, test, expect, beforeEach } from 'bun:test'

import { mockLogger } from './helpers/test-helpers.js'

mockLogger()

// ============================================================================
// Mock the AI SDK generateText
// ============================================================================

type ClassificationResult = {
  classification: 'instruction' | 'revocation' | 'mixed' | 'normal'
  instruction?: string
}

let generateTextResult: { output: ClassificationResult } = {
  output: { classification: 'normal' },
}

void mock.module('ai', () => ({
  generateText: async () => generateTextResult,
  Output: {
    object: ({ schema }: { schema: unknown }) => ({ schema, type: 'object' }),
  },
}))

// Minimal LanguageModel stub
const fakeModel = {
  modelId: 'test-model',
  provider: 'test',
  specificationVersion: 'v1',
} as never

import { classifyMessage, type ClassifyResult } from '../src/classifier.js'

beforeEach(() => {
  generateTextResult = { output: { classification: 'normal' } }
})

describe('classifyMessage', () => {
  test('returns "normal" for a plain task request', async () => {
    generateTextResult = { output: { classification: 'normal' } }
    const result = await classifyMessage(fakeModel, 'Create a task to fix the login bug')
    expect(result.classification).toBe('normal')
    expect(result.instruction).toBeUndefined()
  })

  test('returns "instruction" with extracted text for a behavioral instruction', async () => {
    generateTextResult = {
      output: {
        classification: 'instruction',
        instruction: 'Always set tasks to high priority',
      },
    }
    const result = await classifyMessage(fakeModel, 'From now on, always set my tasks to high priority')
    expect(result.classification).toBe('instruction')
    expect(result.instruction).toBe('Always set tasks to high priority')
  })

  test('returns "mixed" when message has both instruction and task', async () => {
    generateTextResult = {
      output: {
        classification: 'mixed',
        instruction: 'Always use urgent priority',
      },
    }
    const result = await classifyMessage(fakeModel, 'Always use urgent priority, and create a task to deploy the app')
    expect(result.classification).toBe('mixed')
    expect(result.instruction).toBe('Always use urgent priority')
  })

  test('returns "revocation" for a revoke request', async () => {
    generateTextResult = {
      output: {
        classification: 'revocation',
        instruction: 'Always set tasks to high priority',
      },
    }
    const result = await classifyMessage(fakeModel, 'Stop setting my tasks to high priority')
    expect(result.classification).toBe('revocation')
    expect(result.instruction).toBe('Always set tasks to high priority')
  })

  test('returns "normal" for a question about behavior', async () => {
    generateTextResult = { output: { classification: 'normal' } }
    const result = await classifyMessage(fakeModel, 'Do you always set tasks to high priority?')
    expect(result.classification).toBe('normal')
  })

  test('returns "normal" for casual context that is not an instruction', async () => {
    generateTextResult = { output: { classification: 'normal' } }
    const result = await classifyMessage(fakeModel, 'I usually work on backend stuff')
    expect(result.classification).toBe('normal')
  })
})
```

**Step 2: Run tests — expect failure (module not found)**

```bash
bun test tests/classifier.test.ts
```

**Step 3: Implement `src/classifier.ts`**

```typescript
import { generateText, Output, type LanguageModel } from 'ai'
import { z } from 'zod'

import { logger } from './logger.js'

const log = logger.child({ scope: 'classifier' })

const ClassificationSchema = z.object({
  classification: z.enum(['instruction', 'revocation', 'mixed', 'normal']),
  instruction: z
    .string()
    .optional()
    .describe(
      'The extracted behavioral instruction as a short, clear statement. Required when classification is instruction, revocation, or mixed.',
    ),
})

export type ClassifyResult = z.infer<typeof ClassificationSchema>

const CLASSIFIER_PROMPT = `You classify user messages sent to a task-management assistant.

Determine whether the message contains a **persistent behavioral instruction** — a rule the user wants the assistant to follow from now on for all future interactions.

Signals of a behavioral instruction:
- Phrases like "always", "never", "from now on", "by default", "remember to", "whenever I"
- The user is telling the assistant HOW to behave, not asking it to do a ONE-TIME action

Classification categories:
- "instruction": the ENTIRE message is a behavioral instruction (e.g. "Always set my tasks to high priority")
- "revocation": the user wants to CANCEL a previously stated instruction (e.g. "Stop assigning tasks to me automatically", "Forget the rule about high priority")
- "mixed": the message contains BOTH a behavioral instruction AND a concrete task/question (e.g. "Always use urgent priority, and create a task to deploy the app")
- "normal": a regular task request, question, or conversation — NOT a behavioral instruction

IMPORTANT distinctions:
- Questions about current behavior ("Do you always set tasks to high priority?") → "normal"
- Casual context or observations ("I usually work on backend stuff") → "normal"
- One-time requests ("Set this task to high priority") → "normal"
- Persistent rules ("Always set tasks to high priority") → "instruction"

When classification is "instruction", "revocation", or "mixed", also extract the instruction as a short, clear, imperative statement in the "instruction" field. For revocations, extract the instruction being revoked (the rule to remove).

User message: {MESSAGE}`

export async function classifyMessage(model: LanguageModel, userText: string): Promise<ClassifyResult> {
  log.debug({ textLength: userText.length }, 'Classifying message')

  const prompt = CLASSIFIER_PROMPT.replace('{MESSAGE}', userText)

  const result = await generateText({
    model,
    output: Output.object({ schema: ClassificationSchema }),
    prompt,
  })

  log.debug(
    { classification: result.output.classification, hasInstruction: result.output.instruction !== undefined },
    'Classification complete',
  )

  return result.output
}
```

**Step 4: Run tests — expect all pass**

```bash
bun test tests/classifier.test.ts
```

**Step 5: Commit**

```bash
git add src/classifier.ts tests/classifier.test.ts
git commit -m "feat: add message classifier module with structured output schema"
```

---

### Task 2: Integration into processMessage flow

**Files:**

- Modify: `src/llm-orchestrator.ts`
- Test: `tests/llm-orchestrator-classifier.test.ts`

**Covers:** US-1, US-2, US-4, US-6

**Step 1: Write failing tests**

Create `tests/llm-orchestrator-classifier.test.ts`:

```typescript
import { mock, describe, test, expect, beforeEach, spyOn } from 'bun:test'

import { mockLogger } from './helpers/test-helpers.js'

mockLogger()

// ============================================================================
// Track calls to classifier and instructions module
// ============================================================================

let classifyResult = { classification: 'normal' as const }
let saveInstructionCalls: Array<{ contextId: string; text: string }> = []

void mock.module('../src/classifier.js', () => ({
  classifyMessage: async () => classifyResult,
}))

void mock.module('../src/instructions.js', () => ({
  saveInstruction: (contextId: string, text: string) => {
    saveInstructionCalls.push({ contextId, text })
    return { status: 'saved' as const, instruction: { id: 'i-1', text } }
  },
  listInstructions: () => [],
  deleteInstruction: () => ({ status: 'not_found' as const }),
}))

// ... (mock remaining dependencies: config, cache, providers, ai SDK, etc.)
// Full mock setup follows the pattern established in tests/llm-orchestrator-process.test.ts

beforeEach(() => {
  classifyResult = { classification: 'normal' }
  saveInstructionCalls = []
})

describe('pre-processing classifier integration', () => {
  test('does not call classifier when small_model is not configured', async () => {
    // small_model config returns null
    // Verify classifyMessage is never called
    // Verify processMessage still completes normally
  })

  test('calls classifier before main LLM when small_model is configured', async () => {
    // small_model config returns 'gpt-4o-mini'
    // classifyResult = { classification: 'normal' }
    // Verify classifyMessage is called once
    // Verify saveInstruction is NOT called
    // Verify main LLM is called
  })

  test('stores instruction when classifier returns "instruction"', async () => {
    classifyResult = {
      classification: 'instruction',
      instruction: 'Always use high priority',
    } as typeof classifyResult
    // Verify saveInstruction is called with correct contextId and text
    // Verify main LLM is still called (to generate confirmation reply)
  })

  test('stores instruction when classifier returns "mixed"', async () => {
    classifyResult = {
      classification: 'mixed',
      instruction: 'Always use urgent priority',
    } as typeof classifyResult
    // Verify saveInstruction is called
    // Verify main LLM is called with the ORIGINAL full message
  })

  test('falls back gracefully when classifier throws', async () => {
    // classifyMessage throws an error
    // Verify processMessage still completes normally (main LLM still called)
    // Verify no instruction is stored
  })

  test('does not store when instruction field is missing', async () => {
    classifyResult = {
      classification: 'instruction',
      // instruction field deliberately omitted
    } as typeof classifyResult
    // Verify saveInstruction is NOT called
  })
})
```

> NOTE: The full mock setup for llm-orchestrator tests is complex. The test file should follow
> the established pattern in `tests/llm-orchestrator-process.test.ts`, mocking the same
> dependencies. The exact mock wiring is omitted here for brevity but must match the existing
> test infrastructure.

**Step 2: Run tests — expect failure**

```bash
bun test tests/llm-orchestrator-classifier.test.ts
```

**Step 3: Modify `src/llm-orchestrator.ts`**

Add imports:

```typescript
import { classifyMessage, type ClassifyResult } from './classifier.js'
import { saveInstruction, listInstructions, deleteInstruction } from './instructions.js'
```

Add a new helper function after `persistFactsFromResults`:

```typescript
const runPreprocessingClassifier = async (contextId: string, userText: string): Promise<ClassifyResult | null> => {
  const llmApiKey = getConfig(contextId, 'llm_apikey')
  const llmBaseUrl = getConfig(contextId, 'llm_baseurl')
  const mainModel = getConfig(contextId, 'main_model')
  const smallModel = getConfig(contextId, 'small_model')

  // Skip classification if small_model is not configured separately
  // (when small_model falls back to main_model, we skip to avoid extra latency
  // for the same model — the main LLM can handle instructions via tools instead)
  if (llmApiKey === null || llmBaseUrl === null || smallModel === null) {
    log.debug({ contextId }, 'Skipping classifier: small_model not configured')
    return null
  }

  try {
    const model = buildOpenAI(llmApiKey, llmBaseUrl)(smallModel)
    const result = await classifyMessage(model, userText)
    log.debug({ contextId, classification: result.classification }, 'Pre-processing classification complete')
    return result
  } catch (error) {
    log.warn(
      { contextId, error: error instanceof Error ? error.message : String(error) },
      'Pre-processing classifier failed, falling back to normal processing',
    )
    return null
  }
}
```

Add a helper to handle classification results:

```typescript
const handleClassificationResult = (contextId: string, classification: ClassifyResult): string | null => {
  if (classification.classification === 'normal') return null
  if (classification.instruction === undefined) return null

  if (classification.classification === 'instruction' || classification.classification === 'mixed') {
    const result = saveInstruction(contextId, classification.instruction)
    if (result.status === 'saved') {
      log.info({ contextId, instruction: classification.instruction }, 'Behavioral instruction stored via classifier')
      return `[System note: the user just set a new preference — "${classification.instruction}". Acknowledge it briefly in your reply.]`
    }
    if (result.status === 'duplicate') {
      log.debug({ contextId }, 'Classifier detected instruction but it was a duplicate')
      return null
    }
    if (result.status === 'cap_reached') {
      log.warn({ contextId }, 'Classifier detected instruction but cap reached')
      return '[System note: the user tried to set a new preference but they have reached the maximum of 20. Let them know and suggest using /list_instructions to manage existing ones.]'
    }
  }

  if (classification.classification === 'revocation') {
    const instructions = listInstructions(contextId)
    // Find best match by checking if the revoked text appears as a substring (case-insensitive)
    const target = classification.instruction.toLowerCase()
    const match = instructions.find((i) => {
      const iLower = i.text.toLowerCase()
      // Check if the revocation target overlaps meaningfully with any stored instruction
      const targetWords = target.split(/\W+/).filter((w) => w.length > 2)
      const matchCount = targetWords.filter((w) => iLower.includes(w)).length
      return targetWords.length > 0 && matchCount / targetWords.length >= 0.5
    })

    if (match !== undefined) {
      deleteInstruction(contextId, match.id)
      log.info({ contextId, deletedId: match.id }, 'Instruction revoked via classifier')
      return `[System note: the user revoked a preference — "${match.text}" has been removed. Confirm briefly.]`
    }
    log.debug({ contextId }, 'Classifier detected revocation but no matching instruction found')
    return null
  }

  return null
}
```

Modify `processMessage` to insert the classifier step before `callLlm`:

```typescript
export const processMessage = async (
  reply: ReplyFn,
  contextId: string,
  username: string | null,
  userText: string,
): Promise<void> => {
  log.debug({ contextId, userText }, 'processMessage called')
  log.info({ contextId, messageLength: userText.length }, 'Message received from user')

  const baseHistory = getCachedHistory(contextId)
  const newMessage: ModelMessage = { role: 'user', content: userText }

  // --- Pre-processing classifier ---
  const classification = await runPreprocessingClassifier(contextId, userText)
  let classifierHint: string | null = null
  if (classification !== null) {
    classifierHint = handleClassificationResult(contextId, classification)
  }

  // If classifier produced a hint, inject it as a system message before the user message
  const history =
    classifierHint !== null
      ? [...baseHistory, { role: 'system' as const, content: classifierHint }, newMessage]
      : [...baseHistory, newMessage]
  // --- End pre-processing classifier ---

  appendHistory(contextId, [newMessage])

  try {
    const result = await callLlm(reply, contextId, username, history)
    const assistantMessages = result.response.messages
    if (assistantMessages.length > 0) {
      appendHistory(contextId, assistantMessages)
      log.debug(
        { contextId, assistantMessagesCount: assistantMessages.length },
        'Assistant response appended to history',
      )
    }
    const needsTrim = shouldTriggerTrim([...history, ...assistantMessages])
    if (needsTrim) {
      void runTrimInBackground(contextId, [...history, ...assistantMessages])
    }
  } catch (error) {
    saveHistory(contextId, baseHistory)
    await handleMessageError(reply, contextId, error)
  }
}
```

**Step 4: Run tests — expect all pass**

```bash
bun test tests/llm-orchestrator-classifier.test.ts
bun test tests/llm-orchestrator-process.test.ts
```

**Step 5: Commit**

```bash
git add src/llm-orchestrator.ts tests/llm-orchestrator-classifier.test.ts
git commit -m "feat: integrate pre-processing classifier into processMessage flow"
```

---

### Task 3: Graceful fallback and latency guardrails

**Files:**

- Modify: `src/classifier.ts`
- Modify: `src/llm-orchestrator.ts`
- Test: `tests/classifier.test.ts` (add timeout test)

**Covers:** US-4, US-6

**Step 1: Add AbortController timeout to classifier**

Modify `classifyMessage` in `src/classifier.ts` to accept an optional timeout:

```typescript
export async function classifyMessage(
  model: LanguageModel,
  userText: string,
  timeoutMs: number = 5000,
): Promise<ClassifyResult> {
  log.debug({ textLength: userText.length, timeoutMs }, 'Classifying message')

  const prompt = CLASSIFIER_PROMPT.replace('{MESSAGE}', userText)
  const abortController = new AbortController()
  const timer = setTimeout(() => abortController.abort(), timeoutMs)

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: ClassificationSchema }),
      prompt,
      abortSignal: abortController.signal,
    })

    log.debug(
      { classification: result.output.classification, hasInstruction: result.output.instruction !== undefined },
      'Classification complete',
    )

    return result.output
  } finally {
    clearTimeout(timer)
  }
}
```

**Step 2: Add timeout test**

Add to `tests/classifier.test.ts`:

```typescript
test('rejects with abort error when timeout exceeded', async () => {
  // Mock generateText to never resolve
  generateTextResult = new Promise(() => {}) as never
  await expect(classifyMessage(fakeModel, 'test message', 50)).rejects.toThrow()
})
```

**Step 3: Ensure `runPreprocessingClassifier` caller (already in Task 2) catches and logs the timeout**

The `try/catch` in `runPreprocessingClassifier` already handles this — verify with a test:

```typescript
test('returns null when classifier times out', async () => {
  // Mock classifyMessage to throw AbortError
  // Verify runPreprocessingClassifier returns null
  // Verify main LLM still processes the message
})
```

**Step 4: Run full test suite**

```bash
bun test
```

**Step 5: Commit**

```bash
git add src/classifier.ts src/llm-orchestrator.ts tests/classifier.test.ts
git commit -m "feat: add timeout guardrail to pre-processing classifier"
```

---

### Task 4: Confirmation reply injection

**Files:**

- Modify: `src/llm-orchestrator.ts` (system prompt)
- Test: `tests/llm-orchestrator-classifier.test.ts` (add confirmation tests)

**Covers:** US-3

The mechanism is already implemented in Task 2 via the `classifierHint` system message
injection. This task adds **integration tests** to verify the end-to-end confirmation behavior.

**Step 1: Add tests for confirmation scenarios**

Add to `tests/llm-orchestrator-classifier.test.ts`:

```typescript
describe('confirmation reply for stored instructions', () => {
  test('injects system hint when instruction is stored', async () => {
    classifyResult = {
      classification: 'instruction',
      instruction: 'Always use high priority',
    } as typeof classifyResult
    // Call processMessage
    // Capture the messages passed to generateText
    // Assert that a system message containing "new preference" is present
  })

  test('does not inject hint when save returns duplicate', async () => {
    // saveInstruction returns { status: 'duplicate' }
    // classifyResult = { classification: 'instruction', instruction: '...' }
    // Assert no system hint is injected
  })

  test('injects cap warning when save returns cap_reached', async () => {
    // saveInstruction returns { status: 'cap_reached' }
    // classifyResult = { classification: 'instruction', instruction: '...' }
    // Assert system message contains "maximum of 20"
  })

  test('for mixed messages, stores instruction and forwards full original text', async () => {
    classifyResult = {
      classification: 'mixed',
      instruction: 'Always use urgent priority',
    } as typeof classifyResult
    // Call processMessage with "Always use urgent priority, and create a task to deploy"
    // Assert instruction was saved
    // Assert the user message in history is the FULL original text (not just the task part)
    // Assert system hint is injected
  })
})
```

**Step 2: Run tests**

```bash
bun test tests/llm-orchestrator-classifier.test.ts
```

**Step 3: Commit**

```bash
git add tests/llm-orchestrator-classifier.test.ts
git commit -m "test: add confirmation reply tests for classifier integration"
```

---

### Task 5: Instruction revocation via classifier

**Files:**

- Modify: `src/llm-orchestrator.ts` (already has `handleClassificationResult` revocation path)
- Test: `tests/llm-orchestrator-classifier.test.ts` (add revocation tests)

**Covers:** US-5

**Step 1: Add tests for revocation scenarios**

Add to `tests/llm-orchestrator-classifier.test.ts`:

```typescript
describe('instruction revocation via classifier', () => {
  test('deletes matching instruction when revocation is detected', async () => {
    // Pre-populate listInstructions mock to return [{ id: 'i-1', text: 'Always set tasks to high priority' }]
    classifyResult = {
      classification: 'revocation',
      instruction: 'Always set tasks to high priority',
    } as typeof classifyResult
    // Call processMessage with "Stop setting my tasks to high priority"
    // Assert deleteInstruction was called with 'i-1'
    // Assert system hint contains "removed"
  })

  test('does not delete when no matching instruction found', async () => {
    // listInstructions returns [{ id: 'i-1', text: 'Always reply in Spanish' }]
    classifyResult = {
      classification: 'revocation',
      instruction: 'Always set tasks to high priority',
    } as typeof classifyResult
    // Assert deleteInstruction is NOT called (no semantic match)
    // Assert no system hint is injected
  })

  test('matches instruction by word overlap for revocation', async () => {
    // listInstructions returns [{ id: 'i-1', text: 'Assign all new tasks to me by default' }]
    classifyResult = {
      classification: 'revocation',
      instruction: 'Assign tasks to me',
    } as typeof classifyResult
    // Assert deleteInstruction IS called with 'i-1' (sufficient word overlap)
  })
})
```

**Step 2: Run tests**

```bash
bun test tests/llm-orchestrator-classifier.test.ts
```

**Step 3: Commit**

```bash
git add tests/llm-orchestrator-classifier.test.ts
git commit -m "test: add instruction revocation tests for classifier"
```

---

### Task 6: Classification accuracy edge-case tests

**Files:**

- Modify: `tests/classifier.test.ts`

**Covers:** US-7

These are **prompt-quality** tests. Because the LLM is mocked in unit tests, these verify
that the prompt template contains the right guidance. For true accuracy validation, we rely on
manual/integration testing with a real LLM.

**Step 1: Add prompt content tests**

Add to `tests/classifier.test.ts`:

```typescript
describe('CLASSIFIER_PROMPT content', () => {
  test('prompt mentions key classification categories', async () => {
    // Import CLASSIFIER_PROMPT (export it for testing)
    const { CLASSIFIER_PROMPT } = await import('../src/classifier.js')
    expect(CLASSIFIER_PROMPT).toContain('"instruction"')
    expect(CLASSIFIER_PROMPT).toContain('"revocation"')
    expect(CLASSIFIER_PROMPT).toContain('"mixed"')
    expect(CLASSIFIER_PROMPT).toContain('"normal"')
  })

  test('prompt includes guidance for ambiguous cases', async () => {
    const { CLASSIFIER_PROMPT } = await import('../src/classifier.js')
    // Questions are normal
    expect(CLASSIFIER_PROMPT).toContain('Questions about current behavior')
    // Casual context is normal
    expect(CLASSIFIER_PROMPT).toContain('Casual context')
    // One-time requests are normal
    expect(CLASSIFIER_PROMPT).toContain('One-time requests')
  })

  test('prompt includes signal phrases', async () => {
    const { CLASSIFIER_PROMPT } = await import('../src/classifier.js')
    expect(CLASSIFIER_PROMPT).toContain('always')
    expect(CLASSIFIER_PROMPT).toContain('never')
    expect(CLASSIFIER_PROMPT).toContain('from now on')
  })
})
```

**Step 2: Add schema validation tests**

```typescript
describe('ClassificationSchema', () => {
  test('allows valid instruction classification', () => {
    const { ClassificationSchema } = await import('../src/classifier.js')
    const result = ClassificationSchema.safeParse({
      classification: 'instruction',
      instruction: 'Always use high priority',
    })
    expect(result.success).toBe(true)
  })

  test('allows normal classification without instruction', () => {
    const { ClassificationSchema } = await import('../src/classifier.js')
    const result = ClassificationSchema.safeParse({
      classification: 'normal',
    })
    expect(result.success).toBe(true)
  })

  test('rejects invalid classification value', () => {
    const { ClassificationSchema } = await import('../src/classifier.js')
    const result = ClassificationSchema.safeParse({
      classification: 'unknown',
    })
    expect(result.success).toBe(false)
  })
})
```

**Step 3: Run tests**

```bash
bun test tests/classifier.test.ts
```

**Step 4: Commit**

```bash
git add tests/classifier.test.ts
git commit -m "test: add edge-case and prompt-quality tests for classifier"
```

---

### Task 7: System prompt update for instruction-aware replies

**Files:**

- Modify: `src/llm-orchestrator.ts`
- Test: update existing system prompt tests

**Covers:** US-3

**Step 1: Add guidance to `STATIC_RULES` in `src/llm-orchestrator.ts`**

Append to `STATIC_RULES`:

```
LEARNED PREFERENCES — When you see a [System note] about a new, removed, or updated preference:
- Acknowledge it briefly and naturally in your reply (e.g. "Got it, I'll use high priority from now on.")
- If the message also contains a task request, handle the task AND acknowledge the preference.
- Do not repeat the full text of the [System note] to the user.
```

**Step 2: Verify system prompt tests still pass**

```bash
bun test
```

**Step 3: Commit**

```bash
git add src/llm-orchestrator.ts
git commit -m "feat: add LEARNED PREFERENCES guidance to system prompt"
```

---

### Task 8: Integration test with full flow

**Files:**

- Create: `tests/classifier-integration.test.ts`

**Covers:** US-1, US-2, US-3, US-5, US-6

This is an integration test that exercises the full processMessage → classifier → store →
main LLM → reply flow with mocked LLM responses but real cache/instructions logic.

**Step 1: Write integration tests**

```typescript
import { Database } from 'bun:sqlite'
import { mock, describe, test, expect, beforeEach } from 'bun:test'
import { drizzle } from 'drizzle-orm/bun-sqlite'

import { mockLogger } from './helpers/test-helpers.js'

mockLogger()

// ... full mock setup for LLM, providers, etc.
// classifyMessage returns controlled results
// generateText (main) returns controlled assistant responses

describe('classifier integration', () => {
  test('instruction detected → stored → confirmed in reply', async () => {
    // 1. classifyMessage returns { classification: 'instruction', instruction: 'Use high priority' }
    // 2. processMessage runs
    // 3. Assert instruction is in getCachedInstructions(contextId)
    // 4. Assert generateText (main) received a system hint about new preference
    // 5. Assert reply.formatted was called
  })

  test('mixed message → instruction stored + task handled', async () => {
    // 1. classifyMessage returns { classification: 'mixed', instruction: '...' }
    // 2. processMessage receives "Always use urgent, and create a deploy task"
    // 3. Assert instruction is stored
    // 4. Assert main LLM received the FULL original message (with task request)
    // 5. Assert main LLM received tool definitions (create_task etc.)
  })

  test('classifier fails → message processed normally', async () => {
    // 1. classifyMessage throws Error('LLM timeout')
    // 2. processMessage still completes
    // 3. Assert no instruction is stored
    // 4. Assert main LLM was called
    // 5. Assert reply was sent
  })

  test('revocation → matching instruction deleted', async () => {
    // 1. Pre-store an instruction via saveInstruction
    // 2. classifyMessage returns { classification: 'revocation', instruction: '...' }
    // 3. processMessage runs
    // 4. Assert instruction is no longer in getCachedInstructions
  })
})
```

**Step 2: Run tests**

```bash
bun test tests/classifier-integration.test.ts
```

**Step 3: Commit**

```bash
git add tests/classifier-integration.test.ts
git commit -m "test: add end-to-end integration tests for classifier flow"
```

---

## Risk Assessment

| Risk                                                | Probability | Impact | Mitigation                                                                                                                    | Owner |
| --------------------------------------------------- | ----------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- | ----- |
| Classifier adds noticeable latency to every message | Medium      | Medium | 5s timeout with graceful fallback; skip when `small_model` not configured; small model is fast                                | Dev   |
| False positive: casual remark stored as instruction | Medium      | Low    | Carefully engineered prompt with negative examples; Jaccard duplicate check prevents accumulation; users can delete via tools | Dev   |
| False negative: instruction not detected            | Medium      | Low    | Existing LLM tools (`save_instruction`) remain available as explicit fallback                                                 | Dev   |
| Classifier prompt injection via user message        | Low         | Medium | Structured output schema constrains response format; no tool calls or code execution in classifier                            | Dev   |
| `small_model` config changes mid-conversation       | Low         | Low    | Model is built fresh per call from config; no stale state                                                                     | Dev   |
| Revocation matches wrong instruction                | Low         | Medium | Word-overlap matching with 50% threshold; main LLM confirms what was removed                                                  | Dev   |

## Dependency Graph

```
Task 1 (classifier module)
    │
    ▼
Task 2 (processMessage integration) ◄── depends on custom-instructions storage layer
    │
    ├──► Task 3 (timeout guardrails)
    ├──► Task 4 (confirmation tests)
    ├──► Task 5 (revocation tests)
    │
    ▼
Task 6 (edge-case tests) ── can run in parallel with 3, 4, 5
    │
    ▼
Task 7 (system prompt update)
    │
    ▼
Task 8 (integration tests) ── final validation
```

## Files Changed Summary

| File                                        | Action | Task    |
| ------------------------------------------- | ------ | ------- |
| `src/classifier.ts`                         | Create | 1, 3    |
| `src/llm-orchestrator.ts`                   | Modify | 2, 3, 7 |
| `tests/classifier.test.ts`                  | Create | 1, 3, 6 |
| `tests/llm-orchestrator-classifier.test.ts` | Create | 2, 4, 5 |
| `tests/classifier-integration.test.ts`      | Create | 8       |

## Notes

- The classifier hint is injected as a `system` role message in the history array, **not** in
  the system prompt. This keeps the system prompt stable and cacheable, and the hint is
  naturally ephemeral (trimmed away after a few messages).
- The `classifierHint` message is **not** persisted to history — only the original user message
  is appended via `appendHistory`. The hint is a transient signal for the current LLM call only.
- When `small_model` is not set (falls back to `main_model`), the classifier is **skipped**
  to avoid doubling latency with the same model. Users in this config rely on the LLM tools
  approach from the custom instructions design.
