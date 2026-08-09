<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Telemetry metrics

## Why

papai has pino structured logs and an internal debug event bus, but no
external metrics. The bot runs in Docker Compose where Prometheus/Grafana
are planned; today there is no way to observe LLM latency/cost rate, tool
failure rate, provider client health, web-fetch behavior, scheduler tick
duration, queue depth, or process runtime outside log scraping.

## What Changes

- New `src/telemetry/` module: OTel `MeterProvider` + Prometheus exporter
  (`/metrics` on `OTEL_PROMETHEUS_PORT`, default 9464), pre-created
  counters/histograms/gauges, an event-bus subscriber mapping
  `llm:end`/`llm:error`/`llm:tool_result`/`message:received`/
  `message:replied`/`auth:check` to instruments, and a noop fallback.
- Noop-by-default: when `OTEL_ENABLED` is not `true`, no OTel package is
  imported and all instrument calls discard silently (zero overhead).
- Direct instrumentation of `src/web/fetch-extract.ts`,
  `src/providers/kaneo/client.ts`, `src/providers/youtrack/client.ts`
  (injected recorder), and `src/scheduler.ts`; observable gauges for queue
  depth and process runtime; `chat_provider` label on `message:received`.
- Lifecycle: `initTelemetry()` before DB init in `src/index.ts`,
  `shutdownTelemetry()` in the graceful shutdown chain.

## Capabilities

### New Capabilities

- `telemetry-metrics` — optional OTel/Prometheus operational metrics over
  the event bus and direct instrumentation, noop when disabled.

### Modified Capabilities

None. `openspec/specs/` has no entries for the touched surfaces.

## Non-goals

- No auto-instrumentation packages, no trace SDK, no OTLP exporters (Bun
  compatibility; spec decision).
- No usage-analytics change: `src/usage`/`src/analytics` keep recording
  per-request usage to the DB; OTel metrics are operational/exported and
  complementary, not a replacement.
- No dashboards/alerts/Grafana provisioning; no per-platform-instance or
  per-user metric labels (cardinality).
- No changes to `bot.ts` orchestration beyond the `chat_provider` label on
  the existing `message:received` event.

## Impact

- **Code:** new `src/telemetry/` + `tests/telemetry/`; small edits to
  `src/index.ts`, `src/web/fetch-extract.ts`, both provider clients,
  `src/scheduler.ts`, `src/bot.ts` (event label).
- **Dependencies:** 5 new `@opentelemetry/*` packages (manual
  instrumentation only — justified in design.md).
- **Env:** `OTEL_ENABLED` (default false), `OTEL_PROMETHEUS_PORT` (9464),
  `OTEL_SERVICE_NAME` (`papai`) — documented in
  `docs/architecture/environment.md`.
- **Scope model:** no persisted state; nothing keyed by storage/config
  context, platform instance, or user id; identical across instances.
- **Docs:** `docs/architecture/behaviors.md` observability note.
- **Legacy:** adopts `docs/superpowers/plans/2026-04-26-telemetry-metrics.md`,
  `docs/superpowers/specs/2026-04-26-telemetry-metrics-design.md`, and
  `docs/superpowers/remaining/2026-04-26-telemetry-metrics.md`
  (delete-on-adopt, same commit).
