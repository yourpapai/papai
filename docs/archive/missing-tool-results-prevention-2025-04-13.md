<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Missing Tool Results Error Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a two-layer defense system to prevent `AI_MissingToolResultsError` from breaking the bot.

**Architecture:** Layer 1 wraps all tool executions in try/catch to return structured errors instead of throwing. Layer 2 validates conversation history before each LLM call and injects synthetic error results for any missing tool results.

**Tech Stack:** TypeScript, Vercel AI SDK v6, Zod, Bun

---

## File Structure

| File                                        | Responsibility                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/tools/wrap-tool-execution.ts`          | Tool execution wrapper helper that catches errors and returns structured error results |
| `src/tools/index.ts`                        | Modified to wrap all tools using the new helper                                        |
| `src/llm-orchestrator.ts`                   | Add pre-flight validation function and integrate before `invokeModel()`                |
| `tests/tools/wrap-tool-execution.test.ts`   | Tests for the tool wrapper helper                                                      |
| `tests/llm-orchestrator-validation.test.ts` | Tests for pre-flight validation logic                                                  |

---

## Task 1: Create Tool Execution Wrapper Helper

**Files:**

- Create: `src/tools/wrap-tool-execution.ts`
- Test: `tests/tools/wrap-tool-execution.test.ts`

### Step 1: Write the failing test

```typescript
import { describe, expect, test } from 'bun:test'
import { wrapToolExecution, type ToolExecutionOptions } from '../../src/tools/wrap-tool-execution.js'

describe('wrapToolExecution', () => {
  test('returns result when execution succeeds', async () => {
    const execute = async () => ({ success: true, data: 'result' })
    const wrapped = wrapToolExecution(execute, 'test_tool')

    const result = await wrapped({}, { toolCallId: 'call-1', messages: [] })

    expect(result).toEqual({ success: true, data: 'result' })
  })

  test('returns structured error when execution throws', async () => {
    const execute = async () => {
      throw new Error('Something went wrong')
    }
    const wrapped = wrapToolExecution(execute, 'test_tool')

    const result = await wrapped({}, { toolCallId: 'call-1', messages: [] })

    expect(result).toEqual({
      success: false,
      error: 'Something went wrong',
      toolName: 'test_tool',
      toolCallId: 'call-1',
    })
    expect(result).toHaveProperty('timestamp')
  })

  test('returns structured error for non-Error throws', async () => {
    const execute = async () => {
      throw 'string error'
    }
    const wrapped = wrapToolExecution(execute, 'test_tool')

    const result = await wrapped({}, { toolCallId: 'call-2', messages: [] })

    expect(result.success).toBe(false)
    expect(result.error).toBe('string error')
  })
})
```

### Step 2: Run test to verify it fails

Run: `bun test tests/tools/wrap-tool-execution.test.ts`

Expected: FAIL with "Cannot find module"

### Step 3: Create the wrapper helper

```typescript
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool-wrapper' })

export interface ToolExecutionOptions {
  toolCallId: string
  messages: unknown[]
  abortSignal?: AbortSignal
}

export interface ToolErrorResult {
  success: false
  error: string
  toolName: string
  toolCallId: string
  timestamp: string
}

export type ToolExecuteFunction<TInput, TOutput> = (input: TInput, options: ToolExecutionOptions) => Promise<TOutput>

export type WrappedToolExecuteFunction<TInput, TOutput> = (
  input: TInput,
  options: ToolExecutionOptions,
) => Promise<TOutput | ToolErrorResult>

export function wrapToolExecution<TInput, TOutput>(
  execute: ToolExecuteFunction<TInput, TOutput>,
  toolName: string,
): WrappedToolExecuteFunction<TInput, TOutput> {
  return async (input: TInput, options: ToolExecutionOptions): Promise<TOutput | ToolErrorResult> => {
    try {
      return await execute(input, options)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error({ tool: toolName, toolCallId: options.toolCallId, error: errorMessage }, 'Tool execution failed')
      return {
        success: false,
        error: errorMessage,
        toolName,
        toolCallId: options.toolCallId,
        timestamp: new Date().toISOString(),
      }
    }
  }
}
```

### Step 4: Run test to verify it passes

Run: `bun test tests/tools/wrap-tool-execution.test.ts`

Expected: All tests PASS

### Step 5: Commit

```bash
git add tests/tools/wrap-tool-execution.test.ts src/tools/wrap-tool-execution.ts
git commit -m "feat: add tool execution wrapper helper"
```

---

## Task 2: Integrate Wrapper into Tool Creation

**Files:**

- Modify: `src/tools/index.ts`

### Step 1: Analyze existing tool creation pattern

Tools are created via factory functions like `makeCreateTaskTool()` that return `ToolSet[string]` (a Vercel AI SDK tool). The tool has an `execute` method that currently may throw errors.

### Step 2: Modify tool index to wrap tools

The approach is to wrap each tool's `execute` function after creation. Modify `src/tools/index.ts`:

````typescript
import type { ToolSet } from 'ai'

import type { TaskProvider } from '../providers/types.js'
import { buildTools } from './tools-builder.js'
import type { MakeToolsOptions, ToolMode } from './types.js'
import { wrapToolExecution } from './wrap-tool-execution.js'

export type { MakeToolsOptions, ToolMode }

function wrapToolSet(tools: ToolSet): ToolSet {
  const wrapped: ToolSet = {}
  for (const [name, tool] of Object.entries(tools)) {
    if (tool === undefined || tool === null) continue
    wrapped[name] = {
      ...tool,
      execute: wrapToolExecution(tool.execute.bind(tool), name),
    }
  }
  return wrapped
}

/**
 * Build a tool set for the given provider and context.
 *
 * Usage:
 * ```ts
 * makeTools(provider, { storageContextId: 'user-1:group-1', chatUserId: 'user-1', mode: 'normal' })
 * ```
 */
export function makeTools(provider: TaskProvider, options?: MakeToolsOptions): ToolSet {
  const storageContextId = options?.storageContextId
  const chatUserId = options?.chatUserId
  const contextId = storageContextId
  const mode = options?.mode ?? 'normal'
  const contextType = options?.contextType

  const tools = buildTools(provider, chatUserId, contextId, mode, contextType)
  return wrapToolSet(tools)
}
````

### Step 3: Verify existing tests still pass

Run: `bun test tests/tools/`

Expected: All existing tests PASS (tools now return error results instead of throwing)

### Step 4: Commit

```bash
git add src/tools/index.ts
git commit -m "feat: wrap all tool executions with error handler"
```

---

## Task 3: Create Pre-flight Validation Helper

**Files:**

- Create: `src/llm-orchestrator-validation.ts`
- Test: `tests/llm-orchestrator-validation.test.ts`

### Step 1: Write the failing test

```typescript
import { describe, expect, test } from 'bun:test'
import type { ModelMessage } from 'ai'
import { validateToolResults } from '../../src/llm-orchestrator-validation.js'

describe('validateToolResults', () => {
  test('returns unchanged messages when all tool calls have results', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Create a task' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'create_task', args: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'create_task',
            result: { id: '1' },
          },
        ],
      },
    ]

    const result = validateToolResults(messages)

    expect(result).toEqual(messages)
  })

  test('injects synthetic result for missing tool result', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Create a task' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'create_task', args: {} }],
      },
    ]

    const result = validateToolResults(messages)

    expect(result).toHaveLength(3)
    expect(result[2]).toMatchObject({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'create_task',
        },
      ],
    })
    const toolContent = result[2]!.content as Array<{
      type: string
      result: { recovered: boolean }
    }>
    expect(toolContent[0]!.result.recovered).toBe(true)
  })

  test('handles multiple missing results', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Do things' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'call-1', toolName: 'task_a', args: {} },
          { type: 'tool-call', toolCallId: 'call-2', toolName: 'task_b', args: {} },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'task_a', result: {} }],
      },
    ]

    const result = validateToolResults(messages)

    const toolMessages = result.filter((m) => m.role === 'tool')
    expect(toolMessages).toHaveLength(2)
  })
})
```

### Step 2: Run test to verify it fails

Run: `bun test tests/llm-orchestrator-validation.test.ts`

Expected: FAIL with "Cannot find module"

### Step 3: Create the validation helper

```typescript
import type { ModelMessage, ToolResultPart } from 'ai'
import { logger } from './logger.js'

const log = logger.child({ scope: 'llm-validation' })

interface ToolCallPart {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  args: unknown
}

interface ToolResultPartTyped {
  type: 'tool-result'
  toolCallId: string
  toolName: string
  result: unknown
}

function isToolCallPart(part: unknown): part is ToolCallPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === 'tool-call' &&
    'toolCallId' in part &&
    typeof part.toolCallId === 'string'
  )
}

function isToolResultPart(part: unknown): part is ToolResultPartTyped {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === 'tool-result' &&
    'toolCallId' in part &&
    typeof part.toolCallId === 'string'
  )
}

function extractToolCalls(message: ModelMessage): ToolCallPart[] {
  if (message.role !== 'assistant') return []
  if (typeof message.content === 'string') return []
  if (!Array.isArray(message.content)) return []
  return message.content.filter(isToolCallPart)
}

function extractToolResults(message: ModelMessage): ToolResultPartTyped[] {
  if (message.role !== 'tool') return []
  if (typeof message.content === 'string') return []
  if (!Array.isArray(message.content)) return []
  return message.content.filter(isToolResultPart)
}

function createSyntheticResult(toolCall: ToolCallPart): ToolResultPart {
  return {
    type: 'tool-result',
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    result: {
      error: 'Tool execution incomplete or interrupted',
      recovered: true,
    },
  }
}

export function validateToolResults(messages: ModelMessage[]): ModelMessage[] {
  const toolCalls = new Map<string, ToolCallPart>()
  const toolResults = new Set<string>()

  for (const message of messages) {
    for (const call of extractToolCalls(message)) {
      toolCalls.set(call.toolCallId, call)
    }
    for (const result of extractToolResults(message)) {
      toolResults.add(result.toolCallId)
    }
  }

  const missingResults: ToolCallPart[] = []
  for (const [id, call] of toolCalls) {
    if (!toolResults.has(id)) {
      missingResults.push(call)
    }
  }

  if (missingResults.length === 0) {
    return messages
  }

  log.warn(
    { missingCount: missingResults.length, toolCallIds: missingResults.map((c) => c.toolCallId) },
    'Detected missing tool results, injecting synthetic error results',
  )

  const syntheticMessages: ModelMessage[] = missingResults.map((call) => ({
    role: 'tool',
    content: [createSyntheticResult(call)],
  }))

  return [...messages, ...syntheticMessages]
}
```

### Step 4: Run test to verify it passes

Run: `bun test tests/llm-orchestrator-validation.test.ts`

Expected: All tests PASS

### Step 5: Commit

```bash
git add tests/llm-orchestrator-validation.test.ts src/llm-orchestrator-validation.ts
git commit -m "feat: add pre-flight tool result validation"
```

---

## Task 4: Integrate Validation into LLM Orchestrator

**Files:**

- Modify: `src/llm-orchestrator.ts`

### Step 1: Import the validation function

Add import at the top of `src/llm-orchestrator.ts`:

```typescript
import { validateToolResults } from './llm-orchestrator-validation.js'
```

### Step 2: Apply validation before invokeModel

In the `callLlm` function, before calling `invokeModel`, validate the messages:

```typescript
const tools = getOrCreateTools(contextId, chatUserId, provider, contextType)
const timezone = getConfig(contextId, 'timezone') ?? 'UTC'
const { messages: messagesWithMemory, memoryMsg } = buildMessagesWithMemory(contextId, history)

// Validate and repair any missing tool results
const validatedMessages = validateToolResults(messagesWithMemory)

log.debug({ contextId, historyLength: history.length, hasMemory: memoryMsg !== null, timezone }, 'Calling generateText')
const result = await invokeModel({
  contextId,
  mainModel,
  model,
  provider,
  tools,
  messages: validatedMessages,
  deps,
  reply,
})
```

### Step 3: Verify existing tests still pass

Run: `bun test tests/llm-orchestrator.test.ts`

Expected: All tests PASS

### Step 4: Commit

```bash
git add src/llm-orchestrator.ts
git commit -m "feat: integrate tool result validation before LLM calls"
```

---

## Task 5: Final Verification

### Step 1: Run full test suite

Run: `bun test`

Expected: All tests PASS

### Step 2: Run type check

Run: `bun run typecheck`

Expected: No type errors

### Step 3: Run lint

Run: `bun run lint`

Expected: No lint errors

### Step 4: Final commit

```bash
git commit -m "feat: complete missing tool results error prevention system

- Add tool execution wrapper to catch all errors and return structured results
- Add pre-flight validation to detect and repair missing tool results
- Integrate both layers into the LLM orchestration flow

This prevents AI_MissingToolResultsError from breaking the bot when
tool executions fail or conversation history becomes corrupted."
```

---

## Self-Review Checklist

- [x] All spec requirements covered:
  - [x] Tool-level error wrapping (Layer 1)
  - [x] Pre-flight validation with synthetic result injection (Layer 2)
  - [x] Logging at both layers
  - [x] Structured error results
- [x] No placeholders (all code provided)
- [x] Type consistency (ToolExecutionOptions, ToolErrorResult used consistently)
- [x] File paths exact and correct
- [x] Test commands with expected output
