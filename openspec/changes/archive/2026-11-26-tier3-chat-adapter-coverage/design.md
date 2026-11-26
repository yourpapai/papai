<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Tier 3 chat-adapter coverage

## D1 — Keep adapter production paths real; fake only the platform boundary

Both Discord and Mattermost scenarios run the real adapter start/dispatch/reply
path. Only the external platform boundary is replaced: the injected Discord
client fake (in-process) and the Docker-backed fake Mattermost server
(in-container). Calling the isolated helpers (`extractReplyContext`, status
formatters) as the proof was rejected — those helpers are already unit-tested,
and the gap is in the wiring between them and the provider.

## D2 — Existing modules cover the need; no new ones

`tests/platform/harness/fake-discord-client.ts` and
`tests/smoke/harness/fake-mattermost-server.ts` already exist and are the only
boundaries these behaviors cross; both are extended rather than duplicated. The
fake Mattermost server is shared with Tier 2, so every change is additive
(optional `rootId`, new capture accessors, new patch/delete routes) — a second
fake server would fork the contract the Tier 2 lane relies on.

## D3 — Scope model

Scenarios are read-only with respect to durable config. The Mattermost thread
scenario is the one that touches the scope model: it asserts the turn keys live
conversation state by the thread-scoped storage context id (Mattermost groups
are thread-scoped per `src/chat/context-scope.ts`), not the group config
context id. Discord is deliberately not thread-scoped and the Discord scenarios
assert channel-level keying.

## D4 — Capability / tool-prefs gating

None. No new tool surface; the scenarios drive existing adapter paths.

## D5 — DB, dependencies

No migration, no new dependency. Bun's `bun:test` and the existing Docker
harness cover the lane.

## D6 — Hook / TDD interaction

Four new `.platform.ts` scenario files carry the non-discovered suffix and run
only under `bun test:platform`; the Write/Edit TDD hook gates the two harness
files (`fake-discord-client.ts`, `fake-mattermost-server.ts`), so their
contract tests are written first. Order of work: fake contract tests → fake
extensions → scenarios → catalog registration → cross-check cardinality.

## D7 — Tier boundary

The five records stay at proving tier `3`. Promoting them to Tier 0 would
require the frozen story harness to own the fakes, invalidating the recorded
compatibility baseline; the only permitted `tests/stories/**` edit is additive
catalog records in `tests/stories/catalog/coverage.ts`.
