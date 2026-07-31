<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# review-loop live progress reporting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface real-time progress (agent label, current tool + key arg, elapsed time, tool count) during each `opencode run` agent turn in `review-loop`, plus live build-check timing, so a run is no longer silent for 10-30 minutes at a time.

**Architecture:** Switch the agent spawn from buffered `execFile` to streaming `child_process.spawn`, parse the NDJSON event stream emitted by `opencode run --format json`, and feed it to a `LiveRenderer` that keeps one in-place refreshed status line pinned below the existing scrolling phase lines. New pure modules (`event-stream.ts`, `live-renderer.ts`) hold the parsing and formatting; `agent-runner.ts` wires the stream to the reporter; `loop-controller.ts` adds a live phase around build checks.

**Tech Stack:** Bun runtime, TypeScript (strict), `zod`, Node `child_process`. Zero new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-15-review-loop-live-progress-design.md`

---

## File structure

| File                                        | Responsibility                                                                               | Action |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- | ------ |
| `review-loop/src/event-stream.ts`           | Pure NDJSON line → `OpencodeEvent` parser. No I/O.                                           | Create |
| `review-loop/src/live-renderer.ts`          | Pure formatting helpers + `LiveRenderer` (terminal output state machine).                    | Create |
| `review-loop/src/progress-log.ts`           | `ProgressLog` (kept) + new `ProgressReporter` interface.                                     | Modify |
| `review-loop/src/agent-runner.ts`           | Streaming `SpawnFn`, `--format json`, per-line handler driving the reporter.                 | Modify |
| `review-loop/src/issue-matcher.ts`          | Accept + forward `reporter` to `runAgent`.                                                   | Modify |
| `review-loop/src/loop-controller.ts`        | Type `log` as `ProgressReporter`, forward it to agent calls, add `withLivePhase` for builds. | Modify |
| `review-loop/src/cli.ts`                    | Streaming `realSpawn`, construct `LiveRenderer` from `process.stdout`.                       | Modify |
| `tests/review-loop/event-stream.test.ts`    | Golden-line parser tests.                                                                    | Create |
| `tests/review-loop/live-renderer.test.ts`   | Format + renderer tests.                                                                     | Create |
| `tests/review-loop/agent-runner.test.ts`    | Add streaming test.                                                                          | Modify |
| `tests/review-loop/test-helpers.ts`         | Add `silentReporter()`.                                                                      | Modify |
| `tests/review-loop/progress-log.test.ts`    | `makeLog` → `makeReporter`; add build-line assertion.                                        | Modify |
| `tests/review-loop/loop-controller.test.ts` | Use `silentReporter()`.                                                                      | Modify |
| `tests/review-loop/issue-matcher.test.ts`   | Pass `reporter`.                                                                             | Modify |

Conventions (from repo `AGENTS.md`): use `.js` extensions in imports; no lint-disable/type-ignore comments; error extraction `error instanceof Error ? error.message : String(error)`; license header at top of every file.

Verification after each task: `bun run review-loop:test && bun run review-loop:typecheck && bun run review-loop:lint`.

---

## Task 1: Event-stream parser

**Files:**

- Create: `review-loop/src/event-stream.ts`
- Test: `tests/review-loop/event-stream.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/review-loop/event-stream.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseEventLine } from '../../review-loop/src/event-stream.js'

describe('parseEventLine', () => {
  test('parses step_start', () => {
    const line = JSON.stringify({ type: 'step_start', timestamp: 1784136381396, part: { type: 'step-start' } })
    expect(parseEventLine(line)).toEqual({ type: 'step_start', timestamp: 1784136381396 })
  })

  test('parses tool_use', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      part: {
        type: 'tool',
        tool: 'read',
        callID: 'call_1',
        state: { status: 'completed', input: { filePath: '/x/a.ts' } },
      },
    })
    expect(parseEventLine(line)).toEqual({
      type: 'tool_use',
      tool: 'read',
      callId: 'call_1',
      status: 'completed',
      input: { filePath: '/x/a.ts' },
    })
  })

  test('parses text', () => {
    const line = JSON.stringify({ type: 'text', part: { type: 'text', text: 'ping' } })
    expect(parseEventLine(line)).toEqual({ type: 'text', text: 'ping' })
  })

  test('parses step_finish', () => {
    const line = JSON.stringify({
      type: 'step_finish',
      part: { type: 'step-finish', reason: 'stop', tokens: { input: 13373, output: 31, reasoning: 0 }, cost: 0 },
    })
    expect(parseEventLine(line)).toEqual({
      type: 'step_finish',
      reason: 'stop',
      tokens: { input: 13373, output: 31, reasoning: 0 },
      cost: 0,
    })
  })

  test('defaults unknown tool status to running', () => {
    const line = JSON.stringify({ type: 'tool_use', part: { type: 'tool', tool: 'bash', callID: 'c', state: {} } })
    expect(parseEventLine(line)).toMatchObject({ type: 'tool_use', status: 'running' })
  })

  test('returns null for malformed JSON', () => {
    expect(parseEventLine('{ not json')).toBeNull()
  })

  test('returns null for empty line', () => {
    expect(parseEventLine('')).toBeNull()
  })

  test('returns null for unknown event type', () => {
    expect(parseEventLine(JSON.stringify({ type: 'mystery', part: {} }))).toBeNull()
  })

  test('returns null when part is missing', () => {
    expect(parseEventLine(JSON.stringify({ type: 'step_start', timestamp: 1 }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/event-stream.test.ts`
Expected: FAIL — module `review-loop/src/event-stream.js` not found / `parseEventLine` is not a function.

- [ ] **Step 3: Write the implementation**

Create `review-loop/src/event-stream.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type ToolStatus = 'running' | 'completed' | 'error'

export type OpencodeEvent =
  | { type: 'step_start'; timestamp: number }
  | { type: 'tool_use'; tool: string; callId: string; status: ToolStatus; input: unknown }
  | { type: 'text'; text: string }
  | {
      type: 'step_finish'
      reason: string
      tokens: { input: number; output: number; reasoning: number }
      cost: number
    }

interface RawPart {
  type?: unknown
  tool?: unknown
  callID?: unknown
  state?: { status?: unknown; input?: unknown }
  text?: unknown
  reason?: unknown
  tokens?: { input?: unknown; output?: unknown; reasoning?: unknown }
  cost?: unknown
}

interface RawEvent {
  type?: unknown
  timestamp?: unknown
  part?: RawPart
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function normalizeToolStatus(value: unknown): ToolStatus {
  if (value === 'completed' || value === 'running' || value === 'error') {
    return value
  }
  return 'running'
}

export function parseEventLine(line: string): OpencodeEvent | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (!isObject(raw)) {
    return null
  }
  const part = (raw as RawEvent).part
  if (!isObject(part)) {
    return null
  }
  const rawEvent = raw as RawEvent
  const rawPart = part as RawPart

  switch (rawEvent.type) {
    case 'step_start':
      return { type: 'step_start', timestamp: asNumber(rawEvent.timestamp) }
    case 'tool_use': {
      if (typeof rawPart.tool !== 'string' || typeof rawPart.callID !== 'string') {
        return null
      }
      const state = isObject(rawPart.state) ? rawPart.state : {}
      return {
        type: 'tool_use',
        tool: rawPart.tool,
        callId: rawPart.callID,
        status: normalizeToolStatus(state.status),
        input: state.input ?? {},
      }
    }
    case 'text':
      if (typeof rawPart.text !== 'string') {
        return null
      }
      return { type: 'text', text: rawPart.text }
    case 'step_finish': {
      if (typeof rawPart.reason !== 'string') {
        return null
      }
      const tokens = isObject(rawPart.tokens) ? rawPart.tokens : {}
      return {
        type: 'step_finish',
        reason: rawPart.reason,
        tokens: {
          input: asNumber(tokens.input),
          output: asNumber(tokens.output),
          reasoning: asNumber(tokens.reasoning),
        },
        cost: asNumber(rawPart.cost),
      }
    }
    default:
      return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/review-loop/event-stream.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/event-stream.ts tests/review-loop/event-stream.test.ts
git commit -m "feat(review-loop): add opencode NDJSON event-stream parser"
```

---

## Task 2: ProgressReporter interface + test helper

**Files:**

- Modify: `review-loop/src/progress-log.ts`
- Modify: `tests/review-loop/test-helpers.ts`

- [ ] **Step 1: Add the interface**

Replace the entire contents of `review-loop/src/progress-log.ts` with:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface ProgressLog {
  log(message: string): void
}

export interface ProgressReporter {
  readonly dynamic: boolean
  event(message: string): void
  live(line: string): void
  clearLive(): void
  log(message: string): void
}
```

- [ ] **Step 2: Add the test helper**

In `tests/review-loop/test-helpers.ts`, add this import after the existing config import (line 10):

```ts
import type { ProgressReporter } from '../../review-loop/src/progress-log.js'
```

Append at the end of the file:

```ts
export function silentReporter(): ProgressReporter {
  return {
    dynamic: false,
    event() {},
    live() {},
    clearLive() {},
    log() {},
  }
}
```

- [ ] **Step 3: Verify typecheck + existing tests still pass**

Run: `bun run review-loop:typecheck && bun test tests/review-loop`
Expected: typecheck PASS; all existing tests PASS (this is a purely additive type + helper).

- [ ] **Step 4: Commit**

```bash
git add review-loop/src/progress-log.ts tests/review-loop/test-helpers.ts
git commit -m "feat(review-loop): add ProgressReporter interface and silent test reporter"
```

---

## Task 3: Live-renderer formatting helpers

**Files:**

- Create: `review-loop/src/live-renderer.ts` (format helpers only; the `LiveRenderer` class is added in Task 4)
- Test: `tests/review-loop/live-renderer.test.ts` (format helper section)

- [ ] **Step 1: Write the failing test**

Create `tests/review-loop/live-renderer.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatDuration, formatLiveLine, formatStepFooter, formatToolArg } from '../../review-loop/src/live-renderer.js'

describe('formatDuration', () => {
  test('formats seconds under a minute', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(42000)).toBe('42s')
  })
  test('formats minutes and seconds', () => {
    expect(formatDuration(125000)).toBe('2m05s')
  })
})

describe('formatToolArg', () => {
  test('read/edit/write use basename of filePath', () => {
    expect(formatToolArg('read', { filePath: '/a/b/cli.ts' })).toBe('cli.ts')
    expect(formatToolArg('edit', { path: '/a/b/src/x.ts' })).toBe('x.ts')
  })
  test('bash truncates command', () => {
    expect(formatToolArg('bash', { command: 'echo hi' })).toBe('echo hi')
    const long = 'x'.repeat(60)
    expect(formatToolArg('bash', { command: long })).toHaveLength(40)
  })
  test('grep/glob use pattern', () => {
    expect(formatToolArg('grep', { pattern: 'TODO' })).toBe('TODO')
  })
  test('task uses description then subagent_type', () => {
    expect(formatToolArg('task', { description: 'find files' })).toBe('find files')
    expect(formatToolArg('task', { subagent_type: 'explore' })).toBe('explore')
  })
  test('fallback uses first string value', () => {
    expect(formatToolArg('custom', { a: 'hello', b: 'world' })).toBe('hello')
  })
  test('empty input yields empty string', () => {
    expect(formatToolArg('read', {})).toBe('')
    expect(formatToolArg('mystery', {})).toBe('')
  })
})

describe('formatLiveLine', () => {
  test('renders label, tool, arg, elapsed, count', () => {
    const line = formatLiveLine('fixer', 'edit', 'cli.ts', 42000, 3)
    expect(line).toContain('fixer')
    expect(line).toContain('edit cli.ts')
    expect(line).toContain('42s')
    expect(line).toContain('3 tools')
  })
  test('singular tool count', () => {
    expect(formatLiveLine('reviewer', 'read', 'a.ts', 1000, 1)).toContain('1 tool')
  })
  test('no tool yet shows thinking', () => {
    expect(formatLiveLine('reviewer', '', '', 2000, 0)).toContain('thinking')
  })
})

describe('formatStepFooter', () => {
  test('renders summary with tokens', () => {
    const footer = formatStepFooter('reviewer', 18000, 4, { input: 13373, output: 31 })
    expect(footer).toContain('reviewer')
    expect(footer).toContain('18s')
    expect(footer).toContain('4 tools')
    expect(footer).toContain('in 13373 / out 31')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/live-renderer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `review-loop/src/live-renderer.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

const ELLIPSIS = '\u2026'
const ARROW = '\u25B6'
const CHECK = '\u2713'
const MIDDLE_DOT = '\u00B7'

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`
}

function truncate(value: string, max: number): string {
  if (max <= 0) {
    return ''
  }
  if (value.length <= max) {
    return value
  }
  return `${value.slice(0, max - 1)}${ELLIPSIS}`
}

function pickString(obj: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return ''
}

function firstStringValue(obj: Record<string, unknown>): string {
  for (const value of Object.values(obj)) {
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return ''
}

export function formatToolArg(tool: string, input: unknown): string {
  const obj = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  switch (tool) {
    case 'read':
    case 'edit':
    case 'write': {
      const filePath = pickString(obj, ['filePath', 'path'])
      return filePath === '' ? '' : path.basename(filePath)
    }
    case 'bash':
      return truncate(pickString(obj, ['command']), 40)
    case 'grep':
    case 'glob':
      return truncate(pickString(obj, ['pattern']), 40)
    case 'task':
      return truncate(pickString(obj, ['description', 'subagent_type']), 40)
    default:
      return truncate(firstStringValue(obj), 40)
  }
}

export function formatLiveLine(label: string, tool: string, arg: string, elapsedMs: number, toolCount: number): string {
  const toolPart = tool === '' ? 'thinking' : arg === '' ? tool : `${tool} ${arg}`
  const tools = `${toolCount} tool${toolCount === 1 ? '' : 's'}`
  return `  ${label.padEnd(10)} ${ARROW} ${toolPart} ${MIDDLE_DOT} ${formatDuration(elapsedMs)} ${MIDDLE_DOT} ${tools}`
}

export function formatStepFooter(
  label: string,
  elapsedMs: number,
  toolCount: number,
  tokens: { input: number; output: number },
): string {
  const tools = `${toolCount} tool${toolCount === 1 ? '' : 's'}`
  return `  ${label} ${CHECK} ${formatDuration(elapsedMs)} ${MIDDLE_DOT} ${tools} ${MIDDLE_DOT} in ${tokens.input} / out ${tokens.output}`
}
```

Note: only symbols used by the format helpers are declared here. `CLEAR_LINE`, `RendererStream`, and the `ProgressReporter` import are added in Task 4 together with the `LiveRenderer` class, so this file is lint-clean on its own.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/review-loop/live-renderer.test.ts`
Expected: PASS (all format tests).

Run: `bun run review-loop:lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/live-renderer.ts tests/review-loop/live-renderer.test.ts
git commit -m "feat(review-loop): add live progress formatting helpers"
```

---

## Task 4: LiveRenderer terminal state machine

**Files:**

- Modify: `review-loop/src/live-renderer.ts` (append the class)
- Test: `tests/review-loop/live-renderer.test.ts` (append renderer tests)

- [ ] **Step 1: Write the failing test**

Append to `tests/review-loop/live-renderer.test.ts` (add this import at the top with the others):

```ts
import { LiveRenderer } from '../../review-loop/src/live-renderer.js'
```

Append a new describe block:

```ts
function makeStream(opts: { isTTY?: boolean; columns?: number } = {}): {
  output: string[]
  stream: { write(s: string): boolean; isTTY?: boolean; columns?: number }
} {
  const output: string[] = []
  return {
    output,
    stream: {
      write(s: string): boolean {
        output.push(s)
        return true
      },
      ...opts,
    },
  }
}

describe('LiveRenderer', () => {
  test('event writes a scrolling line', () => {
    const { output, stream } = makeStream()
    const r = new LiveRenderer(stream)
    r.event('hello')
    expect(output).toEqual(['hello\n'])
  })

  test('log aliases event', () => {
    const { output, stream } = makeStream()
    const r = new LiveRenderer(stream)
    r.log('hi')
    expect(output).toEqual(['hi\n'])
  })

  test('dynamic=false when not a TTY', () => {
    const { stream } = makeStream()
    expect(new LiveRenderer(stream).dynamic).toBe(false)
  })

  test('dynamic=true when TTY', () => {
    const { stream } = makeStream({ isTTY: true })
    expect(new LiveRenderer(stream).dynamic).toBe(true)
  })

  test('non-TTY live scrolls with newline', () => {
    const { output, stream } = makeStream()
    new LiveRenderer(stream).live('x')
    expect(output).toEqual(['x\n'])
  })

  test('TTY live writes clear-line + content with no newline', () => {
    const { output, stream } = makeStream({ isTTY: true, columns: 80 })
    new LiveRenderer(stream).live('working')
    expect(output).toEqual(['\r\u001b[2Kworking'])
  })

  test('event after a live line clears it first (TTY)', () => {
    const { output, stream } = makeStream({ isTTY: true, columns: 80 })
    const r = new LiveRenderer(stream)
    r.live('working')
    r.event('done')
    expect(output).toEqual(['\r\u001b[2Kworking', '\r\u001b[2K', 'done\n'])
  })

  test('clearLive is a no-op when nothing is live', () => {
    const { output, stream } = makeStream({ isTTY: true })
    new LiveRenderer(stream).clearLive()
    expect(output).toEqual([])
  })

  test('TTY live truncates to columns with ellipsis', () => {
    const { output, stream } = makeStream({ isTTY: true, columns: 10 })
    new LiveRenderer(stream).live('abcdefghijklmnopqrstuvwxyz')
    expect(output[0]).toBe('\r\u001b[2Kabcdefghi\u2026')
    expect(output[0]).toHaveLength(10 + '\r\u001b[2K'.length)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/live-renderer.test.ts`
Expected: FAIL — `LiveRenderer` is not exported.

- [ ] **Step 3: Write the implementation**

In `review-loop/src/live-renderer.ts`:

1. Add this import after the `import path from 'node:path'` line at the top:

```ts
import type { ProgressReporter } from './progress-log.js'
```

2. Add these declarations alongside the existing constants (after `const MIDDLE_DOT = '\u00B7'`):

```ts
const CLEAR_LINE = '\r\u001b[2K'

export interface RendererStream {
  write(chunk: string): boolean
  isTTY?: boolean
  columns?: number
}
```

3. Append the `LiveRenderer` class at the end of the file:

```ts
export class LiveRenderer implements ProgressReporter {
  readonly dynamic: boolean
  private readonly stream: RendererStream
  private liveActive = false

  constructor(stream: RendererStream) {
    this.stream = stream
    this.dynamic = stream.isTTY === true
  }

  event(message: string): void {
    this.clearLive()
    this.stream.write(`${message}\n`)
  }

  log(message: string): void {
    this.event(message)
  }

  live(line: string): void {
    if (!this.dynamic) {
      this.stream.write(`${line}\n`)
      return
    }
    this.stream.write(`${CLEAR_LINE}${this.fit(line)}`)
    this.liveActive = true
  }

  clearLive(): void {
    if (!this.liveActive) {
      return
    }
    this.stream.write(CLEAR_LINE)
    this.liveActive = false
  }

  private fit(line: string): string {
    const max = this.stream.columns ?? 80
    return truncate(line, max)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/review-loop/live-renderer.test.ts`
Expected: PASS (all format + renderer tests).

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/live-renderer.ts tests/review-loop/live-renderer.test.ts
git commit -m "feat(review-loop): add LiveRenderer terminal state machine"
```

---

## Task 5: Streaming agent-runner

**Files:**

- Modify: `review-loop/src/agent-runner.ts`
- Modify: `tests/review-loop/agent-runner.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/review-loop/agent-runner.test.ts`, add these imports at the top (alongside the existing ones):

```ts
import { readFileSync } from 'node:fs'
import type { ProgressReporter } from '../../review-loop/src/progress-log.js'
```

Append a new test inside the existing `describe('agent-runner', ...)` block:

```ts
test('streams live progress from agent events', async () => {
  const dir = makeTempDir('agent-stream-')
  const outputPath = path.join(dir, 'issues.json')
  const logPath = path.join(dir, 'log.txt')
  const lines = [
    JSON.stringify({ type: 'step_start', timestamp: Date.now(), part: { type: 'step-start' } }),
    JSON.stringify({
      type: 'tool_use',
      part: {
        type: 'tool',
        tool: 'read',
        callID: 'call_1',
        state: { status: 'completed', input: { filePath: '/x/cli.ts' } },
      },
    }),
    JSON.stringify({
      type: 'step_finish',
      part: { type: 'step-finish', reason: 'stop', tokens: { input: 100, output: 5, reasoning: 0 }, cost: 0 },
    }),
  ]
  const live: string[] = []
  const events: string[] = []
  const reporter: ProgressReporter = {
    dynamic: false,
    event: (m) => {
      events.push(m)
    },
    live: (m) => {
      live.push(m)
    },
    clearLive() {},
    log: (m) => {
      events.push(m)
    },
  }
  const spawn = (
    _command: string,
    _args: readonly string[],
    _opts: { cwd: string },
    onLine?: (line: string) => void,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
    for (const line of lines) {
      onLine?.(line)
    }
    writeFileSync(outputPath, JSON.stringify({ issues: [] }))
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }

  await runAgent({
    spawn,
    model: 'test-model',
    cwd: dir,
    prompt: 'review the code',
    outputPath,
    outputSchema: ReviewerIssuesSchema,
    label: 'reviewer',
    logPath,
    extraArgs: [],
    reporter,
  })

  expect(live.some((l) => l.includes('reviewer') && l.includes('read'))).toBe(true)
  expect(events.some((e) => e.includes('in 100 / out 5'))).toBe(true)
  expect(readFileSync(logPath, 'utf8')).toContain('step_start')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/agent-runner.test.ts`
Expected: FAIL — `SpawnFn` does not accept `onLine`; `reporter` is not a known option.

- [ ] **Step 3: Replace agent-runner implementation**

Replace the entire contents of `review-loop/src/agent-runner.ts` with:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { appendFile, readFile } from 'node:fs/promises'

import type { z } from 'zod'

import { parseEventLine } from './event-stream.js'
import { formatLiveLine, formatStepFooter, formatToolArg } from './live-renderer.js'
import type { ProgressReporter } from './progress-log.js'

export interface SpawnResult {
  exitCode: number
  stdout: string
  stderr: string
}

export type LineSink = (line: string) => void

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd: string },
  onLine?: LineSink,
) => Promise<SpawnResult>

export interface RunAgentOptions<T> {
  spawn: SpawnFn
  model: string
  cwd: string
  prompt: string
  outputPath: string
  outputSchema: z.ZodType<T>
  label: string
  logPath: string
  extraArgs: readonly string[]
  reporter?: ProgressReporter
  onRetry?: () => void
}

interface AttemptResult<T> {
  ok: true
  value: T
}

interface AttemptError {
  ok: false
  error: Error
}

type Attempt<T> = AttemptResult<T> | AttemptError

async function attemptRun<T>(options: RunAgentOptions<T>, onLine?: LineSink): Promise<SpawnResult> {
  return options.spawn(
    'opencode',
    ['run', '--format', 'json', '--model', options.model, '--dir', options.cwd, ...options.extraArgs, options.prompt],
    { cwd: options.cwd },
    onLine,
  )
}

interface LineHandler {
  onLine: LineSink
  dispose: () => void
}

function createLineHandler<T>(options: RunAgentOptions<T>): LineHandler {
  const reporter = options.reporter
  const label = options.label
  const startedAt = { value: 0 }
  const state = { toolCount: 0, tool: '', arg: '' }
  const seenCalls = new Set<string>()
  let timer: ReturnType<typeof setInterval> | null = null

  function renderLive(): void {
    if (reporter === undefined) {
      return
    }
    const elapsed = startedAt.value === 0 ? 0 : Date.now() - startedAt.value
    reporter.live(formatLiveLine(label, state.tool, state.arg, elapsed, state.toolCount))
  }

  function onLine(line: string): void {
    void appendFile(options.logPath, `${line}\n`)
    const evt = parseEventLine(line)
    if (evt === null || reporter === undefined) {
      return
    }
    switch (evt.type) {
      case 'step_start':
        if (startedAt.value === 0) {
          startedAt.value = Date.now()
          if (reporter.dynamic) {
            timer = setInterval(renderLive, 1000)
          }
        }
        break
      case 'tool_use':
        if (!seenCalls.has(evt.callId)) {
          seenCalls.add(evt.callId)
          state.toolCount += 1
        }
        state.tool = evt.tool
        state.arg = formatToolArg(evt.tool, evt.input)
        renderLive()
        break
      case 'step_finish':
        reporter.clearLive()
        reporter.event(
          formatStepFooter(
            label,
            startedAt.value === 0 ? 0 : Date.now() - startedAt.value,
            state.toolCount,
            evt.tokens,
          ),
        )
        break
      case 'text':
        break
    }
  }

  function dispose(): void {
    if (timer !== null) {
      clearInterval(timer)
    }
    reporter?.clearLive()
  }

  return { onLine, dispose }
}

async function runAttempt<T>(options: RunAgentOptions<T>): Promise<Attempt<T>> {
  const handler = createLineHandler(options)
  try {
    const result = await attemptRun(options, handler.onLine)
    if (result.exitCode !== 0) {
      await appendFile(options.logPath, `[${options.label}] stderr: ${result.stderr}\n`)
      return {
        ok: false,
        error: new Error(`${options.label} exited with code ${result.exitCode}: ${result.stderr}`),
      }
    }
    try {
      const raw = await readFile(options.outputPath, 'utf8')
      return { ok: true, value: options.outputSchema.parse(JSON.parse(raw)) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) }
    }
  } finally {
    handler.dispose()
  }
}

export async function runAgent<T>(options: RunAgentOptions<T>): Promise<T> {
  const first = await runAttempt(options)
  if (first.ok) {
    return first.value
  }

  options.onRetry?.()
  const second = await runAttempt(options)
  if (second.ok) {
    return second.value
  }

  throw second.error
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/review-loop/agent-runner.test.ts`
Expected: PASS (existing 4 + new streaming test). The existing mock fakes ignore the optional `onLine` param, which is fine.

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/agent-runner.ts tests/review-loop/agent-runner.test.ts
git commit -m "feat(review-loop): stream opencode events to live progress reporter"
```

---

## Task 6: Thread reporter through loop-controller and matcher

**Files:**

- Modify: `review-loop/src/loop-controller.ts`
- Modify: `review-loop/src/issue-matcher.ts`
- Modify: `tests/review-loop/loop-controller.test.ts`
- Modify: `tests/review-loop/issue-matcher.test.ts`
- Modify: `tests/review-loop/progress-log.test.ts`

- [ ] **Step 1: Update loop-controller types + agent calls**

In `review-loop/src/loop-controller.ts`:

1. Replace the import `import type { ProgressLog } from './progress-log.js'` with:

```ts
import type { ProgressReporter } from './progress-log.js'
```

2. In the `ReviewLoopDeps` interface, change `log: ProgressLog` to `log: ProgressReporter`.

3. In `runReviewStep`, add `reporter: deps.log,` to the `runAgent({...})` options object (e.g. immediately after `label: 'reviewer',`).

4. In `runFixer`, add `reporter: deps.log,` to the `runAgent({...})` options object (e.g. immediately after `label,`).

- [ ] **Step 2: Update issue-matcher**

In `review-loop/src/issue-matcher.ts`:

1. Add the import (after the existing `runAgent` import):

```ts
import type { ProgressReporter } from './progress-log.js'
```

2. Add a field to `MatchIssuesDeps`:

```ts
reporter: ProgressReporter
```

3. In the `runAgent({...})` call inside `matchIssues`, add `reporter: deps.reporter,`.

4. Update the call site in `review-loop/src/loop-controller.ts` `runMatchAndRecord`: add `reporter: deps.log,` to the `matchIssues({...})` object.

- [ ] **Step 3: Update loop-controller.test.ts**

In `tests/review-loop/loop-controller.test.ts`, add to the imports:

```ts
import { silentReporter } from './test-helpers.js'
```

Replace the three occurrences of `log: { log: () => {} },` with `log: silentReporter(),`.

- [ ] **Step 4: Update issue-matcher.test.ts**

In `tests/review-loop/issue-matcher.test.ts`, add to the imports:

```ts
import { silentReporter } from './test-helpers.js'
```

Add `reporter: silentReporter(),` to both `matchIssues({...})` call objects (the one in `returns null matches when ledger is empty` and the one in `returns LLM-provided matches`).

- [ ] **Step 5: Update progress-log.test.ts**

In `tests/review-loop/progress-log.test.ts`:

1. Replace `import type { ProgressLog } from '../../review-loop/src/progress-log.js'` with:

```ts
import type { ProgressReporter } from '../../review-loop/src/progress-log.js'
```

2. Replace the `makeLog` function with:

```ts
function makeReporter(messages: string[]): ProgressReporter {
  return {
    dynamic: false,
    event: (message: string): void => {
      messages.push(message)
    },
    live() {},
    clearLive() {},
    log: (message: string): void => {
      messages.push(message)
    },
  }
}
```

3. Replace the three occurrences of `log: makeLog(messages),` with `log: makeReporter(messages),`.

(The existing assertions use `messages` and still pass because `log()` pushes via the alias; loop-controller now also emits `[build]` lines, covered in Task 7.)

- [ ] **Step 6: Run full review-loop suite + typecheck + lint**

Run: `bun run review-loop:test && bun run review-loop:typecheck && bun run review-loop:lint`
Expected: PASS (all review-loop tests; build-check live lines are added in Task 7, so progress-log.test build assertion is added there).

- [ ] **Step 7: Commit**

```bash
git add review-loop/src/loop-controller.ts review-loop/src/issue-matcher.ts tests/review-loop/loop-controller.test.ts tests/review-loop/issue-matcher.test.ts tests/review-loop/progress-log.test.ts
git commit -m "refactor(review-loop): thread ProgressReporter through agent call sites"
```

---

## Task 7: Build-check live phase

**Files:**

- Modify: `review-loop/src/loop-controller.ts`
- Modify: `tests/review-loop/progress-log.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/review-loop/progress-log.test.ts`, inside the `logs round start...` test (the first test), add this assertion before its closing brace (after the `expect(messages).toContain('[done] clean after 2 rounds')` line):

```ts
expect(messages.some((m) => m.startsWith('[build] passed'))).toBe(true)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/progress-log.test.ts`
Expected: FAIL — no message starts with `[build] passed`.

- [ ] **Step 3: Add withLivePhase and wire build checks**

In `review-loop/src/loop-controller.ts`:

1. Add to the imports from live-renderer (extend the existing `import type` line for `ProgressReporter` stays; add a value import for `formatDuration`):

```ts
import { formatDuration } from './live-renderer.js'
```

2. Add the helper after the `terminalResult` function (before `runFixer`):

```ts
async function withLivePhase<T>(
  reporter: ProgressReporter,
  label: string,
  fn: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  reporter.event(`[${label}] running...`)
  const start = Date.now()
  let timer: ReturnType<typeof setInterval> | null = null
  if (reporter.dynamic) {
    timer = setInterval(() => {
      reporter.live(`[${label}] ${formatDuration(Date.now() - start)}...`)
    }, 1000)
  }
  try {
    const result = await fn()
    return { result, durationMs: Date.now() - start }
  } finally {
    if (timer !== null) {
      clearInterval(timer)
    }
    reporter.clearLive()
  }
}
```

3. In `processIssue`, replace this block:

```ts
  const buildResult = await runBuildCheck({
    exec: deps.exec,
    cwd: deps.runState.worktreePath,
    command: deps.config.checkCommand,
  })

  if (buildResult.passed) {
```

with:

```ts
  const buildPhase = await withLivePhase(deps.log, 'build', () =>
    runBuildCheck({ exec: deps.exec, cwd: deps.runState.worktreePath, command: deps.config.checkCommand }),
  )
  deps.log.event(`[build] ${buildPhase.result.passed ? 'passed' : 'FAILED'} · ${formatDuration(buildPhase.durationMs)}`)
  const buildResult = buildPhase.result

  if (buildResult.passed) {
```

(Keeping a local `buildResult` alias minimizes the diff to the lines that read `buildResult.passed` / `buildResult.stderr` below.)

4. In `retryFixAfterBuildFailure`, replace this block:

```ts
const retryBuild = await runBuildCheck({
  exec: deps.exec,
  cwd: deps.runState.worktreePath,
  command: deps.config.checkCommand,
})
```

with:

```ts
const retryPhase = await withLivePhase(deps.log, 'build', () =>
  runBuildCheck({ exec: deps.exec, cwd: deps.runState.worktreePath, command: deps.config.checkCommand }),
)
deps.log.event(`[build] ${retryPhase.result.passed ? 'passed' : 'FAILED'} · ${formatDuration(retryPhase.durationMs)}`)
const retryBuild = retryPhase.result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run review-loop:test && bun run review-loop:typecheck && bun run review-loop:lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/loop-controller.ts tests/review-loop/progress-log.test.ts
git commit -m "feat(review-loop): live progress for build checks"
```

---

## Task 8: Streaming realSpawn + LiveRenderer wiring in cli

**Files:**

- Modify: `review-loop/src/cli.ts`

- [ ] **Step 1: Update imports**

In `review-loop/src/cli.ts`:

1. Replace `import { execFile } from 'node:child_process'` with:

```ts
import { spawn } from 'node:child_process'
```

2. Replace `import type { ProgressLog } from './progress-log.js'` with:

```ts
import { LiveRenderer } from './live-renderer.js'
import type { ProgressReporter } from './progress-log.js'
```

- [ ] **Step 2: Replace realSpawn with the streaming version**

Replace the entire `realSpawn` const (the block starting `const realSpawn: SpawnFn = (` through its closing `})`) with:

```ts
const realSpawn: SpawnFn = (command, args, options, onLine): Promise<SpawnResult> => {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let pending = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      pending += text
      let newlineIndex = pending.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = pending.slice(0, newlineIndex)
        pending = pending.slice(newlineIndex + 1)
        newlineIndex = pending.indexOf('\n')
        if (line.length > 0) {
          onLine?.(line)
        }
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', () => {
      resolve({ exitCode: 1, stdout, stderr })
    })
    child.on('close', (code) => {
      if (pending.length > 0) {
        onLine?.(pending)
      }
      resolve({ exitCode: code ?? 0, stdout, stderr })
    })
  })
}
```

- [ ] **Step 3: Construct the LiveRenderer**

Replace `const log: ProgressLog = { log: console.log }` with:

```ts
const log: ProgressReporter = new LiveRenderer(process.stdout)
```

- [ ] **Step 4: Run the full suite + integration test**

Run: `bun run review-loop:test && bun run review-loop:typecheck && bun run review-loop:lint`
Expected: PASS, including `fake-agent-integration.test.ts` (the fake `opencode` emits no stdout, so no live lines; the streaming spawn still resolves exit code 0 and reads the result file).

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/cli.ts
git commit -m "feat(review-loop): stream real subprocess output through LiveRenderer"
```

---

## Verification checklist (after Task 8)

- [ ] `bun run review-loop:test` — all tests pass.
- [ ] `bun run review-loop:typecheck` — no errors.
- [ ] `bun run review-loop:lint` — no errors.
- [ ] Manual (optional): `bun run review-loop:start -- --config review-loop/config.json --plan <plan>` in a real TTY shows the scrolling phase lines plus a refreshed `agent ▶ tool arg · Ns · N tools` line during each agent turn, and `[build] running...` / `[build] passed · Ns` around build checks.

## Follow-ups (out of scope)

- `--verbose` / `--thinking` toggle to surface assistant text and reasoning excerpts.
- Hung-process detection/timeout (the ticking timer now makes a hang visible).
- Optional `status.json` for external/dashboard consumers (Approach C).
