<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Compliance, tax, and operations

The compliance footprint of a billing rollout is typically larger than the
engineering footprint. This document enumerates the obligations and the
common ways to discharge them — buy them from a vendor, do them yourself,
or scope them out of the product.

Nothing here is legal advice; treat it as a checklist for a conversation
with an actual tax/legal advisor before launch.

---

## 1. PCI-DSS scope

Primary objective: never touch raw cardholder data, so you stay in
PCI-DSS **SAQ-A** (the lightest self-assessment).

- Use a tokenizing iframe / hosted checkout (Stripe Checkout, Stripe
  Elements, Paddle Checkout, Polar Checkout). Card numbers go from the
  customer's browser directly to the PSP.
- Avoid any flow where your servers POST card data, even briefly.
- Avoid recording call-center calls if you ever take card-over-phone.
- The Telegram Bot Payments API is structured so the card data flows
  Telegram → PSP, never through your bot.

If the bot ever asks the user to "send your card number in chat", that's
catastrophic. Explicitly forbid this in CLAUDE.md / system prompt and
guard against the bot doing it via a tool-input filter.

## 2. Strong Customer Authentication (PSD2 / SCA)

EU regulation requiring two-factor authentication on most card-not-present
transactions for EU-issued cards.

- Stripe, Paddle, Lemon Squeezy, Polar all handle SCA in the checkout
  flow when their hosted UI is used.
- Off-session (renewal) charges use exemptions (low-value, low-risk,
  merchant-initiated transaction). The provider handles the dance; your
  job is to use their off-session charging APIs correctly.
- Failure mode: a renewal triggers SCA, the customer is not online, the
  charge fails. This is normal; dunning recovers it.

## 3. EU VAT / OSS

The single largest tax surface for a digital-services SaaS selling
internationally.

### Current rules (April 2026 baseline)

- B2C sale of digital services to an EU consumer: VAT is owed in the
  consumer's country at that country's rate.
- B2B sale to a VAT-registered EU business: typically zero-rated under
  the reverse-charge mechanism (buyer self-assesses), provided you
  collect and validate the buyer's VIES VAT number.
- The OSS (One Stop Shop) scheme replaced MOSS in July 2021 and lets a
  non-EU business register in a single EU member state and remit VAT for
  all EU-wide B2C sales through that one filing.
- You must collect **two non-contradictory pieces of evidence** of the
  customer's location (e.g., billing-address country + IP-derived country).

### 2026 enforcement tightening

From January 2026, EU tax authorities are systematically cross-matching:

- VAT returns vs PSP transaction data (Stripe, PayPal, etc.)
- Platform / marketplace records
- Bank-account information
- Inter-member-state data sharing

If your filings don't match what the PSPs report, you will hear about it.
Source: [Creem 2026 VAT guide][creem-vat] and [Stripe VAT/OSS guide][s-oss].

### Two paths

**MoR**: vendor handles all of this. Zero filings on your side for
markets the MoR covers.

**PSP + Stripe Tax** (or equivalent): you collect the evidence, Stripe
calculates and reports, you (or your accountant) file. Stripe Tax
provides registration assistance and filing in many jurisdictions.

### papai-relevant evidence collection

The bot has limited natural sources of location evidence: chat-platform
ID is not a country, and there's no IP unless an external checkout
collects it. Practical answer: drive checkout off-platform (web link)
and let the checkout page collect billing address + IP. For Telegram
in-app payment, Telegram surfaces enough metadata to satisfy SCA but
location evidence still typically comes from the card BIN + the
provided billing details.

## 4. US sales tax

- Each US state with economic nexus rules requires registration once
  thresholds are crossed (commonly $100k or 200 transactions per
  state per year).
- SaaS is taxable in some states (NY, WA, TX, MA, etc.) and not in
  others (CA, FL, …). Rules change.
- Stripe Tax automates calculation and filing where supported. MoR
  handles it transparently.
- Sales tax is a per-jurisdiction filing burden; avoid it via MoR if you
  don't have a finance team.

## 5. Other jurisdictions

- **UK VAT** — post-Brexit, separate registration required once
  thresholds are met. Effectively a parallel to EU OSS.
- **Canada GST/HST/QST** — federal + provincial layers.
- **Australia GST** — registration required once AUD 75k threshold met.
- **India GST** — required for any sale to Indian customers; often
  intermediated through a payment partner.
- **Brazil** — complex; usually only viable via an MoR or local entity.
- **Switzerland VAT** — required at CHF 100k.
- Sanctioned countries (US OFAC list, EU sanctions, UK, CA): require
  geo-blocking. PSPs/MoRs typically enforce; verify your provider's
  coverage and add a backstop in the bot if needed.

## 6. GDPR + privacy

papai already stores user data (config, history, memory facts, identity
mappings). Billing adds:

- Customer object in PSP / MoR (email, name, possibly address)
- Invoice line items revealing usage patterns
- Card metadata (last4, brand, expiry) — never the PAN

### Roles

- For billing data, you are typically the **controller**, the PSP/MoR is
  the **processor**.
- Sign a Data Processing Addendum (DPA) with each. Stripe, Paddle, Polar
  publish standard DPAs.

### Data residency

- Stripe stores data in the US by default; EU-only data residency is
  available on enterprise plans.
- For strict EU-data-residency customers, MoRs that operate EU-resident
  infrastructure may be preferable.

### Right to erasure

- A user requesting deletion of their personal data conflicts with
  legal retention obligations on financial records (typically 7-10 years
  in most jurisdictions).
- Standard treatment: anonymize PII while retaining the financial record
  with a synthetic ID. Document this in the privacy policy.
- papai's existing identity mapping (`user_identity_mappings`) and
  `users` table need an erasure procedure that handles cascading
  references; financial records remain.

## 7. Refund and credit policy

Compliance-relevant pieces:

- Stated refund window must comply with EU consumer law (14-day
  cooling-off period for B2C, with carveouts for digital services
  the buyer has consented to start consuming).
- US: no federal refund mandate; honor whatever you publish.
- "All sales final" is allowed on digital goods in many markets but
  reduces conversion and increases chargebacks.

## 8. Disputes and chargebacks

- Industry-standard dispute rate threshold: keep below 0.9% per Visa
  rules; >1% triggers monitoring; ~1.8% triggers card-network programs
  with surcharges.
- MoR typically absorbs most chargeback handling; PSP gives you tools
  to contest.
- Cost per chargeback (whether you win or lose): commonly $15-25 fee
  from PSP plus your time.
- Repeat offenders: maintain a denylist (chat-platform user ID hash,
  email hash, card fingerprint from PSP).

## 9. Fraud

Self-serve, low-ticket SaaS sees little card fraud but plenty of:

- Trial abuse via duplicate accounts
- Token-cost abuse (prompt-stuffing, infinite-loop generators)
- Group bombing (adding the bot to many groups to inflate quotas)

Mitigations span product (caps, rate limits, group authorization, see
`authorized_groups`), provider (Stripe Radar, Paddle's risk engine), and
in-bot heuristics. The bot already has `src/web/rate-limit.ts` patterns
that can extend to general per-subject rate limits.

## 10. Accounting and revenue recognition

- **Cash-basis**: revenue recognized when collected. Simple.
- **Accrual / ASC 606**: revenue recognized as the service is delivered.
  An annual prepay is recognized 1/12 each month; the rest sits as
  deferred revenue on the balance sheet.
- For a small operation, cash-basis through your PSP's reports is
  sufficient. Investors / due diligence eventually require accrual.
- Subscription engines (Chargebee, Maxio) handle ASC 606 natively;
  Stripe Billing supports basic deferral via Stripe Revenue Recognition.

Bookkeeping integration: most providers export to QuickBooks, Xero,
NetSuite. Pick the integration that matches your accountant.

## 11. Operational policies to write before launch

A short list of policy documents that must exist on the marketing site
or T&Cs before you take real money:

- Terms of Service (with arbitration / jurisdiction clauses)
- Privacy policy (GDPR-aligned, cookie banner if you have cookies)
- Refund policy (windows, carveouts, process)
- Acceptable Use policy (especially relevant for an LLM bot — prompt
  injection, illegal content, abuse)
- Subprocessor list (PSP, model vendor, hosting, embedding provider,
  metering vendor — needed for B2B due diligence)
- DPA template (for B2B customers who require one)
- Service Level (if you make uptime claims)

## 12. Abuse on the free tier — operational specifics

The single most common operational pain point with freemium AI products.

| Vector                            | Mitigation                                                                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| One human, many free accounts     | Phone-number verification (Telegram already provides this implicitly), email verification on web checkout, soft device fingerprinting at signup |
| Token-stuffing prompts            | Per-message + daily token cap; truncate context aggressively on free                                                                            |
| Embedding-spam (memo bulk-import) | Cap memo creates per day; rate-limit embedding calls                                                                                            |
| Group bombing                     | `authorized_groups` already exists — extend to require explicit allowlist for free, paid tier removes the cap                                   |
| Expensive-model abuse             | Free locked to small/cheap models; `main_model` config validates against tier                                                                   |
| Recurring-task bomb               | Cap number of `recurring_tasks` per free user                                                                                                   |
| Deferred-prompt bomb              | Cap concurrent `scheduled_prompts` per free user                                                                                                |
| Web-fetch as a proxy              | `src/web/rate-limit.ts` already handles this; ensure free tier inherits                                                                         |

---

## Sources

- [Stripe VAT and OSS introduction][s-oss]
- [Stripe Tax — EU support][s-tax-eu]
- [Stripe marketplace tax obligations EU][s-mkt]
- [OSS scheme for Dutch companies — Stripe][s-nl-oss]
- [EU VAT 2026 enforcement guide — Creem][creem-vat]
- [SaaS sales tax 2026 — Paddle][paddle-tax]
- [Digital product tax compliance by country — Fungies][fungies]
- [EU digital services tax for SaaS founders — Dodo Payments][dodo]
- [EU VAT guidelines for digital content creators — Commenda][commenda]
- [UK VAT MOSS update 2026 — Outbooks][outbooks]

[s-oss]: https://stripe.com/guides/introduction-to-eu-vat-and-european-vat-oss
[s-tax-eu]: https://docs.stripe.com/tax/supported-countries/european-union
[s-mkt]: https://stripe.com/guides/understanding-the-tax-obligations-of-marketplaces-in-the-eu
[s-nl-oss]: https://stripe.com/resources/more/one-stop-shop-oss-vat-scheme
[creem-vat]: https://www.creem.io/blog/eu-vat-vida-2026-saas-compliance-guide
[paddle-tax]: https://www.paddle.com/blog/saas-sales-tax-state-wide-and-international
[fungies]: https://fungies.io/digital-product-tax-compliance-by-country/
[dodo]: https://dodopayments.com/blogs/eu-digital-services-tax
[commenda]: https://www.commenda.io/blog/europe-vat-guide-for-digital-content-creators
[outbooks]: https://outbooks.co.uk/vat-digital-services-uk-moss-update/
