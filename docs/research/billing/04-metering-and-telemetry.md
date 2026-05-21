<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Metering, telemetry, and metrics

Three concerns, often confused, must stay separate:

1. **Operational telemetry** — observability for engineers (logs, traces,
   spans, exceptions). Already partially in place via pino + the debug
   event bus.
2. **Product analytics** — what users do, where they get stuck, conversion
   funnels. Often a separate stack (PostHog, Amplitude, Mixpanel).
3. **Billing metering** — auditable usage events that drive invoice line
   items. Has stricter requirements than the other two: durability,
   idempotency, immutable audit trail, replayability, reconciliation.

This document focuses on **billing metering** and the **business KPIs**
that the metering data should make possible. It briefly notes the bridge to
operational telemetry where it matters.

---

## 1. What to meter on a chat-bot / LLM workload

Candidate billable units, ranked roughly by predictability for the buyer:

| Unit                                  | Predictable? | COGS-aligned? | Comments for papai                                                                      |
| ------------------------------------- | ------------ | ------------- | --------------------------------------------------------------------------------------- |
| User message                          | High         | Weak          | Easy to count in `bot.ts`, but a single message can run a 30-step agent loop            |
| "Agent run" / orchestrator invocation | Medium-high  | Medium        | Maps to one `invokeModel` call; clear unit users can reason about                       |
| Tool call                             | Medium       | Medium        | One LLM step may produce many tool calls; `handleToolCallFinish` already observes these |
| LLM input + output tokens             | Low          | High          | True cost driver, but bill-shock-prone; expose only as overage detail                   |
| Premium model token                   | Low          | Very high     | Frontier-model use as a separately metered SKU                                          |
| Embedding tokens                      | Low          | Medium        | `memos.embedding` work; trivial cost individually, can spike on bulk import             |
| File / attachment                     | Medium       | Medium        | `file-relay` and `upload_attachment` tools                                              |
| Web fetch                             | High         | Low           | `web_fetch` with rate-limit infra already present                                       |
| Recurring task tick                   | High         | Medium        | `recurring_tasks` create per-occurrence work; cost amplifier                            |
| Deferred prompt fire                  | High         | Medium        | `scheduled_prompts` similarly amplifies cost                                            |
| Group registration                    | High         | Low           | Adding a new authorized group; classic seat-style metric for B2B                        |
| Active group (DAU/WAU)                | High         | Low           | Better than seat for usage-shaped pricing                                               |
| Storage GB-month                      | Medium       | Low           | Conversation history, memos, embeddings, files                                          |

Common best practice: pick **one** primary metering unit your customer
sees on the invoice ("messages", "credits", "agent runs"), and keep tokens
as the internal bookkeeping that drives credit conversion. Exposing tokens
directly tends to cause complaint cycles.

---

## 2. Event shape

Standard billing-event payload looks like:

```jsonc
{
  "id": "evt_01J...", // ULID or UUID, unique per event
  "source": "papai.bot.v1", // your service identity
  "type": "llm.run.completed", // event type, contracted
  "subject": "user_123", // billable account (user or group)
  "occurredAt": "2026-04-18T10:00:00Z",
  "ingestedAt": "2026-04-18T10:00:01Z",
  "data": {
    "model": "gpt-4o-mini",
    "inputTokens": 4123,
    "outputTokens": 812,
    "toolCalls": 4,
    "stepCount": 6,
    "contextType": "group",
    "configId": "group_456",
  },
  "idempotencyKey": "ulid-or-hash", // server-side dedup key
}
```

This shape matches CloudEvents (used by OpenMeter) and aligns with
Stripe's meter event payload. The dedup story uses `(source, id)` per
CloudEvents convention or a single `identifier` per Stripe.

papai already produces most of these signals via `emit('llm:end', ...)` in
`src/llm-orchestrator-events.ts`. The bridge from in-process `emit` to a
durable, dedup-safe billing pipeline is the missing piece.

---

## 3. Ingestion patterns

Three architectural shapes, with tradeoffs.

### a. Synchronous direct-to-billing (small scale)

Bot finishes an LLM call → posts a meter event directly to Stripe / Paddle
inline. Simple. Tightly coupled. Outage in billing affects bot latency.

Tolerable up to ~tens of events per second. Risk: Stripe v1 meter events
endpoint caps at 1,000/sec, v2 streams at 10,000/sec; well within reach
but requires rate-aware retry.

### b. Outbox pattern (recommended for SQLite-shaped systems)

Bot writes the event into a local `billing_outbox` table inside the same
DB transaction as the operation. A background worker drains the outbox
into the billing system, retrying on failure, marking events as committed
once acknowledged.

- Bot latency unaffected by billing outages.
- Idempotency key on the outbox row protects against duplicate sends.
- Reconciliation is straightforward: `outbox.committed = true` ↔ exists
  in Stripe.
- Plays nicely with papai's existing SQLite + Drizzle setup.

### c. Dedicated metering layer (mid-to-large scale)

Use a metering vendor (OpenMeter, Orb, Metronome) as the durable ingest
target. The metering layer handles aggregation, late events, dedup, and
exports invoice-ready summaries to the billing engine.

- Best when usage volume is high or when the rating model is complex
  (per-model pricing, tiered ladders, commit-and-overage contracts).
- Adds a vendor and a cost; only worth it past the point where the
  outbox-plus-Stripe-meters approach becomes painful.

For papai today, **(b)** is the right starting shape. Migration to **(c)**
later is straightforward if events are stored in the outbox before being
forwarded — you change the destination, not the producer.

---

## 4. Idempotency, late events, and the audit trail

### Idempotency

Every billing event must carry a stable, server-side-generated identifier.
A retry of the same event must be a no-op for the billing system. Both
Stripe and OpenMeter document this explicitly:

- Stripe: `identifier` field on meter events, deduplicated within a
  rolling 24h window ([Stripe meters API][s-meter]).
- OpenMeter: `(source, id)` CloudEvents tuple deduplicates ([om-idem]).

Generation strategy: `ULID` or a content hash of the operation. Never
use a clock-derived value alone.

### Late events

LLM calls can be retroactively attributed (e.g., a tool that runs async
and reports tokens late). Stripe accepts events up to 35 days old; events
older than that drop. OpenMeter and Metronome handle longer windows.

Plan for late events that arrive _after_ an invoice has been finalized.
Standard treatment: roll the late usage into the next invoice, or issue
a credit memo. Document the policy in the customer-facing T&Cs.

### Audit trail

Keep a permanent, append-only copy of every emitted billing event in your
own store, separate from the operational DB. Stripe and the metering
vendor are convenient; they are **not** your source of truth. If a customer
disputes a bill, you should be able to reconstruct the bill from your
own logs. (See [Stripe best practices][bmf] which call this out explicitly.)

---

## 5. Real-time gating vs eventual reconciliation

Two different problems often confused:

- **Reconciliation**: at end of period, invoice matches reality. Eventual
  consistency is fine here.
- **Gating**: stop the next operation before it incurs more cost than the
  user is allowed.

Gating must be near-real-time and lives in the bot, not the billing system.
Pattern:

1. Local `quota_state` table per billable subject, updated on each emit.
2. Cheap, in-memory check before each LLM call.
3. Periodic reconciliation against billing-system aggregates to catch drift.

For a credit model: the credit balance lives in your DB (source of truth),
top-ups via Stripe webhooks credit the balance, drains happen on each
metered event. Real-time "do I have enough credit?" is a single SQL
read.

---

## 6. Metering vendors compared

When papai outgrows the outbox + Stripe-meters approach.

### OpenMeter (open source)

- Self-hostable or cloud. OSS code under permissive license.
- CloudEvents-based ingestion via HTTP, Kafka, or webhooks.
- SQL meter definitions for custom aggregations.
- Exports to Stripe, Chargebee, others.
- Best fit when self-hosting matters or when you need a metering layer
  but don't want to commit to a paid vendor early.
- Smaller ecosystem than Orb / Metronome but actively maintained.

### Orb

- Hosted metering + rating + invoicing.
- Strong on flexible pricing models (tiered, volume, package, graduated).
- Typically chosen by API-first / infra companies.
- Requires a separate billing engine for collections and contract
  management at the high end.

### Metronome

- Built for the very largest usage-based businesses (OpenAI, Databricks
  scale).
- Premium pricing; overkill for early-stage products but the gold standard
  for billions of events per day.

### Stigg (entitlements layer)

- Less about metering, more about _what features a plan unlocks_.
- Real-time entitlement enforcement, product-catalog management, credit
  governance.
- Pairs with any billing engine. Useful as the feature-gating service
  papai will eventually need across Free/Pro/Team tiers.

### Lago, Schematic, Flexprice, Alguna

- All in the same neighborhood as Orb/OpenMeter; review pricing and
  feature parity at decision time. Most are differentiated by go-to-market
  segment (indie, mid-market, enterprise) more than by capability.

---

## 7. Business KPIs the billing system must enable

Standard SaaS metrics that any chosen stack must expose either natively
or via raw event export.

### Revenue

- **MRR / ARR** — committed monthly / annual recurring revenue. Excludes
  one-time charges.
- **Bookings** — contract value signed in the period (matters once
  annual deals exist).
- **Net new MRR** = New MRR + Expansion MRR − Contraction MRR − Churned MRR.
- **Quick ratio** = (New + Expansion) / (Contraction + Churn). Healthy SaaS
  is >4.

### Per-customer

- **ARPU / ARPA** — average revenue per user / per account.
- **LTV** — lifetime value. Crude form: ARPU / monthly churn rate.
- **CAC** — customer acquisition cost.
- **LTV / CAC** — should trend >3 in a healthy business.
- **Payback period** — months to recover CAC.

### Retention

- **Logo churn** — % of customers lost in period.
- **Revenue churn** (gross) — MRR lost from cancellations + downgrades.
- **NRR** — (starting MRR + expansion − contraction − churn) / starting MRR.
  Above 100% means existing base grows without new sales.
- **GRR** — same, no expansion. Cap at 100%, isolates customer-quality
  signal.

### Usage / product

- **DAU / WAU / MAU** — active users at each cadence.
- **Active groups** — papai-specific; distinct from active users.
- **Median / p90 / p99 LLM cost per active user** — needed for COGS work
  and pricing calibration.
- **% of paid users hitting their cap** — health of the cap level.
- **% of free users hitting their cap** — conversion signal.
- **Tool-call mix** — which tools drive cost vs which drive value.

### Financial health

- **Gross margin** = (Revenue − COGS) / Revenue. Software target ~75-80%;
  AI-heavy products often lower (40-60%) until pricing matures.
- **Cash collected vs MRR** (especially with annual deals).
- **Burn multiple** = Net burn / Net new ARR.

### Operational health (bridges to telemetry)

- **Bill accuracy** — % of invoices issued without manual correction.
- **Reconciliation drift** — delta between in-DB usage and billing-system
  aggregates. Should trend to zero.
- **Failed-charge rate** + **dunning recovery rate**.
- **Dispute rate** — chargebacks per 1000 transactions. >0.9% triggers
  card-network warnings.

---

## 8. Operational telemetry bridge

Existing papai telemetry that is billing-relevant, in `src/llm-orchestrator-events.ts`:

- `llm:start` — model, message count, tool count
- `llm:end` — model, duration, **tokenUsage**, response id, finish reason
- `llm:error` — error message + model

Token usage is already on the wire; the work is durably persisting it,
attributing it to a billable subject (per the discovery doc), and
forwarding to a billing system. This is mostly plumbing rather than
research, and is touched on in [`06-papai-integration-notes.md`][06].

OpenTelemetry mapping: each billing event can also be a `metric`
observation with attributes for model, contextType, subject. Avoid
double-publishing the same data via two paths if you have an OTel
exporter — keep billing flow primary, mirror the _aggregates_ (not raw
events) into your observability stack.

---

## Sources

- [OpenMeter usage-based billing TechCrunch][om-tc]
- [OpenMeter idempotency design][om-idem]
- [OpenMeter ingest event docs][om-ingest]
- [Stripe Meters API reference][s-meter]
- [Stripe metered billing implementation guide for SaaS — BuildMVPFast][bmf]
- [Metronome alternatives — Stigg][stigg-alts]
- [Best usage-based billing software 2026 — LedgerUp][lu]
- [Metronome vs Orb — Orb][orb-met]
- [Top 8 usage billing software — Schematic][schem]
- [16 key SaaS metrics — Orb blog][orb-saas]
- [SaaS metrics and KPIs FAQ — Zoho Billing][zoho]
- [SaaS metrics: NRR ARR billings — StockTitan][stk]
- [Feature gating implementation — Stigg][stigg-gate]

[om-tc]: https://techcrunch.com/2024/03/12/openmeter-makes-it-easier-for-companies-to-track-usage-based-billing/
[om-idem]: https://github.com/openmeterio/openmeter/blob/main/docs/decisions/0003-idempotency.md
[om-ingest]: https://github.com/openmeterio/openmeter/blob/main/api/client/go/README.md
[s-meter]: https://docs.stripe.com/api/billing/meter
[bmf]: https://www.buildmvpfast.com/blog/stripe-metered-billing-implementation-guide-saas-2026
[stigg-alts]: https://www.stigg.io/blog-posts/metronome-alternatives
[lu]: https://www.ledgerup.ai/resources/best-usage-based-billing-software-2026
[orb-met]: https://www.withorb.com/blog/metronome-vs-orb
[schem]: https://schematichq.com/blog/usage-billing-software
[orb-saas]: https://www.withorb.com/blog/saas-metrics
[zoho]: https://www.zoho.com/billing/academy/billing-basics/faqs-saas-metrics-and-kpis.html
[stk]: https://www.stocktitan.net/articles/saas-metrics-nrr-arr-billings-explained
[stigg-gate]: https://www.stigg.io/blog-posts/feature-gating
[06]: ./06-papai-integration-notes.md
