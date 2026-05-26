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
  renderContextForInstance?(platformInstanceId: string, snapshot: ContextSnapshot): ContextRendered
  isInstanceActive?(platformInstanceId: string): boolean
  setCommands?(adminUserId: string): Promise<void>
}
```

`ReplyFn` is the only outbound surface command handlers and bot wiring should use. It always provides `text`, `formatted`, `typing`, and `buttons`, and may also provide `file`, `redactMessage`, and `embed` depending on platform capabilities.

`IncomingMessage` and `IncomingInteraction` always carry `platformInstanceId`. Router-aware code must preserve that ID when resolving source-provider behavior, group settings, staged attachments, proactive delivery, and callback targets.

## Registration

Adapters register in `src/chat/registry.ts` via `createChatProvider(name)`. Built-in adapters are `telegram`, `mattermost`, and `discord`. Runtime startup wraps active adapter instances in `src/chat/router.ts` (`ChatRouter`), which fans out commands, starts/stops instances, tags incoming events with `platformInstanceId`, and routes proactive sends back to the target instance.

## Rules

- Keep platform-specific code inside the adapter directory and its helper modules.
- Adapters map platform events into `IncomingMessage` or `IncomingInteraction` and construct a `ReplyFn`; they do not implement provider logic, tool logic, or business rules.
- Prefer metadata-driven behavior. `capabilities`, `traits`, `threadCapabilities`, and `configRequirements` are the contract that command/startup code should feature-detect instead of hard-coding provider names.
- Treat optional reply surfaces as capability-dependent. `reply.file`, `reply.redactMessage`, and `reply.embed` are not guaranteed on every platform.
- Do not treat `chat.name === 'router'` as the source provider. Use `platformInstanceId` plus helpers from `src/chat/source-instance.ts` when source-specific behavior matters.
- Group behavior differs by provider. Telegram and Mattermost observe group messages directly; Discord observes DMs plus `@bot` mentions in guild channels.
- Thread handling is provider-specific. Telegram uses forum/message thread IDs, Mattermost uses root post IDs, and Discord currently reports no separate thread-scoped support.
- Context rendering is adapter-owned. `/context` builds a `ContextSnapshot`, then each adapter decides whether to return plain text, formatted markdown, or an embed through `renderContext()`.
- Button callbacks are part of the chat layer. Route interactive callbacks through `src/chat/interaction-router.ts` or adapter-specific fallback helpers before normal message handling.
- Keep formatting and chunking helpers next to the adapter that needs them, such as Telegram markdown/entity conversion or Discord chunk splitting.
