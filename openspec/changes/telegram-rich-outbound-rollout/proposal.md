## Why

The Telegram adapter is papai's most aggressive LLM-markdown degrader: tables are
flattened to `a | b` rows, headings/footnotes/math are dropped, a whitelist entity
switch reshapes everything else (src/chat/telegram/format.ts), and the 4096-char cap
has no chunker — long replies simply fail. Bot API 10.3 `sendRichMessage` renders a
GFM superset natively (tables, headings, task lists, footnotes, 32K limit); grammy
1.45.1 already ships the typed surface; old-client rendering is a declared non-issue
(product call). What remains is shipping it observably — a flagged rollout with a
first-class fallback, in the repo's ratchet style.

## What Changes

- **Phase 1 (opt-in)**: new per-platform-instance `richRendering` flag (default
  OFF, stored like `openDmAccess` on `platform_instances`, surfaced in the settings
  admin panel). When ON, the three markdown-bearing send surfaces go rich-first:
  `reply.formatted`, deferred `sendMessage`, and `editReply` — via
  `sendRichMessage({ rich_message: { markdown } })`.
- **Fallback with error taxonomy**: only content-rejection (4xx parse errors about
  the rich payload) falls back to the existing entity path; rate-limit and
  transport/auth errors take their existing paths (no masking). Every fallback emits
  a structured warn and is visible in a new debug-server snapshot.
- **Control surfaces unchanged**: permission-prompt buttons and replacement replies
  (i18n templates, not LLM markdown) stay on the entity/plain path; the dashboard's
  `disableLinkPreview` send stays entity-path (`sendRichMessage` lacks
  `link_preview_options`).
- **Phase 2 (default flip)**: after sustained opt-in traffic with fallback rate
  below threshold, flip the default ON, announced via `versionAnnouncements`;
  per-instance opt-out remains. **Phase 3**: entity path demoted to error-only
  fallback; `telegramTraits.maxMessageLength` reflects the rich 32K reality.

## Capabilities

### New Capabilities

- `telegram-rich-outbound`: LLM markdown on Telegram renders with native fidelity
  when the instance flag is on, with a measured, non-masking fallback to the entity
  path on rich-parse rejection. Without it, tables/headings stay degraded and long
  replies keep failing — and any unflagged switch would be unobservable, which is
  why the capability includes the fallback contract and its observability, not just
  the send path.

### Modified Capabilities

(none — no existing spec covers adapter output rendering.)

## Impact

- **Code**: `src/chat/telegram/{reply-helpers,index,reply-fn-builder,format,metadata}.ts`;
  `src/db/instance-schema.ts` + migration; settings UI admin instance panel
  (`client/settings`, `client/settings/fetcher-schemas-admin.ts`);
  `src/debug/state-collector.ts` (rich-rendering snapshot);
  `tests/platform/harness/fake-telegram-bot.ts`.
- **Platform instances**: Telegram only. **Scope impact**: instance-scoped operator
  config; applies uniformly across per-user/group-shared/thread-isolated contexts;
  no storage-context or config-context state added.
- **Dependencies**: none new — grammy 1.45.1 types suffice; `@gramio/format` builders
  are not needed (markdown mode).
- **Docs**: `docs/architecture/behaviors.md` (rendering + fallback behavior),
  `src/chat/CLAUDE.md` (adapter convention).

## Non-goals

- `sendRichMessageDraft` streaming — DM-only, 30s window; declined (parked).
- Thinking-block live-status (`InputRichBlockThinking`, blocks mode) — declined;
  revisit with fallback telemetry in hand.
- Rich `/context` rendering (`table compact` grid) — declined; separate garnish.
- `<tg-button>` in-content buttons and rich-media embedding — declined.
- Inbound rich intake — change `telegram-rich-inbound`.
- Discord table flattening / other adapters' dialect layers — declined here.
