<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Telemetry metrics

## Decisions

### D1: OTel + Prometheus, manual instrumentation only (from approved spec)

Vendor-neutral SDK with the Prometheus pull exporter fits the Docker
Compose deployment. No auto-instrumentation (Bun compatibility risk, and it
would not cover LLM/tool/web-fetch metrics anyway). Five packages:
`@opentelemetry/api`, `sdk-metrics`, `exporter-prometheus`, `resources`,
`semantic-conventions`. The existing stack cannot cover this: pino is a
logger, the debug event bus is process-internal, and `src/usage`/`src/analytics`
persist usage rows to SQLite rather than exporting scrape-able metrics.

### D2: Noop-by-default with lazy OTel loading

`OTEL_ENABLED !== 'true'` → `src/telemetry/index.ts` exports noop
instruments; the `@opentelemetry/*` imports live behind dynamic `import()`
in `initTelemetry()` so the disabled path has zero import cost and zero
overhead. This keeps the feature safe to ship before Prometheus is
deployed.

### D3: Event-bus bridge over invasive orchestrator edits

`llm:*`, `message:*`, and `auth:check` metrics come from a subscriber on
the existing debug event bus — no changes to `llm-orchestrator*.ts`.
Direct instrumentation is reserved for modules without events:
`web/fetch-extract.ts` (duration/total/errors at the invalid_url,
rate_limited, distillation_failed sites), both provider clients (injected
`ProviderMetricsRecorder`, try/finally recording), and `scheduler.ts`
(tick histogram + recurring-fired counter). The only event change is a
`chat_provider` label added to the existing `message:received` emit in
`bot.ts`.

### D4: Relationship to src/analytics (drift-check resolution)

The April spec predates `src/analytics`. Verified split: analytics records
content-free usage events to the DB for operator reporting (staged rollout
per ADR-0326/0341); telemetry-metrics exports operational gauges/counters/
histograms to Prometheus. Web-fetch duration counters and provider client
latency are not covered by analytics; no deduplication needed. Label sets
stay coarse (model, tool, provider family, chat_provider) — never
platform-instance ids, users, or groups (cardinality + the `/stats/*`
anonymity contract).

### D5: Scope, DB, gating, hooks

No persisted state, no drizzle migration, no scope-model impact, no
tool_prefs change, no settings UI surface (env-var only, matching
docs/architecture/environment.md conventions for deployment-level knobs).
Hook/TDD: new `src/telemetry/*` files are hook-gated → tests first under
`tests/telemetry/`; client edits ride with their existing suites plus
recorder assertions.
