<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin Developer Guide

Papai plugins are trusted, repository-local extensions loaded from `plugins/<plugin-id>/`. The MVP is for first-party local plugins only: there is no sandbox, marketplace, npm package installation, hot reload, encrypted plugin secret store, raw provider access, raw DB access, or arbitrary process/env/network facade. The framework exposes a restricted plugin API surface, but this is not a sandbox guarantee because plugin code still runs in-process. Plugins may register one declared task-provider type through the trusted provider-task plugin API.

## Quick Start

1. Create `plugins/<plugin-id>/` where `<plugin-id>` is lower-case kebab-case.
2. Add `plugin.json`.
3. Add an entry point such as `index.ts` or `index.js`.
4. Start the bot. Discovery happens on startup.
5. The bot admin runs `/plugin approve <plugin-id>`.
6. Restart the bot so the approved plugin activates.
7. Enable it for a personal or managed group context with `/config`, `plg:` buttons, or `/plugin enable <plugin-id> [context-id]`.

## Manifest

```json
{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "description": "A short description shown in /plugin list.",
  "apiVersion": 1,
  "main": "index.ts",
  "contributes": {
    "tools": ["greet"],
    "promptFragments": ["hello-world-hint"],
    "commands": ["hello"],
    "jobs": ["daily_hello"],
    "configKeys": ["greeting_prefix"]
  },
  "permissions": ["storage", "commands", "scheduler"],
  "defaultEnabled": false,
  "requiredTaskCapabilities": [],
  "requiredChatCapabilities": [],
  "configRequirements": [
    {
      "key": "greeting_prefix",
      "label": "Greeting Prefix",
      "required": false,
      "sensitive": false
    }
  ],
  "activationTimeoutMs": 5000
}
```

Required fields: `id`, `name`, `version`, `description`, and `apiVersion`.

Supported optional fields:

| Field                                | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`                               | Entry point path for non-MCP-only plugins.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `contributes.tools`                  | Tool names the plugin may register with `ctx.registration.registerTool()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `contributes.promptFragments`        | Prompt fragment names the plugin may register with `ctx.registration.registerPromptFragment()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `contributes.commands`               | Command names the plugin may register with `ctx.registration.registerCommand()`. Requires `commands`. Runtime commands are exposed as `plugin_<plugin_id>_<command>`.                                                                                                                                                                                                                                                                                                                                                                          |
| `contributes.jobs`                   | Scheduled job names the plugin may register with `ctx.registration.registerScheduledJob()`. Requires `scheduler`. Runtime job owners are `plugin:<pluginId>:<jobName>`.                                                                                                                                                                                                                                                                                                                                                                        |
| `contributes.configKeys`             | Plugin-owned context config keys exposed in `/config`. Each key must have a matching context-scoped `configRequirements` entry.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `contributes.attachmentTransformers` | Attachment transformer names the plugin may register with `ctx.registration.registerAttachmentTransformer()`. Requires `attachments.read` permission.                                                                                                                                                                                                                                                                                                                                                                                          |
| `contributes.taskProviderTypes`      | At most one plugin-owned task provider type. Requires `provider.task`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `providerCapabilities`               | Task capabilities exposed by the contributed provider type.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `providerConfigSchema`               | Instance-scoped config fields for the contributed provider type.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `providerContextConfigSchema`        | Context-scoped credential/config fields for the contributed provider type.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `providerAllowedHosts`               | Static host allowlist used by `ctx.providerRuntime.httpFetch()`. Available to `http` plugins and contributed task-provider plugins.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `providerAllowedHostsFromConfig`     | List of **admin-scoped** config keys whose runtime values contribute their host to the HTTP allowlist at call time. Schema-validated: every referenced key must exist in `configRequirements` with `scope: 'admin'`. Hosts contributed this way bypass the public-IP restriction (useful for self-hosted endpoints on a LAN) because admin config is operator-trusted input at the same trust level as manifest approval. Static `providerAllowedHosts` entries keep the public-IP restriction. Requires `http` or `provider.task` permission. |
| `providerConfigValidator`            | Optional named export for validating contributed provider config before task-instance writes are persisted.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `mcp`                                | Optional plugin-owned MCP server config. Runtime support is `streamable-http`; `stdio` is schema-reserved.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `permissions`                        | Permission claims checked by framework facades.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `defaultEnabled`                     | Whether the plugin is selected by default for contexts that have no explicit opt-in/out row.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `requiredTaskCapabilities`           | Task provider capabilities required before activation and per-context eligibility.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `requiredChatCapabilities`           | Chat platform capabilities required before activation and per-context eligibility.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `configRequirements`                 | Context-specific config fields that gate tool/prompt/job eligibility when required.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `activationTimeoutMs`                | Activation timeout in milliseconds, between `100` and `10000`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

The manifest `id` must match the directory name. The entry point must stay inside the plugin directory and must be a relative `.ts` or `.js` path without `..` components.

Plugin entry graphs must use relative imports only. Static imports, deterministic literal dynamic imports, and plugin-local `import.meta.require(...)` calls must start with `./` or `../`; bare-module imports such as `import 'left-pad'`, `await import('left-pad')`, or `import.meta.require('left-pad')` are rejected during discovery when they appear in the discovered plugin-owned graph.

## Entry Contract

The entry point must default-export a factory function returning a plugin instance:

```typescript
type PluginContextLike = {
  log: {
    info(data: Record<string, unknown>, msg: string): void
  }
}

type PluginInstanceLike = {
  activate(ctx: PluginContextLike): void
  deactivate?(ctx: PluginContextLike): void
}

type PluginFactoryLike = () => PluginInstanceLike

const factory: PluginFactoryLike = () => ({
  activate(ctx: PluginContextLike): void {
    ctx.log.info({}, 'plugin activated')
  },

  deactivate(ctx: PluginContextLike): void {
    ctx.log.info({}, 'plugin deactivated')
  },
})

export default factory
```

Object-style default exports such as `export default { activate() {} }` are rejected at load time.

## Plugin Context API

The `ctx` object is frozen and exposes only framework-owned facades:

| API                                                           | Description                                                                                                                               |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.pluginId`                                                | Plugin ID.                                                                                                                                |
| `ctx.contextId`                                               | Activation context ID. Activation currently uses the system context; tool and job execution are context-scoped separately.                |
| `ctx.permissions`                                             | Readonly set of requested permissions.                                                                                                    |
| `ctx.log.debug/info/warn/error(data, msg)`                    | Structured plugin logger. Never log secrets.                                                                                              |
| `ctx.kv.get/set/delete/list`                                  | Plugin/context KV store, available only with `storage` permission. KV is not a secret store.                                              |
| `ctx.adminConfig.get(key)`                                    | Read-only admin-scoped plugin config for keys declared with `scope: "admin"`.                                                             |
| `ctx.providerRuntime`                                         | Provider runtime helpers, present with `provider.task` or `http` permission.                                                              |
| `ctx.identity`                                                | Identity facade, present with `identity` permission when exactly one task provider type is declared.                                      |
| `ctx.registration.registerTool(tool)`                         | Register a declared `PluginTool`.                                                                                                         |
| `ctx.registration.registerPromptFragment(fragment)`           | Register a declared prompt fragment.                                                                                                      |
| `ctx.registration.registerCommand(command)`                   | Register a declared command. Requires `commands`.                                                                                         |
| `ctx.registration.registerScheduledJob(job)`                  | Register a declared scheduled job. Requires `scheduler`.                                                                                  |
| `ctx.registration.registerAttachmentTransformer(transformer)` | Register a declared attachment transformer. Requires `attachments.read`. See "Attachment Transformers" section.                           |
| `ctx.registration.registerTaskProviderType(...)`              | Register the plugin's single declared task provider type, either as a factory or `{ factory, autoProvision? }`. Requires `provider.task`. |

Undeclared registrations throw during activation. Command registration also requires `commands`, and scheduled job registration requires `scheduler`. Activation failure cleans framework-owned contributions and records runtime diagnostics.

## Tools

Plugin tools are exposed to the LLM as:

```text
plugin_<sanitized-plugin-id>__<tool-name>
```

For example, `hello-world` plus `greet` becomes `plugin_hello_world__greet`.

Tool execution receives a request-scoped runtime context with `pluginId`, `storageContextId`, `chatUserId`, a permission-gated `taskProvider` facade, plugin/context KV, and:

- `adminConfig.get(key)` — read-only admin-scoped config for keys declared with `scope: "admin"`.
- `contextConfig.get(key)` — context-scoped config for keys declared with `scope: "context"` in `configRequirements`. The same key name may exist in both admin and context scopes — they are independent stores. Typical pattern: context-scoped value overrides admin-scoped value (`contextConfig.get('api_key') ?? adminConfig.get('api_key')`).
- `attachments` facade (`attachments.read` permission) for reading stored attachment metadata and bytes scoped to the current storage context. The raw task provider is not exposed.

The `PluginAttachmentRecord` type exposed to tools and transformers includes:

| Field           | Type                             | Description                                                                                                                     |
| --------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `attachmentId`  | `string`                         | Stable attachment identifier.                                                                                                   |
| `filename`      | `string`                         | Original filename.                                                                                                              |
| `mimeType`      | `string \| undefined`            | MIME type when available.                                                                                                       |
| `size`          | `number \| undefined`            | File size in bytes when available.                                                                                              |
| `createdAt`     | `string`                         | ISO-8601 creation timestamp.                                                                                                    |
| `origin`        | `'voice' \| 'file' \| undefined` | How the file arrived; `undefined` for legacy rows without origin data.                                                          |
| `forwardedFrom` | `string \| undefined`            | Display name of the original sender when the source message was forwarded. Display name only — not a stable identity reference. |

When a plugin declares `permissions: ["identity"]` and exactly one `contributes.taskProviderTypes` value, tool executions receive `runtimeContext.identity`. Declaring a task provider type also requires `provider.task`, so runtime identity provider plugins need `identity` plus the manifest/provider-task requirements. The facade supports `lookupForChatUser(chatUserId)` and `recordClaim(providerUserId, providerLogin, displayName?)`. `recordClaim(...)` always writes for the current runtime actor, not an arbitrary chat-user target. Claims are recorded as `manual_nl` mappings and are not treated as auto-verified.

## Prompt Fragments

Prompt fragments are synchronous strings or synchronous functions returning strings. Async prompt fragments are not supported. Fragments are delimited in the system prompt and budgeted at 2,000 characters of plugin content per fragment and 8,000 characters total across active plugins.

## Commands

Plugin commands are registered through `ctx.registration.registerCommand()` and exposed under a safe namespace:

```text
plugin_<sanitized-plugin-id>_<command-name>
```

Command handlers receive the normal `IncomingMessage`, `ReplyFn`, and `AuthorizationResult` values. They run through the same chat command registration path as core commands.

Declaring `contributes.commands` and calling `ctx.registration.registerCommand()` both require the `commands` permission.

Plugin command handlers run only when the plugin is active and eligible for the current command context. Disabled plugins, missing config, or missing capabilities produce a denial message and the plugin handler is not invoked.

## Scheduled Jobs

Plugin jobs are registered through `ctx.registration.registerScheduledJob()` with an `intervalMs` and an `execute(runtime)` function. The runtime always includes `pluginId` and `contextId`, and includes a permission-gated `taskProvider` facade only when the plugin declares `tasks.read` or `tasks.write`. Jobs are registered with owner names like `plugin:<pluginId>:<jobName>` and execute only for contexts where the plugin is enabled and eligible.

Declaring `contributes.jobs` and calling `ctx.registration.registerScheduledJob()` both require the `scheduler` permission.

## Attachment Transformers

Attachment transformers let a plugin pre-process new attachments before the LLM turn starts. Core dispatches transformers from active, enabled, eligible plugins against each new attachment, and injects the result as a formatted line into the turn message. The plugin returns plain text; **core owns all message formatting and bracket-sanitization**, so a transformer cannot inject unfenced content into prompt structure.

### Manifest and registration

Declare transformer names in `contributes.attachmentTransformers` and hold `attachments.read` permission:

```json
{
  "permissions": ["attachments.read", "storage"],
  "contributes": {
    "attachmentTransformers": ["my-transformer"]
  }
}
```

Register during `activate`:

```typescript
ctx.registration.registerAttachmentTransformer({
  name: 'my-transformer',
  mimePrefixes: ['audio/'],
  filenameExtensions: ['.ogg', '.opus', '.mp3'],
  origins: ['voice'],
  timeoutMs: 30000,
  async transform(record, runtimeContext) {
    const { bytes } = await runtimeContext.attachments.read(record.attachmentId)
    // ... process bytes ...
    return { ok: true, text: 'transcript text', meta: { language: 'en', durationSec: 15 } }
  },
})
```

### Registration shape

```typescript
type PluginAttachmentTransformer = {
  name: string
  /** Matched against attachment mimeType, e.g. ['audio/'] */
  mimePrefixes: readonly string[]
  /** Fallback match when the attachment has no MIME type, e.g. ['.ogg', '.mp3'] */
  filenameExtensions?: readonly string[]
  /** Restrict to attachment origins; omitted means all origins */
  origins?: readonly ('voice' | 'file')[]
  /** Per-call budget enforced by core; clamped to 1000–120000 ms, default 30000 */
  timeoutMs?: number
  transform(
    record: PluginAttachmentRecord,
    runtimeContext: PluginToolRuntimeContext,
  ): Promise<AttachmentTransformResult>
}

type AttachmentTransformResult =
  | { ok: true; text: string; meta?: { language?: string; durationSec?: number } }
  | { ok: false; reason: string }
```

### Dispatch rules

For each new attachment in a turn, core:

1. Collects transformers from all active, enabled, eligible plugins for the current context, sorted by plugin ID for determinism.
2. Finds the first transformer whose `mimePrefixes` match (or, when `mimeType` is absent, whose `filenameExtensions` match) and whose `origins` filter passes.
3. Executes the transformer with its per-call `timeoutMs` budget.
4. At most one transformer runs per attachment per turn.

A wall-clock budget of 120 seconds covers the entire batch so N slow transforms cannot stall a turn for N × per-record timeout.

### Result rendering (core-owned)

Core formats and sanitizes the transformer's plain-text output:

- Success: `[Voice attachment att_x (0:15, en): "transcript"]` — duration/language from `meta`, each omitted when absent.
- Forwarded: `[Forwarded voice from "Alice" att_x (0:15): "transcript"]`.
- Failure or timeout: `[Voice attachment att_x: transcription unavailable — <reason>]`.

Any transformer exception or timeout is caught at the dispatch boundary and rendered as a failure line. A transform can never block or drop the turn.

### Execute-time config and the dual-scope override pattern

Transformers (and tools sharing the same pipeline) should read credentials at execute time, not at activation, so that config changes take effect on the next message without a restart:

```typescript
const apiKey = runtimeContext.contextConfig.get('api_key') ?? runtimeContext.adminConfig.get('api_key')
const model = runtimeContext.contextConfig.get('model') ?? runtimeContext.adminConfig.get('model') ?? 'default-model'
const baseUrl = runtimeContext.adminConfig.get('base_url') ?? 'https://api.example.com'
```

Context-scoped `api_key` and `model` let individual users or groups bring their own credentials (BYOK), while `base_url` stays admin-only to prevent a context owner from redirecting requests carrying the admin's key to an arbitrary host.

### KV caching convention

Use the plugin KV store with `transcript:<attachmentId>` keys to cache results. Include a `cachedAt` field and prune stale entries opportunistically (e.g. via `kv.list` on each write, removing entries older than 30 days). Cached results mean queue coalescing and orchestrator retries never bill the upstream API twice for the same bytes.

### Working example

See `plugins/audio-transcribe/` for a complete first-party transformer that transcribes voice notes via a Whisper-compatible endpoint, shares its pipeline with the `transcribe` tool, and uses the dual-scope override pattern and KV caching described above.

## Permissions

Supported MVP permissions:

| Permission         | Effect                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`          | Enables plugin KV access. Without it, KV calls fail closed.                                                                                                                                  |
| `tasks.read`       | Enables read methods on the task-provider facade.                                                                                                                                            |
| `tasks.write`      | Enables write methods on the task-provider facade.                                                                                                                                           |
| `provider.task`    | Allows registering one declared task-provider type and exposes provider runtime helpers.                                                                                                     |
| `identity`         | Exposes identity facade when exactly one task-provider type is declared.                                                                                                                     |
| `http`             | Exposes provider runtime HTTP helper without requiring a contributed task provider.                                                                                                          |
| `commands`         | Required to declare `contributes.commands` and register commands.                                                                                                                            |
| `scheduler`        | Required to declare `contributes.jobs` and register scheduled jobs.                                                                                                                          |
| `attachments.read` | Enables `runtimeContext.attachments.read(attachmentId)` in tool executions, returning metadata and bytes for attachments in the current storage context only. Without it, reads fail closed. |

Unsupported in the MVP: raw chat provider access, raw task provider access, raw DB access, raw environment access, encrypted plugin secrets, arbitrary network access, and sandbox isolation.

## Context Config And Eligibility

Required `configRequirements` are evaluated per target context. Missing required config does not globally break activation; it makes that plugin ineligible for that context, so tools and prompt fragments are hidden and enable actions report the missing keys. Sensitive plugin config values are masked in `/config` output.

Admin-scoped plugin config stays in the admin UI. Context-scoped plugin config declared through `contributes.configKeys` appears in `/config` and is written to the per-context plugin config store under the plugin's namespace.

Capability requirements are evaluated in two layers. At startup, Papai checks approved plugins against the union of active platform/task instances and marks a plugin globally incompatible only when no active instance combination can satisfy the manifest. At request or scheduled-job time, `getPluginContextEligibility(pluginId, contextId)` checks the context's assigned platform and task instances. If that concrete assignment lacks required capabilities, the plugin is ineligible for that context with `capability_missing`, and its tools, prompt fragments, and jobs are hidden there without affecting other contexts.

## Admin Workflow

`/plugin` is DM-only and bot-admin-only.

```text
/plugin list
/plugin info <id>
/plugin approve <id>
/plugin reject <id>
/plugin enable <id> [context-id]
/plugin disable <id> [context-id]
```

Discovery and approval are startup-oriented. Approving or rejecting a plugin affects the next startup. Manifest hash changes clear approval and require reapproval.

Approval coverage includes the plugin manifest and all plugin-owned local source files reachable from the entry point through relative static imports, deterministic literal dynamic imports, and plugin-local relative `import.meta.require(...)` calls. Discovery fails closed if path verification cannot be completed for any imported file.

Per-context enable/disable takes effect the next time tools or prompt fragments are assembled.

## Validation Commands

Recommended checks while developing plugins:

```bash
bun test tests/plugins
bun test tests/tools/tools-builder.test.ts tests/system-prompt.test.ts
bun lint
bun typecheck
```

Run the broader release gate before merging plugin-system changes:

```bash
bun check:full
bun security
```

## Provider Plugins (worked example: Kaneo)

A plugin may contribute one task provider type by declaring `contributes.taskProviderTypes` in its manifest. The Kaneo plugin at `plugins/task-provider-kaneo/` is the canonical first-party example.

### Manifest shape

Provider plugin manifests split config into two schemas:

- **`providerConfigSchema`** — instance-scoped fields stored in `task_instances.config` (e.g. `baseUrl`, `internalUrl`). Validated by `validateConfig` at instance creation.
- **`providerContextConfigSchema`** — context-scoped fields stored per-user in `user_config` under the `plugin:<id>:provider:<fieldKey>` namespace (e.g. `plugin:task-provider-kaneo:provider:credential`, `plugin:task-provider-kaneo:provider:workspaceId`). Not available at instance-config validation time.

Keys are **camelCase** and there is no `storageKey` property. Set `providerAllowedHosts: []` when the plugin uses the instance `baseUrl` dynamically rather than a fixed allowlist.

> **Known limitation (host allowlist not enforced for first-party task providers).** The
> bundled `task-provider-kaneo` and `task-provider-youtrack` plugins make their HTTP calls
> through a global `fetch` in their own `client.ts`, **not** through `ctx.providerRuntime.httpFetch()`.
> Their `providerAllowedHosts` is therefore declared (`[]`) but **not enforced** at runtime —
> the host allowlist and HTTPS-only checks in `providerRuntime` do not apply to their traffic.
> This is a deliberate, documented gap rather than an oversight: enforcing it requires
> (1) threading `ctx.providerRuntime` through the `(config) => TaskProvider` factory into the
> provider client (the factory does not receive `ctx` today), (2) a mechanism to admit the
> operator-configured instance `baseUrl` host into the otherwise-static allowlist, and (3) a
> policy decision for self-hosted `http://` instances (`providerRuntime` is HTTPS-only). Until
> those are designed, treat first-party provider HTTP as unguarded by `providerRuntime`. New
> `http`-permission plugins that _do_ route through `ctx.providerRuntime.httpFetch()` are
> still enforced normally.

Abbreviated manifest for reference:

```json
{
  "id": "task-provider-kaneo",
  "permissions": ["provider.task", "identity"],
  "contributes": { "taskProviderTypes": ["kaneo"] },
  "providerCapabilities": ["comments.create", "labels.list", "projects.list"],
  "providerConfigSchema": [
    { "key": "baseUrl", "label": "Kaneo URL", "required": true, "sensitive": false, "scope": "instance" },
    { "key": "internalUrl", "label": "Kaneo Internal URL", "required": false, "sensitive": false, "scope": "instance" }
  ],
  "providerContextConfigSchema": [
    { "key": "credential", "label": "Kaneo API Key", "required": true, "sensitive": true, "scope": "context" },
    { "key": "workspaceId", "label": "Workspace ID", "required": true, "sensitive": false, "scope": "context" }
  ],
  "providerAllowedHosts": [],
  "providerConfigValidator": "validateConfig"
}
```

### Entry-point factory

Keep discovered entry graphs strictly relative-only. Do not import `papai/plugin-types`, `zod`, or framework files from `src/` directly from the discovered entry graph. Use plugin-local bridges and structural types at the entry point, and keep any runtime loading behind relative plugin-owned modules:

```typescript
type PluginContextLike = {
  registration: {
    registerTaskProviderType(
      type: string,
      registration:
        | ((config: Record<string, string>) => unknown)
        | {
            factory: (config: Record<string, string>) => unknown
            autoProvision?: (context: {
              contextId: string
              chatUserId: string
              username: string | null
              reply: unknown
            }) => Promise<boolean> | boolean
            provision?: (context: {
              contextId: string
              username: string | null
              publicUrl: string | undefined
              internalUrl: string | undefined
            }) => Promise<
              | {
                  status: 'provisioned'
                  email: string
                  password: string
                  kaneoUrl: string
                  apiKey: string
                  workspaceId: string
                }
              | { status: 'registration_disabled' }
              | { status: 'failed'; error: string }
            >
          },
    ): void
  }
}

type PluginInstanceLike = {
  activate(ctx: PluginContextLike): void
}

type PluginFactoryLike = () => PluginInstanceLike

import { createKaneoProvider } from './entry-runtime'

const factory: PluginFactoryLike = (): PluginInstanceLike => ({
  activate(ctx: PluginContextLike): void {
    ctx.registration.registerTaskProviderType('kaneo', {
      factory: (config) => createKaneoProvider(config),
    })
  },
})

export default factory
```

Provider plugins may also supply `autoProvision` in the object form when the framework should offer provider-specific setup/provisioning flows through `/start`, `/setup`, or DM auto-provisioning.

For self-hosted provider instances, plugins may additionally supply `provision` — the HTTP-route-dispatch counterpart used by the settings web UI's provisioning flow (`/admin` → provision). Unlike `autoProvision`, `provision` is called from a settings-web request (no `chatUserId`, no `reply`), receives the operator-configured `publicUrl` and `internalUrl` from the task instance, and returns a typed outcome — either a `provisioned` envelope (with credentials + URL + API key + workspace id) the UI can hand back to the operator, `registration_disabled` when the upstream explicitly rejects sign-up, or `failed` with an `error` string. The settings route dispatches this hook through the registry (`getTaskProviderProvision(type)` in `src/providers/registry.ts`) so the route never has to statically import the plugin module — plugins that want a hosted-instance flow can simply export a `provision` function and register it.

### `validateConfig` contract

`validateConfig` receives only the **instance-scoped** config (fields from `providerConfigSchema`). Context-scoped fields such as `credential` and `workspaceId` are not available here — they live per-user in `user_config` and are injected at request time. Validate URL shape and required instance fields only; credential validation happens during `/setup`.

```typescript
export function validateConfig(config: Record<string, string>): Promise<{ ok: true } | { ok: false; reason: string }> {
  const baseUrl = config['baseUrl']?.trim() ?? ''
  if (!baseUrl) return Promise.resolve({ ok: false, reason: 'baseUrl is required' })
  // ... URL shape check ...
  return Promise.resolve({ ok: true })
}
```

### Context config namespace

Context-scoped provider config (fields from `providerContextConfigSchema`) is stored under the namespaced key pattern:

```
plugin:<plugin-id>:provider:<fieldKey>
```

For Kaneo: `plugin:task-provider-kaneo:provider:credential` and `plugin:task-provider-kaneo:provider:workspaceId`. Migration `048_namespace_kaneo_config` renamed the legacy flat `kaneo_apikey` and `kaneo_workspace_id` rows to this namespace.

### Operator workflow

1. Create a task instance in `/admin#instances` (fills `providerConfigSchema` fields).
2. Run `/plugin approve task-provider-kaneo` (DM, super admin) and restart. Until approved, affected contexts won't resolve and `/admin#instances` shows an "unresolved" label; a startup `WARN` lists pending approvals.
3. Users configure context-scoped fields (`credential`, `workspaceId`) via `/setup`.

See `plugins/task-provider-kaneo/` for the complete source. The YouTrack plugin at `plugins/task-provider-youtrack/` is a second provider-plugin example with a simpler config schema: one instance field (**`baseUrl`**) and one context credential (**`token`**).

## Example Plugin

See [`docs/plugins/examples/hello-world/`](./examples/hello-world/) for a complete example covering tools, prompt fragments, commands, jobs, and context config metadata.
