# Remaining Work: 2026 04 26 telemetry metrics

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-26-telemetry-metrics.md`

## Completed

_None identified._

## Remaining

- Task 1: Install OpenTelemetry dependencies in package.json
- Task 2: Implement telemetry types and no-op instruments (src/telemetry/types.ts, src/telemetry/noop.ts)
- Task 3: Implement OTel meter provider and real instruments (src/telemetry/meter.ts, src/telemetry/instruments.ts)
- Task 4: Implement event bus subscriber (src/telemetry/subscriber.ts)
- Task 5: Create public API façade (src/telemetry/index.ts)
- Task 6: Wire telemetry into application lifecycle in src/index.ts
- Task 7: Instrument web fetch logic in src/web/fetch-extract.ts
- Task 8: Instrument provider clients in src/providers/kaneo/client.ts and src/providers/youtrack/client.ts
- Task 9: Instrument scheduler in src/scheduler.ts
- Task 10: Add observable gauges for queue depth and process runtime
- Task 11: Add chat_provider label to message:received events in src/bot.ts
- Task 12: Run full verification suite (typecheck, tests, lint, format)

## Suggested Next Steps

1. Run 'bun add @opentelemetry/api @opentelemetry/sdk-metrics @opentelemetry/exporter-prometheus @opentelemetry/resources @opentelemetry/semantic-conventions' to satisfy Task 1
2. Implement the no-op layer (Task 2) to establish the core interfaces without requiring active OTel instrumentation
3. Implement the real OTel instruments and the meter provider (Task 3) to enable actual metric collection
