<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Pricing models

A comparison of the pricing structures papai could adopt, with their economics,
operational implications, and fit for an LLM-driven, multi-platform chat bot
serving both individuals and groups.

The dominant 2026 industry signal is hybrid: 41% of SaaS companies use a
hybrid (subscription + usage) model, up from 27% a year prior, projected to
hit 61% by year-end. Pure seat-based fell from 21% to 15%, pure flat-fee from
29% to 22%. AI products in particular skew heavily toward usage or hybrid
because COGS varies linearly with use ([metronome.com][1], [data-mania][2]).

---

## Model menu

| Model                            | What you charge for                | Predictability for buyer | COGS coverage                 | Operational complexity | Fit for papai                      |
| -------------------------------- | ---------------------------------- | ------------------------ | ----------------------------- | ---------------------- | ---------------------------------- |
| Flat subscription                | Monthly/annual fixed fee           | High                     | Poor under variable LLM use   | Low                    | Possible if heavy quotas           |
| Per-seat                         | Each user / member                 | High                     | Poor (decoupled from LLM use) | Low                    | Awkward for B2C, OK for B2B groups |
| Tiered (free/pro/team)           | Bundle of features + caps          | High                     | Medium                        | Low–Medium             | Common starting point              |
| Pay-as-you-go (metered)          | Each unit of consumption           | Low                      | Excellent                     | High (metering)        | Punishing for casual users         |
| Prepaid credits                  | Pre-paid balance drains            | Medium                   | Excellent                     | Medium                 | Good fit for token-driven cost     |
| Freemium with hard caps          | Free up to a quota, paid removes   | High                     | Medium                        | Medium                 | Good acquisition path              |
| Hybrid (subscription + overages) | Base fee + metered overages        | Medium-High              | Excellent                     | High                   | Industry-standard for AI today     |
| Outcome-based                    | Per "successful" event (task done) | Low                      | Variable                      | Very high              | Aspirational, hard to measure      |

---

## 1. Flat subscription

Single price, unlimited (or "fair use") access.

- Pro: dead simple to communicate, dead simple to implement.
- Pro: predictable revenue, predictable buyer cost.
- Con: a single power user can blow your LLM budget for 10 paying users.
- Con: caps invite gaming and complaint cycles.
- When it works: cost per active user is low and bounded (e.g., LLM-light
  workflows, mostly tool-call / API replies, small models). Not where papai
  is today, given long agentic loops.

## 2. Per-seat / per-user

Each "seat" added to a workspace bills.

- Pro: scales with customer growth, classic B2B selling motion.
- Pro: easy to model for finance and procurement.
- Con: B2C can't be billed per seat (only one user). For papai's hybrid
  audience this is a B2B-only lever.
- Con: in a chat bot, "seat" is ambiguous — every group member who DMs the
  bot? only those with `set_my_identity`? group members observed by
  `group_admin_observations`? This needs a crisp definition (see discovery).
- Con: AI products that price per seat give up margin when one seat consumes
  100x another's tokens. Industry data shows per-seat dropped sharply in 2026.
- When it works: B2B Team plan with predictable usage and feature gating
  (admin tools, more groups, audit logs). Many AI tools combine a per-seat
  base with metered overages.

## 3. Tiered subscriptions (free / pro / team / enterprise)

Different bundles of features and quotas at fixed price points.

- Pro: classic anchor + upsell pattern, easy to understand.
- Pro: lets you gate features as well as quotas (entitlements).
- Con: tiers calcify; raising prices later requires careful grandfathering.
- Con: needs a strong feature-gate story (entitlements module, see [§4][s4] in
  the metering doc and [`03-payment-providers.md`][03] for entitlement vendors).
- Variant: tiers can themselves be hybrid (base + overage).
- When it works: nearly every consumer + prosumer SaaS. Default starting
  posture for most products.

## 4. Pure pay-as-you-go (metered)

Customer pays for exactly what they consumed.

- Pro: perfect COGS alignment if your meter matches your real cost.
- Pro: zero adoption friction (free until used).
- Con: bills with high variance create churn anxiety. AI products charging
  raw tokens find buyers cannot predict spend.
- Con: invoicing is more complex (open-ended billing periods, in-period
  meter events, late-arriving usage).
- Con: requires real-time gating to prevent runaway spend (cost ceilings,
  budget alerts).
- When it works: power-user tools, APIs, infrastructure. Less common as the
  _only_ consumer-facing model.

## 5. Prepaid credits

Customer buys a balance (10k credits = $X), each operation deducts credits.

- Pro: zero risk of bill shock; cost ceiling is the topped-up balance.
- Pro: lets you express variable underlying costs (1 cheap call = 1 credit,
  1 frontier-model call = 50 credits) without exposing raw token math.
- Pro: cash up front improves working capital.
- Con: regulatory treatment of unused credits varies by jurisdiction
  (consumer protection laws may force refunds of unspent balances; "stored
  value" rules may apply at scale).
- Con: revenue recognition is deferred until consumption.
- Con: requires a real-time balance store with strong consistency.
- When it works: buyers want a hard ceiling and can absorb the up-front
  outlay; common pattern in AI image gen, code assistants, transcription.
- Industry: credit-based offerings grew 126% in 2024-2026, reaching 79
  catalogued AI products with credit pricing.

## 6. Freemium with hard caps

Free tier with capped resources; paying removes the caps and unlocks
features.

- Pro: low-friction acquisition; users self-qualify by hitting the wall.
- Pro: combines well with everything else (free + tiers + overage).
- Con: free-tier abuse is the single biggest operational headache —
  duplicate accounts, hostile token consumption, prompt-injection probes.
  Mitigations live in compliance/abuse doc.
- Con: requires careful cap calibration: too low alienates trial users, too
  high subsidizes them indefinitely.
- When it works: papai's natural acquisition shape. Most chat-bot products
  use some flavor of this.

## 7. Hybrid (subscription base + metered overages)

Fixed monthly base includes an allowance; usage above the allowance bills
per unit.

- Pro: predictable floor + linear COGS coverage above the floor.
- Pro: industry-standard for AI products in 2026; 2.3x lower churn than
  seat-only models per Flexprice's analysis ([flexprice.io][3]).
- Pro: aligns "fair use" rhetoric with concrete numbers.
- Con: the most operationally complex model. Requires metering, real-time
  balance, soft caps, overage notifications, and clear surfacing of where
  the user sits relative to the included allowance.
- When it works: post-PMF AI products with diverse usage patterns. Good
  long-term destination even if launch starts simpler.

## 8. Outcome-based / value-based

Charge per "successful" outcome — task completed, deal closed, ticket
resolved.

- Pro: maximally aligned with customer value.
- Con: defining "outcome" is a measurement problem with a long tail of
  edge cases. ("Did the bot really resolve this task, or did the user
  finish it manually after?")
- Con: revenue is volatile; finance hates this.
- When it works: agentic SaaS with crisp success criteria (RPA, sales
  agents). Premature for papai today, but worth tracking for v2.

---

## AI / LLM-specific considerations

- The COGS curve under LLM use is roughly linear in tokens, with sharp
  steps when switching models. Pricing must absorb this without exposing
  the buyer to model-routing decisions they can't reason about.
- BYO-LLM-key fundamentally changes the math: the operator's COGS becomes
  near-zero, and the customer's marginal cost is paid directly to the
  model vendor. This effectively splits the world into two products:
  "managed LLM" (operator pays for tokens, charges a margin) and
  "BYO LLM" (operator charges for orchestration, tools, multi-platform,
  storage, support).
- Stripe's billing-meters now natively supports markup-on-token-cost
  ("apply 30% margin above raw model cost", with auto-tracking of
  upstream model prices). This is the smoothest path if you choose the
  managed-LLM route ([pymnts.com][4]).
- Embedding and vector storage are easily forgotten COGS items
  (papai's `memos.embedding` blob). Should be metered or capped on free.
- "Agent runs" or "tool-call sessions" are often more useful billable units
  than tokens — they map to user intent more cleanly and reduce bill shock.

## Packaging archetypes seen in the wild

| Archetype                    | Example shape                                            | Use cases                          |
| ---------------------------- | -------------------------------------------------------- | ---------------------------------- |
| Free → single Pro            | Free with caps, $X/mo Pro removes caps                   | Solo-dev / prosumer products       |
| Free → Pro → Team            | Adds team admin features at Team                         | Small team SaaS                    |
| Pro + credits add-on         | Subscription gates features, credits cover variable cost | AI products with variable LLM cost |
| Per-seat + base              | Base for org, per-seat for additional members            | B2B SaaS, often with overage       |
| Pay-as-you-go API + Pro chat | Two SKUs, two audiences                                  | Perplexity, OpenAI, Anthropic      |

papai's hybrid B2C+B2B audience suggests **two parallel SKUs**: a personal
plan (likely freemium tier or freemium + credits) and a team/group plan
(per-group flat fee, optionally with overage). Co-existing with BYO-LLM-key
mode as a discounted variant of either.

---

## Decision triggers

Before settling on a pricing model, the following must be quantified:

1. **Per-active-user LLM COGS distribution** — pull a week of `tokenUsage`
   from `emitLlmEnd` events for your active user base, multiply by current
   model prices. Look at p50, p90, p99. The shape of this distribution
   determines whether flat pricing is even viable.
2. **Free-tier acceptable burn** — how many free users can you afford to
   subsidize at $X average COGS, given your runway?
3. **Group economics** — distribution of group sizes, distribution of
   active-poster ratio per group, distribution of LLM cost per group.
4. **BYO-LLM share** — what % of current users have set `llm_apikey`?
   This is your true addressable market for managed-LLM pricing.

These numbers convert pricing from speculation into a constrained optimization.

---

## Sources

- [2026 trends from cataloging 50+ AI pricing models — Metronome][1]
- [How AI companies are monetizing in 2026 — Data-Mania][2]
- [Hybrid pricing complete guide — Flexprice][3]
- [Stripe introduces billing tools to meter and charge AI usage — PYMNTS][4]
- [SaaS pricing models complete 2026 guide — Alguna][5]
- [The 2026 guide to SaaS, AI, and agentic pricing — Monetizely][6]
- [The AI pricing and monetization playbook — BVP][7]
- [6 proven pricing models for AI SaaS — Lago][8]
- [SaaS pricing strategy guide — NxCode][9]

[1]: https://metronome.com/blog/2026-trends-from-cataloging-50-ai-pricing-models
[2]: https://www.data-mania.com/blog/ai-monetization-seats-tokens-hybrid-models/
[3]: https://flexprice.io/blog/hybrid-pricing-guide
[4]: https://www.pymnts.com/news/artificial-intelligence/2026/stripe-introduces-billing-tools-to-meter-and-charge-ai-usage/
[5]: https://blog.alguna.com/saas-pricing-models/
[6]: https://www.getmonetizely.com/blogs/the-2026-guide-to-saas-ai-and-agentic-pricing-models
[7]: https://www.bvp.com/atlas/the-ai-pricing-and-monetization-playbook
[8]: https://getlago.com/blog/6-proven-pricing-models-for-ai-saas
[9]: https://www.nxcode.io/resources/news/saas-pricing-strategy-guide-2026
[s4]: ./04-metering-and-telemetry.md
[03]: ./03-payment-providers.md
