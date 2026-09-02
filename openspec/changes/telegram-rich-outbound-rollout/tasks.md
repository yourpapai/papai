# Tasks — telegram-rich-outbound-rollout

## 1. Live rejection-wording probe (before classifier constants)

- [ ] 1.1 Throwaway probe script (scratch, networked machine + test-bot token — the dev sandbox blackholes `api.telegram.org`): `sendRichMessage` happy-path smoke (document with table, headings, task list, footnote) plus malformed variants (21-column table, 17-deep nesting, >32K text, bad link URL, unclosed inline tag, >500 blocks); record exact error `description` strings and success shapes. Verify: findings captured in `openspec/changes/telegram-rich-outbound-rollout/probe-findings.md`
- [ ] 1.2 Fold observed rejection strings into the classifier test matrix as explicit rows (unknown-400 → fallback stays as the permanent fail-safe default, not a placeholder). Verify: `probe-findings.md` wording table complete

## 2. Foundation (test-first)

- [ ] 2.1 Write table-driven tests for the error classifier (rate-limit → propagate, auth/chat-forbidden → propagate, network → propagate, known parse-400 strings from task 1.2 → fallback, unknown 400 → fallback) per design D3. Verify: `bun test tests/chat/telegram/rich-send.test.ts` (red)
- [ ] 2.2 Implement `src/chat/telegram/rich-send.ts` classifier + in-memory counters (no send orchestration yet). Verify: `bun test tests/chat/telegram/rich-send.test.ts` (green)
- [ ] 2.3 Add drizzle migration: `richRendering` boolean (`NOT NULL DEFAULT 0`) on `platform_instances`; extend `src/db/instance-schema.ts`; no backfill. Verify: `bun test tests/db/` and `bun run typecheck`
- [ ] 2.4 Extend `TelegramBotLike` with `sendRichMessage` (type-only) and `tests/platform/harness/fake-telegram-bot.ts` with injectable rejection + recorded calls (test-first: extend `fake-telegram-bot.test.ts`). Verify: `bun test tests/platform/harness/fake-telegram-bot.test.ts`

## 3. Rich-first surfaces

- [ ] 3.1 Write failing routing tests: flag ON → `sendRichMessage` called with `{ markdown }` + thread id; flag OFF → entity path byte-identical to today. Verify: `bun test tests/chat/telegram/index.test.ts` (red)
- [ ] 3.2 Implement send orchestration in `rich-send.ts` (try-rich → classify → fallback + warn + counter) and wire `sendFormattedReply`, deferred `sendMessage`, `buildTelegramEditReply` per design D4/D5, including markdown-mode mention prefix. Verify: `bun test tests/chat/telegram/index.test.ts` (green)
- [ ] 3.3 Fallback-path tests per spec scenarios: parse-rejection → entity delivery; rate-limit → no fallback; edit fallback retries entity once. Verify: `bun test tests/chat/telegram/index.test.ts`

## 4. Control-surface invariants

- [ ] 4.1 Tests pinning unchanged behavior: button prompts, replacement replies, and `disableLinkPreview` sends never call `sendRichMessage`. Verify: `bun test tests/chat/telegram/reply-helpers.test.ts`

## 5. Observability + settings

- [ ] 5.1 Expose `{attempts, fallbacks, lastReason}` + recent-fallbacks via `src/debug/state-collector.ts` (test-first). Verify: `bun test tests/debug/`
- [ ] 5.2 Settings UI: toggle in the admin Telegram instance panel beside `openDmAccess` (`client/settings`, `client/settings/fetcher-schemas-admin.ts`, msw handlers, Storybook story). Verify: `bun run test:client` and the instance panel Storybook shot via `bun shoot`
- [ ] 5.3 Update `docs/architecture/behaviors.md` (rich rendering + fallback behavior) and `src/chat/CLAUDE.md` (adapter convention). Verify: manual review

## 6. Full gates + live verification

- [ ] 6.1 Full gates: `bun test`, `bun run typecheck`, `bun run lint`, `bun security`, `bun run test:stories:contracts`, `bun run test:platform`
- [ ] 6.2 Opt in one operator instance; collect ≥ 1 week of fallback counters; reconcile live fallback logs against `probe-findings.md` and extend the classifier with any newly observed rejection strings (failing tests first)
- [ ] 6.3 Phase 2 (separate follow-up commit/change): flip default via migration, settings copy, `versionAnnouncements` broadcast — gated on 6.2 evidence; record thresholds used
