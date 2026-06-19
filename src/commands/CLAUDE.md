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
- Current core command surface: `/help`, `/start`, `/config`, `/context`, `/clear`, `/dashboard`, `/stop`. Active plugins also register `plugin_<sanitized-plugin-id>_<command-name>` commands at startup via `registerPluginCommands`.
- `/config` is launcher-only. In DM it issues a single-use settings link (outcome: `ok` / `rate_limited` / `not_configured`). In group contexts it sends one of two messages: a DM redirect for group admins, or an access-denied explanation for non-admins. `SETTINGS_PUBLIC_BASE_URL` must be set; when it is not, `/config` replies asking the admin to configure that variable. All configuration (personal, group, admin, plugins, identity, instances, system LLM, announce) happens in the settings web UI.
- `/context` builds a tokenized `ContextSnapshot` and sends a platform-native view through `chat.renderContext()`.
- `/clear` clears conversation history, summary, and facts for the current storage context. The bot admin can also clear another user or all users; non-bot group admins are limited to clearing the current group context.
- `/dashboard` is DM-only and bot-admin-only; it issues a sign-in link to the operator debug/admin UI when `DEBUG_SERVER=true`. The link origin prefers `DASHBOARD_BASE_URL`, then `SETTINGS_PUBLIC_BASE_URL`, then the internal `http://{DEBUG_HOSTNAME}:{DEBUG_PORT}` default.
- `/stop` halts or steers the running agent turn (the deterministic rungs of the mid-run stop ladder). It looks up the active run via `runRegistry.get(auth.storageContextId)`: no active run → "Nothing is running right now."; first `/stop` → sets `stopRequested` (graceful halt after the current tool step) and acks "winding down…"; a second `/stop` while still stopping → `abortController.abort()` (force-abort) and acks "Stopping immediately…". Any authorized member may `/stop` a group thread's run. Because commands bypass the queue, `/stop` reaches a running turn on every platform (no buttons involved). See the run-control entry in the top-level `CLAUDE.md`.
- The retired commands `/setup`, `/group`, `/groups`, `/user`, `/users`, `/announce`, and `/plugin` no longer exist. Their functionality (group management, plugin approval/enable/disable, identity, instance management, announcements) is now handled in the settings web UI.

## No Interception Flow

There is no message interception for **new** turns. Non-command text goes straight to the LLM orchestrator queue — **except** that, when a run is already active for the context, a qualifying message (DM, or group `@mention`/reply-to-bot) is routed into that run's steer queue (mid-run steering, handled in `handleMessage` via `runRegistry.get`) instead of starting a new turn. Interactive chat callbacks (`gsel:`, `cfg:`, `wizard_`, `plg:`, `tgl:`) are retired; `src/chat/interaction-router.ts` only authorizes the actor and otherwise matches nothing.

## Types

- `CommandHandler`: `(msg: IncomingMessage, reply: ReplyFn, auth: AuthorizationResult) => Promise<void>`
- `IncomingMessage`: includes `contextId`, `contextType`, `platformInstanceId`, optional `threadId`, optional `replyContext`, and optional incoming `files`
- `AuthorizationResult`: includes `allowed`, `isBotAdmin`, `isGroupAdmin`, `storageContextId`, and optional `configContextId`
- `ReplyFn`: always includes `text`, `formatted`, `typing`, and `buttons`; other reply methods are optional by platform
