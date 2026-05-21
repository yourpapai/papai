<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# papai-specific integration notes

This is research, not architecture. The goal is to flag the parts of the
papai codebase that any future billing work will have to confront, so the
discovery and packaging discussions can be grounded in what actually
exists today.

Cross-reference module list with `CLAUDE.md` "Main Modules" section.

---

## 1. Identity model — the awkward parts

### `users` table is keyed by `platform_user_id`

`src/db/schema.ts:4` defines `users.platformUserId` as the primary key.
`platform_user_id` is whatever string the active chat adapter sees:

- Telegram: numeric stringified ID
- Mattermost: platform user ID string (not display name)
- Discord: snowflake string

Implications for billing:

- A "billable subject" in Stripe / Paddle is normally an email address.
  papai has no email by default. Every paid customer must be invited to
  associate an email at the moment of first checkout.
- The `platform_user_id` namespace is **per platform**. The same human
  using the bot from Telegram and Discord has two distinct users today.
  Either you accept "two billing accounts per cross-platform user" or
  you build a cross-platform identity merge first. Discovery question:
  is cross-platform identity in scope for v1?
- The Stripe `Customer` object's `metadata` should carry the
  `platform_user_id` and provider name to make webhook routing
  deterministic.

### Group identity

`authorized_groups` (migration 024) and `group_members` (migration 008)
already exist. Authorization is allowlist-based. A "billable group" in
B2B mode is distinct from a billable user — both pay separately, both
exist independently, neither is a strict child of the other.

### Identity mappings

`user_identity_mappings` already maps a chat-context user to a provider
(Kaneo/YouTrack) user. This is a useful model to extend for billing
mappings (chat user ↔ Stripe customer, group ↔ Stripe customer).

---

## 2. BYO LLM keys reshape the unit economics

`llm_apikey` and `llm_baseurl` are per-user config keys
(`commands/setup.ts`, `commands/config.ts`). A user with their own LLM
key directly pays the model vendor for tokens; papai's COGS for that
user is essentially zero on the model axis.

This forces a packaging fork:

- **Managed-LLM users** — papai pays for tokens, must charge enough to
  cover them with margin. Token-shaped pricing is justified.
- **BYO-LLM users** — papai charges for everything except the tokens:
  orchestration, multi-platform reach, tool ecosystem, storage,
  recurring/deferred infrastructure, identity mapping, support.

Two practical packaging options:

1. Two SKUs (managed Pro vs BYO Pro at a lower price).
2. One SKU with a credits add-on; BYO users buy the SKU and skip credits.

Either way, the system must know whether a billable subject has set
their own `llm_apikey` and treat metering accordingly.

---

## 3. Cost-amplifier surfaces

Several existing capabilities can multiply per-message LLM cost without
a corresponding multiplication of user-visible work. Each one is a place
to apply caps, real-time gating, or per-tier limits.

| Module                                        | Cost amplifier                         | Notes                                                     |
| --------------------------------------------- | -------------------------------------- | --------------------------------------------------------- |
| `src/llm-orchestrator.ts`                     | Multi-step agent loops                 | `stepCountIs` already configurable; tier-bound            |
| `src/tools/*`                                 | Tool calls within a single step        | Capability-gated already; add cost gating per tier        |
| `src/recurring/*`                             | Cron-triggered task occurrences        | Cap recurring tasks per tier                              |
| `src/scheduler.ts` / `scheduledPrompts`       | Deferred prompts firing later          | Cap concurrent / per-day fires                            |
| `src/memory.ts` (`memos.embedding`)           | Embedding calls on each save           | Already has size limits; add per-day cap on free          |
| `src/web/fetch-extract.ts`                    | Outbound fetches; content distillation | Rate-limited; tier the rate limit                         |
| `src/file-relay.ts`                           | Incoming file processing               | Cap file size + per-day count per tier                    |
| `src/conversation.ts` (`runTrimInBackground`) | Summarization passes                   | Free tier: trim more aggressively; smaller context window |

Suggested principle: every quota-bearing decision in the bot reads from
**one** entitlements service with the subject (user or group) as the key.
Don't sprinkle tier checks across modules.

---

## 4. Where to hook metering today

`src/llm-orchestrator-events.ts` already emits `llm:end` with
`tokenUsage: { inputTokens, outputTokens }`. The natural insertion
points for a future billing pipeline are:

- After `emit('llm:end', ...)` — write a billing event to a local outbox
  table inside the same SQLite transaction that persisted the assistant
  turn, then a worker drains the outbox to the billing system.
- Tool-call accounting: `handleToolCallFinish` (referenced in
  `src/llm-orchestrator-support.ts`) is the equivalent surface for
  tool-call metering.
- Recurring / scheduler firings: each occurrence is a discrete billable
  event distinct from the user-initiated turns it generated.

Minimal new schema (sketch only):

- `billing_subjects` — the set of billable accounts (user or group),
  with chat platform, platform id, optional Stripe customer id, plan id,
  current period balance fields.
- `billing_events_outbox` — append-only event log with idempotency key,
  forwarded flag, retry counters.
- `billing_quota_state` — current quota or credit balance per subject;
  read on every cost-amplifying call.

These are sketches, not designs. Real schema work happens after
packaging is decided.

---

## 5. DM-driven config flow already exists

`/setup` and `/config` are DM-driven and can target either personal or
group settings (per `CLAUDE.md` and the `group-settings/` modules). This
is the right shape for billing flows too:

- Subscription change initiated in DM, even if the bot is acting in a
  group, because billing is sensitive.
- Group billing managed by group admin (already discoverable via
  `group_admin_observations`) but only when interacting in DM.
- Wizard pattern in `src/commands/setup.ts` is a viable template for
  a "billing setup" wizard: pick plan → confirm email → open hosted
  checkout link → wait for webhook → confirm in DM.

## 6. Chat-platform constraints

Per [`03-payment-providers.md`][03]:

- **Telegram**: in-bot checkout via Bot Payments API + Stripe possible;
  subscriptions need wrapping (one-shot invoice + renewal logic).
- **Discord**: Premium App SKUs are _required_ if you sell features for
  Discord users. This may dictate a separate billing rail and a separate
  packaging story for Discord.
- **Mattermost**: out-of-band (web link) checkout is the only option.

This means a single global "Pro plan" likely cannot have one global price
across all three platforms — Discord's policy forces the in-platform
price to be no higher than off-platform. Easiest defensible policy:
**identical headline price everywhere**, even if the rails differ.

## 7. Demo mode

`DEMO_MODE` exists (referenced in `CLAUDE.md` env vars and
`src/auth.ts`). This is exactly the affordance you want for a
"sales demo" tier: provisioned account with synthetic data, no payment
required, sandboxed COGS. Plan to extend it (or build a parallel "sales
account" mode) rather than overload billing logic.

## 8. Debug server / debug dashboard

The optional debug server (`DEBUG_SERVER`, `client/debug/`) already
visualizes LLM events. A billing dashboard for an internal operator is
a natural extension — same telemetry stream, different aggregations
(MRR, NRR, COGS-per-user, top spenders). For external customer-facing
billing UI, prefer the PSP's hosted Customer Portal (Stripe) or MoR
portal rather than building it ourselves.

## 9. Test surface

Billing logic is unforgiving when wrong. Specific shapes the test stack
will need to support:

- Webhook fixtures (signed) for each PSP event the bot reacts to.
- Time-travel for renewal cycles, dunning, prorations.
- Idempotency tests: same event arriving twice must produce one effect.
- E2E in `tests/e2e/` with a Stripe-mocked API server (Stripe ships
  `stripe-mock`) — slot in next to the existing Docker-Kaneo harness.
- Mutation tests (Stryker is already in the repo) are particularly
  valuable on rating logic where a sign error can cost real money.

## 10. Logging caveats

Per the project's logging rules: **never log API keys, card data, full
PSP customer objects, or invoice line items containing personally-
identifying line text**. Treat billing fields as sensitive by default;
log Stripe customer ids and amounts but not emails or names. Add a
billing-aware redaction pass to the pino bindings.

---

## Open questions specific to papai

These belong in the discovery doc but are listed here because they
emerged from reading the code, not from a generic billing-discovery
template:

1. Cross-platform identity merge — in scope for v1 of billing?
2. BYO-LLM-key as a discount, a separate SKU, or invisible to pricing?
3. Group billing — does the group admin pay, the group creator pay, or
   any allowlisted user pay? Who can change the group's plan?
4. Authorization model around `authorized_groups` + paid: does paying
   auto-allowlist the payer's groups, or is allowlist still admin-only?
5. Existing `kaneoWorkspaceId` per user — does the workspace get
   archived / deleted on cancel-and-grace-expire? Data retention and
   external-side-effects of cancellation need explicit thinking.
6. Recurring / deferred prompts after cancellation — fire silently, fire
   once with a "your plan ended" message, or pause-and-keep?
7. Demo mode — should it morph into a free tier, or stay an internal-only
   sales tool?

---

## Reading sequence for whoever picks this up

1. Discovery doc (`01-discovery-questions.md`) → choose your answers.
2. Pricing doc (`02-pricing-models.md`) → pick a model.
3. Provider doc (`03-payment-providers.md`) → pick a stack.
4. Metering doc (`04-metering-and-telemetry.md`) → decide outbox-first
   or vendor-first.
5. Compliance doc (`05-compliance-and-tax.md`) → assemble the policy
   docs and tax registrations.
6. This doc → wire integration points to the chosen stack.

Only then start a separate `docs/superpowers/specs/...-billing-design.md`
spec following the project's normal spec-then-plan-then-implement flow.

[03]: ./03-payment-providers.md
