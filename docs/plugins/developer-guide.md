<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin Developer Guide

Papai plugins are trusted, repository-local extensions loaded from `plugins/<plugin-id>/`. The MVP is for first-party local plugins only: there is no sandbox, marketplace, npm package installation, hot reload, encrypted plugin secret store, provider-as-plugin API, raw provider access, raw DB access, or arbitrary process/env/network facade.

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
  "permissions": ["storage"],
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

Required fields: `id`, `name`, `version`, `description`, `apiVersion`, and `main`.

Supported optional fields:

| Field                         | Description                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contributes.tools`           | Tool names the plugin may register with `ctx.registration.registerTool()`.                                                                        |
| `contributes.promptFragments` | Prompt fragment names the plugin may register with `ctx.registration.registerPromptFragment()`.                                                   |
| `contributes.commands`        | Command names the plugin may register with `ctx.registration.registerCommand()`. Runtime commands are exposed as `plugin_<plugin_id>_<command>`.  |
| `contributes.jobs`            | Scheduled job names the plugin may register with `ctx.registration.registerScheduledJob()`. Runtime job owners are `plugin:<pluginId>:<jobName>`. |
| `contributes.configKeys`      | Plugin-owned context config keys shown by docs and admin UX.                                                                                      |
| `permissions`                 | Permission claims checked by framework facades.                                                                                                   |
| `defaultEnabled`              | Whether the plugin is selected by default for contexts that have no explicit opt-in/out row.                                                      |
| `requiredTaskCapabilities`    | Task provider capabilities required before activation and per-context eligibility.                                                                |
| `requiredChatCapabilities`    | Chat platform capabilities required before activation and per-context eligibility.                                                                |
| `configRequirements`          | Context-specific config fields that gate tool/prompt/job eligibility when required.                                                               |
| `activationTimeoutMs`         | Activation timeout in milliseconds, between `100` and `10000`.                                                                                    |

The manifest `id` must match the directory name. The entry point must stay inside the plugin directory and must be a relative `.ts` or `.js` path without `..` components.

## Entry Contract

The entry point must default-export a factory function returning a plugin instance:

```typescript
import type { PluginContext } from '../../../../src/plugins/context.js'
import type { PluginFactory } from '../../../../src/plugins/types.js'

const factory: PluginFactory = () => ({
  activate(ctx: PluginContext): void {
    ctx.log.info({}, 'plugin activated')
  },

  deactivate(ctx: PluginContext): void {
    ctx.log.info({}, 'plugin deactivated')
  },
})

export default factory
```

Object-style default exports such as `export default { activate() {} }` are rejected at load time.

## Plugin Context API

The `ctx` object is frozen and exposes only framework-owned facades:

| API                                                 | Description                                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ctx.pluginId`                                      | Plugin ID.                                                                                                                 |
| `ctx.contextId`                                     | Activation context ID. Activation currently uses the system context; tool and job execution are context-scoped separately. |
| `ctx.permissions`                                   | Readonly set of requested permissions.                                                                                     |
| `ctx.log.debug/info/warn/error(data, msg)`          | Structured plugin logger. Never log secrets.                                                                               |
| `ctx.kv.get/set/delete/list`                        | Plugin/context KV store, available only with `storage` permission. KV is not a secret store.                               |
| `ctx.registration.registerTool(tool)`               | Register a declared `PluginTool`.                                                                                          |
| `ctx.registration.registerPromptFragment(fragment)` | Register a declared prompt fragment.                                                                                       |
| `ctx.registration.registerCommand(command)`         | Register a declared command.                                                                                               |
| `ctx.registration.registerScheduledJob(job)`        | Register a declared scheduled job.                                                                                         |

Undeclared registrations throw during activation. Activation failure cleans framework-owned contributions and records runtime diagnostics.

## Tools

Plugin tools are exposed to the LLM as:

```text
plugin_<sanitized-plugin-id>__<tool-name>
```

For example, `hello-world` plus `greet` becomes `plugin_hello_world__greet`.

Tool execution receives a request-scoped runtime context with `pluginId`, `storageContextId`, `chatUserId`, a permission-gated `taskProvider` facade, and plugin/context KV. The raw task provider is not exposed.

When a plugin declares `permissions: ["identity"]` and exactly one `contributes.taskProviderTypes` value, tool executions receive `runtimeContext.identity`. Declaring a task provider type also requires `provider.task`, so runtime identity provider plugins need `identity` plus the manifest/provider-task requirements. The facade supports `lookupForChatUser(chatUserId)` and `recordClaim(chatUserId, providerUserId, providerLogin, displayName?)`. Claims are recorded as `manual_nl` mappings and are not treated as auto-verified.

## Prompt Fragments

Prompt fragments are synchronous strings or synchronous functions returning strings. Async prompt fragments are not supported. Fragments are delimited in the system prompt and budgeted at 2,000 characters per fragment and 8,000 characters total across active plugins.

## Commands

Plugin commands are registered through `ctx.registration.registerCommand()` and exposed under a safe namespace:

```text
plugin_<sanitized-plugin-id>_<command-name>
```

Command handlers receive the normal `IncomingMessage`, `ReplyFn`, and `AuthorizationResult` values. They run through the same chat command registration path as core commands.

## Scheduled Jobs

Plugin jobs are registered through `ctx.registration.registerScheduledJob()` with an `intervalMs` and an `execute(contextId)` function. Jobs are registered with owner names like `plugin:<pluginId>:<jobName>` and execute only for contexts where the plugin is enabled and eligible.

## Permissions

Supported MVP permissions:

| Permission    | Effect                                                                                  |
| ------------- | --------------------------------------------------------------------------------------- |
| `storage`     | Enables plugin KV access. Without it, KV calls fail closed.                             |
| `tasks.read`  | Enables read methods on the task-provider facade.                                       |
| `tasks.write` | Enables write methods on the task-provider facade.                                      |
| `commands`    | Reserved declaration for command-capable plugins; registration is still manifest-gated. |
| `scheduler`   | Reserved declaration for scheduled-job plugins; registration is still manifest-gated.   |
| `chat.send`   | Declared in the permission list but no raw chat-send facade is exposed in the MVP.      |

Unsupported in the MVP: raw chat provider access, raw task provider access, raw DB access, raw environment access, encrypted plugin secrets, arbitrary network access, and sandbox isolation.

## Context Config And Eligibility

Required `configRequirements` are evaluated per target context. Missing required config does not globally break activation; it makes that plugin ineligible for that context, so tools and prompt fragments are hidden and enable actions report the missing keys. Sensitive plugin config values are masked in `/config` output.

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

## Example Plugin

See [`docs/plugins/examples/hello-world/`](./examples/hello-world/) for a complete example covering tools, prompt fragments, commands, jobs, and context config metadata.
