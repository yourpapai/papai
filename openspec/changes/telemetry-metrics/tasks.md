<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Telemetry metrics

## 1. Foundation

- [ ] 1.1 Add the 5 OTel deps (`@opentelemetry/api`, `sdk-metrics`, `exporter-prometheus`, `resources`, `semantic-conventions`) via `bun add`.
      Verify: clean `bun install`
- [ ] 1.2 Write failing `tests/telemetry/noop.test.ts`, then implement
      `src/telemetry/types.ts` + `src/telemetry/noop.ts`
      (`noopInstruments`, `noopProviderRecorder`).
      Verify: `bun test tests/telemetry/noop.test.ts`

## 2. OTel runtime

- [ ] 2.1 Write failing `tests/telemetry/instruments.test.ts`, then
      implement `src/telemetry/meter.ts` (MeterProvider + Prometheus
      exporter) and `src/telemetry/instruments.ts` (`buildInstruments`,
      `initRealInstruments`, `getProviderRecorder`, observable gauges for
      queue depth / heap / uptime).
      Verify: `bun test tests/telemetry/instruments.test.ts`

## 3. Event bridge + facade

- [ ] 3.1 Write failing `tests/telemetry/subscriber.test.ts`, then
      implement `src/telemetry/subscriber.ts` (maps
      `llm:end`/`llm:error`/`llm:tool_result`/`message:received`/
      `message:replied`/`auth:check` to instruments) and
      `src/telemetry/index.ts` facade (`initTelemetry`,
      `shutdownTelemetry`, `getInstruments`, `getProviderRecorder` with
      lazy dynamic import).
      Verify: `bun test tests/telemetry/subscriber.test.ts`
- [ ] 3.2 Wire `initTelemetry()` / `shutdownTelemetry()` into
      `src/index.ts` startup and graceful shutdown.
      Verify: `bun run typecheck`

## 4. Direct instrumentation

- [ ] 4.1 Failing tests then edits: `src/web/fetch-extract.ts`
      (duration/total/errors), `src/providers/kaneo/client.ts` and
      `src/providers/youtrack/client.ts` (injected recorder, try/finally),
      `src/scheduler.ts` (tick histogram, recurring counter),
      `src/bot.ts` (`chat_provider` label on `message:received`).
      Verify: focused `bun test tests/web tests/providers tests/bot*` plus existing scheduler/bot suites

## 5. Gate

- [ ] 5.1 Full `bun test`, `bun run typecheck`, `bun run lint`,
      `bun run format:check`; document `OTEL_*` vars in
      `docs/architecture/environment.md` and the observability note in
      `docs/architecture/behaviors.md`.
      Verify: all commands pass
