# Chat Adapter Conventions

## Interface

All adapters implement `ChatProvider` from `src/chat/types.ts`.

```typescript
interface ChatProvider {
  readonly name: string
  readonly threadCapabilities: ThreadCapabilities
  readonly capabilities: ReadonlySet<ChatCapability>
  readonly traits: ChatProviderTraits
  readonly configRequirements: readonly ChatProviderConfigRequirement[]

  registerCommand(name: string, handler: CommandHandler): void
  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void
  sendMessage(
    platformInstanceId: string,
    target: DeferredDeliveryTarget,
    markdown: string,
  ): Promise<boolean> | Promise<void>
  renderContext(snapshot: ContextSnapshot): ContextRendered
  start(): Promise<void>
  stop(): Promise<void>
  onInteraction?: (handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) => void
  resolveUserId?(username: string, context: ResolveUserContext): Promise<string | null>
  resolveUserLabel?(userId: string, context: ResolveUserContext | undefined): Promise<string | null>
  resolveGroupLabel?(groupId: string): Promise<string | null>
  isGroupAdmin?(platformInstanceId: string, groupId: string, userId: string): Promise<boolean | null>
  renderContextForInstance?(platformInstanceId: string, snapshot: ContextSnapshot): ContextRendered
  isInstanceActive?(platformInstanceId: string): boolean
  setCommands?(adminUserId: string): Promise<void>
}
```

`ReplyFn` is the only outbound surface command handlers and bot wiring should use. It always provides `text`, `formatted`, `typing`, and `buttons`, and may also provide `file`, `redactMessage`, `embed`, and `createStatus` depending on platform capabilities.

`createStatus(initialText)` posts an **ephemeral live-status message** and returns a `StatusHandle` (`update(text)`/`dismiss()`) — used by `src/live-status/` to show the currently executing task alongside `Typing…`, then delete it when the real reply posts. It is implemented on Telegram/Discord/Mattermost (edit + delete) and intentionally **absent on Kontur Talk** (no edit/delete API). All three methods are best-effort and never throw; `createStatus` resolves `undefined` when the platform can't create one or the send fails.

`IncomingMessage` and `IncomingInteraction` always carry `platformInstanceId`. Router-aware code must preserve that ID when resolving source-provider behavior, group settings, staged attachments, proactive delivery, and callback targets.

## Registration

Adapters register in `src/chat/registry.ts` via `createChatProviderFromConfig(id, type, config)`. Built-in adapters are `telegram`, `mattermost`, `discord`, and `kontur-talk`. Runtime startup wraps active adapter instances in `src/chat/router.ts` (`ChatRouter`), which fans out commands, starts/stops instances, tags incoming events with `platformInstanceId`, and routes proactive sends back to the target instance.

## Rules

- Keep platform-specific code inside the adapter directory and its helper modules.
- Adapters map platform events into `IncomingMessage` or `IncomingInteraction` and construct a `ReplyFn`; they do not implement provider logic, tool logic, or business rules.
- Prefer metadata-driven behavior. `capabilities`, `traits`, `threadCapabilities`, and `configRequirements` are the contract that command/startup code should feature-detect instead of hard-coding provider names.
- Treat optional reply surfaces as capability-dependent. `reply.file`, `reply.redactMessage`, `reply.embed`, `reply.ephemeralConfirm`, and `reply.createStatus` are not guaranteed on every platform. `reply.buttons` returns a `PromptHandle` (`redact`/`remove`) for the just-sent message where the adapter can target it (else `undefined`); `reply.createStatus` returns a `StatusHandle` (`update`/`dismiss`) or `undefined`.
- Do not treat `chat.name === 'router'` as the source provider. Use `platformInstanceId` plus helpers from `src/chat/source-instance.ts` when source-specific behavior matters.
- Group behavior differs by provider. Telegram, Mattermost, and Kontur Talk observe group messages directly; Discord observes DMs plus `@bot` mentions in guild channels. Both **Telegram and Discord** also treat a user's reply to one of the **bot's own messages** in a group as equivalent to an `@mention` (processed without an explicit mention); Mattermost and Kontur Talk are unaffected by this path.
- Thread handling is provider-specific. Telegram uses forum/message thread IDs, Mattermost uses root post IDs, Kontur Talk uses message-thread scope, and Discord currently reports no separate thread-scoped support.
- Context rendering is adapter-owned. `/context` builds a `ContextSnapshot`, then each adapter decides whether to return plain text, formatted markdown, or an embed through `renderContext()`.
- Button callbacks are part of the chat layer. Route interactive callbacks through `src/chat/interaction-router.ts` before normal message handling. Note: all config-flow callback routes (`gsel:`, `cfg:`, `wizard_`, `plg:`, `tgl:`) were retired with the move to the settings web UI. The router authorizes the actor and now handles exactly one prefix — `perm:a:`/`perm:d:`, the allow/deny decision for an `ask`-gated tool prompt; everything else is a safe-sink no-op.
- Permission prompts are self-removing. An `ask`-gated tool posts a prompt via `reply.buttons` and stores its `PromptHandle`. On decision, `interaction-router` deletes the prompt (`handle.remove`) and confirms via `reply.ephemeralConfirm` (a non-persistent toast) on `messages.ephemeral` platforms (Telegram callback toast / Discord ephemeral follow-up / Mattermost `ephemeral_text`); platforms lacking it fall back to editing the prompt in place. On timeout the prompt is redacted to "Expired — denied." Kontur Talk has no buttons/callbacks, so its prompts time out and use the edit/text fallback.
- Keep formatting and chunking helpers next to the adapter that needs them, such as Telegram markdown/entity conversion or Discord chunk splitting.
- `isGroupAdmin?` is an optional live platform lookup (Telegram `getChatMember`, Discord member permissions, Mattermost channel roles) returning `true`/`false`, or `null` when the platform can't determine it (unsupported, e.g. Kontur Talk, or the call failed). It backs the cold-DM `/config` fallback (`src/chat/group-admin-live.ts`): a DM user with no local group-admin observation is still allowed to launch settings if the platform confirms they administer an authorized group. Verdicts are cached per (instance, user) for a short window.
