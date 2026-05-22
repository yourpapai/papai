<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# LLM Trace Detail Modal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a detailed modal view for LLM traces showing all available data when clicking on a trace row.

**Architecture:** Follow the existing session modal pattern - add HTML modal structure, create trace-detail.ts module with render functions, wire up click handlers in index.ts, update state types to capture full LLM response data.

**Tech Stack:** TypeScript, Zod schemas, vanilla DOM manipulation, CSS

---

## Task 1: Add Trace Modal HTML

**Files:**

- Modify: `src/debug/dashboard.html:75-84` (after log modal)

**Step 1: Add trace modal HTML**

Add after the log modal (line 84):

```html
<!-- Trace Detail Modal -->
<div id="trace-modal" class="modal" hidden>
  <div class="modal-content">
    <div class="modal-header">
      <h3 id="trace-modal-title">LLM Trace Details</h3>
      <button id="trace-modal-close" class="modal-close">&times;</button>
    </div>
    <div id="trace-modal-body" class="modal-body"></div>
  </div>
</div>
```

**Step 2: Verify HTML structure**

Run: `cat src/debug/dashboard.html | grep -A5 "Trace Detail Modal"`
Expected: Shows the trace modal div

**Step 3: Commit**

```bash
git add src/debug/dashboard.html
git commit -m "feat(debug): add trace detail modal HTML structure"
```

---

## Task 2: Update LlmTrace Type with Full Data

**Files:**

- Modify: `src/debug/state-collector.ts:22-31`

**Step 1: Update LlmTrace type**

Replace the LlmTrace type with expanded version:

```typescript
type LlmTrace = {
  timestamp: number
  userId: string
  model: string
  steps: number
  totalTokens: { inputTokens: number; outputTokens: number }
  duration: number
  toolCalls: Array<{
    toolName: string
    durationMs: number
    success: boolean
    toolCallId?: string
    args?: unknown
    result?: unknown
    error?: string
  }>
  error?: string
  // Additional fields
  responseId?: string
  actualModel?: string
  finishReason?: string
  messageCount?: number
  toolCount?: number
  generatedText?: string
  stepsDetail?: Array<{
    stepNumber: number
    toolCalls?: Array<{
      toolName: string
      toolCallId: string
      args: unknown
    }>
    response?: unknown
    usage?: { inputTokens: number; outputTokens: number }
  }>
}
```

**Step 2: Update handleLlmToolResult to capture more data**

Modify lines 138-149 to capture args and result:

```typescript
function handleLlmToolResult(event: DebugEvent, userId: string): void {
  const pending = pendingTraces.get(userId)
  if (pending !== undefined) {
    pending.toolCalls.push({
      toolName: str(event.data['toolName']),
      durationMs: num(event.data['durationMs']),
      success: bool(event.data['success']),
      toolCallId: str(event.data['toolCallId']),
      args: event.data['args'],
      result: event.data['result'],
      error: str(event.data['error']),
    })
  }
  stats.totalToolCalls++
  scheduleStatsBroadcast()
}
```

**Step 3: Update handleLlmEnd to capture more data**

Modify lines 151-167:

```typescript
function handleLlmEnd(event: DebugEvent, userId: string): void {
  const pending = pendingTraces.get(userId)
  pendingTraces.delete(userId)
  const trace: LlmTrace = {
    timestamp: event.timestamp,
    userId,
    model: pending?.model ?? str(event.data['model']),
    steps: num(event.data['steps']),
    totalTokens: tokenUsage(event.data['tokenUsage']),
    duration: num(event.data['totalDuration']),
    toolCalls: pending?.toolCalls ?? [],
    responseId: str(event.data['responseId']),
    actualModel: str(event.data['actualModel']),
    finishReason: str(event.data['finishReason']),
    messageCount: num(event.data['messageCount']),
    toolCount: num(event.data['toolCount']),
    generatedText: str(event.data['generatedText']),
    stepsDetail: Array.isArray(event.data['stepsDetail'])
      ? event.data['stepsDetail'].map((s: unknown) => ({
          stepNumber: num((s as Record<string, unknown>)['stepNumber']),
          toolCalls: Array.isArray((s as Record<string, unknown>)['toolCalls'])
            ? (s as Record<string, unknown>)['toolCalls']
            : undefined,
          response: (s as Record<string, unknown>)['response'],
          usage: tokenUsage((s as Record<string, unknown>)['usage']),
        }))
      : undefined,
  }
  pushTrace(trace)
  stats.totalLlmCalls++
  scheduleStatsBroadcast()
  broadcastTrace(trace, event.timestamp)
}
```

**Step 4: Run tests**

Run: `bun test tests/debug/state-collector.test.ts`
Expected: Tests pass

**Step 5: Commit**

```bash
git add src/debug/state-collector.ts
git commit -m "feat(debug): extend LlmTrace type with full response data"
```

---

## Task 3: Update Schemas for Validation

**Files:**

- Modify: `src/debug/schemas.ts:67-76` (LlmTraceSchema)

**Step 1: Update LlmTraceSchema**

Replace lines 67-76 with:

```typescript
export const ToolCallDetailSchema = z.object({
  toolName: z.string(),
  durationMs: z.number(),
  success: z.boolean(),
  toolCallId: z.string().optional(),
  args: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
})

export const StepDetailSchema = z.object({
  stepNumber: z.number(),
  toolCalls: z
    .array(
      z.object({
        toolName: z.string(),
        toolCallId: z.string(),
        args: z.unknown(),
      }),
    )
    .optional(),
  response: z.unknown().optional(),
  usage: TokenInfoSchema.optional(),
})

export const LlmTraceSchema = z.object({
  timestamp: z.union([z.string(), z.number()]),
  userId: z.string(),
  model: z.string(),
  duration: z.number(),
  steps: z.number(),
  totalTokens: TokenInfoSchema,
  toolCalls: z.array(ToolCallDetailSchema).optional(),
  error: z.string().optional(),
  responseId: z.string().optional(),
  actualModel: z.string().optional(),
  finishReason: z.string().optional(),
  messageCount: z.number().optional(),
  toolCount: z.number().optional(),
  generatedText: z.string().optional(),
  stepsDetail: z.array(StepDetailSchema).optional(),
})
```

**Step 2: Export new types**

Add after line 148:

```typescript
export type ToolCallDetail = z.infer<typeof ToolCallDetailSchema>
export type StepDetail = z.infer<typeof StepDetailSchema>
```

**Step 3: Write test for new schemas**

Create: `tests/debug/schemas-llm-trace.test.ts`

```typescript
import { describe, expect, test } from 'bun:test'

import { LlmTraceSchema, ToolCallDetailSchema, StepDetailSchema, safeParseLlmTrace } from '../../src/debug/schemas.js'

describe('LlmTraceSchema with full data', () => {
  test('parses trace with complete data', () => {
    const trace = {
      timestamp: Date.now(),
      userId: 'user-123',
      model: 'gpt-4',
      duration: 2500,
      steps: 3,
      totalTokens: { inputTokens: 150, outputTokens: 250 },
      toolCalls: [
        {
          toolName: 'create_task',
          durationMs: 500,
          success: true,
          toolCallId: 'call-1',
          args: { title: 'Test task' },
          result: { id: 'task-123' },
        },
      ],
      responseId: 'resp-123',
      actualModel: 'gpt-4-0125-preview',
      finishReason: 'stop',
      messageCount: 5,
      toolCount: 10,
      generatedText: 'I created a task for you.',
      stepsDetail: [
        {
          stepNumber: 1,
          toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', args: {} }],
          usage: { inputTokens: 50, outputTokens: 80 },
        },
      ],
    }
    const result = safeParseLlmTrace(trace)
    expect(result).not.toBeNull()
    if (result !== null) {
      expect(result.responseId).toBe('resp-123')
      expect(result.generatedText).toBe('I created a task for you.')
      expect(result.stepsDetail).toHaveLength(1)
    }
  })

  test('parses minimal trace without optional fields', () => {
    const trace = {
      timestamp: Date.now(),
      userId: 'user-123',
      model: 'gpt-4',
      duration: 1000,
      steps: 1,
      totalTokens: { inputTokens: 100, outputTokens: 50 },
    }
    const result = safeParseLlmTrace(trace)
    expect(result).not.toBeNull()
  })
})

describe('ToolCallDetailSchema', () => {
  test('parses tool call with args and result', () => {
    const toolCall = {
      toolName: 'search_tasks',
      durationMs: 300,
      success: true,
      toolCallId: 'call-abc',
      args: { query: 'important' },
      result: [{ id: 'task-1' }],
    }
    const result = ToolCallDetailSchema.safeParse(toolCall)
    expect(result.success).toBe(true)
  })
})

describe('StepDetailSchema', () => {
  test('parses step with tool calls', () => {
    const step = {
      stepNumber: 1,
      toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', args: {} }],
      usage: { inputTokens: 50, outputTokens: 30 },
    }
    const result = StepDetailSchema.safeParse(step)
    expect(result.success).toBe(true)
  })
})
```

**Step 4: Run tests**

Run: `bun test tests/debug/schemas-llm-trace.test.ts`
Expected: 5 tests pass

**Step 5: Commit**

```bash
git add src/debug/schemas.ts tests/debug/schemas-llm-trace.test.ts
git commit -m "feat(debug): extend schemas for full LLM trace data"
```

---

## Task 4: Create Trace Detail Module

**Files:**

- Create: `src/debug/dashboard-ui/trace-detail.ts`

**Step 1: Write trace-detail.ts**

```typescript
import { escapeHtml, formatTime, formatTokens } from './helpers.js'
import type { LlmTrace } from '../schemas.js'

type TraceModalElements = {
  $traceModal: HTMLElement
  $traceModalTitle: HTMLElement
  $traceModalBody: HTMLElement
  $traceModalClose: HTMLElement
}

export function getTraceModalElements(): TraceModalElements {
  return {
    $traceModal: document.getElementById('trace-modal')!,
    $traceModalTitle: document.getElementById('trace-modal-title')!,
    $traceModalBody: document.getElementById('trace-modal-body')!,
    $traceModalClose: document.getElementById('trace-modal-close')!,
  }
}

function renderBasicInfo(trace: LlmTrace): string {
  const hasError = trace.error !== undefined && trace.error !== ''
  return `<div class="trace-detail-section">
    <h4>Basic Info</h4>
    <div class="trace-detail-grid">
      <div class="trace-detail-item"><div class="label">User ID</div><div class="value">${escapeHtml(trace.userId)}</div></div>
      <div class="trace-detail-item"><div class="label">Timestamp</div><div class="value">${formatTime(trace.timestamp)}</div></div>
      <div class="trace-detail-item"><div class="label">Model</div><div class="value">${escapeHtml(trace.model)}</div></div>
      ${trace.actualModel !== undefined ? `<div class="trace-detail-item"><div class="label">Actual Model</div><div class="value">${escapeHtml(trace.actualModel)}</div></div>` : ''}
      <div class="trace-detail-item"><div class="label">Duration</div><div class="value">${(trace.duration / 1000).toFixed(2)}s</div></div>
      <div class="trace-detail-item"><div class="label">Steps</div><div class="value">${trace.steps}</div></div>
      ${trace.finishReason !== undefined ? `<div class="trace-detail-item"><div class="label">Finish Reason</div><div class="value">${escapeHtml(trace.finishReason)}</div></div>` : ''}
      ${trace.responseId !== undefined ? `<div class="trace-detail-item"><div class="label">Response ID</div><div class="value">${escapeHtml(trace.responseId)}</div></div>` : ''}
      ${trace.messageCount !== undefined ? `<div class="trace-detail-item"><div class="label">Messages</div><div class="value">${trace.messageCount}</div></div>` : ''}
      ${trace.toolCount !== undefined ? `<div class="trace-detail-item"><div class="label">Tools Available</div><div class="value">${trace.toolCount}</div></div>` : ''}
      ${hasError ? `<div class="trace-detail-item"><div class="label">Error</div><div class="value error">${escapeHtml(trace.error!)}</div></div>` : ''}
    </div>
  </div>`
}

function renderTokenUsage(trace: LlmTrace): string {
  return `<div class="trace-detail-section">
    <h4>Token Usage</h4>
    <div class="trace-detail-grid">
      <div class="trace-detail-item"><div class="label">Input</div><div class="value">${formatTokens(trace.totalTokens.inputTokens)}</div></div>
      <div class="trace-detail-item"><div class="label">Output</div><div class="value">${formatTokens(trace.totalTokens.outputTokens)}</div></div>
      <div class="trace-detail-item"><div class="label">Total</div><div class="value">${formatTokens(trace.totalTokens.inputTokens + trace.totalTokens.outputTokens)}</div></div>
    </div>
  </div>`
}

function renderToolCalls(trace: LlmTrace): string {
  if (trace.toolCalls === undefined || trace.toolCalls.length === 0) return ''

  let items = ''
  for (const tc of trace.toolCalls) {
    const status = tc.success ? '✓ success' : '✗ failed'
    const statusClass = tc.success ? 'success' : 'error'
    let details = `<div class="tool-call-summary">
      <span class="tool-name">${escapeHtml(tc.toolName)}</span>
      <span class="tool-duration">${tc.durationMs}ms</span>
      <span class="tool-status ${statusClass}">${status}</span>
    </div>`

    if (tc.toolCallId !== undefined) {
      details += `<div class="tool-call-id">ID: ${escapeHtml(tc.toolCallId)}</div>`
    }

    if (tc.args !== undefined) {
      details += `<div class="tool-section"><div class="label">Arguments</div><pre class="tool-json">${escapeHtml(JSON.stringify(tc.args, null, 2))}</pre></div>`
    }

    if (tc.result !== undefined) {
      details += `<div class="tool-section"><div class="label">Result</div><pre class="tool-json">${escapeHtml(JSON.stringify(tc.result, null, 2))}</pre></div>`
    }

    if (tc.error !== undefined && tc.error !== '') {
      details += `<div class="tool-section"><div class="label">Error</div><pre class="tool-json error">${escapeHtml(tc.error)}</pre></div>`
    }

    items += `<div class="tool-call-item">${details}</div>`
  }

  return `<div class="trace-detail-section">
    <h4>Tool Calls (${trace.toolCalls.length})</h4>
    <div class="tool-calls-list">${items}</div>
  </div>`
}

function renderStepsDetail(trace: LlmTrace): string {
  if (trace.stepsDetail === undefined || trace.stepsDetail.length === 0) return ''

  let items = ''
  for (const step of trace.stepsDetail) {
    let stepHtml = `<div class="step-item">
      <div class="step-header">Step ${step.stepNumber}</div>`

    if (step.toolCalls !== undefined && step.toolCalls.length > 0) {
      stepHtml += '<div class="step-tool-calls">'
      for (const tc of step.toolCalls) {
        stepHtml += `<div class="step-tool-call">
          <span class="tool-name">${escapeHtml(tc.toolName)}</span>
          <span class="tool-id">${escapeHtml(tc.toolCallId)}</span>
        </div>`
        if (tc.args !== undefined) {
          stepHtml += `<pre class="tool-json">${escapeHtml(JSON.stringify(tc.args, null, 2))}</pre>`
        }
      }
      stepHtml += '</div>'
    }

    if (step.usage !== undefined) {
      stepHtml += `<div class="step-usage">
        Tokens: ${formatTokens(step.usage.inputTokens)} in / ${formatTokens(step.usage.outputTokens)} out
      </div>`
    }

    stepHtml += '</div>'
    items += stepHtml
  }

  return `<div class="trace-detail-section">
    <h4>Steps Detail (${trace.stepsDetail.length})</h4>
    <div class="steps-list">${items}</div>
  </div>`
}

function renderGeneratedText(trace: LlmTrace): string {
  if (trace.generatedText === undefined || trace.generatedText === '') return ''

  return `<div class="trace-detail-section">
    <h4>Generated Response</h4>
    <pre class="generated-text">${escapeHtml(trace.generatedText)}</pre>
  </div>`
}

export function renderTraceDetail(trace: LlmTrace, elements: ReturnType<typeof getTraceModalElements>): void {
  const { $traceModal, $traceModalTitle, $traceModalBody } = elements

  $traceModalTitle.textContent = `LLM Trace: ${escapeHtml(trace.model)}`

  let html = ''
  html += renderBasicInfo(trace)
  html += renderTokenUsage(trace)
  html += renderGeneratedText(trace)
  html += renderStepsDetail(trace)
  html += renderToolCalls(trace)

  $traceModalBody.innerHTML = html
  $traceModal.hidden = false
}
```

**Step 2: Run typecheck**

Run: `bun typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/debug/dashboard-ui/trace-detail.ts
git commit -m "feat(debug): add trace detail modal module"
```

---

## Task 5: Update Dashboard UI Index

**Files:**

- Modify: `src/debug/dashboard-ui/index.ts`

**Step 1: Import trace detail module**

Add import after line 7:

```typescript
import { getTraceModalElements, renderTraceDetail } from './trace-detail.js'
```

**Step 2: Get trace modal elements**

After line 58 (where other modal elements are defined):

```typescript
const traceModalElements = getTraceModalElements()
```

**Step 3: Add trace modal event listeners**

After line 100 (log modal listeners):

```typescript
traceModalElements.$traceModalClose.addEventListener('click', () => {
  traceModalElements.$traceModal.hidden = true
})
traceModalElements.$traceModal.addEventListener('click', (e) => {
  if (e.target === traceModalElements.$traceModal) traceModalElements.$traceModal.hidden = true
})
```

**Step 4: Replace trace click handler**

Replace lines 103-111 (existing trace click handler):

```typescript
// --- Trace click handler (opens modal) ---
$traceList.addEventListener('click', (e: Event) => {
  const target = e.target
  if (!(target instanceof HTMLElement)) return
  const row = target.closest('.trace-row')
  if (row === null) return
  const traceId = row.getAttribute('data-trace-id')
  if (traceId === null) return

  const trace = window.dashboard.__state.llmTraces.find((t) => String(t.timestamp) === traceId)
  if (trace !== undefined) {
    renderTraceDetail(trace, traceModalElements)
  }
})
```

**Step 5: Update renderTraces to add trace ID**

Modify lines 186-203 to add data-trace-id attribute:

```typescript
window.dashboard.renderTraces = (traces): void => {
  $traceCount.textContent = String(traces.length)
  let html = ''
  for (const t of traces) {
    const isError = t.error !== undefined && t.error !== ''
    html += `<div class="trace-row ${isError ? 'error' : ''}" data-trace-id="${t.timestamp}">`
    html += '<div class="trace-summary">'
    html += `<span class="trace-time">${formatTime(t.timestamp)}</span>`
    html += `<span class="trace-user">${escapeHtml(t.userId)}</span>`
    html += `<span class="trace-model">${escapeHtml(t.model)}</span>`
    html += `<span class="trace-duration">${(t.duration / 1000).toFixed(1)}s</span>`
    html += `<span>${t.steps} steps · ${formatTokens(t.totalTokens?.inputTokens ?? 0)}↓</span>`
    html += '</div>'
    html += '</div>'
  }
  $traceList.innerHTML = html
}
```

**Step 6: Update DashboardAPI type**

Add to the DashboardAPI interface around line 13-20:

```typescript
__state: {
  // ... existing fields
  llmTraces: LlmTrace[]
}
```

Need to import LlmTrace type at top:

```typescript
import type { LlmTrace } from '../schemas.js'
```

**Step 7: Run tests**

Run: `bun test tests/debug/dashboard-ui/`
Expected: Tests pass

**Step 8: Commit**

```bash
git add src/debug/dashboard-ui/index.ts
git commit -m "feat(debug): wire up trace detail modal click handlers"
```

---

## Task 6: Add CSS Styles for Trace Modal

**Files:**

- Modify: `src/debug/dashboard.css`

**Step 1: Add trace detail styles**

Append to dashboard.css:

```css
/* Trace Detail Modal */
.trace-detail-section {
  margin-bottom: 20px;
}

.trace-detail-section h4 {
  margin: 0 0 12px 0;
  color: #00ff88;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.trace-detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 12px;
}

.trace-detail-item {
  background: #1a1a1a;
  padding: 10px 12px;
  border-radius: 2px;
}

.trace-detail-item .label {
  color: #666;
  font-size: 11px;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.trace-detail-item .value {
  color: #ccc;
  font-size: 13px;
  word-break: break-word;
}

.trace-detail-item .value.error {
  color: #ff4444;
}

/* Tool calls */
.tool-calls-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tool-call-item {
  background: #1a1a1a;
  border-left: 3px solid #00ff88;
  padding: 12px;
}

.tool-call-item.error {
  border-left-color: #ff4444;
}

.tool-call-summary {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 8px;
}

.tool-call-summary .tool-name {
  font-weight: bold;
  color: #00ff88;
}

.tool-call-summary .tool-status.success {
  color: #00ff88;
}

.tool-call-summary .tool-status.error {
  color: #ff4444;
}

.tool-call-id {
  color: #666;
  font-size: 11px;
  margin-bottom: 8px;
}

.tool-section {
  margin-top: 12px;
}

.tool-section .label {
  color: #666;
  font-size: 11px;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.tool-json {
  background: #131313;
  padding: 8px;
  border-radius: 2px;
  font-size: 11px;
  color: #ccc;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-json.error {
  color: #ff4444;
}

/* Steps */
.steps-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.step-item {
  background: #1a1a1a;
  padding: 12px;
  border-radius: 2px;
}

.step-header {
  font-weight: bold;
  color: #00ff88;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid #333;
}

.step-tool-calls {
  margin: 8px 0;
}

.step-tool-call {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 8px;
  background: #131313;
  margin-bottom: 4px;
}

.step-tool-call .tool-name {
  color: #00ff88;
}

.step-tool-call .tool-id {
  color: #666;
  font-size: 11px;
}

.step-usage {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #333;
  color: #666;
  font-size: 12px;
}

/* Generated text */
.generated-text {
  background: #1a1a1a;
  padding: 16px;
  border-radius: 2px;
  font-size: 13px;
  line-height: 1.6;
  color: #ccc;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow-y: auto;
}
```

**Step 2: Verify CSS**

Run: `cat src/debug/dashboard.css | tail -50`
Expected: Shows trace detail styles

**Step 3: Commit**

```bash
git add src/debug/dashboard.css
git commit -m "feat(debug): add CSS styles for trace detail modal"
```

---

## Task 7: Update LLM Orchestrator to Emit Full Data

**Files:**

- Modify: `src/llm-orchestrator.ts:100-142` (invokeModel function)

**Step 1: Capture full data in invokeModel**

Replace the emit('llm:end') call (lines 134-140):

```typescript
emit('llm:end', {
  userId: contextId,
  model: mainModel,
  steps: result.steps.length,
  totalDuration: Date.now() - start,
  tokenUsage: result.usage,
  responseId: result.response?.id,
  actualModel: result.response?.modelId,
  finishReason: result.finishReason,
  messageCount: messages.length,
  toolCount: Object.keys(tools).length,
  generatedText: result.text,
  stepsDetail: result.steps.map((step, index) => ({
    stepNumber: index + 1,
    toolCalls: step.toolCalls?.map((tc) => ({
      toolName: tc.toolName,
      toolCallId: tc.toolCallId,
      args: tc.input,
    })),
    response: step.response,
    usage: step.usage,
  })),
})
```

**Step 2: Update tool call event to include args**

Replace lines 115-122:

```typescript
    experimental_onToolCallStart(event) {
      emit('llm:tool_call', {
        userId: contextId,
        toolName: event.toolCall.toolName,
        toolCallId: event.toolCall.toolCallId,
        args: event.toolCall.input,
      })
    },
```

**Step 3: Update tool result event**

Replace lines 123-132:

```typescript
    experimental_onToolCallFinish(event) {
      emit('llm:tool_result', {
        userId: contextId,
        toolName: event.toolCall.toolName,
        toolCallId: event.toolCall.toolCallId,
        durationMs: event.durationMs,
        success: event.success,
        args: event.toolCall.input,
        result: event.success ? event.output : undefined,
        error: event.success ? undefined : String(event.error),
      })
    },
```

**Step 4: Run tests**

Run: `bun test tests/llm-orchestrator.test.ts`
Expected: Tests pass

**Step 5: Commit**

```bash
git add src/llm-orchestrator.ts
git commit -m "feat(debug): emit full LLM trace data from orchestrator"
```

---

## Task 8: Add Tests for Trace Detail Modal

**Files:**

- Create: `tests/debug/dashboard-ui/trace-detail.test.ts`

**Step 1: Write tests**

```typescript
import { describe, expect, test } from 'bun:test'

import { getTraceModalElements, renderTraceDetail } from '../../../src/debug/dashboard-ui/trace-detail.js'
import type { LlmTrace } from '../../../src/debug/schemas.js'

describe('trace-detail', () => {
  // Mock DOM elements
  const createMockElement = (): HTMLElement => {
    const el = document.createElement('div')
    el.innerHTML = ''
    return el
  }

  test('getTraceModalElements returns modal elements', () => {
    // Setup DOM
    const modal = document.createElement('div')
    modal.id = 'trace-modal'
    const title = document.createElement('h3')
    title.id = 'trace-modal-title'
    const body = document.createElement('div')
    body.id = 'trace-modal-body'
    const close = document.createElement('button')
    close.id = 'trace-modal-close'

    document.body.appendChild(modal)
    document.body.appendChild(title)
    document.body.appendChild(body)
    document.body.appendChild(close)

    const elements = getTraceModalElements()
    expect(elements.$traceModal).toBe(modal)
    expect(elements.$traceModalTitle).toBe(title)
    expect(elements.$traceModalBody).toBe(body)
    expect(elements.$traceModalClose).toBe(close)
  })

  test('renderTraceDetail shows basic info', () => {
    const trace: LlmTrace = {
      timestamp: Date.now(),
      userId: 'user-123',
      model: 'gpt-4',
      duration: 2500,
      steps: 3,
      totalTokens: { inputTokens: 150, outputTokens: 250 },
      toolCalls: [],
    }

    const $traceModal = createMockElement()
    const $traceModalTitle = createMockElement()
    const $traceModalBody = createMockElement()
    const $traceModalClose = createMockElement()

    const elements = {
      $traceModal,
      $traceModalTitle,
      $traceModalBody,
      $traceModalClose,
    }

    renderTraceDetail(trace, elements)

    expect($traceModal.hidden).toBe(false)
    expect($traceModalTitle.textContent).toContain('gpt-4')
    expect($traceModalBody.innerHTML).toContain('user-123')
    expect($traceModalBody.innerHTML).toContain('3')
  })

  test('renderTraceDetail shows tool calls', () => {
    const trace: LlmTrace = {
      timestamp: Date.now(),
      userId: 'user-123',
      model: 'gpt-4',
      duration: 1000,
      steps: 1,
      totalTokens: { inputTokens: 100, outputTokens: 50 },
      toolCalls: [
        {
          toolName: 'create_task',
          durationMs: 500,
          success: true,
          toolCallId: 'call-1',
          args: { title: 'Test' },
          result: { id: 'task-123' },
        },
      ],
    }

    const $traceModal = createMockElement()
    const $traceModalTitle = createMockElement()
    const $traceModalBody = createMockElement()
    const $traceModalClose = createMockElement()

    const elements = {
      $traceModal,
      $traceModalTitle,
      $traceModalBody,
      $traceModalClose,
    }

    renderTraceDetail(trace, elements)

    expect($traceModalBody.innerHTML).toContain('create_task')
    expect($traceModalBody.innerHTML).toContain('call-1')
    expect($traceModalBody.innerHTML).toContain('Test')
  })

  test('renderTraceDetail shows steps detail', () => {
    const trace: LlmTrace = {
      timestamp: Date.now(),
      userId: 'user-123',
      model: 'gpt-4',
      duration: 1000,
      steps: 1,
      totalTokens: { inputTokens: 100, outputTokens: 50 },
      toolCalls: [],
      stepsDetail: [
        {
          stepNumber: 1,
          toolCalls: [{ toolName: 'search', toolCallId: 'call-1', args: {} }],
          usage: { inputTokens: 50, outputTokens: 30 },
        },
      ],
    }

    const $traceModal = createMockElement()
    const $traceModalTitle = createMockElement()
    const $traceModalBody = createMockElement()
    const $traceModalClose = createMockElement()

    const elements = {
      $traceModal,
      $traceModalTitle,
      $traceModalBody,
      $traceModalClose,
    }

    renderTraceDetail(trace, elements)

    expect($traceModalBody.innerHTML).toContain('Step 1')
    expect($traceModalBody.innerHTML).toContain('search')
  })

  test('renderTraceDetail shows generated text', () => {
    const trace: LlmTrace = {
      timestamp: Date.now(),
      userId: 'user-123',
      model: 'gpt-4',
      duration: 1000,
      steps: 1,
      totalTokens: { inputTokens: 100, outputTokens: 50 },
      toolCalls: [],
      generatedText: 'Hello, I created a task for you.',
    }

    const $traceModal = createMockElement()
    const $traceModalTitle = createMockElement()
    const $traceModalBody = createMockElement()
    const $traceModalClose = createMockElement()

    const elements = {
      $traceModal,
      $traceModalTitle,
      $traceModalBody,
      $traceModalClose,
    }

    renderTraceDetail(trace, elements)

    expect($traceModalBody.innerHTML).toContain('Hello, I created a task for you.')
  })
})
```

**Step 2: Run tests**

Run: `bun test tests/debug/dashboard-ui/trace-detail.test.ts`
Expected: 5 tests pass

**Step 3: Commit**

```bash
git add tests/debug/dashboard-ui/trace-detail.test.ts
git commit -m "test(debug): add tests for trace detail modal"
```

---

## Task 9: Final Integration Test

**Files:**

- Run: All debug tests

**Step 1: Run full debug test suite**

Run: `bun test tests/debug/`
Expected: All tests pass (150+ tests)

**Step 2: Run typecheck**

Run: `bun typecheck`
Expected: No errors

**Step 3: Run lint**

Run: `bun lint`
Expected: No errors

**Step 4: Final commit**

```bash
git add .
git commit -m "feat(debug): complete LLM trace detail modal with full data display"
```

---

## Summary

**New Files:**

- `src/debug/dashboard-ui/trace-detail.ts` - Modal rendering module
- `tests/debug/schemas-llm-trace.test.ts` - Schema validation tests
- `tests/debug/dashboard-ui/trace-detail.test.ts` - Modal rendering tests

**Modified Files:**

- `src/debug/dashboard.html` - Added trace modal HTML
- `src/debug/dashboard.css` - Added trace detail styles
- `src/debug/schemas.ts` - Extended LlmTraceSchema with full data
- `src/debug/state-collector.ts` - Extended LlmTrace type and handlers
- `src/debug/dashboard-ui/index.ts` - Wired up click handlers
- `src/llm-orchestrator.ts` - Emit full trace data

**New Data Fields in LLM Trace:**

- `responseId` - Provider response ID
- `actualModel` - Actual model used (may differ from requested)
- `finishReason` - Why the generation stopped
- `messageCount` - Number of messages sent
- `toolCount` - Number of tools available
- `generatedText` - Full assistant response
- `stepsDetail` - Per-step breakdown with tool calls and usage
- `toolCalls[].args` - Tool call arguments
- `toolCalls[].result` - Tool call results
- `toolCalls[].toolCallId` - Tool call identifier

**Usage:**

1. Open debug dashboard at `http://localhost:9100/dashboard`
2. Click on any LLM trace row
3. Modal opens showing all available data including:
   - Basic info (model, duration, steps, finish reason)
   - Token usage breakdown
   - Generated response text
   - Step-by-step details with tool calls
   - Tool call arguments and results
