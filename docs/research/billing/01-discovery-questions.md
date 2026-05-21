<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Discovery questions

Structured intake to run before any pricing, provider, or architecture decision.
Treat this as a checklist; every section that returns "we don't know" is a risk
that propagates downstream into pricing, COGS, contract terms, or refund policy.

A useful pattern: answer each question with one of `decided`, `assumption`,
`unknown`, or `not applicable`. The volume of `assumption` and `unknown` answers
is the size of the discovery debt.

---

## 1. Strategic intent

1. Why are we billing? (revenue, COGS recovery, signaling commitment, abuse
   throttling, compliance with provider monetization policy)
2. Is billing the primary business model, an experiment, or a fence?
3. What is the success metric for the billing rollout in the first 90 days?
   (paid conversions, MRR, % of LLM COGS recovered, churn under N%, NPS hold)
4. What would cause us to roll billing back?
5. Who owns the billing P&L day-to-day? (engineering, founder, finance person,
   nobody yet)

## 2. Customer and segment definition

1. Who is the paying entity in B2C: the chat user themselves? Are minors a real
   risk for any platform we run on?
2. Who is the paying entity in B2B: group owner, an org admin who never logs
   into the bot, or a procurement contact via invoice?
3. How does a B2B buyer authenticate against the bot at all? (papai today
   identifies users by `platform_user_id`, no email, no password)
4. Are there segments we explicitly will not sell to (sanctioned countries,
   minors, regulated industries, government, EU public sector)?
5. Is there a free tier, and if so what is its purpose: acquisition, abuse
   tolerance for hobbyists, charitable use, internal testing?

## 3. What are we selling

1. Is the unit of value an outcome (task created), an action (LLM call), an
   amount (tokens, files), a presence (seat in a group), or access (a feature
   unlock)?
2. Which features must be gated on plan? Candidates from current papai:
   recurring tasks, deferred prompts, web fetch, file relay, memo embeddings,
   group history lookup, identity mapping, debug dashboard, multi-provider
   tools, large context windows.
3. Which provider tools (Kaneo, YouTrack) are paid externally vs included?
4. Are BYO LLM keys allowed on free, on paid, on enterprise? If users supply
   their own LLM key, what are we still charging for? (orchestration, tools,
   storage, multi-platform reach, support, uptime)
5. Are there premium models (large context, frontier reasoning) that only paid
   users can select, or only paid users can use beyond a quota?

## 4. Pricing-model intent

1. Subscription, usage, credits, hybrid, freemium-with-caps, or outcome-based?
   See [`02-pricing-models.md`](./02-pricing-models.md) for the full menu.
2. If usage-based, what is the natural unit the customer can predict and
   reason about? (raw tokens almost never qualify; messages, "agent runs", or
   credits usually do)
3. Are we comfortable with bills that vary 5x month over month, or do we need
   commitments / soft caps / credit packs to stabilize revenue?
4. Will we publish prices, or are they enterprise-only / quote-driven for B2B?
5. Annual discount? Multi-year? Non-profit / academic? Founders / early-bird?
6. Currency strategy: USD only, USD + EUR, local currency per market?

## 5. Free tier and abuse

1. What is the free tier intended to permit, and what should it explicitly
   prevent? (e.g., "free can use the bot for personal task tracking but cannot
   add it to groups")
2. What happens when a free user hits a cap mid-conversation? (hard stop with
   upsell, soft degrade to a smaller model, queue and retry next day, silent
   throttle)
3. What is the cost ceiling per free user per month before we cut them off?
4. How do we detect and stop abuse: same Telegram user across many accounts,
   automated accounts, prompt-stuffing for token cost, group bombing?
5. Do free users get any data retention guarantees?

## 6. Geography, currency, language

1. Initial launch markets? Future markets within 12 months?
2. EU customers from day one? (forces VAT/OSS handling immediately)
3. Are we comfortable with USD-only invoicing, or do we need local currencies?
4. Do we need translated checkout, invoices, dunning emails?
5. Sanctioned-country handling: rely on PSP/MoR enforcement, or add our own
   geo-blocking?

## 7. Tax, legal, compliance

1. Where are we legally established and where do we have nexus?
2. Are we registered for VAT in any EU member state, or via OSS?
3. Are we registered for sales tax in any US state? Do we want to outsource
   that decision to Stripe Tax or to an MoR?
4. Will we be the merchant of record (faster, more control, more burden) or
   delegate to an MoR (simpler, higher fee, less branding control)?
5. Do we need to support tax-exempt buyers (educational, government, certain
   non-profits)?
6. Are invoices required by law in any market we sell into? (yes for many EU
   B2B, some LATAM)
7. What are our PCI-DSS expectations? (the goal should be SAQ-A scope by
   never touching card data; verify the chosen provider supports that)
8. GDPR: who is the controller, who is the processor for billing data?
   Where does billing data live? Can we honor deletion without losing legal
   tax records?

## 8. Refunds, disputes, and credits

1. Stated refund policy in days?
2. Pro-rated refunds on cancellation, or end-of-cycle access only?
3. What's the policy for unused credits at cancellation?
4. Who has authority to issue refunds and goodwill credits, and where?
5. Chargeback strategy: contest, accept, ban repeat offenders?
6. SLA / service credits if applicable?

## 9. Lifecycle and dunning

1. Trial: card-up-front, card-after, free with limits-only, no trial?
2. Renewal cadence: monthly only, annual, both?
3. Renewal reminder emails? In-chat reminders? (papai uniquely can DM users)
4. Dunning sequence on failed payment: how many retries, over what window,
   what does the bot tell the user during the grace period?
5. What happens at the end of grace? (downgrade to free, hard suspend,
   anonymize history)
6. Reactivation: do we restore prior history if the user pays after suspension?

## 10. Support and operations

1. Who handles billing support tickets in the first 90 days?
2. Target first-response time on billing issues?
3. Support channels: in-bot (papai can reply directly), email, web form?
4. Self-serve portal expectations: see invoices, change plan, change card,
   download VAT receipt? (Stripe Customer Portal solves most of this; the
   chat-only nature of papai may require deeplinks)
5. Internal tooling: who can issue refunds, change plans, look up a customer,
   without giving everyone PII access?

## 11. Reporting and finance

1. What metrics does the founder want on a weekly/monthly basis?
   (See [`04-metering-and-telemetry.md`](./04-metering-and-telemetry.md) for
   the standard list.)
2. Accounting integration: are we feeding QuickBooks, Xero, NetSuite, or just
   exporting CSV?
3. Revenue recognition: cash basis or accrual? Annual deals require deferred
   revenue accounting.
4. Investor or board reporting requirements?

## 12. Failure modes we accept upfront

1. What is the acceptable rate of "bot says you're paid but Stripe says you
   aren't" inconsistency? (the answer should be "zero, with reconciliation")
2. What is the acceptable downtime of the billing system before we degrade
   the bot? (e.g., does the bot keep working if Stripe is down for 1h?)
3. Can a delayed metering event cause an invoice to be wrong by more than X%?
4. What if our LLM provider raises prices 30%? Do we re-price, eat margin,
   or pass through with notice?

## 13. Roadmap inputs

1. Is multi-provider task tracking (Kaneo + YouTrack today; Linear/Jira/etc
   tomorrow) part of paid packaging?
2. Do we anticipate offering an API or webhook for power users?
3. White-label / reseller story?
4. Marketplace billing (3rd party plugins) on the horizon?

---

## Output of discovery

After the questions above are answered, produce:

- A one-page **packaging brief** (segments, plans, prices, included quotas).
- A short **launch checklist** (legal, tax, support, refund policy, dunning,
  monitoring, reconciliation).
- A list of **explicit non-goals** for v1 (so the implementation stays small).

Only then should architecture or schema work begin.
