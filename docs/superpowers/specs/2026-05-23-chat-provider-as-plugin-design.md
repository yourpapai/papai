<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Chat-Provider-as-Plugin Design

**Date:** 2026-05-23
**Status:** Draft
**Related:** [`2026-03-30-plugin-system-design.md`](./2026-03-30-plugin-system-design.md) (original Phase 3 "Optional Provider Migration"), [`2026-04-13-multi-provider-phase-3-chat-router.md`](./2026-04-13-multi-provider-phase-3-chat-router.md) (ChatRouter), [`2026-05-23-task-provider-as-plugin-design.md`](./2026-05-23-task-provider-as-plugin-design.md) (sibling spec — shared contribution shape), [`2026-05-23-3rd-party-provider-trust-tier-research.md`](./2026-05-23-3rd-party-provider-trust-tier-research.md) (future trust tier)

## Summary

Chat providers (`telegram`, `mattermost`, `discord`) are currently hardcoded in `src/chat/registry.ts` and constructed by `createChatProvider(name, deps)`, then driven by the Phase 3 `ChatRouter`. This spec makes chat providers contributable through the existing plugin system, using the same contribution shape as the task-provider spec but with the extra lifecycle care that long-lived connections (Telegram polling, Mattermost websocket, Discord gateway) demand. The three built-in providers migrate into `plugins/` with a backward-compatible auto-approval seed.

Trust model is unchanged: chat-provider plugins remain trusted, first-party, in-repo code. The 3rd-party trust tier is a separate research document and is out of scope here.

## Goals

- Let a new chat platform (e.g. Slack, WhatsApp) ship as a `plugins/<id>/` package without editing core registries or `bot.ts`.
- Reuse the plugin machinery: discovery, admin approval, capability metadata, and the `/plugin` command.
- Integrate cleanly with the Phase 3 `ChatRouter` — plugins contribute **types**; admins create **instances** (`platform_instances` rows) of those types.
- Migrate Telegram, Mattermost, and Discord into plugins so there is exactly one registration path.

## Non-Goals

- 3rd-party / externally-authored chat-provider plugins, sandboxing, signing — see the trust-tier research doc (which argues chat providers are the _harder_ case and should come after task providers).
- Multi-chat-platform in a single conversation context — the `ChatRouter` (a prerequisite, see Dependencies) does not support it; not a regression to leave it.
- Hot-reloading a chat provider without bot restart — approval-state changes take effect on next startup, identical to the existing plugin system.

## Dependencies & Prerequisite Status

> **Important — read before scheduling this work.** This spec assumes the Multi-Provider Router is implemented. As of this writing it is **in active development** on branch `claude/multi-provider-phase-1-plan-8kqwN`, not yet merged to `master`. Verified against `master` on 2026-05-24:
>
> - No `platform_instances` / `task_instances` / `context_settings` tables (Phase 1 not implemented).
> - No `ChatRouter` in `src/chat/` (Phase 3 not implemented). The live model constructs exactly one chat provider via `createChatProvider(name)` in `src/chat/registry.ts`, selected by the `CHAT_PROVIDER` env var, and drives it directly from `src/index.ts` / `bot.ts`.
> - No capability-aware plugin eligibility (Phase 5 not implemented; its spec is moved to `docs/archive/`).
>
> **This spec depends on Multi-Provider Router Phases 1 and 3 landing first** (instance tables + the `ChatRouter`). Every reference to "the Phase 3 `ChatRouter`", "`platform_instances` rows", or the encrypted `platform_instances.config` is a reference to those prerequisite phases, not to current code. The router is being built now (branch above), so this spec should be scheduled to follow those phases. The startup-reorder in Section 2 is described relative to a `src/index.ts` that already constructs a `ChatRouter`.
>
> **Identity (Section 4) is sequenced separately.** The chat side is the platform-proven half of the hub-and-spoke identity model in the task spec (Section 6); the hub migration lands with/after the router. This migration ships against the `ctx.platformIdentity` facade from day one, backed by the current per-platform tables until then.

## Section 1: Manifest & Contribution Model

Same shape as the task-provider spec; the contribution slot is `chatProviderTypes`, the permission is `provider.chat`, and capabilities/traits/thread-capabilities come from the chat enums.

```jsonc
{
  "id": "chat-provider-telegram",
  "name": "Telegram Chat Provider",
  "version": "1.0.0",
  "description": "Telegram chat platform integration.",
  "apiVersion": 1,
  "permissions": ["provider.chat"],
  "contributes": {
    "chatProviderTypes": ["telegram"], // exactly one type per plugin
  },
  "chatProviderCapabilities": [
    // ChatCapability[]
    "commands.menu",
    "interactions.callbacks",
    "messages.buttons",
    "messages.files",
    "messages.reply-context",
    "files.receive",
    "users.resolve",
  ],
  "chatProviderTraits": {
    "observedGroupMessages": "all",
    "maxMessageLength": 4096,
    "callbackDataMaxLength": 64,
  },
  "chatProviderThreadCapabilities": {
    "supportsThreads": true,
    "canCreateThreads": true,
    "threadScope": "message",
  },
  "providerConfigSchema": [{ "key": "botToken", "label": "Telegram Bot Token", "required": true, "sensitive": true }],
  "providerAllowedHosts": ["api.telegram.org"],
}
```

Rules:

- **Exactly one provider type per plugin** (`contributes.chatProviderTypes.length === 1`).
- `chatProviderCapabilities`, `chatProviderTraits`, `chatProviderThreadCapabilities`, `providerConfigSchema`, `providerAllowedHosts` are **static** (manifest-declared). The `ChatRouter` and admin UI need them _before_ constructing an instance (e.g. to list available platform types when creating a `platform_instances` row).
- `provider.chat` required; declaring `chatProviderTypes` without it rejects the manifest.
- A chat-provider plugin **may also** contribute tools/prompt-fragments/commands/jobs via the existing slots.

### Why traits/thread-capabilities move to the manifest

Built-in providers declare `capabilities`, `traits`, and `threadCapabilities` as effectively static per-instance objects today. Relocating them to the manifest is a pure move; the runtime instance still exposes the same fields during the migration window for backward-compat.

### Registration API

```typescript
type ChatProviderFactory = (instanceConfig: Record<string, string>) => ChatProvider

export type PluginRegistration = {
  // ... existing register* methods ...
  registerChatProviderType(type: string, descriptor: { factory: ChatProviderFactory }): void
}
```

Throws if the plugin lacks `provider.chat`, if `type` is not the single declared value, or if another active plugin already registered the type (first-wins; duplicate logged and skipped).

## Section 2: Long-Lived Lifecycle Integration

The big difference from task providers: chat providers hold long-lived connections. `start()`/`stop()` are heavy, and `ChatRouter` (Phase 3) owns the constructor-to-running-bot lifecycle.

### Activation contract

- `activate(ctx)` only **registers the factory**. It does **not** call `start()`.
- `start()` is invoked by `ChatRouter` per `platform_instances` row, exactly as for built-ins today.
- `stop()` is invoked by `ChatRouter` at graceful shutdown, or when an admin marks a `platform_instances` row inactive.

### Per-instance lifecycle

```text
admin creates platform_instances row (type 'telegram')
  -> ChatRouter.addInstance(id, type, config)
  -> createChatProvider(type, { instanceConfig: config })
       -> registry consults plugin-contributed factory map
       -> plugin factory returns a ChatProvider instance
  -> ChatRouter calls instance.start()  (opens polling / WS / gateway)
  -> IncomingMessage events flow through the router

admin marks platform_instances row inactive
  -> ChatRouter.removeInstance(id) -> instance.stop() -> connection cleanup

plugin deactivated (manifest hash change -> unapproved, or rejected)
  -> for each platform_instances row of this plugin's type:
       ChatRouter.removeInstance(id)  (calls instance.stop())
  -> factory removed from registry
  -> router logs WARN "platform instance unresolvable: plugin not active"
  -> messages for that platform are not received until the plugin is reapproved
```

### Startup ordering (the non-trivial change)

Phase 3's `ChatRouter` is constructed early in `src/index.ts`. Plugin factories must be registered before that. New order:

1. DB init.
2. **Plugin discovery + activation** — _moved earlier than today_; factories registered, scheduler jobs pending (not started).
3. `ChatRouter` construction; iterate active `platform_instances`, `createChatProvider` per row, `start()` per instance.
4. `scheduler.start()`.
5. Bot wiring (`bot.ts`, `llm-orchestrator`, debug server).

The reorder must preserve the existing dependency that plugin activation may register scheduler jobs: jobs are registered during activation (step 2) but only started in step 4, matching current behavior.

### Shutdown failure handling

If a plugin's `stop()` throws or exceeds a 10s timeout, `ChatRouter` logs the failure and proceeds with shutdown — the same bounded-timeout discipline as plugin activation's existing `activationTimeoutMs`.

## Section 3: Plugin Context for Chat Providers

Additions to `PluginContext`, gated by `provider.chat`:

```typescript
readonly chatProviderRuntime?: {
  /** Safe-fetch surface; host allowlist enforced from manifest providerAllowedHosts. No raw fetch. */
  readonly httpFetch: (url: string, init?: RequestInit) => Promise<Response>
  readonly allowedHosts: ReadonlySet<string>
  readonly logger: PluginLogger
}
```

What is **not** provided (deliberate):

- **No runtime access point for `IncomingMessage` / `ReplyFn` / `IncomingInteraction`** — these are stable interface _types_ imported from the `papai/plugin-types` alias (shared with the task spec), not capabilities handed through the context.
- **No raw bot wiring** — the plugin returns a `ChatProvider`; `bot.ts` consumes it through `ChatRouter`. The plugin never calls `bot.ts`.
- **No raw env access, no raw DB** — same as the task spec.

### Per-instance state via `ctx.kv`

Discord identity caches, Mattermost user-resolution caches, Telegram thread state — all through `ctx.kv` with the `storage` permission, scoped `(plugin_id, '__system__:instance:<platform-instance-id>', key)`.

### WebSocket / gateway connections

The plugin uses standard Bun/Node APIs and the existing platform SDKs (Grammy, `discord.js`, the Mattermost REST/WS client) directly inside the `ChatProvider` it returns. `providerAllowedHosts` covers HTTP egress; for WebSocket the host check is applied at connection-open. Because the plugin is trusted (first-party), there is no sandbox.

### File downloads

When a platform delivers a file, the plugin's adapter fetches it via its own client (e.g. Telegram `getFile` → download URL) and populates `IncomingMessage.files`. The core `attachments/` workspace persists the buffer through the existing path; the plugin never writes to S3 directly, so no new permission is needed.

## Section 4: Interaction Routing & Command Registration

`ChatProvider` methods cross the plugin boundary in both directions (`registerCommand`, `onMessage`, `onInteraction`). Today core code calls these on the provider instance; after migration the same calls go through `ChatRouter` to the plugin-contributed instance. No interface change.

### Stays in core

- `src/chat/interaction-router.ts` (+ `-replies`, `-support`) — owns callback-data prefix routing (`cfg:`, `grp:`, `wiz:`, `plg:`). The plugin instance only fires `IncomingInteraction` events; the router decides what to do.
- `src/chat/registry.ts` — merged registry (built-in map + plugin-contributed map), same shape as the task spec.
- `src/chat/types.ts`, `capabilities.ts`, `context-types.ts` — interface, capability strings, traits — unchanged.
- `src/chat/startup.ts` — command-menu registration (`setCommands?`) invoked by core on each instance.
- `src/chat/config-editor-integration.ts`, `group-display-resolution.ts`, `group-settings-target.ts`, `plugin-interaction-handler.ts`, `deferred-target.ts` — unchanged.

### Moves into the plugin directory

- Platform transport: Grammy init, Mattermost REST/WS client, Discord gateway client.
- Platform message → `IncomingMessage` mapping.
- Platform `ReplyFn` construction (including `reply.file`, `reply.redactMessage`, `reply.embed` where supported).
- Platform `renderContext()` implementation.
- Provider-local helpers: Telegram markdown/entity conversion, Discord chunk splitting, Mattermost root-post lookup.

### Platform identity mapping (decision: keep identity in core, behind a facade)

Discord (`src/chat/discord/identity.ts`) and Mattermost user resolution persist to their own tables, also read by the `set_my_identity` tool and `users.ts`. Moving them per-plugin would break cross-provider reads and put a security-sensitive surface inside untrusted-tier code later. Identity stays in core, exposed only through a facade gated by a new `chat.identity` permission. The **storage shape is invisible to plugin code** and evolves without plugin changes. Kept separate from the task-side `identity` permission for clarity.

The chat side is the _platform-proven_ half of the hub-and-spoke identity model described in the task spec (Section 6): the chat platform already authenticates the inbound user, so a chat spoke is verified by construction. The hub joins these chat spokes to provider spokes; proof-of-ownership lives on the provider side. A chat provider only needs to record/resolve its platform mapping — it does not run the proof challenge.

```typescript
// PluginContext, gated by permission 'chat.identity'
readonly platformIdentity?: {
  recordMapping(platformInstanceId: string, platformUserId: string, chatUserId: string): void
  resolveChatUser(platformInstanceId: string, platformUserId: string): string | null
}
```

**Sequencing.** Like the task-side identity work, the hub migration that links chat spokes to a canonical person node is its own phase, landing with/after the multi-provider router (`claude/multi-provider-phase-1-plan-8kqwN`). The chat-provider migration ships against the facade above from day one; until the hub lands, the facade is backed by the existing per-platform tables. No plugin code changes when the backing store is upgraded.

### Command registration ordering

`chat/startup.ts` calls `provider.registerCommand` for each core command before `start()`. `ChatRouter` proxies these to all instances, including plugin-contributed ones, during the same pre-start phase. No new mechanism.

### Per-context plugin commands

Phases 3/5 already route plugin-contributed `/foo` commands via `ChatRouter`. A plugin-contributed chat _provider_ does not need to know whether the plugin also contributes commands. No change.

## Section 5: Migrating Telegram, Mattermost, Discord

### Layout after migration

```text
plugins/
  chat-provider-telegram/
    plugin.json
    index.ts            # activate() registers factory; BOOTSTRAP_ENV_MAP export
    provider.ts         # former src/chat/telegram/index.ts
    grammy-bot.ts
    markdown.ts         # entity/markdown helpers
    context-render.ts
    tests/
  chat-provider-mattermost/
    plugin.json
    index.ts
    provider.ts         # former src/chat/mattermost/index.ts
    rest-client.ts
    ws-client.ts
    context-render.ts
    identity.ts         # uses ctx.platformIdentity
    tests/
  chat-provider-discord/
    plugin.json
    index.ts
    provider.ts         # former src/chat/discord/index.ts
    gateway.ts
    chunk-splitter.ts
    embed.ts
    context-render.ts
    identity.ts         # uses ctx.platformIdentity
    tests/

src/chat/
  types.ts capabilities.ts context-types.ts                 # KEEP
  registry.ts                                                # MODIFIED — merge built-in + plugin factories; listChatProviderTypes()
  startup.ts interaction-router.ts interaction-router-replies.ts
  interaction-router-support.ts config-editor-integration.ts
  group-display-resolution.ts group-settings-target.ts
  plugin-interaction-handler.ts deferred-target.ts           # KEEP
  # telegram/, mattermost/, discord/ directories removed
```

### Backward compatibility

- **Auto-approval seed:** `seedBuiltinChatProviderPlugins()` mirrors the task-spec seed — auto-approves the three plugins on first run with the `__migration__` marker, idempotent thereafter.
- **`defaultEnabled: true`** keeps existing `platform_instances` rows working.

### Env-var bootstrap mapping (`BOOTSTRAP_ENV_MAP` per plugin)

- `chat-provider-telegram`: `{ TELEGRAM_BOT_TOKEN: 'botToken' }`
- `chat-provider-mattermost`: `{ MATTERMOST_URL: 'baseUrl', MATTERMOST_BOT_TOKEN: 'botToken' }`
- `chat-provider-discord`: `{ DISCORD_BOT_TOKEN: 'botToken' }`

Existing deployments with these env vars set get auto-seeded into a `platform_instances` row by Phase 1's `bootstrap()` — no admin action required.

### `CHAT_PROVIDER` env var

Becomes a **seed hint only**: it tells `bootstrap()` which plugin's `BOOTSTRAP_ENV_MAP` to read for the first instance. After bootstrap, all routing decisions go through `platform_instances` and `ChatRouter`.

### Test relocation

`tests/chat/{telegram,mattermost,discord}/**` move into the matching `plugins/<id>/tests/`. The `bun test` glob in `package.json` is extended to include `plugins/**/tests/**/*.test.ts`.

## Section 6: Testing & Rollout

### Testing

| Test file                                                  | Covers                                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `tests/plugins/chat-provider-registration.test.ts`         | `registerChatProviderType` validates declaration, requires `provider.chat`, rejects duplicates                                  |
| `tests/plugins/chat-provider-registry-merge.test.ts`       | `createChatProvider` resolves built-in + plugin-contributed types                                                               |
| `tests/plugins/chat-provider-router-integration.test.ts`   | `ChatRouter` calls `start()`/`stop()` on plugin instances; failed `stop()` past timeout logged, not blocking                    |
| `tests/plugins/chat-provider-startup-order.test.ts`        | Activation precedes `ChatRouter` construction; activation failure prevents the matching `platform_instances` rows being started |
| `tests/plugins/chat-provider-platform-identity.test.ts`    | `ctx.platformIdentity` gated by `chat.identity`; cross-provider lookups via core work post-migration                            |
| `tests/integration/chat-provider-plugin-migration.test.ts` | Existing `platform_instances` rows resolve post-seed; `seedBuiltinChatProviderPlugins` idempotent                               |
| Test moves                                                 | `tests/chat/{telegram,mattermost,discord}/**` relocated into plugin dirs                                                        |

### Rollout (one PR per phase; E2E suite runs after each)

1. API extensions: `provider.chat` permission, `chatProviderTypes` contribution, `chatProviderCapabilities`/`chatProviderTraits`/`chatProviderThreadCapabilities`/`providerConfigSchema`/`providerAllowedHosts` manifest fields, `registerChatProviderType`, `ctx.chatProviderRuntime`, `ctx.platformIdentity` facade. No callers.
2. Startup reorder: plugin discovery + activation before `ChatRouter` construction in `src/index.ts`; test harness updated.
3. Registry merge: `createChatProvider` consults the plugin-contributed map; `listChatProviderTypes()`.
4. Telegram migration: `plugins/chat-provider-telegram/` created with manifest + entry + tests moved; built-in factory removed; `seedBuiltinChatProviderPlugins` added.
5. Mattermost migration: same; identity behind `ctx.platformIdentity`.
6. Discord migration: same; identity behind `ctx.platformIdentity`.
7. Cleanup: delete `src/chat/{telegram,mattermost,discord}/`; extend `bun test` glob to `plugins/**/tests/`.

## Section 7: Risks & Mitigations

- **Startup reorder regressions** (the highest-risk change): cover with `chat-provider-startup-order.test.ts`; keep scheduler-job _start_ in its current position (step 4) so only registration moves.
- **`stop()` hangs on shutdown:** bounded 10s timeout, logged and skipped — bot shutdown never blocks on a misbehaving plugin.
- **Unresolvable platform instances after deactivation:** `ChatRouter` logs and stops receiving for that platform; admin UI labels the row "unresolvable: plugin not active".
- **Hidden `process.env` reads in migrated adapter code:** audited during phases 4–6; `ctx.chatProviderRuntime` exposes no env, so missed reads fail in tests.
- **WebSocket egress not covered by HTTP allowlist:** apply the host check at connection-open inside the safe-fetch helper's companion WS guard; document that first-party trust is the backstop until the 3rd-party tier exists.
