<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tool Call Code Block Output Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change tool call visibility output from inline backtick formatting to fenced code blocks, with each tool call sent as a separate message.

**Architecture:** Modify `ai-progress-reporter.ts` to store per-tool-call formatted messages instead of flat lines, then send each as a separate `reply.formatted()` call during flush. Remove the "AI execution details" / "Tool calls" wrapper headers.

**Tech Stack:** TypeScript, Bun test runner

---

## File Map

| File                                 | Change                                       |
| ------------------------------------ | -------------------------------------------- |
| `src/ai-progress-reporter.ts`        | Rewrite formatting functions and flush logic |
| `tests/ai-progress-reporter.test.ts` | Update assertions for new format             |

---

## Current Format (what we're replacing)

```
AI execution details

Tool calls
- Tool `create_task` success in 42ms
  Input: `{"title": "Fix bug"}`
  Output: `{"id": "TASK-123", "title": "Fix bug"}`
- Tool `search_tasks` success in 200ms
  Input: `{"query": "bug"}`
  Output: `[{"id": "TASK-123"}]`

Reasoning
Provider reasoning available (1234 characters). Enable raw detail to view.
```

## New Format

Each tool call as a separate message:

**Message 1:**

````
Tool `create_task` success in 42ms

Input:
```json
{"title": "Fix bug"}
````

Output:

```json
{ "id": "TASK-123", "title": "Fix bug" }
```

```

**Message 2:**
```

Tool `search_tasks` success in 200ms

Input:

```json
{ "query": "bug" }
```

Output:

```json
[{ "id": "TASK-123" }]
```

```

**Message 3 (reasoning, if enabled):**
```

Reasoning

```json
"Provider reasoning available (1234 characters). Enable raw detail to view."
```

````

---

### Task 1: Rewrite formatting functions

**Files:**
- Modify: `src/ai-progress-reporter.ts:116-132`

- [ ] **Step 1: Replace `appendToolFinished` with `formatToolFinishedMessage`**

Change the function to return a complete formatted message string instead of appending to a lines array.

Replace lines 116-123 with:

```typescript
function formatToolFinishedMessage(event: ToolFinishedEvent, settings: AiOutputSettings): string {
  const status = event.success ? 'success' : 'failed'
  const duration = event.durationMs === undefined ? '' : ` in ${event.durationMs}ms`
  const lines = [`Tool \`${event.toolName}\` ${status}${duration}`, '']
  lines.push('Input:', formatCodeBlock(event.input, settings))
  if (event.output !== undefined) {
    lines.push('', 'Output:', formatCodeBlock(event.output, settings))
  }
  if (event.error !== undefined) {
    lines.push('', 'Error:', formatCodeBlock(event.error, settings))
  }
  return lines.join('\n')
}
````

- [ ] **Step 2: Replace `formatToolStarted` with `formatToolStartedMessage`**

Replace lines 125-127 with:

```typescript
function formatToolStartedMessage(event: ToolStartedEvent, settings: AiOutputSettings): string {
  const lines = [`Tool \`${event.toolName}\` started`, '']
  lines.push('Input:', formatCodeBlock(event.input, settings))
  return lines.join('\n')
}
```

- [ ] **Step 3: Add `formatCodeBlock` helper**

Add after the `formatErrorValue` function (after line 114):

````typescript
function formatCodeBlock(value: unknown, settings: AiOutputSettings): string {
  const formatted = formatValue(value, settings)
  return '```json\n' + formatted + '\n```'
}
````

- [ ] **Step 4: Update `formatReasoningText` to return a fenced code block message**

Replace lines 129-132:

````typescript
function formatReasoningMessage(text: string, settings: AiOutputSettings): string {
  const content =
    settings.detailLevel === 'raw'
      ? text.trim()
      : `Provider reasoning available (${text.trim().length} characters). Enable raw detail to view.`
  return 'Reasoning\n\n```json\n' + JSON.stringify(content) + '\n```'
}
````

- [ ] **Step 5: Run the test to verify it fails with the old assertions**

Run: `bun test tests/ai-progress-reporter.test.ts`
Expected: Tests fail because the format changed.

---

### Task 2: Rewrite flush logic to send separate messages

**Files:**

- Modify: `src/ai-progress-reporter.ts:134-173`

- [ ] **Step 1: Change data model from flat lines to per-tool messages**

Replace the reporter creation function. Change `toolLines: string[]` to `toolMessages: string[]` and `reasoningLines: string[]` to `reasoningMessages: string[]`:

````typescript
export function createAiProgressReporter(reply: ReplyFn, settings: AiOutputSettings): AiProgressReporter {
  const pendingToolStarts = new Map<string, ToolStartedEvent>()
  const toolMessages: string[] = []
  const reasoningMessages: string[] = []

  return {
    toolStarted: (event) => {
      if (settings.toolVisibility !== 'on') return
      pendingToolStarts.set(event.toolCallId, event)
    },
    toolFinished: (event) => {
      if (settings.toolVisibility !== 'on') return
      pendingToolStarts.delete(event.toolCallId)
      toolMessages.push(formatToolFinishedMessage(event, settings))
    },
    reasoning: (...args) => {
      const [text, raw] = args
      if (settings.reasoningVisibility !== 'on') return
      if (settings.detailLevel === 'raw' && raw !== undefined) {
        reasoningMessages.push('Reasoning\n\n```json\n' + formatValue(raw, settings) + '\n```')
        return
      }
      if (text === undefined || text.trim() === '') return
      reasoningMessages.push(formatReasoningMessage(text, settings))
    },
    flush: async () => {
      const startedMessages = Array.from(pendingToolStarts.values()).map((event) =>
        formatToolStartedMessage(event, settings),
      )
      const allMessages = [...startedMessages, ...toolMessages, ...reasoningMessages]
      if (allMessages.length === 0) return
      for (const message of allMessages) {
        await reply.formatted(message)
      }
      pendingToolStarts.clear()
      toolMessages.length = 0
      reasoningMessages.length = 0
    },
  }
}
````

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/ai-progress-reporter.test.ts`
Expected: Tests fail because format changed.

---

### Task 3: Update tests for new format

**Files:**

- Modify: `tests/ai-progress-reporter.test.ts`

- [ ] **Step 1: Update 'does not emit anything when all visibility is off' test**

This test should still pass unchanged — no output when visibility is off.

- [ ] **Step 2: Update 'flushes sanitized tool details without secrets' test**

Replace the assertions to match the new format:

````typescript
test('flushes sanitized tool details without secrets', async () => {
  const { reply, textCalls } = createMockReply()
  const reporter = createAiProgressReporter(reply, toolSettings)

  reporter.toolStarted({
    toolName: 'create_task',
    toolCallId: 'call-1',
    input: { title: 'Visible title', apiKey: 'secret-key' },
  })
  reporter.toolFinished({
    toolName: 'create_task',
    toolCallId: 'call-1',
    input: { title: 'Visible title', apiKey: 'secret-key' },
    durationMs: 42,
    success: true,
    output: { id: 'T-1', token: 'secret-token' },
  })
  await reporter.flush()

  expect(textCalls).toHaveLength(1)
  expect(textCalls[0]).toContain('Tool `create_task` success in 42ms')
  expect(textCalls[0]).toContain('Visible title')
  expect(textCalls[0]).toContain('```json')
  expect(textCalls[0]).not.toContain('AI execution details')
  expect(textCalls[0]).not.toContain('started')
  expect(textCalls[0]).not.toContain('secret-key')
  expect(textCalls[0]).not.toContain('secret-token')
  expect(textCalls[0]).toContain('[redacted]')
})
````

- [ ] **Step 3: Update 'redacts sanitized Error messages that contain secret-like text' test**

````typescript
test('redacts sanitized Error messages that contain secret-like text', async () => {
  const { reply, textCalls } = createMockReply()
  const reporter = createAiProgressReporter(reply, toolSettings)

  reporter.toolFinished({
    toolName: 'create_task',
    toolCallId: 'call-error-message',
    input: { title: 'Visible title' },
    durationMs: 5,
    success: false,
    error: new Error('token=secret-token'),
  })
  await reporter.flush()

  expect(textCalls).toHaveLength(1)
  expect(textCalls[0]).toContain('failed')
  expect(textCalls[0]).toContain('```json')
  expect(textCalls[0]).not.toContain('secret-token')
  expect(textCalls[0]).toContain('[redacted]')
})
````

- [ ] **Step 4: Update 'redacts sanitized object error secret keys' test**

````typescript
test('redacts sanitized object error secret keys', async () => {
  const { reply, textCalls } = createMockReply()
  const reporter = createAiProgressReporter(reply, toolSettings)

  reporter.toolFinished({
    toolName: 'create_task',
    toolCallId: 'call-error-object',
    input: { title: 'Visible title' },
    durationMs: 6,
    success: false,
    error: { token: 'secret-token', message: 'Visible failure metadata' },
  })
  await reporter.flush()

  expect(textCalls).toHaveLength(1)
  expect(textCalls[0]).toContain('Visible failure metadata')
  expect(textCalls[0]).toContain('```json')
  expect(textCalls[0]).not.toContain('secret-token')
  expect(textCalls[0]).toContain('[redacted]')
})
````

- [ ] **Step 5: Update 'redacts sanitized object error message values with secret-like text' test**

````typescript
test('redacts sanitized object error message values with secret-like text', async () => {
  const { reply, textCalls } = createMockReply()
  const reporter = createAiProgressReporter(reply, toolSettings)

  reporter.toolFinished({
    toolName: 'create_task',
    toolCallId: 'call-error-message-value',
    input: { title: 'Visible title' },
    durationMs: 8,
    success: false,
    error: { message: 'token=secret-token' },
  })
  await reporter.flush()

  expect(textCalls).toHaveLength(1)
  expect(textCalls[0]).toContain('failed')
  expect(textCalls[0]).toContain('```json')
  expect(textCalls[0]).not.toContain('secret-token')
  expect(textCalls[0]).toContain('[redacted]')
})
````

- [ ] **Step 6: Update 'flushes sanitized circular objects and arrays with a safe marker' test**

```typescript
test('flushes sanitized circular objects and arrays with a safe marker', async () => {
  const { reply, textCalls } = createMockReply()
  const circularObject: Record<string, unknown> = { title: 'Circular title' }
  const circularArray: unknown[] = ['visible item']
  circularObject['self'] = circularObject
  circularArray[1] = circularArray
  const reporter = createAiProgressReporter(reply, toolSettings)

  reporter.toolFinished({
    toolName: 'create_task',
    toolCallId: 'call-circular',
    input: { title: 'Visible title', circularObject, circularArray },
    durationMs: 12,
    success: true,
  })
  await reporter.flush()

  expect(textCalls).toHaveLength(1)
  expect(textCalls[0]).toContain('Visible title')
  expect(textCalls[0]).toContain('Circular title')
  expect(textCalls[0]).toContain('visible item')
  expect(textCalls[0]).toContain('[circular]')
})
```

- [ ] **Step 7: Update 'redacts sanitized URL and attachment content fields' test**

````typescript
test('redacts sanitized URL and attachment content fields while preserving normal text', async () => {
  const { reply, textCalls } = createMockReply()
  const reporter = createAiProgressReporter(reply, toolSettings)

  reporter.toolFinished({
    toolName: 'upload_attachment',
    toolCallId: 'call-redact-content',
    input: {
      title: 'Visible title',
      query: 'Visible query',
      url: 'https://example.invalid/private?token=secret',
      rawUrl: 'https://example.invalid/raw',
      attachment: { filename: 'private.txt' },
      fileContent: 'private file bytes',
      content: 'private body text',
    },
    durationMs: 15,
    success: true,
    output: { attachments: [{ id: 'file-1', content: 'private output text' }] },
  })
  await reporter.flush()

  expect(textCalls).toHaveLength(1)
  expect(textCalls[0]).toContain('Visible title')
  expect(textCalls[0]).toContain('Visible query')
  expect(textCalls[0]).toContain('```json')
  expect(textCalls[0]).not.toContain('example.invalid')
  expect(textCalls[0]).not.toContain('private.txt')
  expect(textCalls[0]).not.toContain('private file bytes')
  expect(textCalls[0]).not.toContain('private body text')
  expect(textCalls[0]).not.toContain('private output text')
  expect(textCalls[0]).toContain('[redacted]')
})
````

- [ ] **Step 8: Update 'raw detail level includes raw tool input and output' test**

````typescript
test('raw detail level includes raw tool input and output', async () => {
  const { reply, textCalls } = createMockReply()
  const reporter = createAiProgressReporter(reply, {
    toolVisibility: 'on',
    reasoningVisibility: 'off',
    detailLevel: 'raw',
  })

  reporter.toolFinished({
    toolName: 'search_tasks',
    toolCallId: 'call-2',
    input: { query: 'secret query' },
    durationMs: 7,
    success: true,
    output: { result: 'secret result' },
  })
  await reporter.flush()

  expect(textCalls).toHaveLength(1)
  expect(textCalls[0]).toContain('secret query')
  expect(textCalls[0]).toContain('secret result')
  expect(textCalls[0]).toContain('```json')
})
````

- [ ] **Step 9: Update 'emits sanitized reasoning availability' test**

````typescript
test('emits sanitized reasoning availability without provider reasoning text', async () => {
  const { reply, textCalls } = createMockReply()
  const reporter = createAiProgressReporter(reply, {
    toolVisibility: 'off',
    reasoningVisibility: 'on',
    detailLevel: 'sanitized',
  })

  reporter.reasoning('Provider copied task title, user content, and attachment text into reasoning')
  await reporter.flush()

  expect(textCalls).toHaveLength(1)
  expect(textCalls[0]).toContain('Reasoning')
  expect(textCalls[0]).toContain('Provider reasoning available')
  expect(textCalls[0]).toContain('Enable raw detail to view')
  expect(textCalls[0]).toContain('```json')
  expect(textCalls[0]).not.toContain('copied task title')
  expect(textCalls[0]).not.toContain('user content')
  expect(textCalls[0]).not.toContain('attachment text')
})
````

- [ ] **Step 10: Update 'does not emit sanitized reasoning secret-like text or URLs' test**

````typescript
test('does not emit sanitized reasoning secret-like text or URLs', async () => {
  const { reply, textCalls } = createMockReply()
  const reporter = createAiProgressReporter(reply, {
    toolVisibility: 'off',
    reasoningVisibility: 'on',
    detailLevel: 'sanitized',
  })

  reporter.reasoning('Provider considered token=secret-token from https://private.example/path')
  await reporter.flush()

  expect(textCalls).toHaveLength(1)
  expect(textCalls[0]).toContain('Reasoning')
  expect(textCalls[0]).toContain('Provider reasoning available')
  expect(textCalls[0]).toContain('```json')
  expect(textCalls[0]).not.toContain('secret-token')
  expect(textCalls[0]).not.toContain('https://private.example/path')
})
````

- [ ] **Step 11: Update 'flushes a started tool when no finish arrives' test**

````typescript
test('flushes a started tool when no finish arrives', async () => {
  const { reply, textCalls } = createMockReply()
  const reporter = createAiProgressReporter(reply, toolSettings)

  reporter.toolStarted({
    toolName: 'search_tasks',
    toolCallId: 'call-start-only',
    input: { query: 'Visible query' },
  })
  await reporter.flush()

  expect(textCalls).toHaveLength(1)
  expect(textCalls[0]).toContain('search_tasks')
  expect(textCalls[0]).toContain('started')
  expect(textCalls[0]).toContain('Visible query')
  expect(textCalls[0]).toContain('```json')
})
````

- [ ] **Step 12: Update 'does not duplicate a started tool when the same call finishes' test**

````typescript
test('does not duplicate a started tool when the same call finishes', async () => {
  const { reply, textCalls } = createMockReply()
  const reporter = createAiProgressReporter(reply, toolSettings)

  reporter.toolStarted({
    toolName: 'search_tasks',
    toolCallId: 'call-start-finish',
    input: { query: 'Visible query' },
  })
  reporter.toolFinished({
    toolName: 'search_tasks',
    toolCallId: 'call-start-finish',
    input: { query: 'Visible query' },
    durationMs: 9,
    success: true,
    output: { count: 1 },
  })
  await reporter.flush()

  expect(textCalls).toHaveLength(1)
  expect(textCalls[0]).toContain('success in 9ms')
  expect(textCalls[0]).not.toContain('started')
  expect(textCalls[0]).toContain('```json')
})
````

- [ ] **Step 13: Update 'raw detail level uses raw provider reasoning' tests**

Update both raw reasoning tests to expect ` ```json ` fenced blocks instead of plain text.

- [ ] **Step 14: Update 'does not emit an empty reasoning section' test**

This test should still pass unchanged — no output when reasoning is empty.

- [ ] **Step 15: Add test for multiple tool calls as separate messages**

````typescript
test('sends multiple tool calls as separate messages', async () => {
  const { reply, textCalls } = createMockReply()
  const reporter = createAiProgressReporter(reply, toolSettings)

  reporter.toolFinished({
    toolName: 'create_task',
    toolCallId: 'call-1',
    input: { title: 'Task 1' },
    durationMs: 10,
    success: true,
    output: { id: 'T-1' },
  })
  reporter.toolFinished({
    toolName: 'search_tasks',
    toolCallId: 'call-2',
    input: { query: 'test' },
    durationMs: 20,
    success: true,
    output: [{ id: 'T-1' }],
  })
  await reporter.flush()

  expect(textCalls).toHaveLength(2)
  expect(textCalls[0]).toContain('create_task')
  expect(textCalls[0]).toContain('```json')
  expect(textCalls[1]).toContain('search_tasks')
  expect(textCalls[1]).toContain('```json')
})
````

- [ ] **Step 16: Run all tests to verify they pass**

Run: `bun test tests/ai-progress-reporter.test.ts`
Expected: All tests pass.

---

### Task 4: Run lint and typecheck

- [ ] **Step 1: Run typecheck**

Run: `bun typecheck`
Expected: No errors.

- [ ] **Step 2: Run lint**

Run: `bun lint`
Expected: No errors.

- [ ] **Step 3: Run full test suite**

Run: `bun run test`
Expected: All tests pass.
