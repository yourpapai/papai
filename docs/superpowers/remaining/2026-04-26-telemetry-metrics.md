<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Remaining Work: 2026 04 26 telemetry metrics

**Status:** not_implemented
**Generated:** 2026-08-07
**Plan:** `docs/superpowers/plans/2026-04-26-telemetry-metrics.md`

## Completed

- Design spec exists at docs/superpowers/specs/2026-04-26-telemetry-metrics-design.md (referenced by plan)

## Remaining

- Task 1: Install OTel deps (@opentelemetry/api, sdk-metrics, exporter-prometheus, resources, semantic-conventions) in package.json
- Task 2: src/telemetry/types.ts (Instruments, ProviderMetricsRecorder interfaces) + src/telemetry/noop.ts (noopInstruments, noopProviderRecorder) + tests/telemetry/noop.test.ts
- Task 3: src/telemetry/meter.ts (MeterProvider + PrometheusExporter) + src/telemetry/instruments.ts (buildInstruments, initRealInstruments, getProviderRecorder) + tests/telemetry/instruments.test.ts
- Task 4: src/telemetry/subscriber.ts (startEventSubscriber mapping llm:end/llm:error/llm:tool_result/message:received/message:replied/auth:check to instruments) + tests/telemetry/subscriber.test.ts
- Task 5: src/telemetry/index.ts public facade (initTelemetry, shutdownTelemetry, getInstruments, getProviderRecorder) with lazy OTel loading
- Task 6: Wire initTelemetry()/shutdownTelemetry() into src/index.ts startup and graceful shutdown chain
- Task 7: Instrument src/web/fetch-extract.ts (webFetchDuration/Total/Errors at invalid_url, rate_limited, distillation_failed sites)
- Task 8: Instrument src/providers/kaneo/client.ts and src/providers/youtrack/client.ts via getProviderRecorder() with try/finally recording
- Task 9: Instrument src/scheduler.ts (schedulerTickDuration histogram, schedulerRecurringFired counter)
- Task 10: Add observable gauges (papai.queue.depth, papai.queue.buffered, process.runtime.bun.memory.heap_used/external, uptime) in instruments.ts
- Task 11: Add chat_provider label to message:received emit in src/bot.ts
- Task 12: Full verification (typecheck, bun test, lint, format:check, check:verbose)

## Suggested Next Steps

1. Run 'bun add @opentelemetry/api @opentelemetry/sdk-metrics @opentelemetry/exporter-prometheus @opentelemetry/resources @opentelemetry/semantic-conventions' and verify bun install is clean
2. Create the telemetry foundation in TDD order: tests/telemetry/noop.test.ts -> src/telemetry/types.ts -> src/telemetry/noop.ts, confirm tests pass
3. Add OTel runtime: tests/telemetry/instruments.test.ts -> src/telemetry/meter.ts -> src/telemetry/instruments.ts (including Task 10 observable gauges in the same pass)
4. Add event-bus bridge: tests/telemetry/subscriber.test.ts -> src/telemetry/subscriber.ts, then src/telemetry/index.ts facade with async initTelemetry/shutdownTelemetry using dynamic import()
5. Wire src/index.ts lifecycle (await initTelemetry() before initDb; .then(() => shutdownTelemetry()) before closeDrizzleDb)
6. Instrument src/web/fetch-extract.ts and src/providers/kaneo/client.ts / youtrack/client.ts (try/finally recorder pattern), run their existing tests to confirm noop path is safe
7. Instrument src/scheduler.ts tick/recurring metrics and add chat_provider to message:received in src/bot.ts
8. Run full verification: bun run typecheck, bun test, bun run lint, bun run format:check, bun run check:verbose; commit per the plan's task commit messages
