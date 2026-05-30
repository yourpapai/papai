# Command Handler Conventions

## Pattern

Commands are platform-agnostic handlers registered via `ChatProvider.registerCommand()`:

```typescript
export function registerXCommand(chat: Readonly<ChatProvider>): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) return
    await reply.text('Response')
  }

  chat.registerCommand('commandname', handler)
}
```

## Rules

- Check `auth.allowed` before doing work unless the command is intentionally responsible for its own rejection message.
- Do not import Telegram, Mattermost, Discord, or Kontur Talk modules into command handlers. Chat-specific behavior must be expressed through `ChatProvider` capabilities or `ReplyFn`.
- Use injected reply helpers only: `reply.text()`, `reply.formatted()`, `reply.buttons()`, `reply.file?.()`, `reply.embed?.()`, `reply.redactMessage?.()`.
- Feature-detect platform affordances. Use helpers from `src/chat/capabilities.ts` and source-instance helpers instead of branching on `chat.name`; at runtime `chat` may be the `ChatRouter`, not the source adapter.
- Group-specific behavior belongs behind `msg.contextType` and the appropriate admin gate for that flow, usually `auth.isGroupAdmin`.
- Admin-only commands must stay DM-only unless there is an explicit group-safe flow.

## Current Command Behavior

- Commands are registered in `src/bot.ts` via `setupBot(chat, adminUserId)`.
- Current command surface is `/help`, `/start`, `/setup`, `/config`, `/context`, `/clear`, `/group`, plus admin-only `/user`, `/users`, `/announce`, and `/plugin`.
- `/setup` and `/config` are DM-driven. In groups they redirect admins to DM, then the user chooses personal settings or a manageable group through the group-settings selector.
- `/context` is no longer an admin-only export command. It builds a tokenized `ContextSnapshot` and sends a platform-native view through `chat.renderContext()`.
- `/clear` clears conversation history, summary, and facts for the current storage context. The bot admin can also clear another user or all users; non-bot group admins are limited to clearing the current group context.
- `/group` is the group authorization command surface and must route username lookup through `extractGroupUserId()` / source-instance resolution before assuming `@username` lookup works.
- `/plugin` is DM-only and bot-admin-only. Subcommands: `list`, `info <id>`, `approve <id>`, `reject <id>`, `enable <id> [context-id]`, `disable <id> [context-id]`. Approve/reject take effect on next startup; enable/disable take effect on the next tool/prompt assembly. Per-context plugin enable toggles are also surfaced as `plg:` inline buttons inside `/config`.
- `/config` includes a "🧰 Tools" section. Tapping it opens a domain list; users toggle whole domains (`tgl:dom:`) or drill in (`tgl:open:`) to toggle individual tools (`tgl:tool:`) with risk labels. Callbacks are routed in `src/chat/interaction-router.ts` to `handleToolToggleInteraction`. Personal-vs-group targeting reuses the group-settings selector, identical to plugin toggles.

## Interception Flow

Bot wiring in `src/bot.ts` may intercept non-command messages before they reach the LLM queue:

- group-settings selector responses in DM
- config-editor text input
- wizard/setup input
- auto-started setup wizard prompts

Interactive callbacks are routed separately through `src/chat/interaction-router.ts`.

## Types

- `CommandHandler`: `(msg: IncomingMessage, reply: ReplyFn, auth: AuthorizationResult) => Promise<void>`
- `IncomingMessage`: includes `contextId`, `contextType`, `platformInstanceId`, optional `threadId`, optional `replyContext`, and optional incoming `files`
- `AuthorizationResult`: includes `allowed`, `isBotAdmin`, `isGroupAdmin`, `storageContextId`, and optional `configContextId`
- `ReplyFn`: always includes `text`, `formatted`, `typing`, and `buttons`; other reply methods are optional by platform
