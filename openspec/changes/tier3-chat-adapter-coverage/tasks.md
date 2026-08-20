<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Tier 3 chat-adapter coverage

## 1. Discord fake boundary

- [x] 1.1 Failing contract tests in
      `tests/platform/harness/fake-discord-client.test.ts` for parent-message
      `messages.fetch` serving via `seedChannelMessage` and one-shot
      `failNextChannelSend`; then implement both in
      `tests/platform/harness/fake-discord-client.ts`.
      Verify: `bun test tests/platform/harness/fake-discord-client.test.ts`

## 2. Discord scenarios

- [x] 2.1 Add `tests/platform/scenarios/discord-reply-mention.platform.ts`:
      reply-to-bot dispatches identically to an explicit mention; reply to a
      non-bot parent dispatches nothing.
      Verify: `bun test:platform`
- [x] 2.2 Add `tests/platform/scenarios/discord-live-status.platform.ts`:
      create/update/dismiss ordering, and the fallback when the status send
      fails once.
      Verify: `bun test:platform`

## 3. Mattermost fake boundary

- [x] 3.1 Failing contract tests in
      `tests/smoke/harness/fake-mattermost-server.test.ts` for `rootId` on the
      delivered WS frame and ordered patch/delete capture; then implement
      additively in `tests/smoke/harness/fake-mattermost-server.ts`
      (`postMutations()`, `outboundEvents()`).
      Verify: `bun test tests/smoke/harness/fake-mattermost-server.test.ts`
      and `bun test:smoke` (green with no Tier 2 scenario edits)

## 4. Mattermost scenarios

- [ ] 4.1 Add `tests/platform/scenarios/mattermost-thread-reply.platform.ts`:
      outbound post carries the incoming `root_id`; turn uses the
      thread-scoped storage context id.
      Verify: `bun test:platform`
- [ ] 4.2 Add
      `tests/platform/scenarios/mattermost-status-lifecycle.platform.ts`:
      create, ordered patches, terminating delete.
      Verify: `bun test:platform`

## 5. Catalog registration

- [ ] 5.1 Register five `PLATFORM_STORIES` entries in
      `tests/platform/scenarios/catalog.ts`, extend `PLATFORM_COVERAGE_FILES`
      with the newly covered Discord sources, and import the four scenario
      modules in `tests/platform/run-platform.ts`.
      Verify: `bun test:platform`
- [ ] 5.2 Add five `SCN-*` ids to `CATALOG_SCENARIO_IDS` with executable
      records (`provingTier: '3'`, seam `platform-adapter-fakes`) and extend
      `CATALOG_SOURCE` in `tests/stories/catalog/coverage.ts`; raise the
      Tier 3 cardinality from 11 to 16 in
      `tests/platform/catalog-crosscheck.test.ts`.
      Verify: `bun test tests/platform/catalog-crosscheck.test.ts` and
      `bun test:stories:contracts`

## 6. Close out

- [ ] 6.1 Run `bun test`, `bun run typecheck`, `bun run lint`,
      `bun test:stories:coverage`, `bun test:smoke`, `bun test:platform`;
      update `docs/architecture/behaviors.md` if the scenarios surface
      undocumented live-status ordering.
      Verify: all commands exit 0
