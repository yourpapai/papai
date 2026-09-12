<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Tier 3 callback routing coverage

**Status:** approved for planning

**Date:** 2026-08-02

## Context

Tier 3 is the nightly platform-adapter regression lane. It already covers the
Mattermost chat-link and signed-action paths, Discord command/formatting/response
paths, Kontur reply formatting, and Telegram group-admin authorization. The
catalog still has three reachable interaction records at `needs-seam@3`:

- `SCN-interaction-discord-router-wrapped`
- `SCN-interaction-discord-standalone-fallback`
- `SCN-interaction-telegram-callback`

They cannot be promoted into Tier 0: the proof requires the Discord or grammY
event callback above the adapter's normalized interaction boundary. This cycle
closes only these three records. It does not revise existing Tier 3 scenarios or
expand the lane's scope.

## Decision

Use real `DiscordChatProvider` and `TelegramChatProvider` instances with the
existing injected adapter fakes. Drive the providers through their registered
SDK event handlers, wrap them in a real `ChatRouter`, and configure that router
through production `setupBot`.

The fakes provide only event delivery, deterministic flushing, lifecycle cleanup,
and outbound-call observation. They must not implement routing, authorization, or
callback semantics owned by production code. Creating fake Discord Gateway or
Telegram polling servers is out of scope: it would emulate broad third-party
protocols without increasing confidence in these three adapter-to-router paths.

## Architecture

Add a Discord callback scenario file and a Telegram callback scenario file under
`tests/platform/scenarios/`, and register both in the existing
`tests/platform/run-platform.ts` aggregator. Both use the current Tier 3 test
patterns: non-discovered `.platform.ts` suffixes, deterministic fakes, lifecycle
assertions, and the nightly-only `test:platform` lane.

The Discord scenario creates `DiscordChatProvider` with `FakeDiscordClient`.
The Telegram scenario creates `TelegramChatProvider` with an expanded
`FakeTelegramBot`. Each provider is managed by `ChatRouter`; `setupBot` registers
the production interaction handler on that router. A fake SDK event therefore
passes through this complete path:

```
SDK callback -> adapter mapping -> ChatRouter instance wrapper -> setupBot ->
authorization -> routeInteraction -> platform ReplyFn
```

No production `src/` behavior changes are required.

## Scenarios

### Discord router-wrapped interaction

`SCN-interaction-discord-router-wrapped` seeds an authorized user/context and a
pending `perm:a:<id>` permission request. It emits a Discord button event only
after the provider, router, and production bot setup are active. The test asserts
that the request resolves as `allow`, its prompt is removed, and the fake records
the ephemeral confirmation. This proves that the router-injected platform instance
ID reaches the real authorization and interaction route.

### Discord standalone fallback

`SCN-interaction-discord-standalone-fallback` starts the provider without router
interaction registration, installs its ordinary message fallback, and emits an
unmatched button callback. It asserts that the callback is deferred and the
fallback receives its normalized callback-as-message input. It must not require an
interaction handler. This locks down the provider's existing standalone contract.

### Telegram callback

`SCN-interaction-telegram-callback` seeds an authorized pending `perm:d:<id>`
request, then emits a Telegram `callback_query:data` event through the bot's
registered handler after router and bot setup. It uses a group message with a
thread ID. The test asserts the request resolves as `deny`, its prompt is removed,
the callback query is acknowledged exactly once, and Telegram's ephemeral
confirmation reply path is used. This proves callback data, identity, context,
thread, and platform-instance mapping across the Telegram event wire.

## Fake Boundaries And Error Handling

`FakeDiscordClient` retains its existing queued-event and pending-response checks.
`FakeTelegramBot` gains typed handler registration, callback emission, flushing,
callback-answer observation, and polling cleanup checks. Both fakes fail tests
when queued work, unresolved promises, or active client/poller lifecycle state
remains after teardown.

The tests use real permission-request lifecycle state rather than implementation
spies. Unknown/unmatched standalone Discord callbacks exercise the production
fallback. The Telegram scenario verifies its acknowledgement path directly, so a
callback cannot silently hang if the route does not respond ephemerally.

## Catalog And Verification

Promote exactly the three named records from `needs-seam@3` to executable Tier 3
records with story IDs from the platform scenario registry. Update catalog count
and pending-readiness assertions and extend the platform registry/crosscheck so
every promoted record invokes its named scenario.

The lane remains nightly-only; it is not a Tier 0 compatibility or PR gate. The
implementation must verify:

1. `bun run test:platform` passes with the two new scenario files.
2. The platform catalog crosscheck and story catalog contracts pass.
3. Default `bun test` still excludes `.platform.ts` files.
4. Typecheck and lint pass.
5. Any changed production-adjacent source is mutation-tested under the existing
   changed-file policy. The expected production source diff is zero.

## Non-Goals

- No change to existing Mattermost, Discord, Kontur, or Telegram Tier 3 scenarios.
- No fake Discord Gateway, Telegram HTTP/polling server, Docker addition, or
  production transport implementation.
- No change to the Tier 3 nightly-only policy.
- No expansion of Tier 0/0Q qualification.
- No coverage-floor adjustment.
