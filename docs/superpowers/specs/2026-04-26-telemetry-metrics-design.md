# Telemetry & Metrics Design

**Date:** 2026-04-26
**Status:** Approved
**Approach:** OpenTelemetry SDK with Prometheus exporter (manual instrumentation, no auto-instrumentation)

## Context

papai has structured logging via pino and an internal debug event bus, but no external metrics, traces, or structured telemetry. The bot runs in Docker Compose alongside other services. Prometheus + Grafana are planned but not yet deployed.

## Decision

Use the OpenTelemetry JavaScript SDK with the Prometheus exporter. Only manual instrumentation (meters, counters, histograms, gauges) — no auto-instrumentation packages, which avoids Bun compatibility risks. The Prometheus exporter starts an HTTP endpoint that Prometheus scrapes.

Rationale:

- Vendor-neutral, future-proof — can add OTLP exporters for traces/logs without changing application code
- Prometheus pull model fits Docker Compose naturally
- Manual meters cover the custom metrics papai actually needs; auto-instrumentation would not help with LLM/tool/web-fetch metrics
- 5 packages total, no heavy dependency tree

## Architecture

### Module structure

```
src/telemetry/
  index.ts          — public API: initTelemetry(), getMeter(), shutdownTelemetry()
  meter.ts          — OTel MeterProvider + Prometheus exporter setup
  instruments.ts    — pre-created counters, histograms, gauges
  subscriber.ts     — subscribes to debug event bus, maps events to instruments
  noop.ts           — no-op fallback when OTEL_ENABLED=false
```

### Initialization

`initTelemetry()` is called in `src/index.ts` before everything else (after env validation, before DB init). `shutdownTelemetry()` is added to the existing graceful shutdown handler.

### No-op mode

When `OTEL_ENABLED` is not `true`, `index.ts` exports no-op instruments that silently discard all calls. No OTel packages are imported in this path, so there is zero overhead when disabled.

### Instrument access pattern

`instruments.ts` creates all instruments once and exports them. Modules import from `src/telemetry/index.ts` and call instrument methods directly:

```typescript
import { instruments } from '../telemetry/index.js'
instruments.llmRequestDuration.record(durationMs, { model: 'gpt-4o' })
```

Modules never import `@opentelemetry/*` packages directly.

## Metrics

### LLM domain

| Instrument                   | Type           | Labels                   | Source                              |
| ---------------------------- | -------------- | ------------------------ | ----------------------------------- |
| `papai.llm.request.duration` | Histogram (ms) | `model`, `finish_reason` | `emitLlmEnd` via event bus          |
| `papai.llm.request.total`    | Counter        | `model`, `finish_reason` | `emitLlmEnd` via event bus          |
| `papai.llm.request.errors`   | Counter        | `model`, `error_type`    | `emitLlmError` via event bus        |
| `papai.llm.tokens.input`     | Counter        | `model`                  | `emitLlmEnd` → `usage.inputTokens`  |
| `papai.llm.tokens.output`    | Counter        | `model`                  | `emitLlmEnd` → `usage.outputTokens` |
| `papai.llm.steps`            | Histogram      | `model`                  | `emitLlmEnd` → `steps.length`       |

### Tool execution domain

| Instrument                      | Type           | Labels                    | Source                                                   |
| ------------------------------- | -------------- | ------------------------- | -------------------------------------------------------- |
| `papai.tool.execution.duration` | Histogram (ms) | `tool_name`, `success`    | `handleToolCallFinish` via event bus (`llm:tool_result`) |
| `papai.tool.execution.total`    | Counter        | `tool_name`, `success`    | `handleToolCallFinish` via event bus                     |
| `papai.tool.execution.errors`   | Counter        | `tool_name`, `error_type` | `emitToolFailure` via event bus                          |

### Chat / message domain

| Instrument                          | Type             | Labels                                        | Source                                                 |
| ----------------------------------- | ---------------- | --------------------------------------------- | ------------------------------------------------------ |
| `papai.message.received.total`      | Counter          | `context_type`, `chat_provider`, `is_command` | `onIncomingMessage` via event bus (`message:received`) |
| `papai.message.processing.duration` | Histogram (ms)   | `context_type`, `chat_provider`               | `message:replied` event (start → reply completed)      |
| `papai.auth.denied.total`           | Counter          | `reason`, `context_type`                      | `auth:check` event when `allowed=false`                |
| `papai.queue.depth`                 | Observable Gauge | —                                             | `registry.getAllQueues().size` via periodic callback   |
| `papai.queue.buffered`              | Observable Gauge | —                                             | Sum of `queue.getBufferedCount()` across all queues    |

### Web fetch domain

| Instrument                 | Type           | Labels                   | Source                                   |
| -------------------------- | -------------- | ------------------------ | ---------------------------------------- |
| `papai.web.fetch.duration` | Histogram (ms) | `status`, `content_type` | `fetchAndExtract` direct instrumentation |
| `papai.web.fetch.total`    | Counter        | `status`                 | `fetchAndExtract` direct instrumentation |
| `papai.web.fetch.errors`   | Counter        | `error_code`             | `fetchAndExtract` error paths            |

### Task provider domain

| Instrument                        | Type           | Labels                                 | Source                                  |
| --------------------------------- | -------------- | -------------------------------------- | --------------------------------------- |
| `papai.provider.request.duration` | Histogram (ms) | `provider`, `operation`                | Provider adapters via injected recorder |
| `papai.provider.request.errors`   | Counter        | `provider`, `operation`, `error_class` | Provider adapters via injected recorder |

### Scheduler / recurring domain

| Instrument                        | Type           | Labels | Source                                  |
| --------------------------------- | -------------- | ------ | --------------------------------------- |
| `papai.scheduler.tick.duration`   | Histogram (ms) | —      | `scheduler.ts` tick cycle               |
| `papai.scheduler.recurring.fired` | Counter        | —      | `scheduler.ts` recurring task execution |

### Process runtime

| Instrument                             | Type             | Labels | Source                  |
| -------------------------------------- | ---------------- | ------ | ----------------------- |
| `process.runtime.bun.memory.heap_used` | Observable Gauge | —      | `process.memoryUsage()` |
| `process.runtime.bun.memory.external`  | Observable Gauge | —      | `process.memoryUsage()` |
| `process.runtime.bun.uptime`           | Observable Gauge | —      | `process.uptime()`      |

### Histogram buckets

| Metric                              | Boundaries (ms)                                           |
| ----------------------------------- | --------------------------------------------------------- |
| `papai.llm.request.duration`        | 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000, 120000 |
| `papai.tool.execution.duration`     | 10, 50, 100, 250, 500, 1000, 2500, 5000                   |
| `papai.web.fetch.duration`          | 100, 250, 500, 1000, 2500, 5000, 10000                    |
| `papai.provider.request.duration`   | 50, 100, 250, 500, 1000, 2500, 5000                       |
| `papai.message.processing.duration` | 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000         |
| `papai.scheduler.tick.duration`     | 10, 50, 100, 250, 500, 1000, 2500, 5000                   |

## Integration

### Event bus subscription

`subscriber.ts` subscribes to the existing debug event bus (`src/debug/event-bus.ts`) and maps events to instrument calls. This avoids modifying the orchestrator, bot, or reply-tracking modules:

| Event              | Instrument calls                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `llm:start`        | Stores start time in internal `Map<contextId, timestamp>`                                                                                                                                                 |
| `llm:end`          | Computes duration from stored start time, then `llm.request.duration.record()`, `llm.request.total.add()`, `llm.tokens.input.add()`, `llm.tokens.output.add()`, `llm.steps.record()`, cleans up map entry |
| `llm:error`        | `llm.request.errors.add()`                                                                                                                                                                                |
| `llm:tool_result`  | `tool.execution.duration.record()`, `tool.execution.total.add()`, `tool.execution.errors.add()` (on failure)                                                                                              |
| `message:received` | `message.received.total.add()`                                                                                                                                                                            |
| `message:replied`  | `message.processing.duration.record()`                                                                                                                                                                    |
| `auth:check`       | `auth.denied.total.add()` (when `allowed=false`)                                                                                                                                                          |

### Direct instrumentation

These modules have no event bus integration and need direct metric calls:

- `src/web/fetch-extract.ts` — web fetch duration/count/errors (~5 lines)
- `src/providers/youtrack/client.ts` — provider request metrics via injected recorder (~8 lines)
- `src/providers/kaneo/client.ts` — provider request metrics via injected recorder (~8 lines)
- `src/scheduler.ts` — tick duration and recurring task counter (~5 lines)

### Provider recorder interface

```typescript
interface ProviderMetricsRecorder {
  recordRequest(provider: string, operation: string, durationMs: number, error?: string): void
}
```

Injected into the existing provider DI patterns. When telemetry is disabled, the noop implementation discards calls.

### Observable gauges

Registered once during `initTelemetry()` with callbacks:

- `papai.queue.depth` → `registry.getAllQueues().size`
- `papai.queue.buffered` → sum of `queue.getBufferedCount()` across all queues
- `process.runtime.bun.*` → `process.memoryUsage()`, `process.uptime()`

## Environment variables

| Variable               | Default | Purpose                                    |
| ---------------------- | ------- | ------------------------------------------ |
| `OTEL_ENABLED`         | `false` | Enable/disable telemetry                   |
| `OTEL_PROMETHEUS_PORT` | `9464`  | Prometheus `/metrics` scrape endpoint port |
| `OTEL_SERVICE_NAME`    | `papai` | Service name in OTel resource attributes   |

## New dependencies

```
@opentelemetry/api
@opentelemetry/sdk-metrics
@opentelemetry/exporter-prometheus
@opentelemetry/resources
@opentelemetry/semantic-conventions
```

5 packages. No auto-instrumentation, no trace SDK, no OTLP exporters.

## Modules changed

| Module                             | Change                                                   | Lines |
| ---------------------------------- | -------------------------------------------------------- | ----- |
| `src/index.ts`                     | Init telemetry before startup, add to shutdown           | ~10   |
| `src/telemetry/*`                  | New module (index, meter, instruments, subscriber, noop) | ~200  |
| `src/web/fetch-extract.ts`         | Direct metric calls for fetch duration/count/errors      | ~5    |
| `src/providers/youtrack/client.ts` | Inject recorder via existing deps                        | ~8    |
| `src/providers/kaneo/client.ts`    | Inject recorder via existing deps                        | ~8    |
| `src/scheduler.ts`                 | Tick duration, recurring task counter                    | ~5    |

No changes to: `bot.ts`, `llm-orchestrator.ts`, `llm-orchestrator-events.ts`, `llm-orchestrator-support.ts`, `bot-reply-tracking.ts`, `message-queue/*`.

## Testing

- `tests/telemetry/` — own test suite with OTel in-memory metric reader
- No-op mode: verify instruments return without error when `OTEL_ENABLED=false`
- Event subscriber: emit test events on bus, assert metric values via test reader
- Provider recorder: inject mock, verify call signatures
- Direct instrumentation: test `fetch-extract`, provider clients, scheduler with mock meter

## Future extensions (not in scope)

- OTLP exporter for pushing to an OTel Collector
- Distributed tracing via `@opentelemetry/sdk-trace-node`
- Structured log export to Loki via OTel logs bridge
- Grafana dashboard JSON as code
- Alertmanager rules for error rate spikes, LLM latency, queue depth thresholds
