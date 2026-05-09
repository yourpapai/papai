# Telemetry & Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenTelemetry metrics with Prometheus export to papai for alerting, performance monitoring, and usage analytics.

**Architecture:** A new `src/telemetry/` module provides a thin façade over the OTel SDK. Most metrics are collected by subscribing to the existing debug event bus — no changes to the orchestrator, bot, or reply-tracking modules. Provider metrics use the existing DI pattern. When `OTEL_ENABLED` is not `true`, no-op instruments avoid all OTel imports.

**Tech Stack:** `@opentelemetry/api`, `@opentelemetry/sdk-metrics`, `@opentelemetry/exporter-prometheus`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`

**Spec:** `docs/superpowers/specs/2026-04-26-telemetry-metrics-design.md`

---

## File Structure

| File                                  | Responsibility                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/telemetry/noop.ts`               | No-op instrument implementations for when telemetry is disabled                              |
| `src/telemetry/types.ts`              | Shared interfaces for instruments and the recorder                                           |
| `src/telemetry/meter.ts`              | OTel MeterProvider + Prometheus exporter initialization                                      |
| `src/telemetry/instruments.ts`        | Creates all OTel instruments (counters, histograms, gauges)                                  |
| `src/telemetry/subscriber.ts`         | Subscribes to debug event bus, maps events to instrument calls                               |
| `src/telemetry/index.ts`              | Public API: `initTelemetry()`, `shutdownTelemetry()`, `instruments`, `getProviderRecorder()` |
| `tests/telemetry/noop.test.ts`        | Tests for no-op instruments                                                                  |
| `tests/telemetry/instruments.test.ts` | Tests for real instrument creation and recording                                             |
| `tests/telemetry/subscriber.test.ts`  | Tests for event bus → metric mapping                                                         |
| `src/index.ts`                        | Modified: init telemetry before startup, shutdown on signal                                  |
| `src/web/fetch-extract.ts`            | Modified: add web fetch metrics via direct calls                                             |
| `src/providers/youtrack/client.ts`    | Modified: inject provider recorder                                                           |
| `src/providers/kaneo/client.ts`       | Modified: inject provider recorder                                                           |
| `src/scheduler.ts`                    | Modified: add tick duration and recurring task counter                                       |

---

### Task 1: Install dependencies

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install OTel packages**

```bash
bun add @opentelemetry/api @opentelemetry/sdk-metrics @opentelemetry/exporter-prometheus @opentelemetry/resources @opentelemetry/semantic-conventions
```

- [ ] **Step 2: Verify installation**

Run: `bun install`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add OpenTelemetry dependencies for metrics"
```

---

### Task 2: Create telemetry types and no-op instruments

**Files:**

- Create: `src/telemetry/types.ts`
- Create: `src/telemetry/noop.ts`
- Create: `tests/telemetry/noop.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/telemetry/noop.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import { noopInstruments, noopProviderRecorder } from '../../src/telemetry/noop.js'

describe('noop instruments', () => {
  test('counter add does not throw', () => {
    expect(() => noopInstruments.llmRequestTotal.add(1, { model: 'gpt-4o', finish_reason: 'stop' })).not.toThrow()
  })

  test('histogram record does not throw', () => {
    expect(() =>
      noopInstruments.llmRequestDuration.record(100, { model: 'gpt-4o', finish_reason: 'stop' }),
    ).not.toThrow()
  })

  test('all instrument fields are present', () => {
    const keys = Object.keys(noopInstruments)
    expect(keys.length).toBeGreaterThan(0)
    expect(keys).toContain('llmRequestDuration')
    expect(keys).toContain('llmRequestTotal')
    expect(keys).toContain('llmRequestErrors')
    expect(keys).toContain('llmTokensInput')
    expect(keys).toContain('llmTokensOutput')
    expect(keys).toContain('llmSteps')
    expect(keys).toContain('toolExecutionDuration')
    expect(keys).toContain('toolExecutionTotal')
    expect(keys).toContain('toolExecutionErrors')
    expect(keys).toContain('messageReceivedTotal')
    expect(keys).toContain('messageProcessingDuration')
    expect(keys).toContain('authDeniedTotal')
    expect(keys).toContain('webFetchDuration')
    expect(keys).toContain('webFetchTotal')
    expect(keys).toContain('webFetchErrors')
    expect(keys).toContain('providerRequestDuration')
    expect(keys).toContain('providerRequestErrors')
    expect(keys).toContain('schedulerTickDuration')
    expect(keys).toContain('schedulerRecurringFired')
  })

  test('noop provider recorder does not throw', () => {
    expect(() => noopProviderRecorder.recordRequest('kaneo', 'createTask', 100)).not.toThrow()
    expect(() => noopProviderRecorder.recordRequest('youtrack', 'createTask', 100, 'timeout')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry/noop.test.ts`
Expected: FAIL — module `../../src/telemetry/noop.js` not found

- [ ] **Step 3: Create types file**

Create `src/telemetry/types.ts`:

```typescript
export interface TelemetryCounter {
  add(value: number, attributes?: Record<string, string | number | boolean>): void
}

export interface TelemetryHistogram {
  record(value: number, attributes?: Record<string, string | number | boolean>): void
}

export interface Instruments {
  llmRequestDuration: TelemetryHistogram
  llmRequestTotal: TelemetryCounter
  llmRequestErrors: TelemetryCounter
  llmTokensInput: TelemetryCounter
  llmTokensOutput: TelemetryCounter
  llmSteps: TelemetryHistogram
  toolExecutionDuration: TelemetryHistogram
  toolExecutionTotal: TelemetryCounter
  toolExecutionErrors: TelemetryCounter
  messageReceivedTotal: TelemetryCounter
  messageProcessingDuration: TelemetryHistogram
  authDeniedTotal: TelemetryCounter
  webFetchDuration: TelemetryHistogram
  webFetchTotal: TelemetryCounter
  webFetchErrors: TelemetryCounter
  providerRequestDuration: TelemetryHistogram
  providerRequestErrors: TelemetryCounter
  schedulerTickDuration: TelemetryHistogram
  schedulerRecurringFired: TelemetryCounter
}

export interface ProviderMetricsRecorder {
  recordRequest(provider: string, operation: string, durationMs: number, error?: string): void
}
```

- [ ] **Step 4: Create no-op instruments**

Create `src/telemetry/noop.ts`:

```typescript
import type { Instruments, ProviderMetricsRecorder, TelemetryCounter, TelemetryHistogram } from './types.js'

const noopCounter: TelemetryCounter = {
  add() {},
}

const noopHistogram: TelemetryHistogram = {
  record() {},
}

export const noopInstruments: Instruments = {
  llmRequestDuration: noopHistogram,
  llmRequestTotal: noopCounter,
  llmRequestErrors: noopCounter,
  llmTokensInput: noopCounter,
  llmTokensOutput: noopCounter,
  llmSteps: noopHistogram,
  toolExecutionDuration: noopHistogram,
  toolExecutionTotal: noopCounter,
  toolExecutionErrors: noopCounter,
  messageReceivedTotal: noopCounter,
  messageProcessingDuration: noopHistogram,
  authDeniedTotal: noopCounter,
  webFetchDuration: noopHistogram,
  webFetchTotal: noopCounter,
  webFetchErrors: noopCounter,
  providerRequestDuration: noopHistogram,
  providerRequestErrors: noopCounter,
  schedulerTickDuration: noopHistogram,
  schedulerRecurringFired: noopCounter,
}

export const noopProviderRecorder: ProviderMetricsRecorder = {
  recordRequest() {},
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/telemetry/noop.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/telemetry/types.ts src/telemetry/noop.ts tests/telemetry/noop.test.ts
git commit -m "feat(telemetry): add types and no-op instruments"
```

---

### Task 3: Create OTel meter provider and real instruments

**Files:**

- Create: `src/telemetry/meter.ts`
- Create: `src/telemetry/instruments.ts`
- Create: `tests/telemetry/instruments.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/telemetry/instruments.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

import type { Instruments } from '../../src/telemetry/instruments.js'

let instruments: Instruments
let cleanup: () => Promise<void>

describe('real instruments', () => {
  beforeEach(async () => {
    process.env['OTEL_ENABLED'] = 'true'
    process.env['OTEL_PROMETHEUS_PORT'] = '0'
    const mod = await import('../../src/telemetry/instruments.js')
    instruments = mod.initRealInstruments()
    cleanup = mod.shutdownTestInstruments
  })

  afterEach(async () => {
    await cleanup()
    delete process.env['OTEL_ENABLED']
    delete process.env['OTEL_PROMETHEUS_PORT']
  })

  test('counter add does not throw', () => {
    expect(() => instruments.llmRequestTotal.add(1, { model: 'gpt-4o', finish_reason: 'stop' })).not.toThrow()
  })

  test('histogram record does not throw', () => {
    expect(() => instruments.llmRequestDuration.record(100, { model: 'gpt-4o', finish_reason: 'stop' })).not.toThrow()
  })

  test('provider recorder records duration', () => {
    const { getProviderRecorder } = await import('../../src/telemetry/instruments.js')
    const recorder = getProviderRecorder()
    expect(() => recorder.recordRequest('kaneo', 'createTask', 150)).not.toThrow()
    expect(() => recorder.recordRequest('youtrack', 'listTasks', 50, 'timeout')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry/instruments.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create meter provider**

Create `src/telemetry/meter.ts`:

```typescript
import { metrics } from '@opentelemetry/api'
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus'
import { MeterProvider } from '@opentelemetry/sdk-metrics'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'telemetry:meter' })

let meterProvider: MeterProvider | null = null
let prometheusExporter: PrometheusExporter | null = null

export function createMeterProvider(): MeterProvider {
  const port = parseInt(process.env['OTEL_PROMETHEUS_PORT'] ?? '9464', 10)
  const serviceName = process.env['OTEL_SERVICE_NAME'] ?? 'papai'

  prometheusExporter = new PrometheusExporter({ port, endpoint: '/metrics' })

  meterProvider = new MeterProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    readers: [prometheusExporter],
  })

  metrics.setGlobalMeterProvider(meterProvider)

  log.info({ port, serviceName }, 'Telemetry meter provider initialized with Prometheus exporter')

  return meterProvider
}

export async function shutdownMeterProvider(): Promise<void> {
  if (meterProvider === null) return
  log.info('Shutting down telemetry meter provider')
  await meterProvider.shutdown()
  meterProvider = null
  prometheusExporter = null
}

export function getMeterProvider(): MeterProvider | null {
  return meterProvider
}
```

- [ ] **Step 4: Create real instruments**

Create `src/telemetry/instruments.ts`:

```typescript
import type { Meter } from '@opentelemetry/api'

import { createMeterProvider, shutdownMeterProvider } from './meter.js'
import type { Instruments, ProviderMetricsRecorder } from './types.js'

const LLM_DURATION_BOUNDARIES = [500, 1000, 2000, 5000, 10000, 20000, 30000, 60000, 120000]
const TOOL_DURATION_BOUNDARIES = [10, 50, 100, 250, 500, 1000, 2500, 5000]
const WEB_FETCH_DURATION_BOUNDARIES = [100, 250, 500, 1000, 2500, 5000, 10000]
const PROVIDER_DURATION_BOUNDARIES = [50, 100, 250, 500, 1000, 2500, 5000]
const MESSAGE_DURATION_BOUNDARIES = [500, 1000, 2000, 5000, 10000, 20000, 30000, 60000]
const SCHEDULER_TICK_BOUNDARIES = [10, 50, 100, 250, 500, 1000, 2500, 5000]

function buildInstruments(meter: Meter): Instruments {
  return {
    llmRequestDuration: meter.createHistogram('papai.llm.request.duration', {
      description: 'Duration of LLM requests in milliseconds',
      unit: 'ms',
      advice: { explicitBucketBoundaries: LLM_DURATION_BOUNDARIES },
    }),
    llmRequestTotal: meter.createCounter('papai.llm.request.total', {
      description: 'Total number of LLM requests',
    }),
    llmRequestErrors: meter.createCounter('papai.llm.request.errors', {
      description: 'Total number of LLM request errors',
    }),
    llmTokensInput: meter.createCounter('papai.llm.tokens.input', {
      description: 'Total input tokens consumed by LLM requests',
    }),
    llmTokensOutput: meter.createCounter('papai.llm.tokens.output', {
      description: 'Total output tokens generated by LLM requests',
    }),
    llmSteps: meter.createHistogram('papai.llm.steps', {
      description: 'Number of steps per LLM request',
    }),
    toolExecutionDuration: meter.createHistogram('papai.tool.execution.duration', {
      description: 'Duration of tool executions in milliseconds',
      unit: 'ms',
      advice: { explicitBucketBoundaries: TOOL_DURATION_BOUNDARIES },
    }),
    toolExecutionTotal: meter.createCounter('papai.tool.execution.total', {
      description: 'Total number of tool executions',
    }),
    toolExecutionErrors: meter.createCounter('papai.tool.execution.errors', {
      description: 'Total number of tool execution errors',
    }),
    messageReceivedTotal: meter.createCounter('papai.message.received.total', {
      description: 'Total number of messages received from chat providers',
    }),
    messageProcessingDuration: meter.createHistogram('papai.message.processing.duration', {
      description: 'Duration from message received to reply completed in milliseconds',
      unit: 'ms',
      advice: { explicitBucketBoundaries: MESSAGE_DURATION_BOUNDARIES },
    }),
    authDeniedTotal: meter.createCounter('papai.auth.denied.total', {
      description: 'Total number of denied authorization attempts',
    }),
    webFetchDuration: meter.createHistogram('papai.web.fetch.duration', {
      description: 'Duration of web fetch operations in milliseconds',
      unit: 'ms',
      advice: { explicitBucketBoundaries: WEB_FETCH_DURATION_BOUNDARIES },
    }),
    webFetchTotal: meter.createCounter('papai.web.fetch.total', {
      description: 'Total number of web fetch operations',
    }),
    webFetchErrors: meter.createCounter('papai.web.fetch.errors', {
      description: 'Total number of web fetch errors',
    }),
    providerRequestDuration: meter.createHistogram('papai.provider.request.duration', {
      description: 'Duration of task provider API requests in milliseconds',
      unit: 'ms',
      advice: { explicitBucketBoundaries: PROVIDER_DURATION_BOUNDARIES },
    }),
    providerRequestErrors: meter.createCounter('papai.provider.request.errors', {
      description: 'Total number of task provider API request errors',
    }),
    schedulerTickDuration: meter.createHistogram('papai.scheduler.tick.duration', {
      description: 'Duration of scheduler tick cycles in milliseconds',
      unit: 'ms',
      advice: { explicitBucketBoundaries: SCHEDULER_TICK_BOUNDARIES },
    }),
    schedulerRecurringFired: meter.createCounter('papai.scheduler.recurring.fired', {
      description: 'Total number of recurring tasks fired by the scheduler',
    }),
  }
}

let _instruments: Instruments | null = null
let _providerRecorder: ProviderMetricsRecorder | null = null

export function initRealInstruments(): Instruments {
  const provider = createMeterProvider()
  const meter = provider.getMeter('papai')
  _instruments = buildInstruments(meter)

  const inst = _instruments
  _providerRecorder = {
    recordRequest(provider, operation, durationMs, error) {
      const attrs: Record<string, string | number> = { provider, operation }
      inst.providerRequestDuration.record(durationMs, attrs)
      if (error !== undefined) {
        attrs.error_class = error
        inst.providerRequestErrors.add(1, attrs)
      }
    },
  }

  return _instruments
}

export function getProviderRecorder(): ProviderMetricsRecorder {
  if (_providerRecorder === null) {
    throw new Error('Provider recorder not initialized. Call initRealInstruments() first.')
  }
  return _providerRecorder
}

export async function shutdownTestInstruments(): Promise<void> {
  await shutdownMeterProvider()
  _instruments = null
  _providerRecorder = null
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/telemetry/instruments.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/telemetry/meter.ts src/telemetry/instruments.ts tests/telemetry/instruments.test.ts
git commit -m "feat(telemetry): add OTel meter provider and real instruments"
```

---

### Task 4: Create event bus subscriber

**Files:**

- Create: `src/telemetry/subscriber.ts`
- Create: `tests/telemetry/subscriber.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/telemetry/subscriber.test.ts`:

```typescript
import { beforeEach, describe, expect, test, afterEach } from 'bun:test'

import { emit, subscribe, unsubscribe } from '../../src/debug/event-bus.js'
import type { DebugEvent } from '../../src/debug/event-bus.js'
import type { TelemetryCounter, TelemetryHistogram } from '../../src/telemetry/types.js'

interface RecordedCall {
  method: 'add' | 'record'
  value: number
  attributes?: Record<string, string | number | boolean>
}

function createRecordingInstrument(): {
  counter: TelemetryCounter
  histogram: TelemetryHistogram
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  return {
    calls,
    counter: {
      add(value: number, attributes?: Record<string, string | number | boolean>) {
        calls.push({ method: 'add', value, attributes })
      },
    },
    histogram: {
      record(value: number, attributes?: Record<string, string | number | boolean>) {
        calls.push({ method: 'record', value, attributes })
      },
    },
  }
}

describe('telemetry subscriber', () => {
  let capturedEvents: DebugEvent[] = []

  beforeEach(() => {
    capturedEvents = []
    const listener = (event: DebugEvent): void => {
      capturedEvents.push(event)
    }
    subscribe(listener)

    afterEach(() => {
      unsubscribe(listener)
    })
  })

  test('llm:end event records duration, total, tokens, and steps', async () => {
    const {
      subscribe: sub,
      unsubscribe: unsub,
      startEventSubscriber,
    } = await import('../../src/telemetry/subscriber.js')
    const recordingInstruments = await import('../../src/telemetry/instruments.js')

    const llmDuration = createRecordingInstrument()
    const llmTotal = createRecordingInstrument()
    const tokensInput = createRecordingInstrument()
    const tokensOutput = createRecordingInstrument()
    const llmSteps = createRecordingInstrument()

    const mockInstruments = {
      llmRequestDuration: llmDuration.histogram,
      llmRequestTotal: llmTotal.counter,
      llmRequestErrors: { add() {} },
      llmTokensInput: tokensInput.counter,
      llmTokensOutput: tokensOutput.counter,
      llmSteps: llmSteps.histogram,
      toolExecutionDuration: { record() {} },
      toolExecutionTotal: { add() {} },
      toolExecutionErrors: { add() {} },
      messageReceivedTotal: { add() {} },
      messageProcessingDuration: { record() {} },
      authDeniedTotal: { add() {} },
      webFetchDuration: { record() {} },
      webFetchTotal: { add() {} },
      webFetchErrors: { add() {} },
      providerRequestDuration: { record() {} },
      providerRequestErrors: { add() {} },
      schedulerTickDuration: { record() {} },
      schedulerRecurringFired: { add() {} },
    }

    const removeSubscriber = startEventSubscriber(mockInstruments)

    emit('llm:end', {
      userId: 'ctx-1',
      model: 'gpt-4o',
      steps: 3,
      totalDuration: 4500,
      tokenUsage: { inputTokens: 120, outputTokens: 80 },
      finishReason: 'stop',
    })

    expect(llmDuration.calls.length).toBe(1)
    expect(llmDuration.calls[0]?.value).toBe(4500)
    expect(llmDuration.calls[0]?.attributes?.model).toBe('gpt-4o')

    expect(llmTotal.calls.length).toBe(1)
    expect(llmTotal.calls[0]?.value).toBe(1)

    expect(tokensInput.calls.length).toBe(1)
    expect(tokensInput.calls[0]?.value).toBe(120)

    expect(tokensOutput.calls.length).toBe(1)
    expect(tokensOutput.calls[0]?.value).toBe(80)

    expect(llmSteps.calls.length).toBe(1)
    expect(llmSteps.calls[0]?.value).toBe(3)

    removeSubscriber()
  })

  test('llm:error event records error counter', async () => {
    const { startEventSubscriber } = await import('../../src/telemetry/subscriber.js')

    const errorCounter = createRecordingInstrument()

    const mockInstruments = {
      llmRequestDuration: { record() {} },
      llmRequestTotal: { add() {} },
      llmRequestErrors: errorCounter.counter,
      llmTokensInput: { add() {} },
      llmTokensOutput: { add() {} },
      llmSteps: { record() {} },
      toolExecutionDuration: { record() {} },
      toolExecutionTotal: { add() {} },
      toolExecutionErrors: { add() {} },
      messageReceivedTotal: { add() {} },
      messageProcessingDuration: { record() {} },
      authDeniedTotal: { add() {} },
      webFetchDuration: { record() {} },
      webFetchTotal: { add() {} },
      webFetchErrors: { add() {} },
      providerRequestDuration: { record() {} },
      providerRequestErrors: { add() {} },
      schedulerTickDuration: { record() {} },
      schedulerRecurringFired: { add() {} },
    }

    const removeSubscriber = startEventSubscriber(mockInstruments)

    emit('llm:error', {
      userId: 'ctx-1',
      error: 'API timeout',
      model: 'gpt-4o',
    })

    expect(errorCounter.calls.length).toBe(1)
    expect(errorCounter.calls[0]?.value).toBe(1)
    expect(errorCounter.calls[0]?.attributes?.model).toBe('gpt-4o')

    removeSubscriber()
  })

  test('llm:tool_result event records tool execution metrics', async () => {
    const { startEventSubscriber } = await import('../../src/telemetry/subscriber.js')

    const toolDuration = createRecordingInstrument()
    const toolTotal = createRecordingInstrument()
    const toolErrors = createRecordingInstrument()

    const mockInstruments = {
      llmRequestDuration: { record() {} },
      llmRequestTotal: { add() {} },
      llmRequestErrors: { add() {} },
      llmTokensInput: { add() {} },
      llmTokensOutput: { add() {} },
      llmSteps: { record() {} },
      toolExecutionDuration: toolDuration.histogram,
      toolExecutionTotal: toolTotal.counter,
      toolExecutionErrors: toolErrors.counter,
      messageReceivedTotal: { add() {} },
      messageProcessingDuration: { record() {} },
      authDeniedTotal: { add() {} },
      webFetchDuration: { record() {} },
      webFetchTotal: { add() {} },
      webFetchErrors: { add() {} },
      providerRequestDuration: { record() {} },
      providerRequestErrors: { add() {} },
      schedulerTickDuration: { record() {} },
      schedulerRecurringFired: { add() {} },
    }

    const removeSubscriber = startEventSubscriber(mockInstruments)

    emit('llm:tool_result', {
      userId: 'ctx-1',
      toolName: 'create_task',
      toolCallId: 'tc-1',
      durationMs: 230,
      success: true,
    })

    expect(toolDuration.calls.length).toBe(1)
    expect(toolDuration.calls[0]?.value).toBe(230)
    expect(toolTotal.calls.length).toBe(1)
    expect(toolErrors.calls.length).toBe(0)

    emit('llm:tool_result', {
      userId: 'ctx-1',
      toolName: 'delete_task',
      toolCallId: 'tc-2',
      durationMs: 100,
      success: false,
      error: 'Permission denied',
    })

    expect(toolDuration.calls.length).toBe(2)
    expect(toolTotal.calls.length).toBe(2)
    expect(toolErrors.calls.length).toBe(1)
    expect(toolErrors.calls[0]?.attributes?.tool_name).toBe('delete_task')

    removeSubscriber()
  })

  test('message:received event records message counter', async () => {
    const { startEventSubscriber } = await import('../../src/telemetry/subscriber.js')

    const messageCounter = createRecordingInstrument()

    const mockInstruments = {
      llmRequestDuration: { record() {} },
      llmRequestTotal: { add() {} },
      llmRequestErrors: { add() {} },
      llmTokensInput: { add() {} },
      llmTokensOutput: { add() {} },
      llmSteps: { record() {} },
      toolExecutionDuration: { record() {} },
      toolExecutionTotal: { add() {} },
      toolExecutionErrors: { add() {} },
      messageReceivedTotal: messageCounter.counter,
      messageProcessingDuration: { record() {} },
      authDeniedTotal: { add() {} },
      webFetchDuration: { record() {} },
      webFetchTotal: { add() {} },
      webFetchErrors: { add() {} },
      providerRequestDuration: { record() {} },
      providerRequestErrors: { add() {} },
      schedulerTickDuration: { record() {} },
      schedulerRecurringFired: { add() {} },
    }

    const removeSubscriber = startEventSubscriber(mockInstruments)

    emit('message:received', {
      userId: 'user-1',
      contextId: 'ctx-1',
      contextType: 'dm',
      textLength: 42,
      isCommand: false,
    })

    expect(messageCounter.calls.length).toBe(1)
    expect(messageCounter.calls[0]?.value).toBe(1)
    expect(messageCounter.calls[0]?.attributes?.context_type).toBe('dm')
    expect(messageCounter.calls[0]?.attributes?.is_command).toBe(false)

    removeSubscriber()
  })

  test('message:replied event records processing duration', async () => {
    const { startEventSubscriber } = await import('../../src/telemetry/subscriber.js')

    const processingDuration = createRecordingInstrument()

    const mockInstruments = {
      llmRequestDuration: { record() {} },
      llmRequestTotal: { add() {} },
      llmRequestErrors: { add() {} },
      llmTokensInput: { add() {} },
      llmTokensOutput: { add() {} },
      llmSteps: { record() {} },
      toolExecutionDuration: { record() {} },
      toolExecutionTotal: { add() {} },
      toolExecutionErrors: { add() {} },
      messageReceivedTotal: { add() {} },
      messageProcessingDuration: processingDuration.histogram,
      authDeniedTotal: { add() {} },
      webFetchDuration: { record() {} },
      webFetchTotal: { add() {} },
      webFetchErrors: { add() {} },
      providerRequestDuration: { record() {} },
      providerRequestErrors: { add() {} },
      schedulerTickDuration: { record() {} },
      schedulerRecurringFired: { add() {} },
    }

    const removeSubscriber = startEventSubscriber(mockInstruments)

    emit('message:replied', {
      userId: 'user-1',
      contextId: 'ctx-1',
      duration: 3200,
    })

    expect(processingDuration.calls.length).toBe(1)
    expect(processingDuration.calls[0]?.value).toBe(3200)

    removeSubscriber()
  })

  test('auth:check event with allowed=false records denial', async () => {
    const { startEventSubscriber } = await import('../../src/telemetry/subscriber.js')

    const authDenied = createRecordingInstrument()

    const mockInstruments = {
      llmRequestDuration: { record() {} },
      llmRequestTotal: { add() {} },
      llmRequestErrors: { add() {} },
      llmTokensInput: { add() {} },
      llmTokensOutput: { add() {} },
      llmSteps: { record() {} },
      toolExecutionDuration: { record() {} },
      toolExecutionTotal: { add() {} },
      toolExecutionErrors: { add() {} },
      messageReceivedTotal: { add() {} },
      messageProcessingDuration: { record() {} },
      authDeniedTotal: authDenied.counter,
      webFetchDuration: { record() {} },
      webFetchTotal: { add() {} },
      webFetchErrors: { add() {} },
      providerRequestDuration: { record() {} },
      providerRequestErrors: { add() {} },
      schedulerTickDuration: { record() {} },
      schedulerRecurringFired: { add() {} },
    }

    const removeSubscriber = startEventSubscriber(mockInstruments)

    emit('auth:check', {
      userId: 'user-1',
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: 'ctx-1',
    })

    expect(authDenied.calls.length).toBe(0)

    emit('auth:check', {
      userId: 'user-2',
      allowed: false,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: 'ctx-2',
    })

    expect(authDenied.calls.length).toBe(1)

    removeSubscriber()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry/subscriber.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the subscriber**

Create `src/telemetry/subscriber.ts`:

```typescript
import { subscribe, unsubscribe } from '../debug/event-bus.js'
import type { Instruments } from './types.js'

const eventHandler =
  (instruments: Instruments) =>
  (type: string, data: Record<string, unknown>): void => {
    switch (type) {
      case 'llm:end': {
        const attrs = {
          model: String(data.model ?? 'unknown'),
          finish_reason: String(data.finishReason ?? 'unknown'),
        }
        instruments.llmRequestDuration.record(Number(data.totalDuration ?? 0), attrs)
        instruments.llmRequestTotal.add(1, attrs)
        const tokenUsage = data.tokenUsage as { inputTokens?: number; outputTokens?: number } | undefined
        if (tokenUsage !== undefined) {
          const model = String(data.model ?? 'unknown')
          if (tokenUsage.inputTokens !== undefined) instruments.llmTokensInput.add(tokenUsage.inputTokens, { model })
          if (tokenUsage.outputTokens !== undefined) instruments.llmTokensOutput.add(tokenUsage.outputTokens, { model })
        }
        instruments.llmSteps.record(Number(data.steps ?? 0), { model: String(data.model ?? 'unknown') })
        break
      }
      case 'llm:error': {
        instruments.llmRequestErrors.add(1, {
          model: String(data.model ?? 'unknown'),
          error_type: 'llm_error',
        })
        break
      }
      case 'llm:tool_result': {
        const toolName = String(data.toolName ?? 'unknown')
        const success = data.success === true
        instruments.toolExecutionDuration.record(Number(data.durationMs ?? 0), { tool_name: toolName, success })
        instruments.toolExecutionTotal.add(1, { tool_name: toolName, success })
        if (!success) {
          instruments.toolExecutionErrors.add(1, { tool_name: toolName, error_type: 'tool_failure' })
        }
        break
      }
      case 'message:received': {
        instruments.messageReceivedTotal.add(1, {
          context_type: String(data.contextType ?? 'unknown'),
          chat_provider: String(data.chat_provider ?? 'unknown'),
          is_command: Boolean(data.isCommand),
        })
        break
      }
      case 'message:replied': {
        instruments.messageProcessingDuration.record(Number(data.duration ?? 0))
        break
      }
      case 'auth:check': {
        if (data.allowed !== true) {
          instruments.authDeniedTotal.add(1, {
            reason: String(data.reason ?? 'unknown'),
            context_type: String(data.context_type ?? 'unknown'),
          })
        }
        break
      }
    }
  }

export function startEventSubscriber(instruments: Instruments): () => void {
  const handler = eventHandler(instruments)
  const listener = (event: { type: string; data: Record<string, unknown> }): void => {
    handler(event.type, event.data)
  }
  subscribe(listener as never)
  return () => unsubscribe(listener as never)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/telemetry/subscriber.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/subscriber.ts tests/telemetry/subscriber.test.ts
git commit -m "feat(telemetry): add event bus subscriber for LLM, tool, message, auth metrics"
```

---

### Task 5: Create public API façade (index.ts)

**Files:**

- Create: `src/telemetry/index.ts`

- [ ] **Step 1: Create the public API**

Create `src/telemetry/index.ts`:

```typescript
import { logger } from '../logger.js'
import { noopInstruments, noopProviderRecorder } from './noop.js'
import type { Instruments, ProviderMetricsRecorder } from './types.js'

const log = logger.child({ scope: 'telemetry' })

let initialized = false
let _instruments: Instruments = noopInstruments
let _providerRecorder: ProviderMetricsRecorder = noopProviderRecorder
let removeSubscriber: (() => void) | null = null

export function initTelemetry(): void {
  if (initialized) {
    log.warn('Telemetry already initialized')
    return
  }

  if (process.env['OTEL_ENABLED'] !== 'true') {
    log.info('Telemetry disabled (OTEL_ENABLED not set to "true")')
    _instruments = noopInstruments
    _providerRecorder = noopProviderRecorder
    initialized = true
    return
  }

  log.info('Initializing telemetry...')

  const { initRealInstruments } = require('./instruments.js') as typeof import('./instruments.js')
  const { startEventSubscriber } = require('./subscriber.js') as typeof import('./subscriber.js')

  _instruments = initRealInstruments()

  const recorder = (require('./instruments.js') as typeof import('./instruments.js')).getProviderRecorder()
  _providerRecorder = recorder

  removeSubscriber = startEventSubscriber(_instruments)

  initialized = true
  log.info('Telemetry initialized successfully')
}

export async function shutdownTelemetry(): Promise<void> {
  if (!initialized) return
  if (removeSubscriber !== null) {
    removeSubscriber()
    removeSubscriber = null
  }
  if (process.env['OTEL_ENABLED'] === 'true') {
    const { shutdownMeterProvider } = require('./meter.js') as typeof import('./meter.js')
    await shutdownMeterProvider()
  }
  _instruments = noopInstruments
  _providerRecorder = noopProviderRecorder
  initialized = false
  log.info('Telemetry shut down')
}

export function getInstruments(): Instruments {
  return _instruments
}

export function getProviderRecorder(): ProviderMetricsRecorder {
  return _providerRecorder
}

export { noopInstruments, noopProviderRecorder }
export type { Instruments, ProviderMetricsRecorder, TelemetryCounter, TelemetryHistogram } from './types.js'
```

Note: Uses `require()` for OTel modules so they are never loaded when `OTEL_ENABLED` is not `true`. This keeps the no-op path dependency-free.

Actually, Bun supports ESM `require()` via interop. But the cleaner pattern for Bun ESM is dynamic `import()`. Since `initTelemetry()` is async-compatible but currently sync, let me use `await import()` and make it async instead — this is more Bun-native:

Revised `src/telemetry/index.ts`:

```typescript
import { logger } from '../logger.js'
import { noopInstruments, noopProviderRecorder } from './noop.js'
import type { Instruments, ProviderMetricsRecorder } from './types.js'

const log = logger.child({ scope: 'telemetry' })

let initialized = false
let _instruments: Instruments = noopInstruments
let _providerRecorder: ProviderMetricsRecorder = noopProviderRecorder
let removeSubscriber: (() => void) | null = null

export async function initTelemetry(): Promise<void> {
  if (initialized) {
    log.warn('Telemetry already initialized')
    return
  }

  if (process.env['OTEL_ENABLED'] !== 'true') {
    log.info('Telemetry disabled (OTEL_ENABLED not set to "true")')
    _instruments = noopInstruments
    _providerRecorder = noopProviderRecorder
    initialized = true
    return
  }

  log.info('Initializing telemetry...')

  const instrumentsMod = await import('./instruments.js')
  const subscriberMod = await import('./subscriber.js')

  _instruments = instrumentsMod.initRealInstruments()
  _providerRecorder = instrumentsMod.getProviderRecorder()
  removeSubscriber = subscriberMod.startEventSubscriber(_instruments)

  initialized = true
  log.info('Telemetry initialized successfully')
}

export async function shutdownTelemetry(): Promise<void> {
  if (!initialized) return
  if (removeSubscriber !== null) {
    removeSubscriber()
    removeSubscriber = null
  }
  if (process.env['OTEL_ENABLED'] === 'true') {
    const meterMod = await import('./meter.js')
    await meterMod.shutdownMeterProvider()
  }
  _instruments = noopInstruments
  _providerRecorder = noopProviderRecorder
  initialized = false
  log.info('Telemetry shut down')
}

export function getInstruments(): Instruments {
  return _instruments
}

export function getProviderRecorder(): ProviderMetricsRecorder {
  return _providerRecorder
}

export { noopInstruments, noopProviderRecorder }
export type { Instruments, ProviderMetricsRecorder, TelemetryCounter, TelemetryHistogram } from './types.js'
```

- [ ] **Step 2: Verify it type-checks**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/telemetry/index.ts
git commit -m "feat(telemetry): add public API façade with lazy OTel loading"
```

---

### Task 6: Wire telemetry into application startup and shutdown

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Add telemetry init and shutdown to index.ts**

At the top of `src/index.ts`, after the existing imports, add:

```typescript
import { initTelemetry, shutdownTelemetry } from './telemetry/index.js'
```

After the `log.info('Starting papai...')` call (line 49) and before `try { initDb() }`, add:

```typescript
await initTelemetry()
```

In the `shutdown` function, add `shutdownTelemetry()` call. Insert `await shutdownTelemetry()` before the `closeDrizzleDb()` call in the shutdown chain:

Change the `.then(() => {` block from:

```typescript
    .then(() => {
      closeDrizzleDb()
      closeMigrationDbInstance()
      process.exit(0)
    })
```

To:

```typescript
    .then(() => shutdownTelemetry())
    .then(() => {
      closeDrizzleDb()
      closeMigrationDbInstance()
      process.exit(0)
    })
```

The final `src/index.ts` shutdown section should look like:

```typescript
const shutdown = (signal: string): void => {
  log.info(`${signal} received, starting graceful shutdown...`)
  void flushOnShutdown({ timeoutMs: 5000 })
    .then(() => {
      stopScheduler()
      scheduler.stopAll()
      stopPollers()
      stopDebugServerFn?.()
      return chatProvider.stop()
    })
    .then(() => shutdownTelemetry())
    .then(() => {
      closeDrizzleDb()
      closeMigrationDbInstance()
      process.exit(0)
    })
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(telemetry): wire init and shutdown into application lifecycle"
```

---

### Task 7: Instrument web fetch

**Files:**

- Modify: `src/web/fetch-extract.ts`
- Modify: `tests/web/fetch-extract.test.ts`

- [ ] **Step 1: Add telemetry calls to fetchAndExtract**

In `src/web/fetch-extract.ts`, add the import at the top:

```typescript
import { getInstruments } from '../telemetry/index.js'
```

In the `fetchAndExtract` function, add timing and recording. After the `const requestStartedAt = deps.now()` line and before the cache check, there is no change. Instead, wrap the core fetch logic with timing. Find the section starting at `const fetched = await deps.safeFetchContent(...)` and the surrounding return/error logic.

After the `const requestStartedAt = deps.now()` line, add an inner `const fetchStart = requestStartedAt` (reuse same timestamp — no extra `now()` call needed).

After `const result = buildResult(...)` and before `deps.putCachedWebFetch(...)`, add:

```typescript
const instruments = getInstruments()
const fetchDuration = deps.now() - requestStartedAt
instruments.webFetchDuration.record(fetchDuration, { status: 'success', content_type: result.contentType })
instruments.webFetchTotal.add(1, { status: 'success' })
```

For error recording, wrap the main fetch body in a try/catch. The existing `fetchAndExtract` function throws `FetchAndExtractClassifiedError` which has `.code` and `.type` properties. Add instrumentation at the throw sites:

In `normalizeUrl`, after the `throwClassifiedError(webFetchError.invalidUrl(), 'Invalid URL')` line — this already throws, so we add a metric call before it:

Before `return throwClassifiedError(webFetchError.invalidUrl(), 'Invalid URL')` in `normalizeUrl`, add:

```typescript
getInstruments().webFetchErrors.add(1, { error_code: 'invalid_url' })
```

Before `throwClassifiedError(webFetchError.rateLimited(), 'Web fetch quota exceeded', quota.retryAfterSec)` in `enforceQuota`, add:

```typescript
getInstruments().webFetchErrors.add(1, { error_code: 'rate_limited' })
```

The actual full changes are:

1. Add import at top of `src/web/fetch-extract.ts`:

```typescript
import { getInstruments } from '../telemetry/index.js'
```

2. In `normalizeUrl`, before `return throwClassifiedError(webFetchError.invalidUrl(), 'Invalid URL')`, add:

```typescript
getInstruments().webFetchErrors.add(1, { error_code: 'invalid_url' })
```

3. In `enforceQuota`, before `throwClassifiedError(webFetchError.rateLimited(), ...)`, add:

```typescript
getInstruments().webFetchErrors.add(1, { error_code: 'rate_limited' })
```

4. In `fetchAndExtract`, after the `buildResult(...)` call and before `deps.putCachedWebFetch(...)`, add:

```typescript
const instruments = getInstruments()
const fetchDuration = deps.now() - requestStartedAt
instruments.webFetchDuration.record(fetchDuration, { status: 'success', content_type: result.contentType })
instruments.webFetchTotal.add(1, { status: 'success' })
```

5. In `distillProcessedContent`, in the catch block before `return throwClassifiedError(systemError.unexpected(originalError), ...)`, add:

```typescript
getInstruments().webFetchErrors.add(1, { error_code: 'distillation_failed' })
```

- [ ] **Step 2: Run existing tests to verify nothing breaks**

Run: `bun test tests/web/fetch-extract.test.ts`
Expected: PASS (telemetry is disabled by default, so noop instruments are used)

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/web/fetch-extract.ts
git commit -m "feat(telemetry): instrument web fetch with duration, count, and error metrics"
```

---

### Task 8: Instrument provider clients

**Files:**

- Modify: `src/providers/kaneo/client.ts`
- Modify: `src/providers/youtrack/client.ts`

- [ ] **Step 1: Add provider recorder to Kaneo client**

In `src/providers/kaneo/client.ts`, add the import:

```typescript
import { getProviderRecorder } from '../../telemetry/index.js'
```

In the `kaneoFetch` function, add timing. Wrap the fetch call:

Before `const url = buildUrl(config, path, query)`, add:

```typescript
const requestStart = Date.now()
```

After `return validateResponse(rawData, schema, method, path, response.status)` (the happy path return), add a recorder call just before it. Actually, to handle both success and error, we need the recorder call in both paths. The cleanest approach:

Replace the body of `kaneoFetch` (from `const url = ...` to the end) with:

```typescript
const url = buildUrl(config, path, query)
const operation = `${method} ${path}`

log.debug({ method, path, hasBody: body !== undefined }, 'Kaneo API request')

const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (config.sessionCookie === undefined) {
  headers['Authorization'] = `Bearer ${config.apiKey}`
} else {
  headers['Cookie'] = config.sessionCookie
}

const requestStart = Date.now()
try {
  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    return handleErrorResponse(response, method, path)
  }

  const rawData: unknown = await response.json()

  return validateResponse(rawData, schema, method, path, response.status)
} catch (error) {
  const errorClass = error instanceof KaneoApiError ? `http_${error.statusCode}` : 'network'
  getProviderRecorder().recordRequest('kaneo', operation, Date.now() - requestStart, errorClass)
  throw error
}
```

Wait — this double-counts errors that go through `handleErrorResponse` (which throws). Let me restructure. The `handleErrorResponse` throws, so the catch block will catch it. But we also want to record successful requests. Better approach: use try/finally with a success flag:

```typescript
const url = buildUrl(config, path, query)
const operation = `${method} ${path}`

log.debug({ method, path, hasBody: body !== undefined }, 'Kaneo API request')

const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (config.sessionCookie === undefined) {
  headers['Authorization'] = `Bearer ${config.apiKey}`
} else {
  headers['Cookie'] = config.sessionCookie
}

const requestStart = Date.now()
let errorClass: string | undefined
try {
  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    errorClass = `http_${response.status}`
    return handleErrorResponse(response, method, path)
  }

  const rawData: unknown = await response.json()

  return validateResponse(rawData, schema, method, path, response.status)
} catch (error) {
  if (errorClass === undefined) errorClass = 'network'
  throw error
} finally {
  getProviderRecorder().recordRequest('kaneo', operation, Date.now() - requestStart, errorClass)
}
```

This records both success (no errorClass) and failure (with errorClass) in a single place.

The full change to `src/providers/kaneo/client.ts`:

1. Add import at top:

```typescript
import { getProviderRecorder } from '../../telemetry/index.js'
```

2. Replace `kaneoFetch` function body (lines 64-96) with:

```typescript
export async function kaneoFetch<T>(
  config: KaneoConfig,
  method: string,
  path: string,
  body: unknown,
  query: Record<string, string> | undefined,
  schema: ZodType<T>,
): Promise<T> {
  const url = buildUrl(config, path, query)
  const operation = `${method} ${path}`

  log.debug({ method, path, hasBody: body !== undefined }, 'Kaneo API request')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.sessionCookie === undefined) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  } else {
    headers['Cookie'] = config.sessionCookie
  }

  const requestStart = Date.now()
  let errorClass: string | undefined
  try {
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    if (!response.ok) {
      errorClass = `http_${response.status}`
      return handleErrorResponse(response, method, path)
    }

    const rawData: unknown = await response.json()

    return validateResponse(rawData, schema, method, path, response.status)
  } catch (error) {
    if (errorClass === undefined) errorClass = 'network'
    throw error
  } finally {
    getProviderRecorder().recordRequest('kaneo', operation, Date.now() - requestStart, errorClass)
  }
}
```

- [ ] **Step 2: Add provider recorder to YouTrack client**

In `src/providers/youtrack/client.ts`, add the import:

```typescript
import { getProviderRecorder } from '../../telemetry/index.js'
```

Replace the `youtrackFetch` function body (lines 36-82) with:

```typescript
export async function youtrackFetch(
  config: YouTrackConfig,
  method: string,
  path: string,
  options?: { body?: unknown; query?: Record<string, YouTrackQueryValue> },
): Promise<unknown> {
  const url = new URL(path, config.baseUrl)
  if (options?.query !== undefined) {
    appendQueryParams(url, options.query)
  }

  log.debug({ method, path, hasBody: options?.body !== undefined }, 'YouTrack API request')

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/json',
  }
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const operation = `${method} ${path}`
  const requestStart = Date.now()
  let errorClass: string | undefined
  try {
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: options?.body === undefined ? undefined : JSON.stringify(options.body),
    })

    if (!response.ok) {
      errorClass = `http_${response.status}`
      let errorBody: unknown
      try {
        errorBody = await response.json()
      } catch {
        errorBody = await response.text().catch(() => null)
      }
      const msg = `YouTrack API ${method} ${path} returned ${response.status}`
      log.error({ statusCode: response.status, path, errorBody }, msg)
      throw new YouTrackApiError(msg, response.status, errorBody)
    }

    if (response.status === 204) {
      return undefined
    }

    const data: unknown = await response.json()
    log.debug({ method, path }, 'YouTrack API response received')
    return data
  } catch (error) {
    if (errorClass === undefined) errorClass = 'network'
    throw error
  } finally {
    getProviderRecorder().recordRequest('youtrack', operation, Date.now() - requestStart, errorClass)
  }
}
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/providers/kaneo/client.ts src/providers/youtrack/client.ts
git commit -m "feat(telemetry): instrument Kaneo and YouTrack provider clients"
```

---

### Task 9: Instrument scheduler tick and recurring tasks

**Files:**

- Modify: `src/scheduler.ts`

- [ ] **Step 1: Add telemetry calls to scheduler**

In `src/scheduler.ts`, add the import:

```typescript
import { getInstruments } from './telemetry/index.js'
```

In the `tick` function, add timing around the work. Find the `const work = (async (): Promise<void> => {` block and the `activeTickPromise = work.finally(...)` section. Add duration recording.

Inside the `work` async IIFE, after the `try` block and before the closing `})()`, add the duration recording in a finally-like pattern. The cleanest approach:

Wrap the inner work in try/finally:

Change the `work` assignment from:

```typescript
const work = (async (): Promise<void> => {
  try {
    const dueTasks = getDueRecurringTasks()
    tickCount++
    emit('scheduler:tick', { tickCount, dueTaskCount: dueTasks.length })

    if (dueTasks.length === 0) {
      if (tickCount % HEARTBEAT_INTERVAL === 0) {
        log.info({ tickCount }, 'Scheduler heartbeat: no due tasks')
      }
      return
    }

    log.info({ count: dueTasks.length, tickCount }, 'Processing due recurring tasks')

    await dueTasks.reduce(
      (chain, task) => chain.then(() => executeRecurringTask(task, resolvedDeps)),
      Promise.resolve(),
    )
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Scheduler tick failed')
  }
})()
```

To:

```typescript
const tickStart = Date.now()
const work = (async (): Promise<void> => {
  try {
    const dueTasks = getDueRecurringTasks()
    tickCount++
    emit('scheduler:tick', { tickCount, dueTaskCount: dueTasks.length })

    if (dueTasks.length === 0) {
      if (tickCount % HEARTBEAT_INTERVAL === 0) {
        log.info({ tickCount }, 'Scheduler heartbeat: no due tasks')
      }
      return
    }

    log.info({ count: dueTasks.length, tickCount }, 'Processing due recurring tasks')

    await dueTasks.reduce(
      (chain, task) => chain.then(() => executeRecurringTask(task, resolvedDeps)),
      Promise.resolve(),
    )
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Scheduler tick failed')
  }
})()
activeTickPromise = work.finally(() => {
  getInstruments().schedulerTickDuration.record(Date.now() - tickStart)
  activeTickPromise = null
})
```

For the recurring task counter, in `executeRecurringTask`, after `const created = await provider.createTask(...)` and before `await finalizeCreatedRecurringTask(...)`, add:

```typescript
getInstruments().schedulerRecurringFired.add(1)
```

The full change to `executeRecurringTask`:

```typescript
const executeRecurringTask = async (task: RecurringTaskRecord, deps: SchedulerDeps): Promise<void> => {
  log.debug({ taskId: task.id, title: task.title, userId: task.userId }, 'Executing recurring task')

  const provider = buildProviderForUser(task.userId, deps)
  if (provider === null) {
    log.error({ taskId: task.id, userId: task.userId }, 'Cannot build provider for recurring task')
    return
  }

  try {
    const created = await provider.createTask(buildRecurringTaskInput(task))
    getInstruments().schedulerRecurringFired.add(1)
    await finalizeCreatedRecurringTask(task, provider, created, chatProviderRef)
  } catch (error) {
    log.error(
      { taskId: task.id, error: error instanceof Error ? error.message : String(error) },
      'Failed to create recurring task instance',
    )
  }
}
```

- [ ] **Step 2: Run existing scheduler tests**

Run: `bun test tests/scheduler.test.ts`
Expected: PASS (telemetry disabled by default, noop instruments)

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/scheduler.ts
git commit -m "feat(telemetry): instrument scheduler tick duration and recurring task counter"
```

---

### Task 10: Add observable gauges for queue depth and process runtime

**Files:**

- Modify: `src/telemetry/instruments.ts`
- Modify: `src/telemetry/index.ts`

- [ ] **Step 1: Add observable gauges to instrument creation**

In `src/telemetry/instruments.ts`, add imports for the queue registry and process metrics:

```typescript
import { registry } from '../message-queue/index.js'
```

In the `initRealInstruments` function, after creating the instruments, register observable gauges:

```typescript
meter.createObservableGauge('papai.queue.depth', {
  description: 'Number of active message queues',
  callback: () => registry.getAllQueues().size,
})

meter.createObservableGauge('papai.queue.buffered', {
  description: 'Total number of buffered messages across all queues',
  callback: () => {
    let total = 0
    for (const queue of registry.getAllQueues().values()) {
      total += queue.getBufferedCount()
    }
    return total
  },
})

meter.createObservableGauge('process.runtime.bun.memory.heap_used', {
  description: 'Bun process heap memory used in bytes',
  unit: 'By',
  callback: () => process.memoryUsage().heapUsed,
})

meter.createObservableGauge('process.runtime.bun.memory.external', {
  description: 'Bun process external memory in bytes',
  unit: 'By',
  callback: () => process.memoryUsage().external,
})

meter.createObservableGauge('process.runtime.bun.uptime', {
  description: 'Bun process uptime in seconds',
  unit: 's',
  callback: () => process.uptime(),
})
```

Note: The `callback` parameter for `createObservableGauge` takes an `ObservableResult` or returns a number depending on OTel SDK version. Check the OTel JS SDK docs for the exact callback signature — it should be `(observableResult: ObservableResult) => void | Promise<void>` where you call `observableResult.observe(value, attributes)`.

The corrected callback pattern for `@opentelemetry/sdk-metrics`:

```typescript
meter.createObservableGauge(
  'papai.queue.depth',
  {
    description: 'Number of active message queues',
  },
  (observableResult) => {
    observableResult.observe(registry.getAllQueues().size)
  },
)
```

Wait — the OTel JS API for observable gauges uses `callback` in the options or a second argument. Let me use the correct API:

```typescript
const createObservableGauge = (name: string, description: string, fn: () => number, unit?: string) => {
  const options: Record<string, unknown> = { description }
  if (unit !== undefined) options.unit = unit
  meter.createObservableGauge(name, options, (observableResult) => {
    observableResult.observe(fn())
  })
}

createObservableGauge('papai.queue.depth', 'Number of active message queues', () => registry.getAllQueues().size)
createObservableGauge('papai.queue.buffered', 'Total buffered messages across all queues', () => {
  let total = 0
  for (const queue of registry.getAllQueues().values()) {
    total += queue.getBufferedCount()
  }
  return total
})
createObservableGauge(
  'process.runtime.bun.memory.heap_used',
  'Bun heap memory used in bytes',
  () => process.memoryUsage().heapUsed,
  'By',
)
createObservableGauge(
  'process.runtime.bun.memory.external',
  'Bun external memory in bytes',
  () => process.memoryUsage().external,
  'By',
)
createObservableGauge('process.runtime.bun.uptime', 'Bun process uptime in seconds', () => process.uptime(), 's')
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/telemetry/instruments.ts
git commit -m "feat(telemetry): add observable gauges for queue depth and process runtime"
```

---

### Task 11: Add chat_provider label to message:received events

**Files:**

- Modify: `src/bot.ts`

The `message:received` event emitted in `onIncomingMessage` currently does not include the chat provider name. The subscriber tries to read `data.chat_provider` which will be undefined. Add it.

- [ ] **Step 1: Add chat_provider to the emitted event**

In `src/bot.ts`, in `onIncomingMessage`, find the `emit('message:received', { ... })` call (around line 222) and add `chat_provider: chat.name` to the data object:

```typescript
emit('message:received', {
  userId: msg.user.id,
  contextId: msg.contextId,
  contextType: msg.contextType,
  threadId: msg.threadId,
  textLength: msg.text.length,
  isCommand: msg.text.startsWith('/'),
  chat_provider: chat.name,
})
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/bot.ts
git commit -m "feat(telemetry): add chat_provider label to message:received event"
```

---

### Task 12: Run full verification

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 2: Run all tests**

Run: `bun test`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 4: Run format check**

Run: `bun run format:check`
Expected: PASS

- [ ] **Step 5: Run check:verbose**

Run: `bun run check:verbose`
Expected: PASS

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -u
git commit -m "fix(telemetry): address lint/typecheck findings"
```
