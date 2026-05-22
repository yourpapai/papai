<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Payment providers and billing infrastructure

Three layers to evaluate independently:

1. **Money mover** — the PSP or MoR that takes the customer's card and
   moves money to your bank.
2. **Subscription / billing engine** — the system that owns plans, prices,
   invoices, prorations, dunning. Often part of the money mover (Stripe
   Billing, Paddle Billing) but sometimes separate (Chargebee, Recurly,
   Maxio sitting on top of Stripe / Adyen).
3. **Metering and entitlements** — what a customer is allowed to do and how
   their usage is measured. Often a separate vendor for AI workloads
   (Orb, Metronome, OpenMeter, Stigg) feeding the billing engine.

A small operation can run all three from a single Stripe account; a larger
one usually decomposes them.

The chat-platform layer is its own concern — Telegram, Discord, and
Mattermost each have policies about how (or whether) money may flow inside
their app. Those constraints can override your provider preference.

---

## A. PSP vs MoR — the foundational choice

| Dimension                      | PSP (e.g., Stripe direct)      | MoR (e.g., Paddle, Polar, Lemon Squeezy, Creem)         |
| ------------------------------ | ------------------------------ | ------------------------------------------------------- |
| Legal seller                   | You                            | The MoR                                                 |
| Tax registration burden        | You (Stripe Tax assists)       | None for the markets MoR covers                         |
| VAT / sales-tax filing         | You                            | MoR                                                     |
| Chargeback handling            | You                            | MoR (varies — some auto-accept)                         |
| Branding on customer statement | You                            | MoR (some allow brand co-display)                       |
| Effective fee                  | ~2.9% + $0.30 (Stripe US card) | 5%–10% + ~$0.50                                         |
| Time-to-EU-launch              | Weeks (registration, OSS)      | Days                                                    |
| Enterprise comfort             | High (familiar to procurement) | Mixed (some procurement teams object to MoR statements) |
| Refund / dispute flexibility   | High                           | MoR-policy bound                                        |
| Vendor lock-in                 | Lower                          | Higher (customer relationship belongs to MoR)           |

Heuristic: solo / pre-PMF / global from day one → MoR. Established business
with finance team and EU registration → PSP + Stripe Tax. Enterprise B2B
deals → PSP, sometimes both (PSP for enterprise, MoR for self-serve).

---

## B. Money movers / billing engines compared

### Stripe (PSP, optional MoR in private beta)

- Industry-default PSP. Massive ecosystem, deep AI billing features.
- Stripe Billing supports recurring, metered, mixed, and the new AI-token
  billing meters (markup on raw model cost).
- Stripe Tax automates global tax calculation, registration assistance,
  filings; charged separately.
- Customer Portal (hosted) covers see invoices / change plan / update card
  / cancel — important for chat-only products like papai.
- Webhooks are reliable and well-documented.
- 2.9% + $0.30 (US card), 1.5% + €0.25 (EU card), various international.
- Tax filing in MoR mode is in private beta, +3.5% on top of regular fees.
- Sources: [Stripe AI billing announcement][s-ai], [Meters API][s-meter],
  [Stripe Tax][s-tax].

### Paddle (MoR)

- Long-established MoR, transparent pricing: 5% + $0.50 per transaction,
  no extra cross-border or FX fees.
- Solid for global self-serve SaaS and digital goods.
- Paddle Billing now has metered support; historically it was Paddle's
  weak spot.
- Less developer-loved API surface than Stripe, but maturing.
- Strong tax + invoice compliance worldwide out of the box.

### Lemon Squeezy (MoR, Stripe-owned)

- Acquired by Stripe in July 2024.
- Indie-friendly, fast checkout, strong defaults for digital goods.
- Roadmap noticeably slowed post-acquisition; some payout / support
  complaints in 2025-2026 reviews. Verify current state before committing.
- 5% + $0.50 base.
- Reasonable choice if you want MoR with a Stripe migration path later.

### Polar (MoR, open source, dev-tool focus)

- Built developer-first; native handling of GitHub sponsors, license keys,
  digital goods.
- 4% + $0.40 starter; open-source code lets you self-host the
  customer-facing pieces if needed.
- Smaller than Paddle/LS but growing in the indie + AI builder segment.
- Some sources cite 10% + $0.50; pricing has changed multiple times,
  re-verify.

### Creem (MoR, AI-builder focus)

- Newer MoR positioning itself at the lowest fees for indie AI builders.
- Aggressive on EU VAT compliance messaging, particularly the 2026
  enforcement changes.
- Less battle-tested than Paddle / LS — risk profile is "young vendor".

### Chargebee, Recurly, Maxio (Saasoptics + Chargify)

- Subscription engines that sit on top of a PSP (commonly Stripe).
- Use when you outgrow Stripe Billing's complexity model: complex prorations,
  multiple revenue streams, ASC 606 revenue recognition, accounting hooks.
- Overkill for papai today; revisit at $1M+ ARR.

### Orb, Metronome (modern usage-based billing engines)

- Purpose-built for high-volume metered billing.
- Metronome is what large AI companies (OpenAI, Databricks scale) use; it
  bills against the underlying PSP for money movement.
- Orb sits in the same category, with stronger flexibility for non-AI
  use cases. Documented in detail in [`04-metering-and-telemetry.md`][m].

### Stigg (entitlements layer)

- Not a billing engine per se; manages entitlements (what plan unlocks
  what feature) and integrates with Stripe / Paddle for the money side.
- Useful when feature-gating becomes a many-tier, many-feature matrix
  that you don't want hardcoded.

### Regional players (when launching in specific markets)

- **Razorpay** — India, especially when serving Indian B2B with INR
  invoicing and GST compliance.
- **MercadoPago** — LatAm, especially Brazil/Argentina.
- **YooKassa**, **Tinkoff**, **Robokassa** — Russia / CIS (sanctions
  permitting). Note: significant sanctions risk; legal review required
  before any work here.
- **Adyen** — enterprise alternative to Stripe with strong card-not-present
  performance in EMEA.
- **Braintree** — PayPal-owned, broad PayPal-network reach.
- **Square / Block** — mostly retail, limited SaaS use.

---

## C. Effective fee comparison (illustrative, US/EU card, self-serve $20/mo)

Based on each vendor's public pricing as of April 2026 — **re-verify before
selecting**, as percentages and base fees change frequently.

| Vendor                           | Effective rate (~)             | Notes                             |
| -------------------------------- | ------------------------------ | --------------------------------- |
| Stripe (PSP only, no Stripe Tax) | 2.9% + $0.30                   | You handle tax filings            |
| Stripe + Stripe Tax              | + Stripe Tax fees              | Per filing or % depending on plan |
| Stripe MoR (private beta)        | + 3.5% over base               | =~6.4% + $0.30                    |
| Paddle (MoR)                     | 5% + $0.50                     | All-in                            |
| Lemon Squeezy (MoR)              | 5% + $0.50                     | All-in                            |
| Polar (MoR)                      | 4–10% + $0.40–$0.50            | Pricing has shifted               |
| Creem (MoR)                      | low single digits + small base | Newer, verify                     |

Source for fee comparison shape: [SaaS fee calc][saasfeecalc] and
[UserJot transaction-fee piece][userjot]. Vendor docs override.

---

## D. Chat-platform-native rails

This layer is unique to papai's product shape. Each chat platform has its
own rules about money flowing through bots.

### Telegram — Bot Payments API

- Telegram brokers between your bot and an external PSP (Stripe is one
  of several options selectable via BotFather). Telegram does not take a
  commission; the PSP charges its standard fee.
- Native checkout UI inside Telegram (no link-out), good UX for Telegram
  users.
- Subscriptions are not first-class in the Bot Payments API (one-shot
  invoices); recurring requires either renewing-via-message or the
  Telegram Stars / Stars-subscription path for digital goods.
- Telegram Stars is a separate "in-app currency" system with platform
  commission and limited geographic scope; suited only to digital
  in-app goods, not cash subscriptions to a SaaS.
- Reference: [Telegram Bot Payments API][tg-pay].

### Discord — Premium App Subscriptions / SKUs

- **Mandatory if you sell features to Discord users**: Discord's
  monetization policy requires that any paid capability for an app be
  available through Premium Apps at a price no higher than offered
  elsewhere ([discord-policy][d-pol]).
- Premium App SKUs let users subscribe inside Discord; Discord creates an
  Entitlement object the bot can check.
- Discord takes a platform fee (revenue share); rate verify in
  developer console.
- Side effect for papai: if you price externally via Stripe and also sell
  to Discord users, you must list the same price (or higher) on Discord.
  The clean answer is to **pick one** rail per platform, not both.

### Mattermost

- No native payments API. Self-hosted and cloud Mattermost are typically
  enterprise-licensed; per-user-of-bot billing is your problem.
- For Mattermost, pay-via-link (out-of-app Stripe Checkout) is the
  standard pattern.

### General constraint

Apple App Store / Google Play rules do not apply to bot products that
don't ship a mobile binary; but if papai ever ships a companion mobile
app, IAP rules become a major design constraint.

---

## E. Decision matrix sketch

| If you...                                                       | Probably pick                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| ...launch in <30 days, want global by default, no finance team  | Paddle or Polar (MoR)                                        |
| ...have or will have an EU VAT registration and finance support | Stripe + Stripe Tax                                          |
| ...sell mostly through Discord                                  | Discord Premium Apps (forced by policy)                      |
| ...want native Telegram checkout                                | Telegram Bot Payments API + Stripe as PSP                    |
| ...are AI-heavy with variable token cost                        | Stripe Billing meters, or Orb/Metronome layered on top       |
| ...will sell enterprise contracts                               | Stripe direct or Adyen, plus Chargebee for revenue ops later |
| ...need entitlements across many tiers and many features        | Add Stigg on top of any of the above                         |

For papai's hybrid B2C+B2B starting position, the most defensible default
is **Stripe + Stripe Tax** for self-serve web checkout, with **Telegram
Bot Payments API** routing through the same Stripe account for in-Telegram
purchase. Discord support is gated on whether you choose to monetize there
at all (and accept Premium App SKUs as the rail).

This is a default, not a recommendation — final choice depends on the
discovery answers (geography, finance availability, enterprise need).

---

## Sources

- [Stripe Meters API reference][s-meter]
- [Stripe Tax overview][s-tax]
- [Stripe AI billing introduction][s-ai]
- [Stripe vs Paddle vs Lemon Squeezy: SaaS billing for AI products — Athenic][athenic]
- [Polar vs Lemon Squeezy vs Creem — DevToolPicks][devtoolpicks]
- [Choosing the right payment provider for your SaaS — Supastarter][supa]
- [Top Paddle alternatives — Affonso][affonso-pad]
- [Top Lemon Squeezy alternatives — Affonso][affonso-ls]
- [Why Polar is the best way to monetize software — Polar][polar-why]
- [Payment processor fee comparison — UserJot][userjot]
- [SaaS fee calculator][saasfeecalc]
- [Stripe vs Lemon Squeezy — DesignRevision][drev]
- [Telegram Bot Payments API][tg-pay]
- [Telegram Bot Payments for digital goods (Stars)][tg-stars]
- [Discord Premium App subscriptions — Discord docs][d-prem]
- [Discord monetization required support policy][d-pol]
- [Stripe metered billing implementation guide for SaaS — BuildMVPFast][bmf]

[s-meter]: https://docs.stripe.com/api/billing/meter
[s-tax]: https://docs.stripe.com/tax/supported-countries/european-union
[s-ai]: https://www.pymnts.com/news/artificial-intelligence/2026/stripe-introduces-billing-tools-to-meter-and-charge-ai-usage/
[athenic]: https://getathenic.com/blog/stripe-vs-paddle-vs-lemon-squeezy-saas-billing
[devtoolpicks]: https://devtoolpicks.com/blog/polar-vs-lemon-squeezy-vs-creem-2026
[supa]: https://supastarter.dev/blog/saas-payment-providers-stripe-lemonsqueezy-polar-creem-comparison
[affonso-pad]: https://affonso.io/blog/paddle-alternatives-for-saas
[affonso-ls]: https://affonso.io/blog/lemon-squeezy-alternatives-for-saas
[polar-why]: https://polar.sh/resources/why
[userjot]: https://userjot.com/blog/stripe-polar-lemon-squeezy-gumroad-transaction-fees
[saasfeecalc]: https://saasfeecalc.com/
[drev]: https://designrevision.com/blog/stripe-vs-lemonsqueezy
[tg-pay]: https://core.telegram.org/bots/payments
[tg-stars]: https://core.telegram.org/bots/payments-stars
[d-prem]: https://discord.com/developers/docs/monetization/implementing-app-subscriptions
[d-pol]: https://support-dev.discord.com/hc/en-us/articles/23810643331735-Premium-Apps-Required-Support-for-Monetizing-Apps
[bmf]: https://www.buildmvpfast.com/blog/stripe-metered-billing-implementation-guide-saas-2026
[m]: ./04-metering-and-telemetry.md
