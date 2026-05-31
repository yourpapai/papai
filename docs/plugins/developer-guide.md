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

| Field                           | Description                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`                          | Entry point path for non-MCP-only plugins.                                                                                                                              |
| `contributes.tools`             | Tool names the plugin may register with `ctx.registration.registerTool()`.                                                                                              |
| `contributes.promptFragments`   | Prompt fragment names the plugin may register with `ctx.registration.registerPromptFragment()`.                                                                         |
| `contributes.commands`          | Command names the plugin may register with `ctx.registration.registerCommand()`. Requires `commands`. Runtime commands are exposed as `plugin_<plugin_id>_<command>`.   |
| `contributes.jobs`              | Scheduled job names the plugin may register with `ctx.registration.registerScheduledJob()`. Requires `scheduler`. Runtime job owners are `plugin:<pluginId>:<jobName>`. |
| `contributes.configKeys`        | Plugin-owned context config keys exposed in `/config`. Each key must have a matching context-scoped `configRequirements` entry.                                         |
| `contributes.taskProviderTypes` | At most one plugin-owned task provider type. Requires `provider.task`.                                                                                                  |
| `providerCapabilities`          | Task capabilities exposed by the contributed provider type.                                                                                                             |
| `providerConfigSchema`          | Instance-scoped config fields for the contributed provider type.                                                                                                        |
| `providerContextConfigSchema`   | Context-scoped credential/config fields for the contributed provider type.                                                                                              |
| `providerAllowedHosts`          | Host allowlist used by `ctx.providerRuntime.httpFetch()`. Available to `http` plugins and contributed task-provider plugins.                                            |
| `providerConfigValidator`       | Optional named export for validating contributed provider config before task-instance writes are persisted.                                                             |
| `mcp`                           | Optional plugin-owned MCP server config. Runtime support is `streamable-http`; `stdio` is schema-reserved.                                                              |
| `permissions`                   | Permission claims checked by framework facades.                                                                                                                         |
| `defaultEnabled`                | Whether the plugin is selected by default for contexts that have no explicit opt-in/out row.                                                                            |
| `requiredTaskCapabilities`      | Task provider capabilities required before activation and per-context eligibility.                                                                                      |
| `requiredChatCapabilities`      | Chat platform capabilities required before activation and per-context eligibility.                                                                                      |
| `configRequirements`            | Context-specific config fields that gate tool/prompt/job eligibility when required.                                                                                     |
| `activationTimeoutMs`           | Activation timeout in milliseconds, between `100` and `10000`.                                                                                                          |

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

| API                                                 | Description                                                                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.pluginId`                                      | Plugin ID.                                                                                                                                |
| `ctx.contextId`                                     | Activation context ID. Activation currently uses the system context; tool and job execution are context-scoped separately.                |
| `ctx.permissions`                                   | Readonly set of requested permissions.                                                                                                    |
| `ctx.log.debug/info/warn/error(data, msg)`          | Structured plugin logger. Never log secrets.                                                                                              |
| `ctx.kv.get/set/delete/list`                        | Plugin/context KV store, available only with `storage` permission. KV is not a secret store.                                              |
| `ctx.adminConfig.get(key)`                          | Read-only admin-scoped plugin config for keys declared with `scope: "admin"`.                                                             |
| `ctx.providerRuntime`                               | Provider runtime helpers, present with `provider.task` or `http` permission.                                                              |
| `ctx.identity`                                      | Identity facade, present with `identity` permission when exactly one task provider type is declared.                                      |
| `ctx.registration.registerTool(tool)`               | Register a declared `PluginTool`.                                                                                                         |
| `ctx.registration.registerPromptFragment(fragment)` | Register a declared prompt fragment.                                                                                                      |
| `ctx.registration.registerCommand(command)`         | Register a declared command. Requires `commands`.                                                                                         |
| `ctx.registration.registerScheduledJob(job)`        | Register a declared scheduled job. Requires `scheduler`.                                                                                  |
| `ctx.registration.registerTaskProviderType(...)`    | Register the plugin's single declared task provider type, either as a factory or `{ factory, autoProvision? }`. Requires `provider.task`. |

Undeclared registrations throw during activation. Command registration also requires `commands`, and scheduled job registration requires `scheduler`. Activation failure cleans framework-owned contributions and records runtime diagnostics.

## Tools

Plugin tools are exposed to the LLM as:

```text
plugin_<sanitized-plugin-id>__<tool-name>
```

For example, `hello-world` plus `greet` becomes `plugin_hello_world__greet`.

Tool execution receives a request-scoped runtime context with `pluginId`, `storageContextId`, `chatUserId`, a permission-gated `taskProvider` facade, and plugin/context KV. The raw task provider is not exposed.

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

## Permissions

Supported MVP permissions:

| Permission      | Effect                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------- |
| `storage`       | Enables plugin KV access. Without it, KV calls fail closed.                              |
| `tasks.read`    | Enables read methods on the task-provider facade.                                        |
| `tasks.write`   | Enables write methods on the task-provider facade.                                       |
| `provider.task` | Allows registering one declared task-provider type and exposes provider runtime helpers. |
| `identity`      | Exposes identity facade when exactly one task-provider type is declared.                 |
| `http`          | Exposes provider runtime HTTP helper without requiring a contributed task provider.      |
| `commands`      | Required to declare `contributes.commands` and register commands.                        |
| `scheduler`     | Required to declare `contributes.jobs` and register scheduled jobs.                      |

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
