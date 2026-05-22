<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin Developer Guide

Papai supports a first-party plugin system that allows extending the bot with additional tools and prompt fragments at runtime, without modifying core source code.

---

## Quick-start

1. Create a directory under `plugins/` in the repo root (e.g. `plugins/hello-world/`).
2. Add a `plugin.json` manifest file.
3. Add an entry point (e.g. `index.ts`) that exports a `PluginFactory` as its default export.
4. Start the bot — it will discover the plugin automatically.
5. An admin must approve the plugin via `/plugin approve hello-world` before it activates.

---

## Manifest (`plugin.json`)

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
    "commands": [],
    "jobs": [],
    "configKeys": []
  },
  "permissions": [],
  "requiredTaskCapabilities": [],
  "requiredChatCapabilities": [],
  "activationTimeoutMs": 5000
}
```

### Required fields

| Field         | Type     | Description                                                            |
| ------------- | -------- | ---------------------------------------------------------------------- |
| `id`          | `string` | Unique lower-case kebab-case identifier, 1–64 characters.              |
| `name`        | `string` | Human-readable display name.                                           |
| `version`     | `string` | SemVer string (e.g. `1.0.0`).                                          |
| `description` | `string` | Short description shown in admin commands.                             |
| `apiVersion`  | `1`      | Must equal `1` (the current plugin API version).                       |
| `main`        | `string` | Relative path to entry point (`.ts` or `.js`, no `..` or leading `/`). |

### Optional fields

| Field                         | Default | Description                                                                    |
| ----------------------------- | ------- | ------------------------------------------------------------------------------ |
| `contributes.tools`           | `[]`    | Tool names the plugin may register. Only listed names are accepted at runtime. |
| `contributes.promptFragments` | `[]`    | Prompt fragment keys the plugin may register.                                  |
| `permissions`                 | `[]`    | Reserved for future use.                                                       |
| `requiredTaskCapabilities`    | `[]`    | Task provider capabilities required for the plugin to be compatible.           |
| `requiredChatCapabilities`    | `[]`    | Chat provider capabilities required for the plugin to be compatible.           |
| `activationTimeoutMs`         | `5000`  | Activation timeout in ms (100–10000).                                          |

---

## Entry point

The entry point must export a `PluginFactory` as its **default export**:

```typescript
import type { PluginContext, PluginFactory } from '../../../../src/plugins/context.js'

const factory: PluginFactory = {
  activate(rawCtx: unknown) {
    const ctx = rawCtx as PluginContext
    ctx.log.info({}, 'hello-world plugin activated')

    ctx.registration.registerTool({
      name: 'greet',
      description: 'Greet a person by name',
      execute(args: unknown): Promise<unknown> {
        const input = args as { name: string }
        return Promise.resolve({ greeting: `Hello, ${input.name}!` })
      },
    })
  },

  deactivate(rawCtx: unknown) {
    const ctx = rawCtx as PluginContext
    ctx.log.info({}, 'hello-world plugin deactivated')
  },
}

export default factory
```

### PluginContext API

The `ctx` object passed to `activate` and `deactivate` provides:

| Method / Property                                                                            | Description                                                                                           |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ctx.pluginId`                                                                               | The plugin's ID string.                                                                               |
| `ctx.log.debug(data, msg)` / `.info` / `.warn` / `.error`                                    | Structured pino logger. `data` is `Record<string, unknown>`, `msg` is a string.                       |
| `ctx.registration.registerTool(tool)`                                                        | Register a `PluginTool` object (only if `name` is listed in `contributes.tools`).                     |
| `ctx.registration.registerPromptFragment(fragment)`                                          | Register a `PluginPromptFragment` object (only if `name` is listed in `contributes.promptFragments`). |
| `ctx.kv.get(key)` / `ctx.kv.set(key, value)` / `ctx.kv.delete(key)` / `ctx.kv.list(prefix?)` | Persistent key-value store scoped to the plugin.                                                      |

---

## Tool registration

Tools registered by plugins are namespaced automatically:

```
plugin_<sanitized-plugin-id>__<tool-name>
```

For example, a plugin with id `hello-world` registering a tool named `greet` becomes `plugin_hello_world__greet` from the LLM's perspective. Plugin code always uses the short name (`greet`).

---

## Prompt fragments

Prompt fragments are short text snippets injected into the system prompt. Each plugin has a budget of **2 000 characters** per fragment, with a total budget of **8 000 characters** across all active plugins. Fragments that exceed the per-plugin budget are truncated with a `[truncated]` suffix.

```typescript
ctx.registration.registerPromptFragment({
  name: 'my-hint',
  content: 'Use the greet tool when the user says hello.',
})

// Or lazily computed at render time:
ctx.registration.registerPromptFragment({
  name: 'dynamic-hint',
  content: () => `Current time: ${new Date().toISOString()}`,
})
```

---

## Admin workflow

All plugin state changes require an admin user (a user with the `ADMIN_USER_ID` or an authorized user):

```
/plugin list                  — list all discovered plugins and their states
/plugin info <id>             — show full manifest for a plugin
/plugin approve <id>          — approve and activate a plugin
/plugin reject <id>           — reject a plugin (prevents activation)
/plugin enable <id>           — enable an active plugin for the current context
/plugin disable <id>          — disable a plugin for the current context
```

### Plugin lifecycle states

```
discovered ──► approved ──► active
     │              │          │
     └──► rejected  └──► incompatible / config_missing / error
```

- **discovered**: Manifest parsed; awaiting admin approval.
- **approved**: Admin approved; will activate on next startup or reload if compatible.
- **incompatible**: Plugin requires capabilities the current provider does not support.
- **active**: Activated successfully and contributing tools/prompts.
- **error**: Activation failed; error reason stored and logged.
- **rejected**: Admin explicitly rejected; will not activate.

---

## Example plugin

See [`docs/plugins/examples/hello-world/`](./examples/hello-world/) for a complete working example.
