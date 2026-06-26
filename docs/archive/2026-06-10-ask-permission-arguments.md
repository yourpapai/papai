<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Ask Permission Arguments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show tool arguments in the permission prompt so users can make informed decisions about allowing/denying tool execution.

**Architecture:** Extend `AskPermissionFn` type to include arguments, add argument formatting functions to `permission-prompt.ts`, and update `gatedExecute` to pass cleaned arguments to the permission prompt.

**Tech Stack:** TypeScript, Bun test runner, Zod (for schema validation)

---

## File Structure

- `src/tools/permission-gate.ts` - Update `AskPermissionFn` type and `gatedExecute` function
- `src/chat/permission-prompt.ts` - Add `formatArguments` and helpers, update `formatPrompt` and `askPermissionViaChat`
- `tests/tools/permission-gate.test.ts` - Update tests for new `AskPermissionFn` signature
- `tests/chat/permission-prompt.test.ts` - Add tests for argument formatting functions
- `tests/chat/interaction-router.test.ts` - Update tests for new prompt format

---

### Task 1: Update `AskPermissionFn` Type

**Files:**

- Modify: `src/tools/permission-gate.ts:92`
- Modify: `src/tools/permission-gate.ts:106-128`

- [ ] **Step 1: Update `AskPermissionFn` type definition**

```typescript
// src/tools/permission-gate.ts:92
// Before:
export type AskPermissionFn = (req: { toolName: string; reason: string }) => Promise<'allow' | 'deny'>

// After:
export type AskPermissionFn = (req: {
  toolName: string
  reason: string
  args: Record<string, unknown>
}) => Promise<'allow' | 'deny'>
```

- [ ] **Step 2: Update `gatedExecute` to pass `args`**

```typescript
// src/tools/permission-gate.ts:106-128
export function gatedExecute<O>(
  execute: ExecuteFn<O>,
  toolName: string,
  askPermission: AskPermissionFn | undefined,
): ExecuteFn<O | PermissionDeniedResult> {
  return async (input: unknown, options: ToolExecutionOptions): Promise<O | PermissionDeniedResult> => {
    if (askPermission === undefined) {
      return buildPermissionDenied(`Tool '${toolName}' requires user permission, but no chat surface is available.`)
    }
    const inputRecord: Record<string, unknown> = {}
    if (typeof input === 'object' && input !== null) {
      for (const [k, v] of Object.entries(input)) {
        inputRecord[k] = v
      }
    }
    const reason = extractReason(inputRecord)
    const cleaned = omitReasonField(inputRecord)
    const decision = await askPermission({ toolName, reason, args: cleaned })
    if (decision === 'deny') {
      return buildPermissionDenied(`User denied execution of '${toolName}'.`)
    }
    return execute(cleaned, options)
  }
}
```

- [ ] **Step 3: Update `llm-orchestrator-tools.ts` binding**

```typescript
// src/llm-orchestrator-tools.ts:89
// No changes needed - the binding already passes the full req object
```

- [ ] **Step 4: Run type check**

Run: `bun run typecheck`
Expected: PASS (no type errors)

- [ ] **Step 5: Commit**

```bash
git add src/tools/permission-gate.ts
git commit -m "feat(tools): add args to AskPermissionFn type"
```

---

### Task 2: Add Argument Formatting Functions

**Files:**

- Modify: `src/chat/permission-prompt.ts`

- [ ] **Step 1: Add `isPlainObject` helper**

```typescript
// src/chat/permission-prompt.ts (after line 11)
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
```

- [ ] **Step 2: Add `flattenArguments` function**

```typescript
// src/chat/permission-prompt.ts (after isPlainObject)
function flattenArguments(obj: Record<string, unknown>, prefix = '', depth = 0): [string, unknown][] {
  const result: [string, unknown][] = []
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value) && depth < 3) {
      result.push(...flattenArguments(value, fullKey, depth + 1))
    } else if (isPlainObject(value)) {
      result.push([fullKey, '[Object]'])
    } else {
      result.push([fullKey, value])
    }
  }
  return result
}
```

- [ ] **Step 3: Add `formatArray` function**

```typescript
// src/chat/permission-prompt.ts (after flattenArguments)
function formatArray(arr: unknown[]): string {
  return arr.map((item) => String(item)).join(', ')
}
```

- [ ] **Step 4: Add `isSensitiveFieldName` function**

```typescript
// src/chat/permission-prompt.ts (after formatArray)
function isSensitiveFieldName(name: string): boolean {
  return /api[_-]?key|token|password|secret|credential/i.test(name)
}
```

- [ ] **Step 5: Add `maskValue` function**

```typescript
// src/chat/permission-prompt.ts (after isSensitiveFieldName)
function maskValue(value: string): string {
  if (value.length <= 7) return '***'
  return value.slice(0, 3) + '...' + value.slice(-3)
}
```

- [ ] **Step 6: Add `maskSensitive` function**

```typescript
// src/chat/permission-prompt.ts (after maskValue)
function maskSensitive(value: string): string {
  if (/^(sk-|token-|password-|secret-|key-)/i.test(value)) {
    return value.slice(0, 4) + '...' + value.slice(-3)
  }
  return value
}
```

- [ ] **Step 7: Add `formatValue` function**

```typescript
// src/chat/permission-prompt.ts (after maskSensitive)
function formatValue(value: unknown, fieldName?: string): string {
  if (value === null || value === undefined) return '(empty)'
  if (Array.isArray(value)) return formatArray(value)
  if (typeof value === 'object') return JSON.stringify(value)
  const str = String(value)
  return fieldName && isSensitiveFieldName(fieldName) ? maskValue(str) : maskSensitive(str)
}
```

- [ ] **Step 8: Add `formatArguments` function**

```typescript
// src/chat/permission-prompt.ts (after formatValue)
function formatArguments(args: Record<string, unknown>): string {
  const entries = flattenArguments(args)
  if (entries.length === 0) return ''

  const lines = entries.map(([key, value]) => {
    const formatted = formatValue(value, key)
    return `${key}: ${formatted}`
  })

  return lines.join('\n')
}
```

- [ ] **Step 9: Run type check**

Run: `bun run typecheck`
Expected: PASS (no type errors)

- [ ] **Step 10: Commit**

```bash
git add src/chat/permission-prompt.ts
git commit -m "feat(chat): add argument formatting functions"
```

---

### Task 3: Update `formatPrompt` and `askPermissionViaChat`

**Files:**

- Modify: `src/chat/permission-prompt.ts:39-41`
- Modify: `src/chat/permission-prompt.ts:48-71`

- [ ] **Step 1: Update `formatPrompt` to accept and format args**

```typescript
// src/chat/permission-prompt.ts:39-41
// Before:
function formatPrompt(toolName: string, reason: string): string {
  return `🔐 Run \`${toolName}\`?\n\n${escapeMarkdown(reason)}`
}

// After:
function formatPrompt(toolName: string, reason: string, args: Record<string, unknown>): string {
  const argsSection = formatArguments(args)
  const parts = [`🔐 Run \`${toolName}\`?`]

  if (argsSection) {
    parts.push('')
    parts.push('**Arguments:**')
    parts.push(argsSection)
  }

  parts.push('')
  parts.push(escapeMarkdown(reason))

  return parts.join('\n')
}
```

- [ ] **Step 2: Update `askPermissionViaChat` signature**

```typescript
// src/chat/permission-prompt.ts:48-71
// Before:
export async function askPermissionViaChat(
  reply: ReplyFn,
  contextId: string,
  req: { toolName: string; reason: string },
): Promise<PermissionDecision>

// After:
export async function askPermissionViaChat(
  reply: ReplyFn,
  contextId: string,
  req: { toolName: string; reason: string; args: Record<string, unknown> },
): Promise<PermissionDecision>
```

- [ ] **Step 3: Update `askPermissionViaChat` to pass args to `formatPrompt`**

```typescript
// src/chat/permission-prompt.ts:54
// Before:
const body = formatPrompt(req.toolName, req.reason)

// After:
const body = formatPrompt(req.toolName, req.reason, req.args)
```

- [ ] **Step 4: Run type check**

Run: `bun run typecheck`
Expected: PASS (no type errors)

- [ ] **Step 5: Commit**

```bash
git add src/chat/permission-prompt.ts
git commit -m "feat(chat): update formatPrompt to include arguments"
```

---

### Task 4: Add Unit Tests for Argument Formatting

**Files:**

- Create: `tests/chat/permission-prompt.test.ts`

- [ ] **Step 1: Create test file with imports**

```typescript
// tests/chat/permission-prompt.test.ts
import { describe, expect, test } from 'bun:test'

import { formatArguments, formatPrompt } from '../../src/chat/permission-prompt.js'
```

- [ ] **Step 2: Add `formatArguments` tests**

```typescript
// tests/chat/permission-prompt.test.ts
describe('formatArguments', () => {
  test('formats flat object', () => {
    expect(formatArguments({ id: 'task-123', name: 'Test' })).toBe('id: task-123\nname: Test')
  })

  test('flattens nested objects', () => {
    expect(formatArguments({ assignee: { name: 'John' } })).toBe('assignee.name: John')
  })

  test('formats arrays as comma-separated', () => {
    expect(formatArguments({ tags: ['bug', 'urgent'] })).toBe('tags: bug, urgent')
  })

  test('masks sensitive values', () => {
    expect(formatArguments({ apiKey: 'sk-abc123def' })).toBe('apiKey: sk-...def')
  })

  test('masks sensitive field names', () => {
    expect(formatArguments({ token: 'abc123def456' })).toBe('token: abc...456')
  })

  test('handles empty args', () => {
    expect(formatArguments({})).toBe('')
  })

  test('flattens up to 3 levels, then shows [Object]', () => {
    const deep = { a: { b: { c: { d: 'value' } } } }
    expect(formatArguments(deep)).toBe('a.b.c.d: value')
  })

  test('shows [Object] for deeply nested objects beyond 3 levels', () => {
    const veryDeep = { a: { b: { c: { d: { e: 'value' } } } } }
    expect(formatArguments(veryDeep)).toBe('a.b.c.d: [Object]')
  })

  test('handles null values', () => {
    expect(formatArguments({ id: null })).toBe('id: (empty)')
  })

  test('handles undefined values', () => {
    expect(formatArguments({ id: undefined })).toBe('id: (empty)')
  })

  test('handles boolean values', () => {
    expect(formatArguments({ active: true })).toBe('active: true')
  })

  test('handles numeric values', () => {
    expect(formatArguments({ count: 42 })).toBe('count: 42')
  })
})
```

- [ ] **Step 3: Add `formatPrompt` tests**

```typescript
// tests/chat/permission-prompt.test.ts
describe('formatPrompt', () => {
  test('includes arguments before reason', () => {
    const result = formatPrompt('delete_task', 'cleanup', { id: 'task-123' })
    expect(result).toContain('**Arguments:**\nid: task-123')
    expect(result.indexOf('**Arguments:**')).toBeLessThan(result.indexOf('cleanup'))
  })

  test('skips arguments section when args empty', () => {
    const result = formatPrompt('delete_task', 'cleanup', {})
    expect(result).not.toContain('**Arguments:**')
    expect(result).toContain('🔐 Run `delete_task`?\n\ncleanup')
  })

  test('escapes markdown in reason', () => {
    const result = formatPrompt('delete_task', 'cleanup *task*', { id: 'task-123' })
    expect(result).toContain('cleanup \\*task\\*')
  })
})
```

- [ ] **Step 4: Export `formatArguments` and `formatPrompt` for testing**

```typescript
// src/chat/permission-prompt.ts
// Change formatArguments from:
function formatArguments(args: Record<string, unknown>): string {
// To:
export function formatArguments(args: Record<string, unknown>): string {

// Change formatPrompt from:
function formatPrompt(toolName: string, reason: string, args: Record<string, unknown>): string {
// To:
export function formatPrompt(toolName: string, reason: string, args: Record<string, unknown>): string {
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/chat/permission-prompt.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/chat/permission-prompt.test.ts src/chat/permission-prompt.ts
git commit -m "test(chat): add unit tests for argument formatting"
```

---

### Task 5: Update Existing Permission Gate Tests

**Files:**

- Modify: `tests/tools/permission-gate.test.ts`

- [ ] **Step 1: Update `fakeExecute` to include args**

```typescript
// tests/tools/permission-gate.test.ts:90-93
// Before:
function fakeExecute(input: unknown, _opts: ToolExecutionOptions): Promise<string> {
  const rec = typeof input === 'object' && input !== null ? input : {}
  return Promise.resolve(`ran:${String(Object.entries(rec).find(([k]) => k === 'id')?.[1] ?? '')}`)
}

// After:
function fakeExecute(input: unknown, _opts: ToolExecutionOptions): Promise<string> {
  const rec = typeof input === 'object' && input !== null ? input : {}
  return Promise.resolve(`ran:${String(Object.entries(rec).find(([k]) => k === 'id')?.[1] ?? '')}`)
}
```

- [ ] **Step 2: Update test to verify `args` is passed**

```typescript
// tests/tools/permission-gate.test.ts:134-143
// Before:
test('passes toolName and reason to askPermission', async () => {
  let captured: { toolName: string; reason: string } | null = null
  const ask: AskPermissionFn = (req) => {
    captured = req
    return Promise.resolve('allow')
  }
  const gated = gatedExecute(fakeExecute, 'demo_tool', ask)
  await gated({ id: 'X', _permission_reason: 'cleanup' }, toolOpts)
  expect(captured).toMatchObject({ toolName: 'demo_tool', reason: 'cleanup' })
})

// After:
test('passes toolName, reason, and args to askPermission', async () => {
  let captured: { toolName: string; reason: string; args: Record<string, unknown> } | null = null
  const ask: AskPermissionFn = (req) => {
    captured = req
    return Promise.resolve('allow')
  }
  const gated = gatedExecute(fakeExecute, 'demo_tool', ask)
  await gated({ id: 'X', _permission_reason: 'cleanup' }, toolOpts)
  expect(captured).toMatchObject({ toolName: 'demo_tool', reason: 'cleanup', args: { id: 'X' } })
})
```

- [ ] **Step 3: Run tests**

Run: `bun test tests/tools/permission-gate.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/tools/permission-gate.test.ts
git commit -m "test(tools): update permission gate tests for args"
```

---

### Task 6: Update Interaction Router Tests

**Files:**

- Modify: `tests/chat/interaction-router.test.ts`

- [ ] **Step 1: Update `createPendingPermission` to include args**

```typescript
// tests/chat/interaction-router.test.ts:30-46
// Before:
async function createPendingPermission(contextId = 'tg:u1'): Promise<{ id: string; decision: Promise<string> }> {
  const calls: Array<{ options: { buttons?: Array<{ callbackData: string }> } }> = []
  const reply: ReplyFn = {
    text: () => Promise.resolve(),
    formatted: () => Promise.resolve(),
    typing: () => {},
    buttons: (_content: string, options: { buttons?: Array<{ callbackData: string }> }) => {
      calls.push({ options })
      return Promise.resolve()
    },
  }
  const decision = askPermissionViaChat(reply, contextId, { toolName: 'delete_task', reason: 'cleanup' })
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
  return { id: calls[0]!.options.buttons![0]!.callbackData.replace('perm:a:', ''), decision }
}

// After:
async function createPendingPermission(contextId = 'tg:u1'): Promise<{ id: string; decision: Promise<string> }> {
  const calls: Array<{ options: { buttons?: Array<{ callbackData: string }> } }> = []
  const reply: ReplyFn = {
    text: () => Promise.resolve(),
    formatted: () => Promise.resolve(),
    typing: () => {},
    buttons: (_content: string, options: { buttons?: Array<{ callbackData: string }> }) => {
      calls.push({ options })
      return Promise.resolve()
    },
  }
  const decision = askPermissionViaChat(reply, contextId, {
    toolName: 'delete_task',
    reason: 'cleanup',
    args: { id: 'task-123' },
  })
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
  return { id: calls[0]!.options.buttons![0]!.callbackData.replace('perm:a:', ''), decision }
}
```

- [ ] **Step 2: Run tests**

Run: `bun test tests/chat/interaction-router.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/chat/interaction-router.test.ts
git commit -m "test(chat): update interaction router tests for args"
```

---

### Task 7: Run Full Test Suite

**Files:**

- None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `bun run test`
Expected: PASS (all tests)

- [ ] **Step 2: Run type check**

Run: `bun run typecheck`
Expected: PASS (no type errors)

- [ ] **Step 3: Run format check**

Run: `bun run format:check`
Expected: PASS (all files formatted)

- [ ] **Step 4: Run lint check**

Run: `bun run lint`
Expected: PASS (no lint errors)

---

## Verification

After implementation, verify:

1. Permission prompt shows arguments before the LLM's reason
2. Nested objects are flattened (e.g., `assignee.name: John`)
3. Arrays are comma-separated (e.g., `tags: bug, urgent`)
4. Sensitive fields are masked (e.g., `apiKey: sk-...def`)
5. Empty args skip the arguments section
6. All tests pass
7. No type errors
8. No lint errors
