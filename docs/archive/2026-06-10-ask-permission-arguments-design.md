<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Ask Permission Arguments Design

## Problem Statement

When a tool has `ask` permission configured, the permission prompt shows only the tool name and an LLM-provided reason:

```
🔐 Run `delete_task`?

Need to clean up completed tasks
```

Users cannot see which specific arguments (e.g., task ID, project name) will be used, making it impossible to make informed permission decisions.

## Goals

1. Show tool arguments in the permission prompt so users can make informed decisions
2. Display arguments as a simple key-value list
3. Flatten nested objects (e.g., `assignee.name: "John"`)
4. Show arrays as comma-separated lists
5. Truncate long values to fit chat message limits
6. Mask known sensitive fields (API keys, tokens, passwords)
7. Position arguments before the LLM's reason

## Non-Goals

- Allowing users to modify arguments before approving (future enhancement)
- Exhaustive sensitive data detection (simple pattern matching only)
- Support for Kontur Talk buttons (platform limitation, degrades to text)

## Design

### Approach: Modify `gatedExecute` to Pass Arguments

Extend the `AskPermissionFn` type to include arguments, then format them in the permission prompt.

### Data Flow

```
gatedExecute(input)
  → extractReason(input)
  → askPermission({ toolName, reason, args: cleaned })
      ↓
    formatPrompt(toolName, reason, args)
      ↓
    reply.buttons("🔐 Run `tool`?\n\n**Arguments:**\nkey: value\n...\n\nreason")
```

### Type Changes

**`src/tools/permission-gate.ts`:**

```typescript
// Before
export type AskPermissionFn = (req: { toolName: string; reason: string }) => Promise<'allow' | 'deny'>

// After
export type AskPermissionFn = (req: {
  toolName: string
  reason: string
  args: Record<string, unknown>
}) => Promise<'allow' | 'deny'>
```

**`src/chat/permission-prompt.ts`:**

```typescript
// Before
export async function askPermissionViaChat(
  reply: ReplyFn,
  contextId: string,
  req: { toolName: string; reason: string },
): Promise<PermissionDecision>

// After
export async function askPermissionViaChat(
  reply: ReplyFn,
  contextId: string,
  req: { toolName: string; reason: string; args: Record<string, unknown> },
): Promise<PermissionDecision>
```

### Argument Formatting

**New function in `src/chat/permission-prompt.ts`:**

```typescript
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

**Helper functions:**

```typescript
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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

function formatValue(value: unknown, fieldName?: string): string {
  if (value === null || value === undefined) return '(empty)'
  if (Array.isArray(value)) return formatArray(value)
  if (typeof value === 'object') return JSON.stringify(value)
  const str = String(value)
  return fieldName && isSensitiveFieldName(fieldName) ? maskValue(str) : maskSensitive(str)
}

function isSensitiveFieldName(name: string): boolean {
  return /api[_-]?key|token|password|secret|credential/i.test(name)
}

function maskValue(value: string): string {
  if (value.length <= 7) return '***'
  return value.slice(0, 3) + '...' + value.slice(-3)
}

function formatArray(arr: unknown[]): string {
  return arr.map((item) => String(item)).join(', ')
}

function maskSensitive(value: string): string {
  if (/^(sk-|token-|password-|secret-|key-)/i.test(value)) {
    return value.slice(0, 4) + '...' + value.slice(-3)
  }
  return value
}
```

### Prompt Format

**Before:**

```
🔐 Run `delete_task`?

Need to clean up completed tasks
```

**After:**

```
🔐 Run `delete_task`?

**Arguments:**
id: task-123
project.id: proj-456
assignee.name: John Doe
tags: bug, urgent

Need to clean up completed tasks
```

### Integration Changes

**`gatedExecute` in `src/tools/permission-gate.ts`:**

```typescript
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

**`formatPrompt` in `src/chat/permission-prompt.ts`:**

```typescript
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

## Error Handling

### Graceful Degradation

- **Missing arguments:** Skip "Arguments:" section entirely
- **Malformed arguments:** Treat as empty, never throw
- **Platform message length limits:** Truncate if total prompt exceeds ~1500 characters

### Sensitive Field Detection

**Known patterns to mask:**

- Values starting with `sk-`, `token-`, `password-`, `secret-`, `key-`
- Fields named `apiKey`, `token`, `password`, `secret`, `credential`

### Edge Cases

- **Null/undefined values:** Show as `(empty)`
- **Boolean values:** Show as `true`/`false`
- **Numeric values:** Show as-is
- **Deeply nested objects:** Flatten up to 3 levels, then show as `[Object]`
- **Circular references:** Not possible (input is JSON-serializable from LLM)

## Testing Strategy

### Unit Tests

**`tests/chat/permission-prompt.test.ts`:**

- Test `formatArguments` with flat objects
- Test `flattenArguments` with nested objects
- Test `formatArray` with various array types
- Test `maskSensitive` with known patterns
- Test `formatPrompt` includes arguments section

**`tests/tools/permission-gate.test.ts`:**

- Update existing tests to include `args` in captured request
- Verify `args` contains cleaned input (without `_permission_reason`)

### Test Cases

```typescript
// formatArguments
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

// formatPrompt
test('includes arguments before reason', () => {
  const result = formatPrompt('delete_task', 'cleanup', { id: 'task-123' })
  expect(result).toContain('**Arguments:**\nid: task-123')
  expect(result.indexOf('**Arguments:**')).toBeLessThan(result.indexOf('cleanup'))
})
```

## Migration & Backward Compatibility

### Breaking Change Analysis

**`AskPermissionFn` type change:**

- Internal only - not part of public API
- All call sites are in `src/` (3 locations):
  1. `src/tools/permission-gate.ts` (definition + usage)
  2. `src/chat/permission-prompt.ts` (implementation)
  3. `src/llm-orchestrator-tools.ts` (binding)

### Migration Steps

1. Update type definition in `src/tools/permission-gate.ts`
2. Update `gatedExecute` to pass `args`
3. Update `askPermissionViaChat` signature
4. Update `formatPrompt` to accept and format args
5. Add `formatArguments` and helpers
6. Update tests to match new signatures

### Backward Compatibility

- No database migration needed
- No configuration changes needed
- No user-facing changes to settings UI
- Existing tool permissions continue to work
- The only visible change is the enhanced prompt format

## Files to Modify

1. `src/tools/permission-gate.ts` - Update `AskPermissionFn` type and `gatedExecute`
2. `src/chat/permission-prompt.ts` - Add `formatArguments`, update `formatPrompt` and `askPermissionViaChat`
3. `tests/tools/permission-gate.test.ts` - Update tests for new signature
4. `tests/chat/interaction-router.test.ts` - Update tests for new prompt format

## Open Questions

None - all design decisions have been made.
