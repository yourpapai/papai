<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Billing research bundle

Status: discovery + research only. No architecture or implementation decisions are
made here. The goal is to enumerate the questions to answer, the pricing models to
weigh, the providers to evaluate, the signals to measure, and the compliance traps
to avoid before papai introduces any commercial billing.

The user has confirmed two constraints, everything else is open:

- Customer profile: hybrid B2C + B2B (individuals pay personally; group/org owners
  may pay for shared limits)
- Output mode: research-only; defer architecture and code-level integration plans
  until packaging and provider decisions are made

## Reading order

1. [`01-discovery-questions.md`](./01-discovery-questions.md) — structured intake
   across product, finance, legal, and operations. Answers here gate every other
   decision.
2. [`02-pricing-models.md`](./02-pricing-models.md) — subscription, seat-based,
   metered, credits, freemium, hybrid. Comparison tables and AI-product specifics.
3. [`03-payment-providers.md`](./03-payment-providers.md) — PSP vs MoR, Stripe,
   Paddle, Lemon Squeezy, Polar, Creem, regional players, plus chat-platform
   native rails (Telegram Payments, Discord Premium Apps, Mattermost).
4. [`04-metering-and-telemetry.md`](./04-metering-and-telemetry.md) — what to
   meter on a chat-bot/LLM workload, ingestion patterns, dedicated metering
   vendors (Orb, Metronome, OpenMeter, Stigg), and the business + product
   metrics dashboards papai will need.
5. [`05-compliance-and-tax.md`](./05-compliance-and-tax.md) — PCI-DSS scope,
   PSD2/SCA, EU VAT/OSS, US sales tax, GDPR, refunds, dunning, fraud, abuse on
   the free tier, accounting and revenue recognition.
6. [`06-papai-integration-notes.md`](./06-papai-integration-notes.md) —
   papai-specific surface: where billing intersects existing modules (LLM
   orchestrator, identity mapping, group settings, BYO LLM keys, recurring and
   deferred prompts, debug/demo modes).

## Glossary

- **PSP** — Payment Service Processor. You remain the merchant of record and
  legal seller; the PSP only moves money (Stripe, Adyen, Braintree).
- **MoR** — Merchant of Record. The vendor becomes the legal seller in each
  jurisdiction, taking on tax collection, remittance, dunning, and chargeback
  handling (Paddle, Lemon Squeezy, Polar, Creem, FastSpring, DodoPayments).
- **SCA** — Strong Customer Authentication, mandated by EU PSD2.
- **OSS** — One Stop Shop, the EU VAT scheme that replaced MOSS in 2021 and
  expanded to all B2C distance sales of goods and services.
- **Entitlement** — what a paying customer is allowed to do (features unlocked,
  quotas, rate limits). Distinct from feature flags, which govern _release_ of
  a feature.
- **Meter / metered event** — a usage event ingested into a billing system
  (token count, message count, tool call) that aggregates into an invoice line.
- **COGS** — Cost of Goods Sold. For papai this is dominated by LLM API spend,
  embedding spend, plus fixed infra. Critical because BYO-LLM-key users have
  near-zero COGS on the bot operator.
- **NRR / GRR** — Net / Gross Revenue Retention. NRR includes expansion;
  GRR caps at 100% and isolates churn + downgrades.
- **Dunning** — the retry + recovery process for failed renewal payments.

## Out of scope for this bundle

- A concrete pricing sheet (numbers depend on COGS analysis and segment data).
- A chosen provider or tech stack.
- Database schema, table design, or webhook handlers.
- A packaging document for marketing.
- Anything related to a separate dashboard or self-serve portal beyond what is
  noted as needed.

## Source caveats

- All web-search citations were captured in April 2026; pricing and feature
  matrices for vendors shift quickly, re-verify before committing.
- Stripe acquired Lemon Squeezy in July 2024; treat any roadmap claim from LS
  with skepticism and verify directly.
- EU VAT enforcement tightened in January 2026 (cross-checking PSP transaction
  data against VAT returns); the compliance doc reflects this.
