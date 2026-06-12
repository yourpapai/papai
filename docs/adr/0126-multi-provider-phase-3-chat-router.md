<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0126: Multi-Provider Phase 3: Chat Router

## Status

Implemented

## Date

2026-04-13 – 2026-05-23

## Context

After Phase 1 introduced the `platform_instances` data model and Phase 2 added
task-provider routing, the chat layer still constructed a single `ChatProvider`
from environment variables at startup. There was no way to run multiple chat
adapters simultaneously (e.g. one Telegram and one Mattermost bot in the same
process), and no inbound message carried a `platformInstanceId` tag to
correlate it with the originating platform instance.

Proactive sends (scheduler recurring-task notifications, deferred-prompt
delivery, version announcements, admin `/announce`) all called
`sendMessage(target, markdown)` with no platform instance routing. When
multiple adapters exist, those calls cannot determine which adapter should
deliver the message without an explicit instance key.

The spec (`docs/archive/2026-04-13-multi-provider-phase-3-chat-router.md`)
required a `ChatRouter` that implements `ChatProvider`, delegates to multiple
underlying adapters keyed by `platformInstanceId`, tags all inbound traffic,
and routes proactive sends to a named instance. The implementation plan
(`docs/archive/2026-05-23-multi-provider-phase-3-chat-router-plan.md`)
decomposed this into nine tasks covering types, registry, router core,
adapter updates, command surfaces, delivery routing, proactive send callers,
startup wiring, and full verification.

## Decision Drivers

- **Single object contract**: `setupBot()` and all callers must receive exactly
  one `ChatProvider`; the router must satisfy the full interface including
  optional surfaces (`setCommands`, resolvers, `renderContext`).
- **Inbound traceability**: Every `IncomingMessage` and `IncomingInteraction`
  must carry `platformInstanceId` so downstream code can resolve the source
  adapter for rendering, identity, and label queries.
- **Explicit proactive routing**: Proactive sends must name the target
  platform instance; no implicit "first active" guessing when multiple
  instances exist.
- **Instance isolation**: One instance failing to start must not prevent the
  rest from running.
- **Backward-compatible adapters**: Concrete adapters must still work in
  isolation (single-instance tests, env bootstrap) without a router.

## Considered Options

### Option A: Pass-through router with ambient instance lookup

Router delegates all `ChatProvider` methods to a single "default" instance.
Proactive sends look up the platform instance from `context_settings` inside
the router at call time, keeping the `sendMessage(target, markdown)` signature.

- **Pros**: No `ChatProvider` signature change; adapters unchanged.
- **Cons**: Router must guess which instance handles a context when
  `context_settings` is absent; ambiguous routing is a source of silent
  misdelivery; the single-default-instance model collapses back to
  single-provider behavior.

### Option B: Explicit platformInstanceId on sendMessage (chosen)

Change `ChatProvider.sendMessage` to
`sendMessage(platformInstanceId, target, markdown)`. The router uses the first
argument for instance lookup. Concrete adapters accept and ignore it because
each adapter already represents one instance.

- **Pros**: No ambiguity; caller is always explicit about the target platform;
  `DeferredDeliveryTarget` persisted shape stays unchanged (no schema
  migration for stored targets).
- **Cons**: Every callsite must supply the instance ID; signature change
  propagates to all mock providers and test helpers.

### Option C: Store platformInstanceId on DeferredDeliveryTarget

Add `platformInstanceId` to the `DeferredDeliveryTarget` type so scheduled
prompts and recurring alerts carry their routing key in the persisted payload.

- **Pros**: `sendMessage` signature stays two-argument; routing data travels
  with the target.
- **Cons**: Persisted schema migration for all stored delivery targets;
  historical targets lack the field and need migration or fallback;
  conflates routing metadata with delivery addressing.

## Decision

**Option B** — explicit `platformInstanceId` as the first `sendMessage`
argument, with the following subsidiary decisions:

| Topic                    | Decision                                                                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbound tagging          | `platformInstanceId` is a required field on `IncomingMessage` and `IncomingInteraction`. The router overwrites the adapter-set value with the managed instance ID on every inbound event.     |
| Proactive send contract  | `sendMessage(platformInstanceId, target, markdown)`. Concrete adapters accept `_platformInstanceId` and ignore it.                                                                            |
| Delivery routing helper  | `resolveDeliveryPlatformInstanceId(target)` in `src/chat/delivery-routing.ts` looks up `context_settings.platformInstanceId`; returns `null` when unassigned, causing a logged skip.          |
| Command registration     | `registerCommand` stores commands in a local map and fans out to all current instances. `addInstance` replays stored commands, message handler, and interaction handler onto the new adapter. |
| Capabilities             | Union of all active instances' capability sets.                                                                                                                                               |
| Traits                   | Not aggregated; `getInstanceTraits(platformInstanceId)` returns the source instance's traits. Router-level `traits` falls back to the first active instance.                                  |
| Context rendering        | `renderContextForInstance(platformInstanceId, snapshot)` for paths with a real inbound message. `renderContext(snapshot)` is a compatibility fallback.                                        |
| Resolver delegation      | `resolveUserId`, `resolveUserLabel`, `resolveGroupLabel` delegate through the source instance when `platformInstanceId` is available in the resolver context.                                 |
| Instance lifecycle       | `addInstance` / `removeInstance` / `startInstance` / `stopInstance`. `removeInstance` swallows stop errors. `startInstance` marks a failed instance as `stopped` and continues.               |
| Startup wiring           | `src/index.ts` constructs `ChatRouter` from `listActivePlatformInstances()`, adds each instance, then calls `setupBot()` and `router.start()`.                                                |
| `DeferredDeliveryTarget` | Unchanged in Phase 3; `platformInstanceId` is not added to the persisted shape.                                                                                                               |
| Config-backed registry   | `createChatProviderFromConfig(id, type, config)` maps instance config keys to env-shaped constructors, preserving `createChatProvider(name)` for env bootstrap.                               |

## Consequences

### Positive

- Multiple chat adapters run in one process with deterministic routing.
- Inbound `platformInstanceId` enables correct source-adapter resolution for
  rendering, identity, and label queries without `context_settings` lookups.
- Proactive sends are always explicit; no silent misdelivery when multiple
  platform instances exist.
- Instance start failures are isolated — one bad adapter does not block the
  rest of the router.
- Command registration replay means instances added after initial bot setup
  still receive all registered commands.
- `DeferredDeliveryTarget` persisted shape is unchanged; no stored-data
  migration required.

### Negative

- Every proactive-send callsite must resolve and pass `platformInstanceId`,
  adding one lookup call per send path.
- The `sendMessage` three-argument signature propagates to all mock providers
  and test helpers.
- Router-level `traits` and `renderContext` fall back to the first active
  instance, which is correct only when one instance exists or when traits
  happen to agree.

### Risks

- If a proactive-send callsite omits the delivery-routing helper and passes
  a wrong `platformInstanceId`, the message routes to the wrong adapter.
  Mitigation: the delivery-routing helper is the single approved path for
  resolving platform IDs from delivery targets; direct callers (command
  handlers) use `msg.platformInstanceId` from the inbound event.
- Router fan-out for `setCommands` logs and continues on per-instance
  failure; a persistent `setCommands` failure on one instance leaves its
  command menu stale until the next bot restart.

## Implementation Notes

Key modules:

| File                              | Role                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/chat/router.ts`              | `ChatRouter implements ChatProvider`; lifecycle, command replay, inbound tagging, send routing, capability union, resolver delegation |
| `src/chat/delivery-routing.ts`    | `resolveDeliveryPlatformInstanceId(target)` for proactive send routing                                                                |
| `src/chat/types.ts`               | `platformInstanceId` added to `IncomingMessage`, `IncomingInteraction`, `ResolveUserContext`; `sendMessage` signature updated         |
| `src/chat/registry.ts`            | `createChatProviderFromConfig(id, type, config)` added alongside env-backed `createChatProvider(name)`                                |
| `src/instances/platform-store.ts` | `listActivePlatformInstances()` helper added                                                                                          |
| `src/index.ts`                    | Constructs `ChatRouter` from active `platform_instances` rows; wires startup through router                                           |

Adapter constructors gained optional `platformInstanceId` parameters:
`TelegramChatProvider(token?, platformInstanceId?)`,
`MattermostChatProvider(config?)`,
`DiscordChatProvider(clientFactory?, token?, platformInstanceId?)`.

Command updates: `/context` uses `renderContextForInstance()` when available;
`/group` passes `msg.platformInstanceId` into resolver contexts; `/announce`
routes through the message source instance.

Proactive-send callers (`src/deferred-prompts/poller.ts`,
`src/scheduler-recurring.ts`, `src/announcements.ts`, `src/commands/admin.ts`)
resolve the platform instance via `resolveDeliveryPlatformInstanceId()` or
`msg.platformInstanceId` before calling `sendMessage`.

## Related Decisions

- ADR-0009: Multi-Provider Task Tracker Support — provider capability model;
  Phase 1 and Phase 2 instance data model that ChatRouter builds on.
- ADR-0014: Multi-Chat Provider Abstraction — the `ChatProvider` interface
  that ChatRouter implements and extends.
- ADR-0123: Trusted-Local Plugin System — plugin compatibility evaluation
  depends on per-instance capabilities; ChatRouter's capability union feeds
  plugin eligibility checks.
