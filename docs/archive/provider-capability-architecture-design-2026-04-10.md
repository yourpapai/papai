<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Provider Capability Architecture Design

**Date:** 2026-04-10  
**Status:** Approved  
**Scope:** Shared provider metadata, chat capabilities and interaction routing, first consumer refactors, and plugin/provider compatibility

## Problem Statement

papai already has a mature capability architecture for task providers, but not for chat providers:

1. **Task providers are capability-shaped**: `TaskProvider` exposes capabilities and tools are assembled by gating on those capabilities.
2. **Chat providers are still flat**: provider-specific behavior leaks into `bot.ts`, setup/wizard flows, config UI, and startup through platform-name checks and duck typing.
3. **Plugin plans stop at framework permissions**: current plugin design talks about `"store"`, `"scheduler"`, `"taskProvider"`, and `"chat"`, but not the specific task/chat capabilities a plugin needs.
4. **Plugin tool binding is underspecified**: the design says plugin tools are provider/user-bound factories, while the implementation plan stores raw tools at activation time.
5. **Future providers need a subset model**: Discord MVP is a good example of a provider with a deliberately smaller chat surface that should be expressible without adding more `chat.name === ...` branches.

## Goals

1. Introduce a shared provider metadata model across task and chat providers.
2. Add explicit chat capabilities and provider traits without replacing the current `ChatProvider` model.
3. Add a provider-agnostic interaction path for button/menu callbacks.
4. Refactor the first concrete consumer flows to use capabilities instead of platform checks.
5. Extend the plugin design so plugins can declare task/chat capability requirements.
6. Rename task-provider `Capability` to `TaskCapability` so task and chat capability systems are symmetric and unambiguous.

## Non-Goals

- Redesigning thread support; `ThreadCapabilities` remains separate and out of scope for this design.
- Implementing provider-as-plugin contracts in this phase.
- Adding CDN or external file storage for chat exports in this phase.
- Redesigning every command and reply surface in the app.
- Implementing Mattermost interactive callback webhooks in this phase; this design only reserves the architecture for it.

## Design

### 1. Shared Provider Metadata

Introduce a shared metadata shape that both task and chat providers follow conceptually:

```typescript
export interface BaseProviderDescriptor<C, R> {
  readonly name: string
  readonly capabilities: ReadonlySet<C>
  readonly configRequirements: readonly R[]
}
```

This is not meant to force task and chat providers into a single runtime base class. It is a design constraint: both provider families should expose the same kinds of metadata so the rest of the application can reason about them consistently.

#### Task Provider Naming

Rename task-provider capability type:

```typescript
export type TaskCapability =
  | 'tasks.delete'
  | 'tasks.count'
  | 'tasks.relations'
  | 'tasks.watchers'
  | 'tasks.votes'
  | 'tasks.visibility'
  | 'projects.read'
  | 'projects.list'
  | 'projects.create'
  | 'projects.update'
  | 'projects.delete'
  | 'projects.team'
  | 'comments.read'
  | 'comments.create'
  | 'comments.update'
  | 'comments.delete'
  | 'comments.reactions'
  | 'labels.list'
  | 'labels.create'
  | 'labels.update'
  | 'labels.delete'
  | 'labels.assign'
  | 'statuses.list'
  | 'statuses.create'
  | 'statuses.update'
  | 'statuses.delete'
  | 'statuses.reorder'
  | 'attachments.list'
  | 'attachments.upload'
  | 'attachments.delete'
  | 'workItems.list'
  | 'workItems.create'
  | 'workItems.update'
  | 'workItems.delete'
  | 'sprints.list'
  | 'sprints.create'
  | 'sprints.update'
  | 'sprints.assign'
  | 'activities.read'
  | 'queries.saved'
```

Compatibility shim during migration:

```typescript
/** Transitional alias during migration. */
export type Capability = TaskCapability
```

This keeps the design additive and avoids a repo-wide flag day while still making the long-term model explicit.

#### Chat Capabilities

Add a dedicated chat capability set:

```typescript
export type ChatCapability =
  | 'commands.menu'
  | 'interactions.callbacks'
  | 'messages.buttons'
  | 'messages.files'
  | 'messages.redact'
  | 'messages.reply-context'
  | 'files.receive'
  | 'users.resolve'
```

These names are intentionally behavior-oriented. They describe what callers can safely rely on, not how a provider happens to implement it.

#### Chat Traits

Capabilities alone are not enough for chat providers. Some important constraints are not boolean:

```typescript
export type ChatProviderTraits = {
  observedGroupMessages: 'all' | 'mentions_only'
  maxMessageLength?: number
  callbackDataMaxLength?: number
}
```

Examples:

| Provider    | observedGroupMessages | maxMessageLength                 | callbackDataMaxLength                |
| ----------- | --------------------- | -------------------------------- | ------------------------------------ |
| Telegram    | `all`                 | omitted unless a caller needs it | omitted unless a caller needs it     |
| Mattermost  | `all`                 | omitted unless a caller needs it | omitted unless a caller needs it     |
| Discord MVP | `mentions_only`       | omitted unless a caller needs it | set when the provider is implemented |

`ThreadCapabilities` remains a separate concern and is explicitly not folded into this design.

### 2. Additive ChatProvider Evolution

Evolve `ChatProvider` additively rather than replacing it:

```typescript
export type ChatProviderConfigRequirement = {
  key: string
  label: string
  required: boolean
}

export interface ChatProvider {
  readonly name: string
  readonly capabilities: ReadonlySet<ChatCapability>
  readonly traits: ChatProviderTraits
  readonly configRequirements: readonly ChatProviderConfigRequirement[]

  registerCommand(name: string, handler: CommandHandler): void
  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void
  onInteraction?(handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void

  sendMessage(userId: string, markdown: string): Promise<void>
  resolveUserId?(username: string): Promise<string | null>
  setCommands?(adminUserId: string): Promise<void>

  start(): Promise<void>
  stop(): Promise<void>
}
```

Design notes:

1. `setCommands?` keeps the current Telegram naming to reduce churn.
2. `resolveUserId?` becomes optional; callers must gate on `users.resolve`.
3. `ReplyFn` remains structurally unchanged in this phase, but the first consumer flows stop assuming every provider should use every reply surface.

### 3. Provider-Agnostic Interactions

Introduce a shared interaction event shape:

```typescript
export type IncomingInteraction = {
  kind: 'button'
  user: ChatUser
  contextId: string
  contextType: ContextType
  callbackData: string
  messageId?: string
  threadId?: string
}
```

The bot layer should own routing for interaction callback domains:

- `cfg:*`
- `wizard_*`
- `plugin_*`

#### Interaction Routing Model

```text
Telegram callback_query:data ----\
                                   -> ChatProvider.onInteraction() -> shared router
Future Mattermost action webhook --/
Future Discord component event ----/
```

The important architectural shift is that config editor, wizard callbacks, and future plugin actions stop living inside Telegram-specific code.

#### Provider Behavior in This Phase

| Provider    | `messages.buttons`                  | `interactions.callbacks`            | Phase behavior                                                     |
| ----------- | ----------------------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| Telegram    | yes                                 | yes                                 | Full reference implementation                                      |
| Mattermost  | not advertised yet                  | not advertised yet                  | Keep button-driven UX disabled until real callback receiver exists |
| Discord MVP | not in current implementation scope | not in current implementation scope | Reserved compatibility target for a later provider addition        |

### 4. First Consumer Refactors

This design includes the first concrete call-site cleanup so the architecture produces immediate value.

#### `/config`

Use interactive config UI only when both of these are true:

- `messages.buttons`
- `interactions.callbacks`

Otherwise, render a text-first configuration view.

#### Wizard

Use the same gating as `/config`:

- no `platform === 'telegram'`
- no provider-name branching
- button-driven wizard only when end-to-end interactions are supported

#### `/context`

Export behavior:

- if `messages.files` is supported, keep file export behavior
- if `messages.files` is not supported, show a clear warning that context export is unavailable on this provider today

Explicitly deferred:

- chunked inline export
- CDN/external file delivery

#### `/group`

Username resolution behavior:

- if `users.resolve` is supported, `@username` can be resolved through the provider
- otherwise, require an explicit stable user ID

This removes the current ambiguity where unsupported platforms appear to accept usernames but cannot actually verify them.

#### Startup Command Menu

Replace duck-typed startup logic with capability-aware startup:

- if `commands.menu` is supported and `setCommands` exists, register command menu
- otherwise do nothing

### 5. Plugin / Provider Compatibility

#### Manifest Changes

Extend plugin manifests with provider capability requirements:

```typescript
export type PluginManifest = {
  // existing fields...
  permissions: PluginFrameworkPermission[]
  requiredTaskCapabilities?: TaskCapability[]
  requiredChatCapabilities?: ChatCapability[]
}
```

This is intentionally separate from framework permissions:

- `permissions` = what framework services the plugin may access
- `required*Capabilities` = what provider features must exist for the plugin to activate safely

#### Plugin State

Add an explicit incompatibility state:

```typescript
export type PluginState = 'discovered' | 'approved' | 'incompatible' | 'active' | 'rejected' | 'error'
```

`incompatible` means:

- plugin is structurally valid
- plugin is approved
- current task/chat provider combination does not satisfy its required capabilities

That gives `/plugin` a concrete explanation path instead of collapsing provider mismatch into generic activation failure.

#### Plugin Tool Contract

Plugin tools must be provider/user-bound factories:

```typescript
export interface RegisteredPluginTool {
  build(args: { userId: string; taskProvider: TaskProvider; store: PluginStore }): ToolSet[string]
}
```

This resolves the mismatch between:

1. the design, which says task provider access is resolved per user at tool assembly time
2. the implementation plan, which currently stores raw tools at activation time

### 6. Provider Notes

#### Telegram

In this design, Telegram becomes the first fully declared chat-capability provider:

- `commands.menu`
- `interactions.callbacks`
- `messages.buttons`
- `messages.files`
- `messages.redact`
- `messages.reply-context`
- `files.receive`

`users.resolve` is intentionally **not** advertised.

#### Mattermost

Mattermost should advertise only what is truly end-to-end supported in this phase:

- `messages.files`
- `messages.redact`
- `messages.reply-context`
- `files.receive`
- `users.resolve`

It should **not** advertise button/interactions support until a real callback receiver exists.

#### Discord MVP

This design leaves space for Discord as a subset-capability provider with this intended MVP shape:

- `interactions.callbacks`
- `messages.buttons`
- `messages.redact`
- `messages.reply-context`
- not `messages.files` in MVP
- not `users.resolve` unless it can be implemented honestly
- `traits.observedGroupMessages = 'mentions_only'`

### 7. Rollout Plan

#### Phase 1 — Shared Provider Metadata

- add `TaskCapability`
- add `ChatCapability`
- add `ChatProviderTraits`
- add chat provider config requirements
- migrate startup off duck typing

#### Phase 2 — Provider-Agnostic Interactions

- add `IncomingInteraction`
- add `onInteraction?`
- add shared interaction router
- move Telegram callback routing to shared path

#### Phase 3 — First Consumer Refactors

- `/config`
- wizard
- `/context`
- `/group`

All capability-gated, with warning or text-first behavior where appropriate.

#### Phase 4 — Plugin / Provider Compatibility

- extend manifests with required capabilities
- add `incompatible` plugin state
- convert plugin tools to provider/user-bound factories

#### Deferred Future Phase — Provider-as-Plugin

This design does **not** define provider plugins as an implementation phase. It only preserves a clean future path for:

- task-provider plugin contracts
- chat-provider plugin contracts

Later-phase migration notes:

1. Provider plugins should use **dedicated contracts**, not the ordinary plugin interface used for tools/jobs/prompt fragments.
2. Task-provider plugins will need to participate in provider selection, config requirement declaration, URL helpers, prompt addenda, and capability publication before they can replace built-in providers.
3. Chat-provider plugins will need to participate in startup validation, message ingress, shared interaction routing, proactive delivery, and capability publication before they can replace built-in providers.
4. Built-in Telegram, Mattermost, Kaneo, and YouTrack implementations should remain first-class until a provider plugin path can match their lifecycle and operational requirements end to end.
5. Full provider-as-plugin migration should happen **after** the metadata, interaction, consumer refactor, and plugin compatibility phases are stable, so the migration builds on proven abstractions instead of redefining them mid-flight.

## Implementation Changes

Primary file groups affected:

| Area                    | Files                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task capability rename  | `src/providers/types.ts`, task provider constants, tool gating imports                                                                                                                            |
| Chat metadata           | `src/chat/types.ts`, `src/chat/telegram/index.ts`, `src/chat/mattermost/index.ts`, and a future Discord provider when that work begins                                                            |
| Interaction routing     | `src/bot.ts`, new shared interaction router module, Telegram callback integration, and a deferred Mattermost webhook entry                                                                        |
| Consumer refactors      | `src/commands/config.ts`, `src/commands/context.ts`, `src/commands/group.ts`, `src/commands/setup.ts`, `src/wizard/types.ts`, `src/wizard/engine.ts`, `src/wizard-integration.ts`, `src/index.ts` |
| Plugin design alignment | `docs/plans/2026-03-30-plugin-system-design.md`, `docs/plans/2026-03-30-plugin-system-implementation.md`                                                                                          |

## Follow-Up Work (Not in This Design)

1. Thread capability consolidation or coexistence model
2. Mattermost interactive action receiver
3. External file delivery for unsupported chat providers
4. Provider-as-plugin contracts and loader lifecycle
