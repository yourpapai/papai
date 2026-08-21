<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tier 3 Platform Adapters Design

**Date:** 2026-07-30

## Decision

Split the platform-adapter and deferred-poller follow-up into two implementation
cycles and two specs. This document defines the Tier 3 platform-adapter cycle.
The deferred-poller lifecycle remains the next, independent Tier 4 cycle.

The split is required because the two lanes prove different things with different
trusted boundaries. Tier 3 runs real adapter code against deterministic platform
client or HTTP fakes. Tier 4 must own virtual time and scheduler lifecycle; it
cannot establish its guarantees through platform fakes. Combining them would make
the Tier 3 runner responsible for timer semantics and obscure both failure modes.

Tier 3 is the recommended first cycle: it extends the existing nightly platform
lane without changing the production scheduler boundary. Tier 4 follows after a
separate design establishes that boundary.

## Scope

This slice maps only these existing Tier 3, `platform-adapter-fakes` records:

- `SCN-interaction-discord-command-routing`
- `SCN-interaction-discord-format-chunking`
- `SCN-interaction-discord-response-lifecycle`
- `SCN-interaction-kontur-reply-formatting`
- `SCN-interaction-telegram-admin-authorization`

It preserves their proving tier and named seam. It does not reclassify any record
as Tier 0, alter existing Tier 0 helper coverage, add broader interaction records,
or include deferred-poller behavior.

## Existing Lane and Boundaries

The implementation belongs in the existing explicit nightly platform lane:
`tests/platform/run-platform.ts` imports non-discovered
`tests/platform/scenarios/*.platform.ts` files, while
`tests/platform/catalog-crosscheck.test.ts` enforces one-to-one Tier 3 catalog
registration. It reuses the lane's normal lifecycle and cleanup conventions but
does not make the default unit or story suites run platform scenarios.

Each scenario instantiates the real provider and drives its normal start and
event-dispatch path. The fake replaces only the external platform boundary:

| Platform | Minimum faithful fake |
| --- | --- |
| Discord | A controllable client that records event listeners, resolves `login` through a deterministic `ready` event, emits `messageCreate` and `interactionCreate`, and supplies channels/interactions that record ordered sends, edits, deletes, typing, and acknowledgements. |
| Kontur Talk | An in-process API boundary that records deterministic requests and returns fixed `get_updates` and `send_message` responses. |
| Telegram | A minimal Bot API membership boundary for `getChatMember`, with deterministic status and error responses. No real bot token, polling loop, or network endpoint is permitted. |

The fakes expose only behavior the production adapter consumes. They are not a
generic normalized-chat fake and must not mirror unrelated SDK internals.

## Scenario Requirements

### Discord command routing

Emit one mentioned `messageCreate` event containing `/help retained-args` through
the started provider. Prove that the registered command runs exactly once, receives
the expected scoped context and `commandMatch`, and prevents the ordinary message
handler from running. A fixed unmatched or non-mentioned control message proves no
spurious command route occurs.

### Discord format chunking

Route a fixed oversized markdown payload that contains paragraphs and a fenced code
block through the real Discord reply path. Prove every content payload is within
Discord's configured adapter limit; emitted chunks are in source order; their
content preserves the intended text semantics; and every chunk has valid fence
state. Assertions must inspect recorded sends, not call `chunkForDiscord` directly.

### Discord response lifecycle

Emit one button interaction through the started client. Prove its acknowledgement
(`deferUpdate`) occurs exactly once before routing, then that the route produces one
permitted reply or status outcome. Exercise one rejected acknowledgement or
response and prove the adapter does not make a second acknowledgement or retry it
as another interaction response.

### Kontur Talk reply formatting

Drive a fixed room/thread update and produce text plus formatted replies. Prove the
recorded `POST /send_message` calls are ordered and have the exact room ID, inherited
or explicitly overridden thread ID, message, `plain` or `markdown` format, and an
empty mentions array. Calling `buttons` must reject and must not issue a send.

### Telegram admin authorization

Drive creator, administrator, member, malformed-ID, and API-error cases through the
provider membership boundary. For valid IDs, prove the Bot API receives numeric
native chat and user IDs. Creator and administrator yield `true`, member yields
`false`, and malformed IDs or an API error yield `null`. The authorization consumer
must treat `null` as unauthorized: uncertainty may never grant administrative
access.

## Determinism, Failure Handling, and Cleanup

All scenario data is fixed: platform instance IDs, native user/context IDs, message
and thread IDs, command text, fake response bodies, and oversized-payload content.
No assertion may use wall-clock timing, live credentials, network access, SDK
implementation details outside the structural fake boundary, random data, or test
ordering.

Platform failures remain observable at their boundary. Rejected operations are
captured as adapter failures; they must not be hidden by retrying a Discord
interaction acknowledgement or by treating a Telegram membership error as access.
The scenarios must assert cleanup: no unconsumed fake request, outstanding event
listener, deferred interaction response, timer, or client/server resource may remain
after teardown. A cleanup failure fails the scenario.

## Verification Strategy

The Tier 3 runner will explicitly import the five new scenario files. The platform
catalog crosscheck will continue to require exact one-to-one registration and the
lane census will reject an unregistered scenario marker or an unclaimed record.
The scenarios run in the existing nightly Tier 3 lane; unit/helper tests remain
useful regression checks but are not proof for these records.

## Tier 4 Handoff: Deferred Poller Lifecycle

`SCN-deferred-poller-lifecycle` remains Tier 4 with the named
`scheduler-due-seed` and `scheduler-chat-di` seams. Its separate spec must define a
production clock/scheduler ownership boundary before adding operational scenarios.
That boundary must provide a deterministic virtual clock that advances due work
without wall time, tracks every timer handle and owner, and can prove the scheduled
and alert pollers' immediate start, interval cadence, idempotent repeated start,
stop, unregister, restart, and in-flight cleanup behavior. Stopping must cancel all
poller-owned work and leave no reachable timer or task registration; virtual-clock
teardown must fail on a leak. Platform fakes are not a substitute for this seam.

No Tier 4 implementation, test, fixture, catalog mapping, or plan is part of this
Tier 3 cycle.
