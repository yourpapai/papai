## Why

Bot API 10.3 clients can send, forward, and edit rich messages — structured documents
that arrive as `RichMessageMessage` **without a `text` field**. The Telegram adapter
listens only on `message:text` (src/chat/telegram/index.ts:98) and reads only
`ctx.editedMessage?.text` (:131), so such updates are silently dropped: no log, no
reply, no trace. To the user the bot looks broken. This is a correctness gap that
exists today and widens as rich-capable clients spread — independent of whether papai
ever *sends* rich messages, and a prerequisite for dogfooding the outbound rollout
(change `telegram-rich-outbound-rollout`).

## What Changes

- Add a message catch-all in the Telegram adapter that recognizes updates carrying
  `rich_message` and routes them through the existing `IncomingMessage` pipeline
  instead of dropping them.
- Add a recursive `RichText`/`RichBlock` → plain-text extractor (every styled node
  carries `text: RichText`; paragraph, heading, preformatted, list-item, and quotation
  blocks cover LLM-consumable content) so the LLM receives the message as text.
- Apply the same handling to `edited_message` updates with `rich_message`, so rich
  edits are not dropped either.
- Extraction is plain text only: inbound formatting is intentionally not preserved
  into the conversation context.

## Capabilities

### New Capabilities

- `telegram-rich-inbound`: the Telegram adapter accepts every message format a
  current client can deliver (text, media, rich) and never silently ignores a user
  message. Without it, any user on a rich-capable client who pastes or forwards a
  formatted document gets no response and no diagnostic — the bot appears broken,
  and there is no signal in logs or `/stats` to even detect it.

### Modified Capabilities

(none — no existing spec covers chat adapter intake; adapter behavior is documented
only as conventions in `src/chat/CLAUDE.md`, which this change follows, not amends.)

## Impact

- **Code**: `src/chat/telegram/index.ts` (`onMessage`, `onMessageEdit`), new
  extraction module under `src/chat/telegram/` (e.g. `rich-inbound.ts`),
  `src/chat/telegram/message-extraction.ts` (shared context extraction).
- **Platform instances affected**: Telegram only; no config change; no task
  instances involved.
- **Scope impact**: none — no new config-context state; behavior is identical across
  per-user, group-shared, and thread-isolated scopes.
- **Dependencies**: none — `@grammyjs/types` (via grammy 1.45.1) already ships the
  `RichMessage`/`RichText`/`RichBlock` types this change reads.
- **Docs**: `src/chat/CLAUDE.md` (adapter conventions gain the rich-intake rule);
  `docs/architecture/behaviors.md` (message-intake behavior note).
- **Tests**: unit tests for the extractor; adapter tests via the existing
  `botFactory` seam and `tests/platform/harness/fake-telegram-bot.ts` (extend the
  fake to emit rich updates).

## Non-goals

- Outbound rich-message sending — change `telegram-rich-outbound-rollout`.
- Preserving inbound rich *formatting* into context (only plain text reaches the
  LLM; formatting fidelity inbound is declined as unnecessary for task management).
- Handling rich messages on Mattermost/Discord/Kontur Talk (none of these platforms
  deliver rich Telegram messages).
- Rich *attachments* inside inbound rich messages (photos embedded in blocks) —
  out of scope until live traffic shows a need; recorded as declined.
