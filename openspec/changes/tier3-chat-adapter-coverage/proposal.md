<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Tier 3 chat-adapter coverage (Discord + Mattermost)

## Why

The nightly Tier 3 lane (`bun test:platform`, seam `platform-adapter-fakes`)
proves chat adapters against fake platform boundaries. Four adapter behaviors
have no proving record at any tier: Discord reply-to-bot mention equivalence,
Discord live-status lifecycle (create/update/dismiss plus unavailable-status
fallback), Mattermost thread-root reply propagation, and the Mattermost
live-status patch/delete mutation lifecycle. Without them, a regression in
`src/chat/discord/` reply resolution or in either live-status path ships
green: no scenario dispatches through the real provider for these cases, and
`tests/platform/catalog-crosscheck.test.ts` records no Tier 3 entry to miss.
Live status and reply threading are user-visible on both platform instances.

## What Changes

- Extend `tests/platform/harness/fake-discord-client.ts` with parent-message
  `messages.fetch` serving (`seedChannelMessage`) and one-shot send-failure
  injection (`failNextChannelSend`), with contract tests.
- Extend `tests/smoke/harness/fake-mattermost-server.ts` **additively** with
  `IncomingPost.rootId` on the delivered WS frame and ordered capture of
  `PUT /api/v4/posts/:id/patch` and `DELETE /api/v4/posts/:id`, exposed via
  `postMutations()` / `outboundEvents()`.
- Add four scenario files under `tests/platform/scenarios/`
  (`discord-reply-mention`, `discord-live-status`, `mattermost-thread-reply`,
  `mattermost-status-lifecycle`), driving real adapter start/dispatch/reply.
- Register five `PLATFORM_STORIES` entries and the matching `SCN-*` records
  with `provingTier: '3'` in `tests/stories/catalog/coverage.ts`; raise the
  Tier 3 cardinality in `catalog-crosscheck.test.ts` from 11 to 16.

## Capabilities

### New Capabilities

- `tier3-chat-adapter-coverage` — proving records for the four uncovered
  Discord/Mattermost adapter behaviors, plus the fake-boundary surfaces those
  records require. Without it the four behaviors stay unproven at every tier.

### Modified Capabilities

None. `openspec/specs/` has no entry for the platform-adapter lane.

## Non-goals

- Telegram and Kontur Talk adapters — already covered at Tier 3; declined to
  keep the fake-boundary surface additive and the diff reviewable.
- Moving any record to Tier 0 — the frozen story harness stays untouched
  except for additive catalog records.
- Raising the Tier 0 coverage floor in `scripts/story/coverage-floor.json`;
  these are Tier 3 records and do not move that number.
- Rewriting the Tier 2 smoke scenarios; all fake-Mattermost changes are
  additive so `bun test:smoke` stays green unedited.

## Impact

- **Platform instances:** Discord and Mattermost only. Scope model: scenarios
  exercise thread-isolated storage context ids (Mattermost `root_id`
  threading); no per-user or group-shared config surface changes.
- **Tests:** `tests/platform/harness/`, `tests/platform/scenarios/`,
  `tests/platform/run-platform.ts`, `tests/platform/catalog-crosscheck.test.ts`,
  `tests/smoke/harness/fake-mattermost-server.ts`,
  `tests/stories/catalog/coverage.ts`.
- **Production code / DB / deps:** none.
- **Docs:** `docs/architecture/behaviors.md` live-status section if the
  scenarios reveal undocumented ordering.
- **Legacy:** adopts `docs/archive/2026-08-04-tier3-chat-adapter-coverage.md`
  (delete-on-adopt, same commit).
