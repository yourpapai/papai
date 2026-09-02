# Design — telegram-rich-outbound-rollout

## Context

See `proposal.md — Why`. Three markdown-bearing call sites exist
(`sendFormattedReply` reply-helpers.ts:217, deferred `sendMessage` index.ts:140,
`buildTelegramEditReply` reply-fn-builder.ts:40); two control-surface call sites
(`sendButtonReply`, replacement replies) and the dashboard's single
`disableLinkPreview` send stay untouched. `formatLlmOutput` remains the fallback.

## Goals / Non-Goals

- Goals: rich-first on the three surfaces behind an instance flag; a non-masking,
  observable fallback; deploy-free rollback; phase-2 flip driven by measured
  fallback rate.
- Non-Goals (design-level): no new telemetry pipeline; no mode-memory per reply
  target; no changes to entity-path internals beyond being called as fallback.

## Decisions

### D1 — Flag storage: boolean column on `platform_instances`

`richRendering` joins `openDmAccess` (src/db/instance-schema.ts:14) as a sibling
column — queryable, default-false, drizzle migration `NOT NULL DEFAULT 0`, no
backfill. Alternative rejected: inside the encrypted `config` blob — that is for
secrets (tokens) and would make the flag unreadable for routing decisions without
decryption on every send. Scope model: instance-scoped operator config; uniform
across user/group/thread scopes; no storage-context or config-context state.

### D2 — Surface split by content kind

Rich applies only where LLM markdown flows (the three call sites). Control surfaces
are i18n templates (permission prompts, confirmations) — rich adds nothing, and
`sendRichMessage` lacks `link_preview_options`, which pins the dashboard send to the
entity path. Phase-1 diff boundary is exactly three functions.

### D3 — Fallback predicate: conservative content-rejection classification

A pure classifier maps an API error to `fallback` / `propagate`: rate-limit and
authorization/transport classes propagate (an entity retry would fail identically —
falling back there would mask real failures and double API load); known
rich-parse-400 classes fall back; **unknown 400s fall back and log loudly** —
fail-safe in the safe direction (one extra entity send, never a lost reply) and the
logs teach the real rejection taxonomy during phase 1. Exact Telegram 400 wording is
unverifiable from the dev sandbox; the pre-implementation probe (tasks 1.1–1.2) pins
it before the classifier constants are written, phase-1 logs refine it further
(task 6.2), and misclassification fails safe per above.

### D4 — New module `src/chat/telegram/rich-send.ts`

No existing module covers rich sending (`format.ts` is the entity path;
`reply-helpers.ts` holds per-surface senders). The module owns: the flag-aware send
orchestration (try-rich → classify → fallback), the classifier (D3), the in-memory
counters, and mention-prefix handling — in markdown mode the audience prefix is
plain prepended text, replacing the entity-shift arithmetic
(`shiftTelegramEntity`). Surfaces call it with their existing context params.

### D5 — Edit symmetry without mode memory

`editMessageText` accepts `text` or `rich_message` and converts between them, so
`editReply` independently tries rich then entity; no per-target mode tracking. A
regeneration may legally upgrade an entity message to rich rendering.

### D6 — Observability: structured warns + state-collector snapshot

Durable evidence: one `log.warn({ scope, instanceId, surface, reason },
'rich send fell back')` per fallback — survives restarts, greppable from reports —
this is the phase-gate data source. Live ops: in-memory counters
(`{attempts, fallbacks, lastReason}` + recent-fallbacks list mirroring
`recentToolFailures`) exposed via `src/debug/state-collector.ts`. No DB counter, no
analytics pipeline — smallest thing answering both consumers. Counters carry no user
identifiers.

### D7 — Phase mechanics

Phase 2 = migration flipping the column default + settings copy update +
`versionAnnouncements` broadcast; rollback at every stage is the flag (data, not
code). Phase 3 removes the flag-off fast path only after sustained phase-2
evidence; `telegramTraits.maxMessageLength` is updated for truthfulness (nothing
reads it today — informational).

### D8 — Test seams: extend, don't add

`TelegramBotLike` gains `sendRichMessage` (type-only). `fake-telegram-bot.ts` gains
a stub with injectable rejection behavior and a recorded-calls accessor (the
`membershipCalls` pattern). The classifier gets table-driven grouped-assertion
tests; routing tests use the existing `botFactory` seam. No production DI changes.

## Risks / Trade-offs

- [Fallback pays one rejected API call (~100–300 ms) before the entity send] →
  accepted for rare fallbacks; the counter makes "rare" a measured claim.
- [Unknown 400 wording misroutes a non-parse error to fallback] → extra entity send
  still delivers the reply; loud log surfaces the wording for classifier correction.
- [Entity message later edited rich] → legal per API (D5); visual mode switch on
  regeneration is acceptable.
- [Flag flip mid-conversation] → per-send decision; an in-flight turn may mix modes
  across its replies. Accepted; no user-visible contract broken.

## Migration Plan

Phase 1 ships flag-default-off: zero behavior change on deploy; operators opt in
per instance. Phase 2 and 3 are separate config/migration steps gated on D6
evidence. Rollback: set flag false (or restore default) — no deploy.

## Open Questions

- Phase-2 flip threshold (days × sends × fallback-rate ceiling) — numbers tunable
  from phase-1 telemetry without changing this design.
- Real Telegram 400 wording for rich-parse rejections — resolved by the
  pre-implementation probe (tasks 1.1–1.2, findings in `probe-findings.md`);
  the classifier's unknown-400 default makes the answer non-blocking.
