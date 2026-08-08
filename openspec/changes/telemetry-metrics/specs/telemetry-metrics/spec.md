<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines papai's optional OpenTelemetry/Prometheus operational metrics:
an event-bus-driven and directly-instrumented telemetry module that exports
LLM, tool, chat, web-fetch, provider-client, scheduler, queue, and process
metrics when enabled, and costs nothing when disabled.

## ADDED Requirements

### Requirement: Noop-by-default telemetry

The system SHALL export fully functional no-op instruments when
`OTEL_ENABLED` is not `true`, SHALL NOT import any `@opentelemetry/*`
package on that path, and SHALL expose `initTelemetry` /
`shutdownTelemetry` / `getInstruments` / `getProviderRecorder` from
`src/telemetry/index.ts` regardless of mode.

#### Scenario: Disabled by default

- **WHEN** the process starts without `OTEL_ENABLED=true`
- **THEN** no OTel package is loaded, instrument calls silently discard,
  and startup/shutdown succeed unchanged

#### Scenario: Enabled startup

- **WHEN** the process starts with `OTEL_ENABLED=true`
- **THEN** a MeterProvider with the Prometheus exporter serves `/metrics`
  on `OTEL_PROMETHEUS_PORT` (default 9464) with `OTEL_SERVICE_NAME`
  (default `papai`) as the resource service name

### Requirement: Event-bus metric mapping

The system SHALL map `llm:end`, `llm:error`, `llm:tool_result`,
`message:received`, `message:replied`, and `auth:check` debug-bus events to
counters/histograms with coarse labels (model, tool name, chat_provider),
and SHALL include a `chat_provider` label on the `message:received` event
payload.

#### Scenario: LLM turn completes

- **WHEN** an `llm:end` event fires with model and duration metadata
- **THEN** the LLM request duration histogram records the value with the
  model label

#### Scenario: Message received

- **WHEN** a `message:received` event fires
- **THEN** the received counter increments with the chat provider family
  label and no instance/user/group labels

### Requirement: Direct instrumentation points

The system SHALL record web-fetch duration/count/errors in
`src/web/fetch-extract.ts`, provider client call duration/errors in the
Kaneo and YouTrack clients via an injected recorder, and scheduler tick
duration plus recurring-fired counts in `src/scheduler.ts`.

#### Scenario: Provider client failure

- **WHEN** a Kaneo or YouTrack client call throws
- **THEN** the provider error counter increments and the duration histogram
  still records via the try/finally pattern

#### Scenario: Noop path safety

- **WHEN** telemetry is disabled and an instrumented module runs
- **THEN** behavior and return values are identical to the pre-telemetry
  implementation

### Requirement: Label cardinality and anonymity

Metric labels SHALL NOT include platform instance ids, user ids, group ids,
task identifiers, or message content.

#### Scenario: Label audit

- **WHEN** `/metrics` output is inspected after mixed traffic
- **THEN** label sets contain only coarse operational dimensions (model,
  tool, provider family, chat_provider, status class)

### Requirement: Lifecycle integration

`initTelemetry()` SHALL run before DB initialization and
`shutdownTelemetry()` SHALL run in the existing graceful shutdown chain.

#### Scenario: Graceful shutdown

- **WHEN** the process receives SIGTERM with telemetry enabled
- **THEN** the meter provider flushes and shuts down before the database
  closes
