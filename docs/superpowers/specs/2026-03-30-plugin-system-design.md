<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin System Design

**Date:** 2026-03-30
**Status:** Approved

## Goals

1. **Internal modularity** — Refactor toward a consistent plugin architecture so adding new integrations follows a single pattern.
2. **Third-party extensibility** — Enable external developers to build and distribute plugins independently.
3. **Gradual migration** — Existing chat/task providers stay as core code now, but the plugin interface supports migrating them later.

## Design Decisions

| Decision           | Choice                                                  | Rationale                                                                                      |
| ------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Plugin categories  | Full-stack (tools + background jobs + prompt fragments) | Plugins like finance tracking need all three                                                   |
| Distribution       | Convention-based directory (`plugins/`)                 | Simple, no npm overhead, auto-discovered at startup                                            |
| Storage            | Generic storage API (no direct DB access)               | Most secure — no SQL injection, enforced isolation                                             |
| Framework services | Scoped `PluginContext` injection                        | Plugins consume `taskProvider`, `chat`, `scheduler`, `store` without inter-plugin dependencies |
| Permissions        | Two-layer: admin-approved + per-user opt-in             | Admin controls what loads, users control what's active for them                                |
| LLM integration    | Tool injection + system prompt fragments                | Both declared in manifest, merged at runtime                                                   |
| Existing providers | Keep as core, design for future extraction              | Zero regression risk, gradual migration via Strangler Fig                                      |
| Architecture       | Lightweight Plugin Context (factory + scoped context)   | Matches existing factory patterns, no event bus or DI container overhead                       |

---

## Section 1: Plugin Manifest & Directory Structure

Each plugin lives in `plugins/<plugin-id>/` with a `plugin.json` manifest and a TypeScript entry point:

```
plugins/
├── finance/
│   ├── plugin.json
│   ├── index.ts          # default export: createPlugin()
│   ├── tools/
│   │   ├── record-expense.ts
│   │   └── get-balance.ts
│   └── jobs/
│       └── daily-summary.ts
└── github/
    ├── plugin.json
    ├── index.ts
    └── tools/
        └── create-issue.ts
```

### Manifest Schema (`plugin.json`)

```typescript
type PluginManifest = {
  id: string // unique, lowercase + hyphens: "finance-tracker"
  name: string // display name: "Finance Tracker"
  version: string // semver: "1.2.0"
  description: string
  author?: string
  minAppVersion?: string // minimum papai version, optional

  // What the plugin provides (declarative — for admin review + lazy loading)
  contributes: {
    tools?: string[] // ["record_expense", "get_balance"]
    promptFragments?: string[] // ["finance-context"]
    jobs?: string[] // ["daily-summary"]
    commands?: string[] // ["finance"]
  }

  // What framework services it needs (checked at approval time)
  permissions: (
    | 'store' // scoped key-value storage
    | 'scheduler' // register background jobs
    | 'taskProvider' // create/query tasks
    | 'chat' // send proactive messages to users
  )[]
  requiredTaskCapabilities?: TaskCapability[]
  requiredChatCapabilities?: ChatCapability[]

  // Plugin entry point relative to plugin directory
  main?: string // default: "index.ts"

  // Config keys the plugin needs from users (shown in /setup wizard)
  configRequirements?: Array<{
    key: string // stored as "pluginId.key" in the config store
    label: string // "Bank API Token"
    sensitive?: boolean // masked in /config output
    required?: boolean // blocks plugin activation if missing
  }>

  // Auto-enable for all users when admin approves (default: false)
  autoEnable?: boolean
}
```

### Validation

The manifest is validated with Zod at discovery time — malformed manifests are logged and skipped, never crash the bot.

### Key Decisions

- `contributes` is **declarative**: the framework knows what a plugin offers before loading its code. This enables the admin to review what a plugin does before approving it.
- `permissions` is an **allowlist**: the plugin only receives the services it declares. A plugin without `"chat"` permission cannot send proactive messages.
- `permissions` and `required*Capabilities` are separate: permissions control framework access, while required capabilities describe which task/chat provider features must exist before the plugin can activate safely.
- `configRequirements` integrates with the existing `/setup` wizard and `/config` display.

---

## Section 2: Plugin Lifecycle & Entry Point

### Plugin Interface

Each plugin's `index.ts` exports a factory function that returns a `PluginInstance`:

```typescript
// Plugin authors implement this interface
interface PluginInstance {
  /** Called once when the plugin is loaded after admin approval. */
  activate(ctx: PluginContext): Promise<void> | void

  /** Called when the plugin is being unloaded (shutdown or admin disables). */
  deactivate?(): Promise<void> | void
}

// Plugin entry point — default export
type PluginFactory = () => PluginInstance
```

### Example Plugin

```typescript
// plugins/finance/index.ts
import { makeRecordExpenseTool } from './tools/record-expense.js'
import { makeGetBalanceTool } from './tools/get-balance.js'
import { dailySummaryHandler } from './jobs/daily-summary.js'
import type { PluginFactory } from '../../src/plugins/types.js'

const createPlugin: PluginFactory = () => ({
  activate(ctx) {
    // Register LLM tools
    ctx.tools.register('record_expense', makeRecordExpenseTool(ctx))
    ctx.tools.register('get_balance', makeGetBalanceTool(ctx))

    // Register background job
    ctx.scheduler.register('daily-summary', {
      cron: '0 20 * * *',
      handler: () => dailySummaryHandler(ctx),
    })

    // Register system prompt fragment
    ctx.prompts.register(
      'finance-context',
      () =>
        'You have access to finance tracking tools. When the user mentions expenses, ' +
        'income, or budgets, use the finance tools to record and query transactions.',
    )

    ctx.logger.info('Finance plugin activated')
  },

  async deactivate() {
    // Scheduler jobs are auto-cleaned by the framework,
    // but plugins can do custom cleanup here
  },
})

export default createPlugin
```

### Lifecycle Phases

```
Discovery ──→ Validation ──→ Loading ──→ Activation ──→ Running ──→ Deactivation
    │              │             │             │                          │
  scan dirs    Zod parse    import()     activate(ctx)            deactivate()
  read JSON    manifest     entry file   register tools/jobs      cleanup
                                         on bot startup            on shutdown
```

1. **Discovery** — At startup, scan `plugins/*/plugin.json`. Parse and validate manifests.
2. **Validation** — Check manifest against Zod schema. Reject malformed plugins with a warning log.
3. **Loading** — For admin-approved plugins only: `import()` the entry point, call the factory to get a `PluginInstance`.
4. **Activation** — Call `activate(ctx)` with a scoped `PluginContext`. Plugin registers its tools, jobs, prompt fragments, and commands.
5. **Running** — Plugin tools are injected into LLM calls for opted-in users. Scheduler jobs tick on schedule.
6. **Deactivation** — On shutdown or admin disable: call `deactivate()`, then the framework unregisters all tools, jobs, and prompt fragments associated with the plugin.

### Error Boundaries

- If `activate()` throws, the plugin is marked as `error` state, logged, and skipped. Other plugins continue loading.
- If a plugin's tool throws during LLM execution, it's caught by the existing tool error handling in `llm-orchestrator.ts`. The error is attributed to the plugin in logs.
- If `deactivate()` throws, it's logged and the framework proceeds with cleanup anyway.

### Key Decisions

- **Factory function, not class inheritance** — Matches papai's existing patterns (`createProvider`, `createChatProvider`). No `this` binding issues.
- **Framework owns cleanup** — The framework tracks everything a plugin registered and can forcibly unregister it all, even if `deactivate()` fails or is missing. Plugins don't need to manually undo their registrations.
- **No hot reload** — Plugins load once at startup. For development, use `bun --watch`. A future full-cycle reload (deactivate all → re-scan → re-activate) is possible but not needed now.

---

## Section 3: PluginContext & Framework Services

This is the API surface that plugins interact with. Each plugin receives a `PluginContext` scoped to its identity.

### PluginContext Interface

```typescript
interface PluginContext {
  // ── Identity ──
  readonly pluginId: string
  readonly logger: pino.Logger // pre-scoped: logger.child({ plugin: pluginId })

  // ── Registration APIs ──
  readonly tools: PluginToolRegistry
  readonly prompts: PluginPromptRegistry
  readonly scheduler: PluginSchedulerRegistry
  readonly commands: PluginCommandRegistry

  // ── Framework Services (gated by manifest permissions) ──
  readonly store: PluginStore // requires "store" permission
  readonly taskProvider: TaskProvider // requires "taskProvider" permission
  readonly chat: PluginChatService // requires "chat" permission
}
```

Services not declared in `permissions` are `undefined` at runtime. TypeScript enforces this: if a plugin doesn't declare `"chat"`, `ctx.chat` is not available. An attempt to use it throws a clear error: `"Plugin 'finance' does not have 'chat' permission"`.

### Registration APIs

```typescript
interface PluginToolRegistry {
  /** Register an LLM tool. Name must match one declared in manifest contributes.tools */
  register(name: string, tool: ToolDefinition): void
}

interface PluginPromptRegistry {
  /** Register a system prompt fragment. Can be static string or dynamic function. */
  register(key: string, fragment: string | (() => string | Promise<string>)): void
}

interface PluginSchedulerRegistry {
  /** Register a background job. */
  register(
    name: string,
    config: {
      cron?: string // 5-field cron expression
      interval?: number // milliseconds (mutually exclusive with cron)
      handler: (userId: string) => Promise<void> | void
    },
  ): void
}

interface PluginCommandRegistry {
  /** Register a chat command (e.g., /finance). */
  register(name: string, handler: CommandHandler): void
}
```

### PluginStore (Scoped Storage)

```typescript
interface PluginStore {
  /** Get a value by key (scoped to plugin + user). */
  get<T = unknown>(userId: string, key: string): Promise<T | null>

  /** Set a value (scoped to plugin + user). */
  set<T = unknown>(userId: string, key: string, value: T): Promise<void>

  /** Delete a key (scoped to plugin + user). */
  delete(userId: string, key: string): Promise<void>

  /** List keys matching an optional prefix (scoped to plugin + user). */
  list(userId: string, prefix?: string): Promise<Array<{ key: string; value: unknown }>>

  /** Store a sensitive value (encrypted at rest). */
  setSecret(userId: string, key: string, value: string): Promise<void>

  /** Retrieve a sensitive value (decrypted on read). */
  getSecret(userId: string, key: string): Promise<string | null>
}
```

### PluginChatService

```typescript
interface PluginChatService {
  /** Send a proactive message to a user. */
  sendMessage(userId: string, markdown: string): Promise<void>
}
```

Deliberately minimal — plugins can send messages but cannot register message handlers or intercept incoming messages.

Ordinary plugins keep this minimal `PluginChatService` surface. Full provider-as-plugin contracts for chat or task providers are a later dedicated phase, not a responsibility of the initial plugin framework.

### TaskProvider Access

Plugins receive the same `TaskProvider` interface that core tools use. However, the instance is **resolved per-user at tool execution time**, not at activation time. During `activate()`, `ctx.taskProvider` is not available — it only resolves when a plugin's tool is called by the LLM for a specific user.

This matches how core tools work: `makeTools(provider, userId)` already receives the provider per-call.

Plugin tools are registered as factories. When `makeTools` assembles the tool set for a user, it calls the plugin tool factory with the user's provider:

```typescript
// Framework internals — not exposed to plugins
function buildPluginToolForUser(
  pluginTool: PluginToolDefinition,
  provider: TaskProvider,
  userId: string,
  store: PluginStore,
): ToolSet[string] {
  return pluginTool.build({ taskProvider: provider, userId, store })
}
```

### Context Freezing

The `PluginContext` object and all its nested registries are frozen with `Object.freeze()` after construction. Plugins cannot replace framework services or mutate the context.

### Key Decisions

- **`userId` is explicit in store/chat** — Plugin tools need to handle multiple users (scheduler jobs iterate over users, tools execute per-user). Explicit userId is more honest than hidden scoping.
- **TaskProvider is per-user, per-call** — Avoids stale provider state. Each tool invocation gets the correct provider for that user's config.
- **No raw DB access** — Plugins never see Drizzle. The `PluginStore` is the only persistence path.
- **Registration validates against manifest** — `ctx.tools.register('unknown_tool', ...)` throws if `'unknown_tool'` isn't in `contributes.tools`. Prevents plugins from registering undeclared capabilities.

---

## Section 4: Plugin Discovery, Loading & Permission Gates

### Discovery at Startup

```typescript
// src/plugins/discovery.ts
async function discoverPlugins(pluginsDir: string): Promise<DiscoveredPlugin[]>

type DiscoveredPlugin = {
  readonly manifest: PluginManifest
  readonly dir: string // absolute path to plugin directory
  readonly state: 'discovered' // initial state before admin review
}
```

### Plugin Registry

```typescript
type PluginState =
  | 'discovered' // found on disk, not yet approved
  | 'approved' // admin approved, will be loaded on next startup
  | 'incompatible' // approved, but current providers do not satisfy required capabilities
  | 'rejected' // admin explicitly rejected
  | 'active' // loaded and activate() succeeded
  | 'error' // activate() threw — logged, skipped

type RegisteredPlugin = {
  readonly manifest: PluginManifest
  readonly dir: string
  state: PluginState
  readonly instance?: PluginInstance // present only when state = 'active'
  readonly error?: string // present only when state = 'error'
}
```

### Startup Flow

```
1. discoverPlugins('plugins/')
       │
2. Load admin states from DB (plugin_admin_state table)
       │
3. For each discovered plugin:
       │
       ├── Not in DB yet → state = 'discovered', log "New plugin found: {id}"
       ├── admin_state = 'rejected' → skip, do not load
       └── admin_state = 'approved' → proceed to load
              │
4. Validate permissions and provider capability requirements against manifest
       │
       ├── requirements unmet → state = 'incompatible', log reason, continue
       └── requirements satisfied → proceed to load
              │
5. Dynamic import: import(path.join(dir, manifest.main ?? 'index.ts'))
       │
6. Call factory: const instance = createPlugin()
       │
7. Build scoped PluginContext (only services declared in permissions)
       │
8. Call instance.activate(ctx)
       │
       ├── Success → state = 'active'
       └── Throws → state = 'error', log error, continue with other plugins
```

### Admin Plugin Management

Uses the existing interactive UX pattern — wizard flows with inline buttons.

**`/plugin` command (admin only):**

```
  ┌─────────────────────────────────────────────────┐
  │  📦 Plugins                                      │
  │                                                   │
  │  ✅ finance-tracker v1.2.0                        │
  │     Finance tracking and expense management       │
  │     Permissions: store, scheduler, taskProvider    │
  │     3 tools · 1 job · 1 prompt                    │
  │                                                   │
  │  🆕 github-issues v0.1.0                          │
  │     GitHub issue integration                      │
  │     Permissions: store, taskProvider               │
  │     2 tools                                        │
  │                                                   │
  │  ❌ suspicious-plugin v0.0.1                       │
  │     Rejected by admin                              │
  │                                                   │
  │  ⚠️ broken-plugin v1.0.0                           │
  │     Error: activate() failed — see logs            │
  │                                                   │
  │  [Approve] [Reject]  ← for 🆕 discovered plugins  │
  │  [Disable] [Info]    ← for ✅ active plugins       │
  └─────────────────────────────────────────────────┘
```

Buttons use callback routing like the existing config editor:

- `plugin_approve_{id}` → Approve plugin, log action, prompt restart
- `plugin_reject_{id}` → Reject plugin
- `plugin_disable_{id}` → Revoke approval (deactivates on next restart)
- `plugin_info_{id}` → Show full manifest details

State indicators:

- 🆕 `discovered` — new, awaiting admin review
- ⏸️ `incompatible` — approved, but current provider capabilities do not satisfy the manifest requirements
- ✅ `active` — approved and loaded
- ❌ `rejected` — admin rejected
- ⚠️ `error` — approved but activate() failed

### Per-User Plugin Opt-In

Integrated into `/config` — the existing config display gains a **Plugins** section:

```
  │  📦 Plugins                                       │
  │  ✅ finance-tracker          [Disable]             │
  │  ⭕ github-issues            [Enable]              │
  │                                                    │
  │  Plugin config:                                    │
  │  🔑 finance.api_key ····5678    [Edit]             │
  │  🏦 finance.account_id acct123  [Edit]             │
```

Callbacks:

- `plugin_user_enable_{id}` → Enable plugin for this user
- `plugin_user_disable_{id}` → Disable plugin for this user

No restart needed for user-level changes — the next LLM call picks up the updated tool set.

Plugin `configRequirements` trigger the wizard flow when a user enables a plugin that has required config keys.

Mattermost fallback: text list with `/plugin approve <id>` text command support.

### Resolution: Is a Plugin Active for a User?

```typescript
function isPluginActiveForUser(pluginId: string, userId: string): boolean {
  const plugin = registry.get(pluginId)
  if (!plugin || plugin.state !== 'active') return false

  const userState = getUserPluginState(pluginId, userId)

  // If user has an explicit preference, respect it
  if (userState !== null) return userState.enabled

  // Otherwise, fall back to manifest default
  return plugin.manifest.autoEnable ?? false
}
```

### Tool Assembly Integration

The existing `makeTools(provider, userId)` is extended to merge plugin tools:

```typescript
function makeTools(provider: TaskProvider, userId?: string): ToolSet {
  const tools: ToolSet = {}

  // 1. Core tools (existing logic, unchanged)
  Object.assign(tools, makeCoreTools(provider, userId))

  // 2. Plugin tools (new)
  if (userId) {
    for (const plugin of getActivePluginsForUser(userId)) {
      for (const [name, toolDef] of plugin.registeredTools) {
        tools[`${plugin.manifest.id}__${name}`] = buildPluginToolForUser(toolDef, provider, userId, plugin.store)
      }
    }
  }

  return tools
}
```

Plugin tools are prefixed with `pluginId__` (e.g., `finance__record_expense`) to prevent collisions.

### System Prompt Integration

`buildSystemPrompt()` appends plugin prompt fragments for active plugins:

```typescript
function buildSystemPrompt(provider: TaskProvider, timezone: string, userId: string): string {
  let prompt = buildCoreSystemPrompt(provider, timezone, userId)

  for (const plugin of getActivePluginsForUser(userId)) {
    for (const [_key, fragment] of plugin.registeredPrompts) {
      const text = typeof fragment === 'function' ? await fragment() : fragment
      prompt += `\n\n${text}`
    }
  }

  return prompt
}
```

---

## Section 5: Plugin Storage & Database Schema

### New Tables

Three new tables added via Drizzle migrations:

```sql
-- Plugin admin approval state
CREATE TABLE plugin_admin_state (
  plugin_id   TEXT PRIMARY KEY,
  state       TEXT NOT NULL,          -- 'approved' | 'rejected'
  approved_by TEXT,                   -- admin user ID
  updated_at  TEXT NOT NULL
);

-- Per-user plugin opt-in state
CREATE TABLE plugin_user_state (
  plugin_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  enabled     INTEGER NOT NULL,       -- 1 or 0
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (plugin_id, user_id)
);

-- Plugin scoped key-value storage
CREATE TABLE plugin_kv (
  plugin_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,          -- JSON-serialized
  encrypted   INTEGER DEFAULT 0,     -- 1 for secrets (setSecret/getSecret)
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (plugin_id, user_id, key)
);
```

### Plugin Config Keys in Existing Store

Plugin `configRequirements` are stored in the existing `userConfig` table with a namespaced key:

```
plugin_id = "finance", config key = "api_key"
→ stored as userConfig(userId, "finance.api_key", value)
```

This reuses the existing config infrastructure (`getConfig`, `setConfig`, cache layer, masking) without modification. The namespace prefix prevents collisions — core keys never contain dots.

### Secret Encryption

Values stored via `setSecret()` are encrypted before writing:

- **Algorithm:** AES-256-GCM (Web Crypto API in Bun)
- **Key derivation:** Platform encryption key from `PLUGIN_SECRET_KEY` env var (or auto-generated and persisted on first run)
- **Storage format:** `encrypted = 1`, value contains `iv:ciphertext:tag` (base64-encoded)
- **Scope:** Only `getSecret()` can read encrypted values. `get()` on an encrypted key returns `null`.

### Key Decisions

- **Dots as namespace separator** — Simple, readable, impossible to collide with existing core keys (all `snake_case` without dots).
- **JSON serialization for values** — Supports objects, arrays, numbers, strings. Zod validation ensures valid JSON.
- **No foreign keys to core tables** — Plugin tables are self-contained. Cleanup handled by a scheduled job that prunes orphaned plugin data.
- **Encryption is opt-in per value** — Only values stored via `setSecret()` are encrypted. Avoids unnecessary overhead for non-sensitive data.

---

## Section 6: Scheduler Integration for Plugin Jobs

Plugin-registered jobs integrate with the existing central scheduler (`src/utils/scheduler.ts`).

### Registration

```typescript
// Inside PluginSchedulerRegistry implementation
function register(
  name: string,
  config: {
    cron?: string
    interval?: number
    handler: (userId: string) => Promise<void> | void
  },
): void {
  const taskName = `plugin:${pluginId}:${name}`

  // Validate against manifest
  if (!manifest.contributes.jobs?.includes(name)) {
    throw new Error(`Job '${name}' not declared in plugin manifest contributes.jobs`)
  }

  // Register with the central scheduler
  scheduler.register(taskName, {
    cron: config.cron,
    interval: config.interval,
    handler: async () => {
      const users = getPluginEnabledUsers(pluginId)
      for (const userId of users) {
        try {
          await config.handler(userId)
        } catch (error) {
          logger.error({ plugin: pluginId, job: name, userId, error }, 'Plugin job failed')
        }
      }
    },
    options: { unref: true },
  })

  scheduler.start(taskName)
}
```

### Key Behaviors

- **Namespaced task names** — `plugin:finance:daily-summary` prevents collision with core tasks.
- **Per-user execution** — Jobs iterate over users who have the plugin enabled. Handler receives `userId`.
- **Error isolation** — A failure for one user doesn't stop execution for other users.
- **Automatic cleanup** — On deactivation, the framework calls `scheduler.unregister()` for all `plugin:{pluginId}:*` tasks.
- **Retry behavior** — Inherits central scheduler's exponential backoff (3 retries, max 60s delay).

### Coexistence with Core Scheduler Tasks

| Task Name                      | Owner  | Interval |
| ------------------------------ | ------ | -------- |
| `recurring-tasks`              | Core   | 60s      |
| `deferred-scheduled-poll`      | Core   | 60s      |
| `deferred-alert-poll`          | Core   | 5min     |
| `user-cache-cleanup`           | Core   | 5min     |
| `message-cache-sweep`          | Core   | 24h      |
| `message-cleanup`              | Core   | 1h       |
| `wizard-session-cleanup`       | Core   | 10min    |
| `plugin:finance:daily-summary` | Plugin | cron     |
| `plugin:github:sync-issues`    | Plugin | 15min    |

All managed by the same scheduler instance, sharing the same graceful shutdown path.

---

## Section 7: Gradual Migration Path

### Phase 1: Plugin Infrastructure (No Migration)

Build the plugin system. Existing code is **untouched**:

```
src/
├── plugins/               # NEW — plugin framework
│   ├── types.ts           # PluginInstance, PluginContext, PluginManifest
│   ├── discovery.ts       # scan plugins/ directory, validate manifests
│   ├── registry.ts        # PluginState, RegisteredPlugin, tracking
│   ├── context.ts         # PluginContext builder (scoped services, frozen)
│   ├── store.ts           # PluginStore implementation (plugin_kv table)
│   └── loader.ts          # import(), factory call, activate/deactivate
├── chat/                  # UNCHANGED
├── providers/             # UNCHANGED
├── tools/
│   └── index.ts           # MODIFIED — makeTools() merges plugin tools
├── system-prompt.ts       # MODIFIED — appends plugin prompt fragments
├── commands/
│   └── plugin.ts          # NEW — /plugin command (admin management)
└── index.ts               # MODIFIED — plugin discovery + loading at startup

plugins/                   # NEW — convention directory
└── .gitkeep
```

Changes to existing code are minimal: `makeTools()`, `buildSystemPrompt()`, `index.ts` startup/shutdown, and `/config` display.

### Phase 2: Validate with Real Plugins

Build 1-2 real plugins to prove the API. Good candidates already semi-independent in the codebase:

| Candidate            | Current location                                   | Why it's a good fit                                    |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| **Memos**            | `src/tools/memo-*.ts`                              | Own tools, own DB queries, no task provider dependency |
| **Recurring tasks**  | `src/scheduler.ts`, `src/tools/recurring-*.ts`     | Own tools + scheduler job + DB tables                  |
| **Deferred prompts** | `src/deferred-prompts/`, `src/tools/deferred-*.ts` | Own tools + two scheduler jobs + alert conditions      |

### Phase 3: Optional Provider Migration

Chat and task providers can become plugins later. The manifest supports a `providerType` field:

```typescript
// Future manifest extension — not built in Phase 1
type PluginManifest = {
  // ... existing fields ...
  providerType?: 'chat' | 'task'
}
```

**Explicitly out of scope for initial implementation.** Designed-for but not committed to.

### What Stays Core (Never Becomes a Plugin)

- Bot wiring (`bot.ts`) — message routing, authorization, wizard interception
- LLM orchestration (`llm-orchestrator.ts`) — the core generateText loop
- User management (`users.ts`) — authorization store
- Config system (`config.ts`, `cache.ts`) — per-user config infrastructure
- Conversation management (`conversation.ts`, `memory.ts`) — history, summaries, facts
- Plugin system itself (`src/plugins/`) — the framework that loads plugins

---

## Section 8: Error Handling & Testing

### Error Handling

Plugin errors follow the existing `AppError` pattern with plugin attribution in logs.

**Activation errors:** Plugin marked as `error` state, logged, skipped. Other plugins continue.

**Tool execution errors:** Caught by existing tool error handling in `llm-orchestrator.ts`. Logged with `{ plugin, tool, userId }`.

**Scheduler job errors:** Per-user failures logged and skipped. Central scheduler retry logic applies.

**Deactivation errors:** Logged, framework proceeds with cleanup regardless.

**User-facing errors:** Generic message like "The finance tool encountered an error." No internal details leak.

### Testing Strategy

**Plugin framework tests** (`tests/plugins/`):

| Test file             | What it covers                                                           |
| --------------------- | ------------------------------------------------------------------------ |
| `discovery.test.ts`   | Manifest parsing, Zod validation, duplicate ID detection, malformed JSON |
| `registry.test.ts`    | State transitions, admin approval/rejection, user opt-in resolution      |
| `context.test.ts`     | PluginContext construction, permission gating, Object.freeze enforcement |
| `store.test.ts`       | PluginStore CRUD, namespace isolation, secret encryption/decryption      |
| `loader.test.ts`      | Dynamic import, factory call, lifecycle, error boundaries                |
| `integration.test.ts` | makeTools() merging, buildSystemPrompt() appending, two-gate check       |

**Testing plugins themselves:**

A test helper provides a mock `PluginContext`:

```typescript
// tests/plugins/utils/mock-context.ts
function createMockPluginContext(overrides?: Partial<PluginContext>): PluginContext {
  return {
    pluginId: 'test-plugin',
    logger: mockLogger(),
    tools: { register: mock(() => {}) },
    prompts: { register: mock(() => {}) },
    scheduler: { register: mock(() => {}) },
    commands: { register: mock(() => {}) },
    store: createInMemoryStore(),
    taskProvider: createMockProvider(),
    chat: { sendMessage: mock(() => Promise.resolve()) },
    ...overrides,
  }
}
```

Follows the existing pattern: `createMockProvider()` in `tests/tools/mock-provider.ts`.

**Mock pollution prevention:** Plugin framework tests mock only `src/db/drizzle.js` (via `mockDrizzle()`) and clean up with `afterAll(() => { mock.restore() })`.
