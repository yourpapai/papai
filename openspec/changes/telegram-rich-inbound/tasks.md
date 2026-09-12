# Tasks — telegram-rich-inbound

## 1. Live payload probe (dogfood, before extractor constants)

- [ ] 1.1 Throwaway log-dump spike on a dev instance (scratch script, networked machine — the dev sandbox blackholes `api.telegram.org`): from a real client, send / paste / forward a rich message to the bot and edit one; record the raw `rich_message` update JSON. Verify: findings captured in `openspec/changes/telegram-rich-inbound/probe-findings.md`
- [ ] 1.2 From findings: confirm the no-`text` assumption and the D1 text-wins rule (does `text` ever co-populate?), and record the observed block-type inventory; confirm/extend the extractor's text-bearing block whitelist. Verify: `probe-findings.md` block inventory section complete

## 2. Extractor (pure function, test-first)

- [ ] 2.1 Write grouped-assertion unit tests for `richTextToPlain`: string node, styled-node recursion (Bold/Italic/Url/…), text-bearing blocks (paragraph, section heading, preformatted, list item, quotation — plus any block types from task 1.2) in document order, unknown block/node skipped, media-only → `null`. Verify: `bun test tests/chat/telegram/rich-inbound.test.ts` (red)
- [ ] 2.2 Implement `src/chat/telegram/rich-inbound.ts` exporting the extractor per design D2. Verify: `bun test tests/chat/telegram/rich-inbound.test.ts` (green)

## 3. Adapter intake

- [ ] 3.1 Extend `tests/platform/harness/fake-telegram-bot.ts` with a rich-message emit (test-first: extend `fake-telegram-bot.test.ts`). Verify: `bun test tests/platform/harness/fake-telegram-bot.test.ts`
- [ ] 3.2 Write adapter routing tests (rich DM delivered, group mention routing on extracted text, forum thread scoping, both-text-and-rich → text wins, media-only not delivered) using the `botFactory` seam. Verify: `bun test tests/chat/telegram/index.test.ts` (red)
- [ ] 3.3 Register the bare-`message` catch-all in `src/chat/telegram/index.ts` per design D1 (no-op without `rich_message`; `text` wins on both). Verify: `bun test tests/chat/telegram/index.test.ts` (green)

## 4. Edits

- [ ] 4.1 Write failing test: `edited_message` with `rich_message` delivers with `editedAt` and re-extracted text. Verify: `bun test tests/chat/telegram/index.test.ts` (red)
- [ ] 4.2 Widen `onMessageEdit` guard per design D3. Verify: `bun test tests/chat/telegram/index.test.ts` (green)

## 5. Platform lane + docs

- [ ] 5.1 Add a Tier 3 platform scenario (rich intake in a group) with a catalog record per `tests/stories/catalog/` conventions. Verify: `bun run test:platform`
- [ ] 5.2 Update `src/chat/CLAUDE.md` (intake rule) and `docs/architecture/behaviors.md` (rich intake note). Verify: manual review of rendered diffs
- [ ] 5.3 Full gates: `bun test`, `bun run typecheck`, `bun run lint`
- [ ] 5.4 Post-landing follow-up: inspect debug log buffer for real-world rich payloads against `probe-findings.md`; widen whitelist only with a failing test first
