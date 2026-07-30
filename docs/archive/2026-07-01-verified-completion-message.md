<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Verified Completion Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare `Done.` reply with a truthful, in-language completion message that verifies the user's request actually happened, in both the interactive and proactive paths.

**Architecture:** A new pure module (`src/completion/verified-completion.ts`) decides, on "risky" turns only (empty text, step-cap truncation, or a tool failure), to run a second constrained LLM call that verifies what happened and reports honestly. Read-back verification (re-fetch state via a read-only tool subset) is primary; self-check over the turn's tool results is the fallback; a neutral honest message is the last resort. The interactive orchestrator (`sendLlmResponse`/`invokeWithLiveStatus`) and the proactive path (`finalizeAndLog` + its 3 callers) both route through the same helper. A prompt tweak makes the model produce natural confirmations in the common case so the fallback rarely fires.

**Tech Stack:** TypeScript (strict, `.js` import paths), Bun test runner (`bun:test`), Vercel AI SDK (`generateText`, `ToolSet`, `ModelMessage`), Zod v4, pino logging.

**Spec:** `docs/superpowers/specs/2026-07-01-verified-completion-message-design.md`

---

## File Structure

- **Create** `src/completion/verified-completion.ts` — the whole feature's core: types, `selectReadOnlyTools`, `detectToolFailure`, `buildVerifiedCompletion`. One responsibility: decide the final completion text on risky turns.
- **Create** `tests/completion/verified-completion.test.ts` — unit tests for the module.
- **Modify** `src/llm-orchestrator-support.ts` — `sendLlmResponse` gains a risky-turn branch; `invokeWithLiveStatus` builds the verifier and passes it down.
- **Modify** `src/system-prompt.ts` — sharpen `WORKFLOW` step 4.
- **Create** `tests/system-prompt-workflow.test.ts` — regression guard for the sharpened wording.
- **Modify** `src/deferred-prompts/proactive-llm-helpers.ts` — `finalizeAndLog` becomes async + optional verification.
- **Modify** `src/deferred-prompts/proactive-llm.ts` — add `buildProactiveVerification`; wire the 3 `finalizeAndLog` call sites.
- **Modify** `tests/deferred-prompts/proactive-llm-helpers.test.ts` (if present) — `await` the now-async `finalizeAndLog`.

---

## Task 1: Read-only tool filter + tool-failure detection

**Files:**

- Create: `src/completion/verified-completion.ts`
- Test: `tests/completion/verified-completion.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/completion/verified-completion.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import type { ModelMessage, ToolSet } from 'ai'

import { detectToolFailure, selectReadOnlyTools } from '../../src/completion/verified-completion.js'
import type { ToolFailureResult } from '../../src/tool-failure.js'

const fakeTools = (...names: string[]): ToolSet => Object.fromEntries(names.map((n) => [n, {}])) as unknown as ToolSet

const failure: ToolFailureResult = {
  success: false,
  error: 'boom',
  toolName: 'update_task',
  toolCallId: 'c1',
  timestamp: '2026-07-01T00:00:00.000Z',
  errorType: 'tool-execution',
  errorCode: 'unknown',
  userMessage: 'That action failed.',
  agentMessage: 'It failed.',
  retryable: false,
}

describe('selectReadOnlyTools', () => {
  test('keeps get_/list_/search_ tools and drops mutating tools', () => {
    const result = selectReadOnlyTools(
      fakeTools('get_task', 'list_tasks', 'search_tools', 'create_task', 'update_task'),
    )
    expect(result).not.toBeUndefined()
    expect(Object.keys(result ?? {}).sort()).toEqual(['get_task', 'list_tasks', 'search_tools'])
  })

  test('returns undefined when no read-only tools are present', () => {
    expect(selectReadOnlyTools(fakeTools('create_task', 'delete_project'))).toBeUndefined()
  })
})

describe('detectToolFailure', () => {
  test('detects a ToolFailureResult nested in a tool message', () => {
    const messages: ModelMessage[] = [
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'update_task', output: failure }] },
    ] as unknown as ModelMessage[]
    expect(detectToolFailure(messages)).toBe(true)
  })

  test('returns false when no tool result is a failure', () => {
    const messages: ModelMessage[] = [
      { role: 'assistant', content: 'hi' },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'get_task', output: { id: 'TK-1' } }],
      },
    ] as unknown as ModelMessage[]
    expect(detectToolFailure(messages)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/completion/verified-completion.test.ts`
Expected: FAIL — cannot find module `src/completion/verified-completion.js`.

- [ ] **Step 3: Create the module with the two helpers**

Create `src/completion/verified-completion.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage, ToolSet } from 'ai'

import { logger } from '../logger.js'
import { isToolFailureResult } from '../tool-failure.js'

const log = logger.child({ scope: 'completion:verified' })

const READ_ONLY_PREFIXES = ['get_', 'list_', 'search_'] as const

/** Filter an assembled toolset to a read-only subset by name prefix. Returns undefined when none match. */
export const selectReadOnlyTools = (tools: ToolSet): ToolSet | undefined => {
  const entries = Object.entries(tools).filter(([name]) => READ_ONLY_PREFIXES.some((p) => name.startsWith(p)))
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}

const containsToolFailure = (value: unknown): boolean => {
  if (isToolFailureResult(value)) return true
  if (Array.isArray(value)) return value.some(containsToolFailure)
  if (value !== null && typeof value === 'object') return Object.values(value).some(containsToolFailure)
  return false
}

/** True when any tool-result message in the turn carries a ToolFailureResult (scanned defensively). */
export const detectToolFailure = (messages: readonly ModelMessage[]): boolean => {
  for (const message of messages) {
    if (message.role !== 'tool') continue
    if (containsToolFailure(message.content)) return true
  }
  return false
}

export { log as verifiedCompletionLog }
```

> Note: `export { log as verifiedCompletionLog }` is a temporary export so the module has a value export before Task 2 adds the rest; remove it at the end of Task 2 if unused. (It keeps `knip` from flagging `log` as unused mid-task.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/completion/verified-completion.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/completion/verified-completion.ts tests/completion/verified-completion.test.ts
git commit -m "feat(completion): read-only tool filter + tool-failure detection"
```

---

## Task 2: `buildVerifiedCompletion` core

**Files:**

- Modify: `src/completion/verified-completion.ts`
- Test: `tests/completion/verified-completion.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/completion/verified-completion.test.ts` (add the import at the top alongside the existing one):

```ts
import { buildVerifiedCompletion } from '../../src/completion/verified-completion.js'
import type { VerifierDeps, VerifierPrompt } from '../../src/completion/verified-completion.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('buildVerifiedCompletion', () => {
  const okDeps = (text: string | undefined, capture?: (p: VerifierPrompt) => void): VerifierDeps => ({
    readOnlyToolset: undefined,
    invokeVerifier: async (prompt) => {
      capture?.(prompt)
      return { text }
    },
  })

  test('confirmed: passes through the verifier text', async () => {
    mockLogger()
    const result = await buildVerifiedCompletion(
      { history: [], finishReason: 'stop', hadToolFailure: false },
      okDeps('Created task TK-42.'),
    )
    expect(result).toEqual({ text: 'Created task TK-42.', verdict: 'confirmed' })
  })

  test('truncated: verdict is truncated and the prompt tells the model to invite "continue"', async () => {
    mockLogger()
    let seen: VerifierPrompt | undefined
    const result = await buildVerifiedCompletion(
      { history: [], finishReason: 'tool-calls', hadToolFailure: false },
      okDeps('Reached the step limit; say continue to resume.', (p) => (seen = p)),
    )
    expect(result.verdict).toBe('truncated')
    expect(seen?.system).toContain('continue')
  })

  test('partial: a tool failure yields the partial verdict', async () => {
    mockLogger()
    const result = await buildVerifiedCompletion(
      { history: [], finishReason: 'stop', hadToolFailure: true },
      okDeps('The update failed.'),
    )
    expect(result.verdict).toBe('partial')
  })

  test('unconfirmed: neutral message when the verifier throws', async () => {
    mockLogger()
    const deps: VerifierDeps = {
      readOnlyToolset: undefined,
      invokeVerifier: async () => {
        throw new Error('network')
      },
    }
    const result = await buildVerifiedCompletion({ history: [], finishReason: 'stop', hadToolFailure: false }, deps)
    expect(result.verdict).toBe('unconfirmed')
    expect(result.text).toContain('could not confirm')
  })

  test('unconfirmed: neutral message when the verifier returns empty text', async () => {
    mockLogger()
    const result = await buildVerifiedCompletion(
      { history: [], finishReason: 'stop', hadToolFailure: false },
      okDeps(''),
    )
    expect(result.verdict).toBe('unconfirmed')
    expect(result.text).toContain('could not confirm')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/completion/verified-completion.test.ts`
Expected: FAIL — `buildVerifiedCompletion` is not exported.

- [ ] **Step 3: Implement `buildVerifiedCompletion`**

In `src/completion/verified-completion.ts`, remove the temporary `export { log as verifiedCompletionLog }` line and append:

```ts
export type CompletionVerdict = 'confirmed' | 'truncated' | 'partial' | 'failed' | 'unconfirmed'
export type VerifiedCompletion = { text: string; verdict: CompletionVerdict }
export type VerifierPrompt = { system: string; messages: ModelMessage[] }

export type VerifierDeps = {
  /** Runs the constrained second generateText call; returns its text + finishReason. */
  invokeVerifier: (prompt: VerifierPrompt) => Promise<{ text: string | undefined; finishReason?: string }>
  /** Present when read-back is possible (used only for the debug log; the closure binds the toolset itself). */
  readOnlyToolset: ToolSet | undefined
}

export type CompletionTurn = {
  history: readonly ModelMessage[]
  finishReason?: string
  hadToolFailure: boolean
}

export const VERIFIER_MAX_STEPS = 4
const NEUTRAL_FALLBACK = 'I ran the requested actions but could not confirm the result — please double-check.'

const buildVerifierPrompt = (turn: CompletionTurn): VerifierPrompt => {
  const truncated = turn.finishReason === 'tool-calls'
  const system = [
    'You are finalizing an assistant turn in a task-management chat bot.',
    'The conversation so far — including the tools the assistant just called and their results — is provided.',
    "Determine whether the user's most recent request was actually carried out, then write ONE short reply to the user.",
    'Rules:',
    '- Reply in the same language the user used.',
    '- Be truthful. Never claim something succeeded unless the tool results (or a read-back) confirm it.',
    '- You MAY call read-only tools to re-check current state before answering. Never attempt to change anything.',
    '- If a tool failed, tell the user plainly what did not work.',
    truncated
      ? '- The turn stopped because it reached the tool-step limit before finishing. Summarize what was completed, say the step limit was reached, and invite the user to say "continue" to resume.'
      : '- Summarize what was done, naming the affected item(s).',
    'Output only the user-facing reply text, nothing else.',
  ].join('\n')
  const messages: ModelMessage[] = [
    ...turn.history,
    { role: 'user', content: '[FINALIZE] Write the reply now, following your instructions.' },
  ]
  return { system, messages }
}

const deriveVerdict = (turn: CompletionTurn): CompletionVerdict => {
  if (turn.finishReason === 'tool-calls') return 'truncated'
  if (turn.hadToolFailure) return 'partial'
  return 'confirmed'
}

/**
 * On a risky turn, run a verification LLM call and return a truthful user-facing message.
 * Never returns a bare "Done."; degrades to a neutral honest message if verification fails.
 */
export const buildVerifiedCompletion = async (
  turn: CompletionTurn,
  deps: VerifierDeps,
): Promise<VerifiedCompletion> => {
  const verdict = deriveVerdict(turn)
  log.debug({ verdict, readBack: deps.readOnlyToolset !== undefined }, 'Building verified completion')
  const prompt = buildVerifierPrompt(turn)
  try {
    const res = await deps.invokeVerifier(prompt)
    if (res.text === undefined || res.text === '') {
      log.warn({ verdict }, 'Verifier returned empty text; using neutral fallback')
      return { text: NEUTRAL_FALLBACK, verdict: 'unconfirmed' }
    }
    log.info({ verdict }, 'Verified completion built')
    return { text: res.text, verdict }
  } catch (error) {
    log.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'Verifier call failed; using neutral fallback',
    )
    return { text: NEUTRAL_FALLBACK, verdict: 'unconfirmed' }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/completion/verified-completion.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 5: Typecheck the module**

Run: `bun run typecheck`
Expected: no errors in `src/completion/verified-completion.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/completion/verified-completion.ts tests/completion/verified-completion.test.ts
git commit -m "feat(completion): buildVerifiedCompletion verify-and-report core"
```

---

## Task 3: Wire the interactive path

**Files:**

- Modify: `src/llm-orchestrator-support.ts` (`sendLlmResponse` ~237-267, `invokeWithLiveStatus` ~277-298)
- Test: `tests/completion/verified-completion.test.ts` (add a `sendLlmResponse` block) or a new `tests/llm-orchestrator-support-completion.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/llm-orchestrator-support-completion.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import type { ModelMessage } from 'ai'

import { sendLlmResponse } from '../src/llm-orchestrator-support.js'
import { createMockReply, mockLogger } from './utils/test-helpers.js'

const emptyResult = {
  text: undefined as string | undefined,
  finishReason: 'stop' as string | undefined,
  toolCalls: [] as unknown[],
  response: { messages: [] as ModelMessage[] },
}

describe('sendLlmResponse verification wiring', () => {
  test('risky turn (empty text) invokes the verifier and delivers its text', async () => {
    mockLogger()
    const reply = createMockReply()
    let invoked = 0
    await sendLlmResponse(reply.reply, 'ctx-1', { ...emptyResult }, undefined, {
      history: [],
      verifier: {
        readOnlyToolset: undefined,
        invokeVerifier: async () => {
          invoked += 1
          return { text: 'Created task TK-42.' }
        },
      },
    })
    expect(invoked).toBe(1)
    expect(reply.formattedCalls).toContain('Created task TK-42.')
  })

  test('normal turn (confident text) does NOT invoke the verifier', async () => {
    mockLogger()
    const reply = createMockReply()
    let invoked = 0
    await sendLlmResponse(reply.reply, 'ctx-1', { ...emptyResult, text: 'All set — moved to Done.' }, undefined, {
      history: [],
      verifier: {
        readOnlyToolset: undefined,
        invokeVerifier: async () => {
          invoked += 1
          return { text: 'should not be used' }
        },
      },
    })
    expect(invoked).toBe(0)
    expect(reply.formattedCalls).toContain('All set — moved to Done.')
  })
})
```

> Check `createMockReply()`'s actual shape in `tests/utils/test-helpers.ts` first — it may expose the reply object directly and record formatted calls under a different property name (e.g. `reply.formatted.mock.calls`). Adjust `reply.reply` / `reply.formattedCalls` to match the helper. The assertions (verifier invoked count; delivered text) stay the same.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/llm-orchestrator-support-completion.test.ts`
Expected: FAIL — `sendLlmResponse` does not accept a 5th argument / verifier never invoked.

- [ ] **Step 3: Update `sendLlmResponse`**

In `src/llm-orchestrator-support.ts`, add to the imports near the top:

```ts
import {
  buildVerifiedCompletion,
  detectToolFailure,
  selectReadOnlyTools,
  VERIFIER_MAX_STEPS,
} from './completion/verified-completion.js'
import type { VerifierDeps, VerifierPrompt } from './completion/verified-completion.js'
```

Replace the body of `sendLlmResponse` (the current lines 237-267) with:

```ts
export const sendLlmResponse = async (
  reply: ReplyFn,
  contextId: string,
  result: {
    text: string | undefined
    finishReason?: string
    toolCalls: unknown[] | undefined
    response: { messages: ModelMessage[] }
  },
  progressReporter: AiProgressReporter | undefined,
  verification?: { verifier: VerifierDeps; history: readonly ModelMessage[] },
): Promise<void> => {
  const hadToolFailure = detectToolFailure(result.response.messages)
  const isRisky =
    result.text === undefined || result.text === '' || result.finishReason === 'tool-calls' || hadToolFailure

  let textToFormat: string
  if (isRisky && verification !== undefined) {
    const verified = await buildVerifiedCompletion(
      { history: verification.history, finishReason: result.finishReason, hadToolFailure },
      verification.verifier,
    )
    textToFormat = verified.text
  } else {
    textToFormat = result.text !== undefined && result.text !== '' ? result.text : 'Done.'
  }

  const responseLength = result.text === undefined ? 0 : result.text.length
  const toolCallCount = result.toolCalls === undefined ? 0 : result.toolCalls.length
  const meta = { contextId, responseLength, toolCalls: toolCallCount, finishReason: result.finishReason }
  if (result.finishReason === 'tool-calls') {
    log.warn(meta, 'LLM turn ended on a pending tool call (step cap reached); reply may be incomplete')
  }
  await reply.formatted(textToFormat)
  if (progressReporter !== undefined) {
    try {
      await progressReporter.flush()
    } catch (error) {
      log.warn(
        { contextId, error: error instanceof Error ? error.message : String(error) },
        'AI progress details flush failed after final response',
      )
    }
  }
  log.info(meta, 'Response sent successfully')
}
```

- [ ] **Step 4: Build the verifier in `invokeWithLiveStatus`**

In `src/llm-orchestrator-support.ts`, replace line 293 (`await sendLlmResponse(reply, invokeArgs.contextId, result, progressReporter)`) with:

```ts
const readOnlyToolset = selectReadOnlyTools(invokeArgs.tools)
const verifier: VerifierDeps = {
  readOnlyToolset,
  invokeVerifier: async ({ system, messages }: VerifierPrompt) => {
    const res = await invokeArgs.deps.generateText({
      model: invokeArgs.model,
      system,
      messages,
      tools: readOnlyToolset ?? {},
      stopWhen: invokeArgs.deps.stepCountIs(VERIFIER_MAX_STEPS),
      timeout: 1_200_000,
    })
    return { text: res.text, finishReason: res.finishReason }
  },
}
const history: ModelMessage[] = [...invokeArgs.messages, ...result.response.messages]
await sendLlmResponse(reply, invokeArgs.contextId, result, progressReporter, { verifier, history })
```

> If TypeScript reports that `invokeArgs.messages`, `invokeArgs.model`, `invokeArgs.tools`, `invokeArgs.deps.generateText`, or `invokeArgs.deps.stepCountIs` are not present on `InvokeModelArgs`, open `src/llm-orchestrator-types.ts`, confirm the field names on `InvokeModelArgs` / `LlmOrchestratorDeps`, and use the exact names (they are the same fields `callGenerateText` uses in `src/llm-orchestrator-invoke.ts`).

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test tests/llm-orchestrator-support-completion.test.ts`
Expected: PASS (2 tests).

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Run the existing orchestrator suite to confirm no regressions**

Run: `bun test tests/ 2>&1 | tail -20` (or the specific existing `llm-orchestrator*` test files)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/llm-orchestrator-support.ts tests/llm-orchestrator-support-completion.test.ts
git commit -m "feat(orchestrator): route risky interactive turns through verify-and-report"
```

---

## Task 4: Sharpen the prompt (Pillar A)

**Files:**

- Modify: `src/system-prompt.ts:111`
- Test: `tests/system-prompt-workflow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/system-prompt-workflow.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildProviderlessSystemPrompt } from '../src/system-prompt.js'

describe('WORKFLOW confirmation instruction', () => {
  test('step 4 tells the model to name what it did', () => {
    const prompt = buildProviderlessSystemPrompt('ctx-1', new Set<string>(), { askPermissionAvailable: false })
    expect(prompt).toContain('names what you did')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/system-prompt-workflow.test.ts`
Expected: FAIL — prompt does not contain `names what you did`.

- [ ] **Step 3: Sharpen the wording**

In `src/system-prompt.ts`, inside the `WORKFLOW` template literal, change:

```ts
4. Reply with a concise confirmation.
```

to:

```ts
4. Reply with a concise confirmation that names what you did — the affected item(s) and the change — in the user's language.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/system-prompt-workflow.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/system-prompt.ts tests/system-prompt-workflow.test.ts
git commit -m "feat(system-prompt): make the post-action confirmation name what was done"
```

---

## Task 5: Wire the proactive path

**Files:**

- Modify: `src/deferred-prompts/proactive-llm-helpers.ts` (`finalizeAndLog` ~71-80)
- Modify: `src/deferred-prompts/proactive-llm.ts` (add `buildProactiveVerification`; call sites at lines 133, 180, 249)
- Modify: `tests/deferred-prompts/proactive-llm-helpers.test.ts` (if it exists — `await` the now-async `finalizeAndLog`)

- [ ] **Step 1: Make `finalizeAndLog` async + verification-aware**

In `src/deferred-prompts/proactive-llm-helpers.ts`, add to the imports:

```ts
import { buildVerifiedCompletion, detectToolFailure } from '../completion/verified-completion.js'
import type { VerifierDeps } from '../completion/verified-completion.js'
```

Replace `finalizeAndLog` (lines 71-80) with:

```ts
export const finalizeAndLog = async (
  result: DeliveryResultLike & { response?: { messages: readonly ModelMessage[] } },
  userId: string,
  mode: ExecutionMetadata['mode'],
  verification?: { verifier: VerifierDeps; history: readonly ModelMessage[] },
): Promise<string> => {
  const stepCount = Array.isArray(result.steps) ? result.steps.length : undefined
  const meta = { userId, mode, finishReason: result.finishReason, stepCount }
  if (result.finishReason === 'tool-calls') {
    log.warn(meta, 'Proactive delivery ended on a pending tool call; dropping incomplete preamble text')
  } else {
    log.debug(meta, 'Proactive delivery finalized')
  }

  if (verification !== undefined) {
    const messages = result.response?.messages ?? []
    const hadToolFailure = detectToolFailure(messages)
    const isRisky =
      result.text === undefined || result.text === '' || result.finishReason === 'tool-calls' || hadToolFailure
    if (isRisky) {
      const verified = await buildVerifiedCompletion(
        { history: verification.history, finishReason: result.finishReason, hadToolFailure },
        verification.verifier,
      )
      return verified.text
    }
  }
  return finalizeDeliveryText(result)
}
```

> `finalizeDeliveryText` stays unchanged (still the non-verified fallback). The 3 callers `return finalizeAndLog(...)` from `async` functions, so returning a `Promise<string>` needs no `await` at the call sites — but any test that calls `finalizeAndLog` directly must now `await` it.

- [ ] **Step 2: Add `buildProactiveVerification` in `proactive-llm.ts`**

In `src/deferred-prompts/proactive-llm.ts`, add imports:

```ts
import type { LanguageModel, ToolSet } from 'ai'

import { selectReadOnlyTools, VERIFIER_MAX_STEPS } from '../completion/verified-completion.js'
import type { VerifierDeps, VerifierPrompt } from '../completion/verified-completion.js'
```

Add this helper near the top of the module body (below the imports / type declarations):

```ts
const buildProactiveVerification = (
  deps: Pick<ProactiveLlmDeps, 'generateText' | 'stepCountIs'>,
  model: LanguageModel,
  tools: ToolSet,
  history: readonly ModelMessage[],
): { verifier: VerifierDeps; history: readonly ModelMessage[] } => {
  const readOnlyToolset = selectReadOnlyTools(tools)
  const verifier: VerifierDeps = {
    readOnlyToolset,
    invokeVerifier: async ({ system, messages }: VerifierPrompt) => {
      const res = await deps.generateText({
        model,
        system,
        messages,
        tools: readOnlyToolset ?? {},
        stopWhen: deps.stepCountIs(VERIFIER_MAX_STEPS),
        timeout: 1_200_000,
      })
      return { text: res.text, finishReason: res.finishReason }
    },
  }
  return { verifier, history }
}
```

> If `ProactiveLlmDeps` does not expose `generateText`/`stepCountIs` under those exact names, open the interface (declared around line 47 of `proactive-llm.ts`) and use the real field names.

- [ ] **Step 3: Wire the three call sites**

Site 1 — `invokeLightweight`, line 133. Capture the tools in a const and pass verification:

```ts
const tools = makeMinimalTools(createdByUserId)
const result = await deps.generateText({
  model,
  system: buildMinimalSystemPrompt(type),
  messages,
  tools,
  stopWhen: deps.stepCountIs(25),
  timeout: 1_200_000,
})

const assistantMessages = result.response.messages
persistLightweightResponse(createdByUserId, storageContextId, configContextId, config.mainModel, assistantMessages)
return finalizeAndLog(
  result,
  createdByUserId,
  'lightweight',
  buildProactiveVerification(deps, model, tools, [...messages, ...result.response.messages]),
)
```

Site 2 — `invokeWithContext`, line 180. Same pattern:

```ts
const tools = makeMinimalTools(createdByUserId)
const result = await deps.generateText({
  model,
  system: buildMinimalSystemPrompt(type),
  messages,
  tools,
  stopWhen: deps.stepCountIs(25),
  timeout: 1_200_000,
})

persistContextResponse(
  storageContextId,
  configContextId,
  deliveryTarget.contextType,
  history,
  config.mainModel,
  result.response.messages,
)
return finalizeAndLog(
  result,
  createdByUserId,
  'context',
  buildProactiveVerification(deps, model, tools, [...messages, ...result.response.messages]),
)
```

Site 3 — `runFullGeneration`, line 249 (uses `prepared.tools` / `prepared.messages`):

```ts
return finalizeAndLog(
  result,
  createdByUserId,
  'full',
  buildProactiveVerification(deps, model, prepared.tools, [...prepared.messages, ...result.response.messages]),
)
```

- [ ] **Step 4: Update any existing `finalizeAndLog` tests to await**

Run: `grep -rn "finalizeAndLog" tests/`
For each hit, wrap the call in `await` and make the enclosing test `async`. Existing behavior is unchanged when no `verification` arg is passed (returns `finalizeDeliveryText(result)`), so only the `await` is needed.

- [ ] **Step 5: Add a proactive verify test**

Append to `tests/deferred-prompts/proactive-llm-helpers.test.ts` (create it if absent, with the standard license header + imports):

```ts
import { finalizeAndLog } from '../../src/deferred-prompts/proactive-llm-helpers.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('finalizeAndLog verification', () => {
  test('empty text + verification → verified text', async () => {
    mockLogger()
    const text = await finalizeAndLog(
      { text: '', finishReason: 'stop', response: { messages: [] } },
      'user-1',
      'full',
      {
        history: [],
        verifier: { readOnlyToolset: undefined, invokeVerifier: async () => ({ text: 'Reminder delivered.' }) },
      },
    )
    expect(text).toBe('Reminder delivered.')
  })

  test('no verification arg → legacy Done. fallback preserved', async () => {
    mockLogger()
    const text = await finalizeAndLog({ text: '', finishReason: 'stop' }, 'user-1', 'lightweight')
    expect(text).toBe('Done.')
  })
})
```

- [ ] **Step 6: Run tests + typecheck**

Run: `bun test tests/deferred-prompts/ tests/completion/`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/deferred-prompts/proactive-llm-helpers.ts src/deferred-prompts/proactive-llm.ts tests/deferred-prompts/proactive-llm-helpers.test.ts
git commit -m "feat(proactive): route risky deferred deliveries through verify-and-report"
```

---

## Task 6: Full check + knip

**Files:** none (verification only)

- [ ] **Step 1: Run the full check suite**

Run: `bun check:full`
Expected: all checks pass (lint, typecheck, format:check, knip, license-headers, tests).

- [ ] **Step 2: Fix any knip "unused export" findings**

`knip` may flag exports that are only consumed in tests (e.g. `CompletionTurn`, `VERIFIER_MAX_STEPS`). If a symbol is genuinely only used internally, un-export it; if it is used across modules, it is fine. Do NOT add ignore comments — resolve by adjusting exports.

- [ ] **Step 3: Commit any fixups**

```bash
git add -A
git commit -m "chore(completion): satisfy full check suite"
```

---

## Self-Review Notes (author checklist — already applied)

- **Spec coverage:** Pillar A → Task 4; Pillar B core → Tasks 1-2; interactive path → Task 3; proactive path → Task 5; degradation ladder (read-back/self-check/neutral) → `buildVerifiedCompletion` + `selectReadOnlyTools` returning `undefined`; truncation "continue" message → truncated branch of `buildVerifierPrompt` (Task 2) + test; cost guard (risky-only) → `isRisky` gates in Tasks 3 & 5; read-only safety → `selectReadOnlyTools` + Task 1 tests; verdict taxonomy → `deriveVerdict`. Ladder step 4 ("empty text + no tool calls → honest re-ask") is handled by the verifier prompt rather than a dedicated code branch — an intentional simplification (the prompt instructs an honest reply when nothing was done).
- **Type consistency:** `VerifierDeps`, `VerifierPrompt`, `CompletionTurn`, `CompletionVerdict`, `VerifiedCompletion`, `buildVerifiedCompletion`, `selectReadOnlyTools`, `detectToolFailure`, `VERIFIER_MAX_STEPS` are used identically across Tasks 1-5.
- **Known integration risk:** exact field names on `InvokeModelArgs` / `LlmOrchestratorDeps` / `ProactiveLlmDeps` are called out with a "confirm the names" note at each wiring step rather than assumed silently.
