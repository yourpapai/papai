<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Router — Phase 3: ChatRouter

**Date:** 2026-04-13
**Status:** Approved
**Parent:** [`2026-04-13-multi-provider-router-design.md`](./2026-04-13-multi-provider-router-design.md)
**Depends on:** Phase 1 (Instance Data Model)
**Ships independently:** Yes — once Phase 1 is in, ChatRouter can wrap a single instance with no behavior change, then expand to many.

## Summary

Add a `ChatRouter` that implements `ChatProvider` and delegates to multiple underlying adapters keyed by `platformInstanceId`. It fans out command registration, replays registrations for instances added later, tags every `IncomingMessage` and `IncomingInteraction` with `platformInstanceId`, and routes proactive `sendMessage` calls to the named instance. `src/index.ts` constructs the router from active rows in `platform_instances` and starts the bot through it.

## Requirements

- Single object passed to `setupBot()`, satisfying the existing `ChatProvider` interface
- Command registration fans out to all current instances and is replayed when new instances are added
- Every inbound `IncomingMessage` / `IncomingInteraction` arrives at the bot with `platformInstanceId` set to the source instance ID
- `sendMessage(platformInstanceId, target, markdown)` routes to that specific instance (used by scheduler, poller, and proactive admin notices)
- Per-instance lifecycle: `addInstance` / `removeInstance` / `startInstance` / `stopInstance`
- Instance start failures are isolated — the rest of the router keeps running

## Section 1: Interface

```typescript
export type ManagedChatInstance = {
  id: string
  type: string
  provider: ChatProvider
  status: 'pending' | 'active' | 'stopped'
}

export type ManagedChatInstanceFactory = (type: string, config: Record<string, string>) => ChatProvider

export class ChatRouter implements ChatProvider {
  constructor(factory: ManagedChatInstanceFactory)

  // Lifecycle — called from index.ts at startup and from dashboard "Apply" later
  addInstance(id: string, type: string, config: Record<string, string>): void
  removeInstance(id: string): Promise<void>
  startInstance(id: string): Promise<void>
  stopInstance(id: string): Promise<void>

  // ChatProvider interface — delegates to all active instances
  registerCommand(name: string, handler: CommandHandler): void
  onMessage(handler: (m: IncomingMessage, r: ReplyFn) => Promise<void>): void
  onInteraction(handler: (i: IncomingInteraction, r: ReplyFn) => Promise<void>): void
  sendMessage(platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>

  // Instance queries
  getInstance(id: string): ManagedChatInstance | undefined
  listInstances(): ManagedChatInstance[]
}
```

## Section 2: Message Flow

1. Each underlying `ChatProvider` adapter invokes its `onMessage` handler as today.
2. The router wraps each adapter's handler to inject `platformInstanceId: instance.id` into the `IncomingMessage` before forwarding to the bot's handler.
3. The `ReplyFn` produced by the adapter is already scoped to the right instance — no extra routing on the reply path.

## Section 3: IncomingMessage / IncomingInteraction Changes

```typescript
export type IncomingMessage = {
  user: ChatUser
  contextId: string
  contextType: ContextType
  isMentioned: boolean
  text: string
  platformInstanceId: string // NEW — set by ChatRouter
} & Partial<{ /* unchanged optional fields */ }>

export type IncomingInteraction = {
  kind: 'button'
  user: ChatUser
  contextId: string
  contextType: ContextType
  platformInstanceId: string // NEW
  /* rest unchanged */
}
```

Test factories (`createDmMessage`, `createGroupMessage`, equivalent for interactions) default `platformInstanceId: 'test-instance'`.

## Section 4: Command Registration

- `registerCommand(name, handler)` stores `(name, handler)` in `registeredCommands: Map<string, CommandHandler>` and immediately calls `instance.provider.registerCommand(name, handler)` on every current instance.
- `addInstance(id, type, config)` constructs a new `ChatProvider` via the injected factory and replays every entry in `registeredCommands` onto it, plus re-binds the current `messageHandler` and `interactionHandler`.

## Section 5: `sendMessage` Routing

```typescript
sendMessage(platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<void>
```

The new first parameter is required. Existing adapter implementations of `sendMessage(target, markdown)` are wrapped by the router, which discards the `platformInstanceId` argument when calling the underlying adapter (the adapter only knows its own instance).

Scheduler and poller paths must look up the context's `platformInstanceId` from `context_settings` and pass it explicitly.

## Section 6: Capabilities and Traits

- `capabilities`: union of all active instances' `capabilities` sets
- `traits`: **not aggregated** — message handlers that need traits look them up with `router.getInstance(platformInstanceId)?.provider.traits`
- The router exposes a small helper `getInstanceTraits(platformInstanceId)` for convenience

## Section 7: Startup Integration

`src/index.ts`:

```typescript
import { ChatRouter } from './chat/router.js'
import { createChatProvider } from './chat/registry.js'
import { listActivePlatformInstances } from './instances/platform-store.js'

const router = new ChatRouter((type, config) => createChatProvider(type, config))
for (const instance of listActivePlatformInstances()) {
  router.addInstance(instance.id, instance.type, instance.config)
}
// setupBot/onMessage/registerCommand all go through the router from here on
```

`router.start()` is called after `setupBot()`; failures per instance are caught by `startInstance` and reported via instance status, not by throwing.

## Section 8: Error Handling

| Condition                                  | Behavior                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| Instance factory throws on `addInstance`   | Throw immediately; the row is not stored                                              |
| `startInstance` throws                     | Mark `status: 'stopped'`, log ERROR, continue with other instances                    |
| Instance disconnects at runtime            | Existing adapter reconnection logic owns recovery; if unrecoverable, mark `stopped`   |
| `sendMessage` to unknown `platformInstanceId` | Log a WARN and return without throwing (caller may be poller/scheduler racing remove) |
| `removeInstance` called while running      | Call `stop()` first, swallow errors, then drop from the map                           |

## Section 9: Testing Strategy

- **`tests/chat/router.test.ts`**:
  - `registerCommand` fan-out
  - command replay when an instance is added later
  - `platformInstanceId` injection into messages and interactions
  - `sendMessage` routes to the named instance only
  - `start()` isolates a failing instance
  - `removeInstance` swallows stop errors
- **`tests/chat/incoming-message-shape.test.ts`** — TypeScript shape check that `platformInstanceId` is required
- Update every fixture under `tests/bot.ts`, `tests/utils/messages.ts`, and equivalents to default `platformInstanceId: 'test-instance'`

## Section 10: Out of Scope

- Dashboard "Apply changes" button → Phase 4
- Per-platform admin model → Phase 4
- Plugin chat-capability re-evaluation → Phase 5
