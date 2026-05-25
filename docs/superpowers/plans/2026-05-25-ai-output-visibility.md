<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# AI Output Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-context `/config` controls for showing or hiding tool-call details and provider-exposed reasoning in normal chat.

**Architecture:** Store three context-scoped settings in the existing `user_config` table through cache helpers, without adding a migration. Add a request-scoped buffered progress reporter that collects tool and reasoning details, flushes one complete details block after the final answer, and leaves debug tracing unchanged.

**Tech Stack:** Bun, TypeScript, Vercel AI SDK `generateText`, existing `ReplyFn`, SQLite-backed cache/config helpers, Bun test runner.

---

## File Structure

Create these files:

- `src/ai-output-settings.ts` — setting keys, value unions, defaults, parsers, `getAiOutputSettings()`, and setters used by `/config`.
- `src/ai-progress-reporter.ts` — buffered user-visible tool/reasoning reporter plus sanitization and raw formatting.
- `src/ai-output-config-ui.ts` — `/config` section rendering, callback data serialization/parsing, and callback handling for AI output settings.
- `tests/ai-output-settings.test.ts` — settings defaults and fallback behavior.
- `tests/ai-progress-reporter.test.ts` — reporter no-op/default, sanitized, raw, reasoning, and buffered flush behavior.
- `tests/ai-output-config-ui.test.ts` — config section rendering and callback setting behavior.

Modify these files:

- `src/commands/config.ts` — append AI Output section and buttons to `/config` output.
- `src/chat/interaction-router.ts` — route `cfg:ai:*` callbacks through the existing `/config` target validation flow.
- `src/llm-orchestrator-types.ts` — add optional `progressReporter` to model invocation args.
- `src/llm-orchestrator-invoke.ts` — report tool starts/finishes to the reporter and stop sending legacy tool failure warnings directly from tool hooks.
- `src/llm-orchestrator-events.ts` — include `reasoningText` in the resolved result type.
- `src/llm-orchestrator.ts` — create reporter per turn, report reasoning after `generateText`, and flush after final answer.
- `tests/commands/config.test.ts` — assert `/config` includes AI Output section and buttons.
- `tests/llm-orchestrator-invoke.test.ts` — assert reporter hooks receive tool events while debug events remain safe.
- `tests/llm-orchestrator.test.ts` — update default tool-failure expectations and add enabled-output/reasoning integration tests.

Do not modify the debug dashboard, trace collector, debug schemas, or client UI.

---

### Task 1: AI Output Settings Model

**Files:**

- Create: `src/ai-output-settings.ts`
- Create: `tests/ai-output-settings.test.ts`

- [ ] **Step 1: Write the failing settings tests**

Create `tests/ai-output-settings.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setCachedConfig } from '../src/cache.js'
import {
  AI_OUTPUT_DETAIL_LEVEL_KEY,
  AI_REASONING_VISIBILITY_KEY,
  AI_TOOL_VISIBILITY_KEY,
  getAiOutputSettings,
  setAiOutputSetting,
} from '../src/ai-output-settings.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('ai-output-settings', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('uses safe defaults when no settings exist', () => {
    expect(getAiOutputSettings('ctx-default')).toEqual({
      toolVisibility: 'off',
      reasoningVisibility: 'off',
      detailLevel: 'sanitized',
    })
  })

  test('reads valid settings from context config', () => {
    setCachedConfig('ctx-valid', AI_TOOL_VISIBILITY_KEY, 'on')
    setCachedConfig('ctx-valid', AI_REASONING_VISIBILITY_KEY, 'on')
    setCachedConfig('ctx-valid', AI_OUTPUT_DETAIL_LEVEL_KEY, 'raw')

    expect(getAiOutputSettings('ctx-valid')).toEqual({
      toolVisibility: 'on',
      reasoningVisibility: 'on',
      detailLevel: 'raw',
    })
  })

  test('falls back safely for invalid stored values', () => {
    setCachedConfig('ctx-invalid', AI_TOOL_VISIBILITY_KEY, 'yes')
    setCachedConfig('ctx-invalid', AI_REASONING_VISIBILITY_KEY, 'visible')
    setCachedConfig('ctx-invalid', AI_OUTPUT_DETAIL_LEVEL_KEY, 'full')

    expect(getAiOutputSettings('ctx-invalid')).toEqual({
      toolVisibility: 'off',
      reasoningVisibility: 'off',
      detailLevel: 'sanitized',
    })
  })

  test('setAiOutputSetting writes the selected context value', () => {
    setAiOutputSetting('ctx-write', 'toolVisibility', 'on')
    setAiOutputSetting('ctx-write', 'reasoningVisibility', 'on')
    setAiOutputSetting('ctx-write', 'detailLevel', 'raw')

    expect(getAiOutputSettings('ctx-write')).toEqual({
      toolVisibility: 'on',
      reasoningVisibility: 'on',
      detailLevel: 'raw',
    })
  })
})
```

- [ ] **Step 2: Run the failing settings tests**

Run: `bun test tests/ai-output-settings.test.ts`

Expected: FAIL with a module resolution error for `../src/ai-output-settings.js`.

- [ ] **Step 3: Implement the settings module**

Create `src/ai-output-settings.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getCachedConfig, setCachedConfig } from './cache.js'

export const AI_TOOL_VISIBILITY_KEY = 'ai_tool_visibility'
export const AI_REASONING_VISIBILITY_KEY = 'ai_reasoning_visibility'
export const AI_OUTPUT_DETAIL_LEVEL_KEY = 'ai_output_detail_level'

export type AiVisibility = 'on' | 'off'
export type AiOutputDetailLevel = 'sanitized' | 'raw'

export type AiOutputSettings = {
  toolVisibility: AiVisibility
  reasoningVisibility: AiVisibility
  detailLevel: AiOutputDetailLevel
}

export type AiOutputSettingName = keyof AiOutputSettings

const DEFAULT_SETTINGS: AiOutputSettings = {
  toolVisibility: 'off',
  reasoningVisibility: 'off',
  detailLevel: 'sanitized',
}

const SETTING_KEY_BY_NAME: Record<AiOutputSettingName, string> = {
  toolVisibility: AI_TOOL_VISIBILITY_KEY,
  reasoningVisibility: AI_REASONING_VISIBILITY_KEY,
  detailLevel: AI_OUTPUT_DETAIL_LEVEL_KEY,
}

function parseVisibility(value: string | null): AiVisibility {
  return value === 'on' || value === 'off' ? value : 'off'
}

function parseDetailLevel(value: string | null): AiOutputDetailLevel {
  return value === 'raw' || value === 'sanitized' ? value : 'sanitized'
}

export function getAiOutputSettings(contextId: string): AiOutputSettings {
  return {
    toolVisibility: parseVisibility(getCachedConfig(contextId, AI_TOOL_VISIBILITY_KEY)),
    reasoningVisibility: parseVisibility(getCachedConfig(contextId, AI_REASONING_VISIBILITY_KEY)),
    detailLevel: parseDetailLevel(getCachedConfig(contextId, AI_OUTPUT_DETAIL_LEVEL_KEY)),
  }
}

export function getDefaultAiOutputSettings(): AiOutputSettings {
  return { ...DEFAULT_SETTINGS }
}

export function setAiOutputSetting(
  contextId: string,
  name: AiOutputSettingName,
  value: AiVisibility | AiOutputDetailLevel,
): void {
  setCachedConfig(contextId, SETTING_KEY_BY_NAME[name], value)
}
```

- [ ] **Step 4: Run the settings tests**

Run: `bun test tests/ai-output-settings.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit settings model**

Run:

```bash
git add src/ai-output-settings.ts tests/ai-output-settings.test.ts
git commit -m "feat: add ai output settings model"
```

---

### Task 2: Buffered Progress Reporter

**Files:**

- Create: `src/ai-progress-reporter.ts`
- Create: `tests/ai-progress-reporter.test.ts`

- [ ] **Step 1: Write failing reporter tests**

Create `tests/ai-progress-reporter.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createAiProgressReporter } from '../src/ai-progress-reporter.js'
import type { AiOutputSettings } from '../src/ai-output-settings.js'
import { createMockReply } from './utils/test-helpers.js'

const hiddenSettings: AiOutputSettings = {
  toolVisibility: 'off',
  reasoningVisibility: 'off',
  detailLevel: 'sanitized',
}

const toolSettings: AiOutputSettings = {
  toolVisibility: 'on',
  reasoningVisibility: 'off',
  detailLevel: 'sanitized',
}

describe('createAiProgressReporter', () => {
  test('does not emit anything when all visibility is off', async () => {
    const { reply, textCalls } = createMockReply()
    const reporter = createAiProgressReporter(reply, hiddenSettings)

    reporter.toolStarted({ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'x' } })
    reporter.toolFinished({
      toolName: 'create_task',
      toolCallId: 'call-1',
      input: { title: 'x' },
      durationMs: 10,
      success: true,
      output: { id: 'T-1' },
    })
    reporter.reasoning('Visible provider reasoning')
    await reporter.flush()

    expect(textCalls).toHaveLength(0)
  })

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
    expect(textCalls[0]).toContain('AI execution details')
    expect(textCalls[0]).toContain('create_task')
    expect(textCalls[0]).toContain('Visible title')
    expect(textCalls[0]).toContain('42ms')
    expect(textCalls[0]).not.toContain('secret-key')
    expect(textCalls[0]).not.toContain('secret-token')
    expect(textCalls[0]).toContain('[redacted]')
  })

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

    expect(textCalls[0]).toContain('secret query')
    expect(textCalls[0]).toContain('secret result')
  })

  test('emits provider reasoning only when reasoning visibility is on', async () => {
    const { reply, textCalls } = createMockReply()
    const reporter = createAiProgressReporter(reply, {
      toolVisibility: 'off',
      reasoningVisibility: 'on',
      detailLevel: 'sanitized',
    })

    reporter.reasoning('Provider exposed reasoning text')
    await reporter.flush()

    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('Reasoning')
    expect(textCalls[0]).toContain('Provider exposed reasoning text')
  })

  test('raw detail level uses raw provider reasoning when supplied', async () => {
    const { reply, textCalls } = createMockReply()
    const reporter = createAiProgressReporter(reply, {
      toolVisibility: 'off',
      reasoningVisibility: 'on',
      detailLevel: 'raw',
    })

    reporter.reasoning('Provider reasoning text', [{ type: 'reasoning', text: 'raw reasoning payload' }])
    await reporter.flush()

    expect(textCalls[0]).toContain('raw reasoning payload')
  })

  test('does not emit an empty reasoning section', async () => {
    const { reply, textCalls } = createMockReply()
    const reporter = createAiProgressReporter(reply, {
      toolVisibility: 'off',
      reasoningVisibility: 'on',
      detailLevel: 'sanitized',
    })

    reporter.reasoning(undefined)
    reporter.reasoning('')
    await reporter.flush()

    expect(textCalls).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the failing reporter tests**

Run: `bun test tests/ai-progress-reporter.test.ts`

Expected: FAIL with a module resolution error for `../src/ai-progress-reporter.js`.

- [ ] **Step 3: Implement the buffered reporter**

Create `src/ai-progress-reporter.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn } from './chat/types.js'
import type { AiOutputSettings } from './ai-output-settings.js'

type ToolEventBase = {
  toolName: string
  toolCallId: string
  input: unknown
}

export type ToolStartedEvent = ToolEventBase

export type ToolFinishedEvent = ToolEventBase & {
  durationMs: number | undefined
  success: boolean
  output?: unknown
  error?: unknown
}

export type AiProgressReporter = {
  toolStarted: (event: ToolStartedEvent) => void
  toolFinished: (event: ToolFinishedEvent) => void
  reasoning: (text: string | undefined, raw?: unknown) => void
  flush: () => Promise<void>
}

const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|authorization|cookie)/i
const MAX_SANITIZED_STRING_LENGTH = 240

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    return value.length > MAX_SANITIZED_STRING_LENGTH
      ? `${value.slice(0, MAX_SANITIZED_STRING_LENGTH)}... [truncated ${value.length} chars]`
      : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 10).map(sanitizeValue)
  if (!isRecord(value)) return `[${typeof value}]`

  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value).slice(0, 20)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : sanitizeValue(nested)
  }
  return out
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatValue(value: unknown, settings: AiOutputSettings): string {
  return stableStringify(settings.detailLevel === 'raw' ? value : sanitizeValue(value))
}

function appendToolFinished(lines: string[], event: ToolFinishedEvent, settings: AiOutputSettings): void {
  const status = event.success ? 'success' : 'failed'
  const duration = event.durationMs === undefined ? '' : ` in ${event.durationMs}ms`
  lines.push(`- Tool \`${event.toolName}\` ${status}${duration}`)
  lines.push(`  Input: \`${formatValue(event.input, settings)}\``)
  if (event.output !== undefined) lines.push(`  Output: \`${formatValue(event.output, settings)}\``)
  if (event.error !== undefined) lines.push(`  Error: \`${formatValue(formatError(event.error), settings)}\``)
}

export function createAiProgressReporter(reply: ReplyFn, settings: AiOutputSettings): AiProgressReporter {
  const toolLines: string[] = []
  const reasoningLines: string[] = []

  return {
    toolStarted: (event) => {
      if (settings.toolVisibility !== 'on') return
      toolLines.push(`- Tool \`${event.toolName}\` started`)
      toolLines.push(`  Input: \`${formatValue(event.input, settings)}\``)
    },
    toolFinished: (event) => {
      if (settings.toolVisibility !== 'on') return
      appendToolFinished(toolLines, event, settings)
    },
    reasoning: (text, raw) => {
      if (settings.reasoningVisibility !== 'on') return
      if (settings.detailLevel === 'raw' && raw !== undefined) {
        reasoningLines.push(formatValue(raw, settings))
        return
      }
      if (text === undefined || text.trim() === '') return
      reasoningLines.push(text.trim())
    },
    flush: async () => {
      if (toolLines.length === 0 && reasoningLines.length === 0) return
      const lines = ['AI execution details']
      if (toolLines.length > 0) lines.push('', 'Tool calls', ...toolLines)
      if (reasoningLines.length > 0) lines.push('', 'Reasoning', ...reasoningLines)
      await reply.formatted(lines.join('\n'))
      toolLines.length = 0
      reasoningLines.length = 0
    },
  }
}
```

- [ ] **Step 4: Run the reporter tests**

Run: `bun test tests/ai-progress-reporter.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit reporter**

Run:

```bash
git add src/ai-progress-reporter.ts tests/ai-progress-reporter.test.ts
git commit -m "feat: add ai progress reporter"
```

---

### Task 3: Config UI Section and Callbacks

**Files:**

- Create: `src/ai-output-config-ui.ts`
- Create: `tests/ai-output-config-ui.test.ts`
- Modify: `src/commands/config.ts`
- Modify: `src/chat/interaction-router.ts`
- Modify: `tests/commands/config.test.ts`

- [ ] **Step 1: Write failing config UI unit tests**

Create `tests/ai-output-config-ui.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  buildAiOutputConfigSection,
  handleAiOutputConfigCallback,
  parseAiOutputCallbackData,
  serializeAiOutputCallbackData,
} from '../src/ai-output-config-ui.js'
import { getAiOutputSettings } from '../src/ai-output-settings.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('ai-output-config-ui', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('renders default AI output section and buttons', () => {
    const section = buildAiOutputConfigSection('ctx-ui')

    expect(section.lines.join('\n')).toContain('AI Output')
    expect(section.lines.join('\n')).toContain('Tool calls: off')
    expect(section.lines.join('\n')).toContain('Reasoning: off')
    expect(section.lines.join('\n')).toContain('Detail level: sanitized')
    expect(section.buttons.map((button) => button.text)).toEqual([
      'Show tool calls',
      'Show reasoning',
      'Use raw detail',
    ])
  })

  test('serializes and parses callback data with target context', () => {
    const data = serializeAiOutputCallbackData('toolVisibility', 'on', 'group-1:thread-2')

    expect(parseAiOutputCallbackData(data)).toEqual({
      setting: 'toolVisibility',
      value: 'on',
      targetContextId: 'group-1:thread-2',
    })
  })

  test('rejects invalid callback data', () => {
    expect(parseAiOutputCallbackData('cfg:ai:toolVisibility:maybe')).toBeNull()
    expect(parseAiOutputCallbackData('cfg:ai:unknown:on')).toBeNull()
    expect(parseAiOutputCallbackData('cfg:edit:timezone')).toBeNull()
  })

  test('callback writes target context setting and returns refreshed section', () => {
    const result = handleAiOutputConfigCallback('ctx-callback', 'reasoningVisibility', 'on')

    expect(result.handled).toBe(true)
    expect(result.response).toContain('AI Output updated')
    expect(result.response).toContain('Reasoning: on')
    expect(result.buttons?.some((button) => button.text === 'Hide reasoning')).toBe(true)
    expect(getAiOutputSettings('ctx-callback').reasoningVisibility).toBe('on')
  })
})
```

- [ ] **Step 2: Run the failing config UI unit tests**

Run: `bun test tests/ai-output-config-ui.test.ts`

Expected: FAIL with a module resolution error for `../src/ai-output-config-ui.js`.

- [ ] **Step 3: Implement config UI helper**

Create `src/ai-output-config-ui.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatButton } from './chat/types.js'
import {
  getAiOutputSettings,
  setAiOutputSetting,
  type AiOutputSettingName,
  type AiOutputSettings,
} from './ai-output-settings.js'

export type AiOutputConfigSection = {
  lines: string[]
  buttons: ChatButton[]
}

export type AiOutputConfigResult = {
  handled: boolean
  response: string
  buttons: ChatButton[]
}

type CallbackValue<Name extends AiOutputSettingName> = AiOutputSettings[Name]
type ParsedAiOutputCallback = {
  setting: AiOutputSettingName
  value: AiOutputSettings[AiOutputSettingName]
  targetContextId?: string
}

const encodeContextId = (id: string): string => Buffer.from(id).toString('base64url')
const decodeContextId = (encoded: string): string => Buffer.from(encoded, 'base64url').toString('utf8')

function appendContext(base: string, targetContextId: string | undefined): string {
  return targetContextId === undefined ? base : `${base}@${encodeContextId(targetContextId)}`
}

function isSetting(value: string): value is AiOutputSettingName {
  return value === 'toolVisibility' || value === 'reasoningVisibility' || value === 'detailLevel'
}

function isValidSettingValue(
  setting: AiOutputSettingName,
  value: string,
): value is AiOutputSettings[AiOutputSettingName] {
  if (setting === 'detailLevel') return value === 'sanitized' || value === 'raw'
  return value === 'on' || value === 'off'
}

export function serializeAiOutputCallbackData<Name extends AiOutputSettingName>(
  setting: Name,
  value: CallbackValue<Name>,
  targetContextId?: string,
): string {
  return appendContext(`cfg:ai:${setting}:${value}`, targetContextId)
}

export function parseAiOutputCallbackData(data: string): ParsedAiOutputCallback | null {
  if (!data.startsWith('cfg:ai:')) return null
  const atIdx = data.indexOf('@')
  const core = atIdx === -1 ? data : data.slice(0, atIdx)
  let targetContextId: string | undefined
  if (atIdx !== -1) {
    try {
      targetContextId = decodeContextId(data.slice(atIdx + 1))
    } catch {
      targetContextId = undefined
    }
  }

  const [, , settingRaw, valueRaw] = core.split(':')
  if (settingRaw === undefined || valueRaw === undefined || !isSetting(settingRaw)) return null
  if (!isValidSettingValue(settingRaw, valueRaw)) return null
  return { setting: settingRaw, value: valueRaw, targetContextId }
}

function toggleVisibility(value: 'on' | 'off'): 'on' | 'off' {
  return value === 'on' ? 'off' : 'on'
}

function toggleDetailLevel(value: 'sanitized' | 'raw'): 'sanitized' | 'raw' {
  return value === 'raw' ? 'sanitized' : 'raw'
}

export function buildAiOutputConfigSection(targetContextId: string): AiOutputConfigSection {
  const settings = getAiOutputSettings(targetContextId)
  const nextToolVisibility = toggleVisibility(settings.toolVisibility)
  const nextReasoningVisibility = toggleVisibility(settings.reasoningVisibility)
  const nextDetailLevel = toggleDetailLevel(settings.detailLevel)
  return {
    lines: [
      '',
      'AI Output',
      `Tool calls: ${settings.toolVisibility}`,
      `Reasoning: ${settings.reasoningVisibility}`,
      `Detail level: ${settings.detailLevel}${settings.detailLevel === 'raw' ? ' (sensitive)' : ''}`,
    ],
    buttons: [
      {
        text: `${nextToolVisibility === 'on' ? 'Show' : 'Hide'} tool calls`,
        callbackData: serializeAiOutputCallbackData('toolVisibility', nextToolVisibility, targetContextId),
        style: nextToolVisibility === 'on' ? 'primary' : 'danger',
      },
      {
        text: `${nextReasoningVisibility === 'on' ? 'Show' : 'Hide'} reasoning`,
        callbackData: serializeAiOutputCallbackData('reasoningVisibility', nextReasoningVisibility, targetContextId),
        style: nextReasoningVisibility === 'on' ? 'primary' : 'danger',
      },
      {
        text: `Use ${nextDetailLevel} detail`,
        callbackData: serializeAiOutputCallbackData('detailLevel', nextDetailLevel, targetContextId),
        style: nextDetailLevel === 'raw' ? 'danger' : 'secondary',
      },
    ],
  }
}

export function handleAiOutputConfigCallback(
  targetContextId: string,
  setting: AiOutputSettingName,
  value: AiOutputSettings[AiOutputSettingName],
): AiOutputConfigResult {
  setAiOutputSetting(targetContextId, setting, value)
  const section = buildAiOutputConfigSection(targetContextId)
  return {
    handled: true,
    response: ['AI Output updated', ...section.lines].join('\n'),
    buttons: section.buttons,
  }
}
```

- [ ] **Step 4: Run config UI unit tests**

Run: `bun test tests/ai-output-config-ui.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing `/config` rendering test**

Append this test inside `tests/commands/config.test.ts` in the interactive button support describe block:

```typescript
test('renders AI Output section and buttons', async () => {
  const { reply, buttonCalls } = createMockReply()
  await renderConfigForTarget(reply, USER_ID, true)

  assert(buttonCalls[0] !== undefined, 'expected buttonCalls[0] to be defined')
  expect(buttonCalls[0]).toContain('AI Output')
  expect(buttonCalls[0]).toContain('Tool calls: off')
  expect(buttonCalls[0]).toContain('Reasoning: off')
  expect(buttonCalls[0]).toContain('Detail level: sanitized')
})
```

- [ ] **Step 6: Run the failing `/config` rendering test**

Run: `bun test tests/commands/config.test.ts --test-name-pattern "renders AI Output"`

Expected: FAIL because the `/config` output does not contain `AI Output`.

- [ ] **Step 7: Add AI Output section to `/config`**

Modify `src/commands/config.ts`:

```typescript
import { buildAiOutputConfigSection } from '../ai-output-config-ui.js'
```

Then update `renderConfigForTarget()` after `appendPluginConfigLines(lines, targetContextId)`:

```typescript
const aiOutputSection = buildAiOutputConfigSection(targetContextId)
lines.push(...aiOutputSection.lines)
```

Then update the interactive buttons call:

```typescript
await reply.buttons(lines.join('\n'), {
  buttons: [
    ...buildConfigButtons(config, targetContextId),
    ...buildPluginButtons(targetContextId),
    ...aiOutputSection.buttons,
  ],
})
```

- [ ] **Step 8: Run `/config` tests**

Run: `bun test tests/commands/config.test.ts`

Expected: PASS.

- [ ] **Step 9: Route AI Output callbacks through interaction router**

Modify `src/chat/interaction-router.ts` imports:

```typescript
import { handleAiOutputConfigCallback, parseAiOutputCallbackData } from '../ai-output-config-ui.js'
```

Add this helper above `defaultHandleConfigInteraction()`:

```typescript
async function handleAiOutputConfigInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
): Promise<boolean | null> {
  const parsed = parseAiOutputCallbackData(interaction.callbackData)
  if (parsed === null) return null

  const targetContextId = getTargetContextId(parsed.targetContextId, interaction)
  if (
    interaction.contextType === 'dm' &&
    parsed.targetContextId === undefined &&
    !(await validateImplicitDmConfigTarget(interaction.user.id, reply))
  ) {
    return true
  }
  if (interaction.contextType === 'dm' && parsed.targetContextId !== undefined) {
    const validatedTargetContextId = getValidatedDmCallbackTargetContextId(interaction.user.id, targetContextId)
    if (validatedTargetContextId === null) {
      await replyTextPreferReplace(reply, getMissingGroupTargetMessage(interaction.user.id, targetContextId))
      return true
    }
  }

  const result = handleAiOutputConfigCallback(targetContextId, parsed.setting, parsed.value)
  await replyButtonsPreferReplace(
    reply,
    result.response,
    result.buttons.map((button) => ({ text: button.text, callbackData: button.callbackData, style: button.style })),
  )
  return true
}
```

Then add this near the start of `defaultHandleConfigInteraction()` after the `startsWith('cfg:')` guard:

```typescript
const aiOutputHandled = await handleAiOutputConfigInteraction(interaction, reply)
if (aiOutputHandled !== null) return aiOutputHandled
```

- [ ] **Step 10: Add an interaction-router callback test**

Append to the existing interaction-router test file if present. If no focused file exists, create `tests/chat/interaction-router-ai-output.test.ts` with this test:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { routeInteraction } from '../../src/chat/interaction-router.js'
import type { IncomingInteraction } from '../../src/chat/types.js'
import { serializeAiOutputCallbackData } from '../../src/ai-output-config-ui.js'
import { getAiOutputSettings } from '../../src/ai-output-settings.js'
import { createAuth, createMockReply, mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('interaction-router AI output callbacks', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('updates AI output setting for callback target context', async () => {
    const interaction: IncomingInteraction = {
      kind: 'button',
      user: { id: 'user-1', username: null, isAdmin: true },
      contextId: 'user-1',
      contextType: 'dm',
      storageContextId: 'user-1',
      callbackData: serializeAiOutputCallbackData('toolVisibility', 'on', 'user-1'),
    }
    const { reply, buttonCalls } = createMockReply()

    await routeInteraction(interaction, reply, createAuth('user-1'))

    expect(getAiOutputSettings('user-1').toolVisibility).toBe('on')
    expect(buttonCalls[0]).toContain('AI Output updated')
  })
})
```

- [ ] **Step 11: Run config and interaction tests**

Run: `bun test tests/ai-output-config-ui.test.ts tests/commands/config.test.ts tests/chat/interaction-router-ai-output.test.ts`

Expected: PASS.

- [ ] **Step 12: Commit config UI**

Run:

```bash
git add src/ai-output-config-ui.ts src/commands/config.ts src/chat/interaction-router.ts tests/ai-output-config-ui.test.ts tests/commands/config.test.ts tests/chat/interaction-router-ai-output.test.ts
git commit -m "feat: add ai output config controls"
```

---

### Task 4: Wire Reporter Into Tool Hooks

**Files:**

- Modify: `src/llm-orchestrator-types.ts`
- Modify: `src/llm-orchestrator-invoke.ts`
- Modify: `tests/llm-orchestrator-invoke.test.ts`

- [ ] **Step 1: Write failing hook tests**

Modify `tests/llm-orchestrator-invoke.test.ts` imports:

```typescript
import type { AiProgressReporter } from '../src/ai-progress-reporter.js'
```

Add this helper below `baseContext()`:

```typescript
function createReporterSpy(): { reporter: AiProgressReporter; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    reporter: {
      toolStarted: (event) => {
        calls.push(`started:${event.toolName}:${event.toolCallId}`)
      },
      toolFinished: (event) => {
        calls.push(`finished:${event.toolName}:${event.toolCallId}:${event.success}`)
      },
      reasoning: (text) => {
        calls.push(`reasoning:${text ?? ''}`)
      },
      flush: () => Promise.resolve(),
    },
  }
}
```

Add this test in `describe('handleToolCallStart')`:

```typescript
test('forwards tool start to progress reporter', () => {
  const { reporter, calls } = createReporterSpy()

  handleToolCallStart(
    { ...baseContext(), progressReporter: reporter },
    {
      toolCall: {
        toolName: 'search_tasks',
        toolCallId: 'call-start',
        input: { query: 'x' },
      },
    },
  )

  expect(calls).toEqual(['started:search_tasks:call-start'])
})
```

Add this test in `describe('handleToolCallFinishEvent')`:

```typescript
test('forwards tool finish to progress reporter without user-warning reply', () => {
  const { reporter, calls } = createReporterSpy()

  handleToolCallFinishEvent({ ...baseContext(), progressReporter: reporter }, undefined, {
    toolCall: {
      toolName: 'search_tasks',
      toolCallId: 'call-finish',
      input: { query: 'x' },
    },
    durationMs: 9,
    success: false,
    error: new Error('boom'),
  })

  expect(calls).toEqual(['finished:search_tasks:call-finish:false'])
})
```

- [ ] **Step 2: Run failing hook tests**

Run: `bun test tests/llm-orchestrator-invoke.test.ts --test-name-pattern "progress reporter|forwards tool"`

Expected: FAIL because `ToolCallContext` has no `progressReporter` field and hooks do not call it.

- [ ] **Step 3: Add reporter types to invocation args**

Modify `src/llm-orchestrator-types.ts` imports:

```typescript
import type { AiProgressReporter } from './ai-progress-reporter.js'
```

Update `InvokeModelArgs`:

```typescript
export type InvokeModelArgs = {
  contextId: string
  chatUserId: string
  contextType: 'dm' | 'group'
  mainModel: string
  model: ReturnType<ReturnType<typeof createOpenAICompatible>>
  provider: TaskProvider
  tools: ToolSet
  toolRouting: ToolRoutingInfo | undefined
  messages: ModelMessage[]
  deps: LlmOrchestratorDeps
  progressReporter?: AiProgressReporter
}
```

- [ ] **Step 4: Forward tool events to reporter and suppress legacy warning replies**

Modify `src/llm-orchestrator-invoke.ts` imports:

```typescript
import type { AiProgressReporter } from './ai-progress-reporter.js'
```

Update `ToolCallContext`:

```typescript
export type ToolCallContext = {
  contextId: string
  chatUserId: string
  contextType: 'dm' | 'group'
  model: string
  modelRole: 'main' | 'small'
  turnId: string
  progressReporter?: AiProgressReporter
}
```

At the end of `handleToolCallStart()`, add:

```typescript
ctx.progressReporter?.toolStarted({
  toolName: event.toolCall.toolName,
  toolCallId: event.toolCall.toolCallId,
  input: event.toolCall.input,
})
```

In `handleToolCallFinishEvent()`, add the reporter call before `handleToolCallFinish(...)`:

```typescript
ctx.progressReporter?.toolFinished({
  toolName: event.toolCall.toolName,
  toolCallId: event.toolCall.toolCallId,
  input: event.toolCall.input,
  durationMs: event.durationMs,
  success: event.success,
  output: event.output,
  error: event.error,
})
```

Then change the final support call to avoid direct user-warning replies:

```typescript
handleToolCallFinish(ctx.contextId, undefined, event)
```

This preserves `llm:tool_result` debug/trace emission while moving user-visible tool failure messages to `AiProgressReporter`.

In `invokeModel()`, include the reporter in `ctx`:

```typescript
    progressReporter: args.progressReporter,
```

- [ ] **Step 5: Run hook tests**

Run: `bun test tests/llm-orchestrator-invoke.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit hook wiring**

Run:

```bash
git add src/llm-orchestrator-types.ts src/llm-orchestrator-invoke.ts tests/llm-orchestrator-invoke.test.ts
git commit -m "feat: route tool progress through reporter"
```

---

### Task 5: Orchestrator Integration and Reasoning Output

**Files:**

- Modify: `src/llm-orchestrator-events.ts`
- Modify: `src/llm-orchestrator.ts`
- Modify: `tests/llm-orchestrator.test.ts`

- [ ] **Step 1: Update test result type to include reasoning text**

Modify `tests/llm-orchestrator.test.ts` `GenerateTextResult` type:

```typescript
type GenerateTextResult = {
  text: string
  reasoningText?: string
  reasoning?: unknown
  toolCalls: Array<{ toolName: string; toolCallId: string; input: unknown }>
  toolResults: Array<{ toolName: string; toolCallId: string; output: unknown }>
  steps: unknown[]
  response: { messages: ModelMessage[] } & ResponseMetadata
  usage: Record<string, unknown>
  finishReason: string
  warnings: unknown[] | undefined
  request: unknown
  providerMetadata: unknown
}
```

Update `defaultGenerateTextResult()` to include no reasoning text by omission.

- [ ] **Step 2: Replace old default tool warning tests with new default-off expectation**

In `tests/llm-orchestrator.test.ts`, replace the test named `sends immediate user feedback when tool execution fails` with:

```typescript
test('does not send intermediate tool failure feedback by default', async () => {
  seedConfigForContext('tool-fail-ctx')

  generateTextImpl = (args): Promise<GenerateTextResult> => {
    args.experimental_onToolCallFinish?.({
      toolCall: { toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test' } },
      durationMs: 100,
      success: false,
      error: new Error('Task creation failed'),
    })
    return Promise.resolve({
      text: 'Done!',
      toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test' } }],
      toolResults: [{ toolName: 'create_task', toolCallId: 'call-1', output: { error: 'failed' } }],
      steps: [],
      response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
      usage: {},
      finishReason: 'stop',
      warnings: undefined,
      request: {},
      providerMetadata: undefined,
    })
  }

  const { reply, textCalls } = createMockReply()

  await processMessage(reply, 'tool-fail-ctx', 'user-1', null, 'create a task', 'dm')

  expect(textCalls).toEqual(['Done!'])
})
```

Delete these two old tests from `tests/llm-orchestrator.test.ts` because `tests/llm-orchestrator-invoke.test.ts` already covers non-Error and structured tool-failure shapes after tool-hook routing changes:

```typescript
test('handles non-Error objects in tool failure callback', async () => {
  // delete this entire test block
})

test('sends immediate user feedback when a tool returns a structured failure result', async () => {
  // delete this entire test block
})
```

- [ ] **Step 3: Add enabled tool-output integration test**

Add this test in the `tool execution failure` describe block:

```typescript
test('flushes tool details when tool visibility is on', async () => {
  seedConfigForContext('tool-visible-ctx')
  setCachedConfig('tool-visible-ctx', 'ai_tool_visibility', 'on')

  generateTextImpl = (args): Promise<GenerateTextResult> => {
    args.experimental_onToolCallFinish?.({
      toolCall: { toolName: 'search_tasks', toolCallId: 'call-visible', input: { query: 'visible query' } },
      durationMs: 12,
      success: true,
      output: { count: 2 },
    })
    return Promise.resolve({
      text: 'Done!',
      toolCalls: [],
      toolResults: [],
      steps: [],
      response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
      usage: {},
      finishReason: 'stop',
      warnings: undefined,
      request: {},
      providerMetadata: undefined,
    })
  }

  const { reply, textCalls } = createMockReply()

  await processMessage(reply, 'tool-visible-ctx', 'user-1', null, 'search tasks', 'dm')

  expect(textCalls[0]).toBe('Done!')
  expect(textCalls.some((text) => text.includes('AI execution details'))).toBe(true)
  expect(textCalls.some((text) => text.includes('search_tasks'))).toBe(true)
})
```

- [ ] **Step 4: Add reasoning integration tests**

Add this describe block near other success-path tests:

```typescript
describe('reasoning visibility', () => {
  test('does not show provider reasoning by default', async () => {
    seedConfigForContext('reasoning-hidden-ctx')
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({
        text: 'Done!',
        reasoningText: 'Provider reasoning text',
        toolCalls: [],
        toolResults: [],
        steps: [],
        response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
        usage: {},
        finishReason: 'stop',
        warnings: undefined,
        request: {},
        providerMetadata: undefined,
      })

    const { reply, textCalls } = createMockReply()
    await processMessage(reply, 'reasoning-hidden-ctx', 'user-1', null, 'hello', 'dm')

    expect(textCalls).toEqual(['Done!'])
  })

  test('shows provider reasoning when reasoning visibility is on', async () => {
    seedConfigForContext('reasoning-visible-ctx')
    setCachedConfig('reasoning-visible-ctx', 'ai_reasoning_visibility', 'on')
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({
        text: 'Done!',
        reasoningText: 'Provider reasoning text',
        toolCalls: [],
        toolResults: [],
        steps: [],
        response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
        usage: {},
        finishReason: 'stop',
        warnings: undefined,
        request: {},
        providerMetadata: undefined,
      })

    const { reply, textCalls } = createMockReply()
    await processMessage(reply, 'reasoning-visible-ctx', 'user-1', null, 'hello', 'dm')

    expect(textCalls[0]).toBe('Done!')
    expect(textCalls[1]).toContain('Reasoning')
    expect(textCalls[1]).toContain('Provider reasoning text')
  })
})
```

- [ ] **Step 5: Run failing orchestrator integration tests**

Run: `bun test tests/llm-orchestrator.test.ts --test-name-pattern "tool failure|reasoning visibility|tool details"`

Expected: FAIL because `processMessage()` does not create or flush an AI progress reporter and result type does not expose `reasoningText` in production types.

- [ ] **Step 6: Add reasoningText to resolved result type**

Modify `src/llm-orchestrator-events.ts` `ResolvedStreamTextResult`:

```typescript
export type ResolvedStreamTextResult = {
  text: string
  reasoningText: string | undefined
  reasoning: unknown
  toolCalls: Array<ResultToolCall>
  toolResults: Array<ResultToolResult>
  steps: Array<ResultStep>
  response: ResultResponse
  usage: TokenUsage
  finishReason: string
} & Partial<{
  warnings: unknown[]
  request: unknown
  providerMetadata: unknown
}>
```

If TypeScript reports `reasoningText` as optional on the AI SDK result, keep the text field optional in this local type:

```typescript
  reasoningText?: string
  reasoning?: unknown
```

Then use `result.reasoningText` safely in the orchestrator.

- [ ] **Step 7: Create and flush reporter in orchestrator**

Modify `src/llm-orchestrator.ts` imports:

```typescript
import { createAiProgressReporter, type AiProgressReporter } from './ai-progress-reporter.js'
import { getAiOutputSettings } from './ai-output-settings.js'
```

Update `sendLlmResponse()` signature and body:

```typescript
const sendLlmResponse = async (
  reply: ReplyFn,
  contextId: string,
  result: { text: string | undefined; toolCalls: unknown[] | undefined; response: { messages: ModelMessage[] } },
  progressReporter?: AiProgressReporter,
): Promise<void> => {
  const textToFormat = result.text !== undefined && result.text !== '' ? result.text : 'Done.'
  const responseLength = result.text === undefined ? 0 : result.text.length
  const toolCallCount = result.toolCalls === undefined ? 0 : result.toolCalls.length
  await reply.formatted(textToFormat)
  await progressReporter?.flush()
  log.info({ contextId, responseLength, toolCalls: toolCallCount }, 'Response sent successfully')
}
```

In `callLlm()`, after `prepareLlmInvocation(...)`, create the reporter:

```typescript
const progressReporter = createAiProgressReporter(reply, getAiOutputSettings(contextId))
```

Pass it into `invokeModelWithTyping()`:

```typescript
    progressReporter,
```

After `const result = await invokeModelWithTyping(...)`, before `persistFactsFromResults(...)`, report reasoning:

```typescript
progressReporter.reasoning(result.reasoningText, result.reasoning)
```

Then call:

```typescript
await sendLlmResponse(reply, contextId, result, progressReporter)
```

- [ ] **Step 8: Run orchestrator integration tests**

Run: `bun test tests/llm-orchestrator.test.ts --test-name-pattern "tool failure|reasoning visibility|tool details"`

Expected: PASS.

- [ ] **Step 9: Run related orchestrator tests**

Run: `bun test tests/llm-orchestrator.test.ts tests/llm-orchestrator-invoke.test.ts tests/llm-orchestrator-support.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit orchestrator integration**

Run:

```bash
git add src/llm-orchestrator.ts src/llm-orchestrator-events.ts tests/llm-orchestrator.test.ts
git commit -m "feat: show configured ai output details"
```

---

### Task 6: Final Verification and Documentation Check

**Files:**

- Modify only files changed by prior tasks if verification exposes issues.

- [ ] **Step 1: Run focused feature tests**

Run:

```bash
bun test tests/ai-output-settings.test.ts tests/ai-progress-reporter.test.ts tests/ai-output-config-ui.test.ts tests/commands/config.test.ts tests/llm-orchestrator-invoke.test.ts tests/llm-orchestrator.test.ts tests/llm-orchestrator-support.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck`

Expected: PASS.

- [ ] **Step 3: Run lint on changed implementation files**

Run:

```bash
bun lint:agent-strict -- src/ai-output-settings.ts src/ai-progress-reporter.ts src/ai-output-config-ui.ts src/commands/config.ts src/chat/interaction-router.ts src/llm-orchestrator-types.ts src/llm-orchestrator-invoke.ts src/llm-orchestrator-events.ts src/llm-orchestrator.ts
```

Expected: PASS.

- [ ] **Step 4: Run formatting check**

Run: `bun format:check`

Expected: PASS.

- [ ] **Step 5: Inspect git diff for scope**

Run: `git diff --stat && git diff -- src client tests docs/superpowers/specs/2026-05-25-ai-output-visibility-design.md`

Expected: Diff contains only AI output settings, reporter, `/config` integration, orchestrator wiring, and tests. It must not modify debug dashboard/client files.

- [ ] **Step 6: Commit final fixes if any were required**

If Step 1 through Step 5 required fixes, run:

```bash
git add <fixed-files>
git commit -m "fix: stabilize ai output visibility"
```

If no fixes were required, do not create an empty commit.

---

## Self-Review Notes

Spec coverage:

- Context-scoped settings are implemented in Task 1.
- `/config`-only control and existing permission reuse are implemented in Task 3.
- Separate tool and reasoning toggles plus sanitized/raw level are implemented in Tasks 1 through 3.
- User-visible reporting boundary is implemented in Task 2 and wired in Tasks 4 and 5.
- Debug tracing remains separate because Task 4 preserves debug emissions and Task 6 explicitly checks no debug UI changes.
- Reasoning is provider-exposed only through `result.reasoningText` in Task 5.
- Default `off/off/sanitized` behavior and suppression of tool failure warnings are tested in Tasks 1 and 5.

Placeholder scan:

- The plan contains no placeholder markers, no deferred implementation steps, and no unscoped “add tests” instructions.

Type consistency:

- Setting names are consistently `toolVisibility`, `reasoningVisibility`, and `detailLevel` in TypeScript, mapped to stored keys `ai_tool_visibility`, `ai_reasoning_visibility`, and `ai_output_detail_level`.
- `AiProgressReporter` is the single reporter type used in settings, invoke hooks, and orchestrator wiring.
