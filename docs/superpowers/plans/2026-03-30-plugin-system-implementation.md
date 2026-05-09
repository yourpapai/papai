# Plugin System Implementation Plan

> **Status:** Revised 2026-04-25 to align with the current papai codebase.
> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

## Goal

Add a robust first-party plugin framework for papai that lets approved local plugins contribute LLM tools, prompt fragments, commands, scheduled jobs, and scoped storage without weakening provider capability checks, user/group authorization, config isolation, or operational reliability.

The original plan referenced `docs/plans/2026-03-30-plugin-system-design.md`, but that file is not present in the current repository. Treat this document as the source of truth until a formal ADR/design document is added.

## Current project state to align with

- There is no `src/plugins/**`, `tests/plugins/**`, or top-level `plugins/` directory today.
- Provider capability surfaces already exist: `TaskCapability` in `src/providers/types.ts` and `ChatCapability` in `src/chat/types.ts`.
- `makeTools(provider, options?)` is implemented in `src/tools/index.ts` and delegates to `buildTools(...)` in `src/tools/tools-builder.ts`; it no longer accepts `(provider, userId, mode)` positional arguments.
- Tool execution is centrally wrapped in `src/tools/index.ts` through `wrapToolExecution`, so plugin tools must be merged before wrapping or wrapped through the same helper.
- `buildSystemPrompt(provider, contextId)` is synchronous in `src/system-prompt.ts`; prompt fragment support must remain synchronous unless a separate async prompt-building migration is done.
- Migrations currently run through `src/db/index.ts`; the latest migration is `027_scheduled_prompt_timezone`, so the first plugin migration must be numbered `028` unless newer migrations land first.
- `src/db/schema.ts` already imports `integer`, `primaryKey`, and `index`; plugin tables should follow the current Drizzle style and add query indexes.
- Interactive callbacks route through `src/chat/interaction-router.ts` with namespaced prefixes (`gsel:`, `cfg:`, `wizard_`). Plugin callbacks need a namespaced route there, not ad-hoc parsing in `bot.ts`.
- `/config` uses `serializeCallbackData()` from `src/config-editor/index.ts` and can target either the user context or a managed group context. Plugin opt-in must respect that target context.
- Startup/shutdown flows live in `src/index.ts`; shutdown is promise-chained through `flushOnShutdown(...)` and should deactivate plugins before provider/database teardown.
- Tests follow the repo's TDD conventions. Prefer dependency injection over broad top-level `mock.module()` usage.

## Gaps and flaws in the previous plan

1. It referenced nonexistent design docs, stale line numbers, old tool signatures, and outdated migration numbering.
2. It implied arbitrary local TypeScript dynamic imports without defining trust boundaries, dependency policy, path restrictions, or failure containment.
3. It advertised secret storage while storing plaintext with an `encrypted` flag.
4. It allowed async prompt fragments even though system prompt construction is currently synchronous.
5. It mentioned provider compatibility but did not tie it to current capability sets, app API compatibility, or state transitions.
6. It routed plugin callbacks outside the current interaction router pattern.
7. It lacked activation timeouts, partial-activation cleanup, duplicate registration protection, and deterministic deactivation.
8. It persisted only coarse plugin state and omitted manifest hashes, compatibility reasons, config status, and version-change handling.
9. It did not fully prevent tool/command collisions with built-in contributions or other plugins.
10. It lacked resource limits, observability, and a clear support boundary for untrusted third-party plugins.

## Design decisions

- **Trust boundary:** MVP plugins are trusted, local, first-party extensions loaded from repository-controlled `plugins/` subdirectories. Do not present this as a sandbox for arbitrary third-party code. Third-party marketplace support needs a separate ADR.
- **Default-disabled:** Discovered plugins are inert until a bot admin approves them. Users or managed group contexts then opt in unless an approved plugin explicitly declares `defaultEnabled: true`.
- **Compatibility as state:** A plugin can be approved but inactive because task/chat capabilities, app API version, required config, or manifest hash approval are missing.
- **Context-scoped data:** Opt-in, config, and storage must key by `contextId`, not just user ID, to support personal and group-targeted `/config` flows.
- **No plaintext secrets:** Secret storage is deferred from the MVP. Plugin config may mark fields as sensitive for display masking, but sensitive values must use the existing config editor/storage path until a dedicated encrypted plugin secret store is designed and implemented.
- **Synchronous prompt MVP:** Prompt fragments are strings or synchronous functions only.
- **Narrow service facades:** Plugins receive constrained framework services, not raw `TaskProvider` or `ChatProvider` instances, except through explicit context-bound facades.

## Target architecture

```text
plugins/<plugin-id>/plugin.json
plugins/<plugin-id>/index.ts
        │
        ▼
src/plugins/discovery.ts      validate manifests and filesystem boundaries
src/plugins/registry.ts       persist admin/context state and compatibility status
src/plugins/loader.ts         import approved compatible plugins and control lifecycle
src/plugins/context.ts        provide frozen registration/service facades
src/plugins/store.ts          context-scoped KV storage with no cross-plugin access
        │
        ├─ tools    → merged into makeTools() before wrapToolExecution()
        ├─ prompts  → appended by buildSystemPrompt() for active context
        ├─ commands → registered through ChatProvider command registration
        └─ jobs     → registered through scheduler with ownership and cleanup
```

## Manifest model

Create `src/plugins/types.ts` with a Zod schema and exported types.

Required manifest fields:

- `id`: lowercase kebab-case and equal to the containing directory name.
- `name`
- `version`: semantic version.
- `description`
- `apiVersion`: initially `1`.
- `main`: relative entry point, default `index.ts`; must stay inside the plugin directory.
- `contributes`: declared contribution names for tools, prompt fragments, commands, jobs, and config keys.
- `permissions`: framework permissions requested by the plugin.

Optional manifest fields:

- `author`
- `homepage`
- `license`
- `defaultEnabled`: only honored after admin approval.
- `requiredTaskCapabilities: TaskCapability[]`
- `requiredChatCapabilities: ChatCapability[]`
- `configRequirements`: context-scoped config fields with labels, required flags, and sensitivity metadata.
- `activationTimeoutMs`: bounded by framework defaults and maximums.

Validation rules:

- Reject unknown permissions and unknown capability strings.
- Reject contribution names that are not snake_case or kebab-case as appropriate for their namespace.
- Reject `main` paths that are absolute, contain `..`, resolve through symlinks outside the plugin directory, or do not end in `.ts` or `.js`.
- Reject duplicate plugin IDs and duplicate contribution names after namespacing.
- Persist a manifest hash and require re-approval when a previously approved plugin's manifest or entry point changes.

## Permission model

Use two layers of control:

1. **Admin approval:** controls whether a discovered plugin may be loaded at all.
2. **Context opt-in:** controls whether a plugin is available for a user or managed group context.

Initial permissions:

- `storage`: context-scoped KV access for the plugin.
- `scheduler`: ability to register owned scheduled jobs.
- `commands`: ability to register declared commands.
- `chat.send`: ability to send messages through a narrow chat service.
- `tasks.read`: read-only task provider facade.
- `tasks.write`: write-capable task provider facade, still limited by provider capabilities.
- `web.fetch`: optional future permission for public network access through the existing safe web subsystem only.

Permissions must be enforced when building the plugin context and again at execution time for context-bound services.

## Persistence model

Check `src/db/index.ts` for the highest registered migration and add the plugin migration with the next available immutable ID. At the time of this revision, the next migration is `028_plugins`.

- `plugin_admin_state`
  - `plugin_id`, `state`, `approved_by`, `approved_manifest_hash`, `last_seen_manifest_hash`, `compatibility_reason`, `updated_at`.
- `plugin_context_state`
  - `plugin_id`, `context_id`, `enabled`, `updated_at`.
- `plugin_kv`
  - `plugin_id`, `context_id`, `key`, `value`, `created_at`, `updated_at`.
  - Add indexes for `(plugin_id, context_id)` and prefix/list query patterns.
- `plugin_runtime_events` (optional for MVP if logs are sufficient)
  - compact activation/deactivation/error history for admin diagnostics.

Do not store secrets in `plugin_kv`. Adding `setSecret()`/`getSecret()` requires a separate task that adds authenticated encryption, key-management documentation, migration tests, and explicit security review.

## Implementation phases

### Phase 1: Types and manifest validation

- Add plugin manifest and runtime types in `src/plugins/types.ts`.
- Add tests for valid minimal/full manifests, invalid IDs, invalid capabilities, invalid permissions, unsafe `main` paths, and directory-name mismatch.
- Add an explicit `PLUGIN_API_VERSION` constant.

Validation:

- `bun test tests/plugins/types.test.ts`
- `bun typecheck`

### Phase 2: Database schema and state storage

- Add migration `028_plugins` and Drizzle schema exports.
- Add repository functions for admin state, context state, manifest hashes, and KV operations.
- Ensure migration IDs are immutable once committed.

Validation:

- DB migration unit tests.
- `bun test tests/db tests/plugins`
- `bun typecheck`

### Phase 3: Discovery

- Discover direct children of `plugins/` that contain `plugin.json`.
- Resolve real paths and reject symlink/path traversal escapes.
- Validate manifests with the schema.
- Record invalid discoveries as diagnostics without loading code.
- Keep discovery deterministic by sorting directory entries.

Validation:

- Discovery tests for missing directory, invalid JSON, duplicate IDs, unsafe paths, directory mismatch, and deterministic ordering.

### Phase 4: Registry and compatibility evaluation

- Implement `src/plugins/registry.ts`.
- Track states: `discovered`, `approved`, `rejected`, `incompatible`, `config_missing`, `active`, `error`.
- Evaluate compatibility against current task provider capabilities, chat provider capabilities, plugin API version, manifest hash approval, and required config.
- Persist admin/context decisions separately from runtime state.

Valid state transitions:

| From                       | To               | Trigger                                                     |
| -------------------------- | ---------------- | ----------------------------------------------------------- |
| none                       | `discovered`     | Manifest is discovered and validates.                       |
| `discovered`               | `approved`       | Bot admin approves current manifest hash.                   |
| `discovered`               | `rejected`       | Bot admin rejects plugin.                                   |
| `rejected`                 | `approved`       | Bot admin explicitly re-approves plugin.                    |
| `approved`                 | `incompatible`   | Required task/chat capability or API version is missing.    |
| `approved`                 | `config_missing` | Required plugin config is absent for the target context.    |
| `approved`                 | `active`         | Plugin loads and activates successfully.                    |
| `active`                   | `approved`       | Plugin deactivates cleanly during shutdown/reload.          |
| `active`                   | `error`          | Runtime activation or contribution registration fails.      |
| any approved-derived state | `discovered`     | Manifest or entry point hash changes and needs re-approval. |
| any state                  | `rejected`       | Bot admin rejects or disables plugin globally.              |

Validation:

- Registry tests for approvals, rejections, manifest hash changes, context opt-in, compatibility reasons, and config-missing state.

### Phase 5: Context builder and service facades

- Build a frozen `PluginContext` with registration APIs for declared contributions only.
- Reject undeclared tools, prompts, jobs, commands, and config keys.
- Provide plugin-scoped logger metadata: `{ scope: 'plugin', pluginId }`.
- Implement a context-scoped KV store; do not include secret methods until encrypted storage exists.
- Provide task/chat facades only when permissions allow them.

Validation:

- Context tests for permission denial, declaration enforcement, frozen objects, scoped storage, and service facade behavior.

### Phase 6: Loader and lifecycle

- Load only approved and compatible plugins.
- Import entry points only after path validation.
- Require a default factory that returns an object with `activate(ctx)` and optional `deactivate(ctx)`.
- Apply activation timeout and fail one plugin without aborting startup.
- On partial activation failure, unregister contributions and mark the plugin `error`.
- Deactivate active plugins in reverse activation order during shutdown.

Validation:

- Loader tests for activation success, activation failure, timeout, cleanup, rejected/incompatible skip, and reverse deactivation.

### Phase 7: Tool integration

- Add a small plugin contribution collector that can be injected into `buildTools`/`makeTools` for tests.
- Merge plugin tools for the active `storageContextId`/`chatUserId` only.
- Namespace tool names as `plugin_<pluginId>__<toolName>` or another deterministic safe format that cannot collide with built-ins.
- Wrap plugin tool execute functions with `wrapToolExecution` and include plugin metadata in errors/logs.
- Enforce provider capability requirements again at tool build/execution time.

Validation:

- Tests that active opted-in plugins add tools, inactive plugins do not, built-in tools remain, collisions are rejected, and thrown plugin errors are wrapped.
- `bun test tests/tools tests/plugins`

### Phase 8: Prompt integration

- Append prompt fragments from active opted-in plugins in `buildSystemPrompt(provider, contextId)`.
- Keep fragments synchronous for MVP.
- Add delimiters and plugin IDs around fragments for diagnostics.
- Enforce a maximum fragment length per plugin and a maximum total plugin prompt budget.

Validation:

- Tests for active/inactive fragments, ordering, length limits, and provider addendum preservation.

### Phase 9: Commands and interactions

- Add `src/commands/plugin.ts` for bot-admin plugin management.
- Register `/plugin` through `src/commands/index.ts` and `setupBot()`.
- Add plugin callback handling to `src/chat/interaction-router.ts` under a namespaced prefix such as `plg:`.
- Require bot-admin authorization for admin actions.
- Prefer capability-aware buttons and formatted fallback text.

Validation:

- Command tests for no plugins, list, approve, reject, incompatibility display, manifest-change reapproval, and non-admin denial.
- Interaction-router tests for the `plg:` prefix.

### Phase 10: `/config` context opt-in and plugin config

- Extend config rendering to show approved compatible plugins for the selected target context.
- Add enable/disable buttons using the current config callback serialization patterns or the new `plg:` route with explicit target context encoding.
- Show plugin config requirements with masking for sensitive values.
- Respect group-target validation exactly like existing `/config` fields.

Validation:

- Config tests for personal target, managed group target, inaccessible group target, no-button fallback, and sensitive masking.

### Phase 11: Startup and shutdown

- Create `plugins/.gitkeep`.
- Initialize discovery, registry, compatibility evaluation, and loading in `src/index.ts` after chat/task providers and scheduler services are available.
- Set the plugin registry/contribution provider before LLM message processing can build tools.
- Deactivate plugins during graceful shutdown before scheduler/database closure.

Validation:

- Startup tests where feasible through dependency-injected helpers.
- `bun typecheck`

### Phase 12: Documentation and examples

- Add developer docs explaining the trust model, manifest schema, permissions, context scoping, and supported APIs.
- Add one minimal example plugin under docs or tests, not enabled at runtime by default.
- Document that untrusted third-party plugins are not supported by the MVP.

Validation:

- `bun format:check`

### Phase 13: End-to-end lifecycle tests

- Add a lifecycle test that covers discover → approve → compatibility check → activate → context opt-in → tool/prompt availability → deactivate.
- Add failure-path tests for manifest changes, missing config, missing provider capabilities, and activation failure.

Validation:

- `bun test tests/plugins`
- `bun test`
- `bun typecheck`
- `bun lint`
- `bun format:check`

## Security and operational checklist

- Do not load unapproved plugins.
- Do not load plugins with changed manifests or entry points until re-approved.
- Do not follow symlinks outside the plugin directory.
- Do not expose raw DB, raw chat provider, raw task provider, process env, or arbitrary network helpers in plugin context.
- Do not store plugin secrets in plaintext.
- Do not allow plugin contribution names to collide with built-in or other plugin contributions.
- Enforce activation and tool execution timeouts.
- Use `p-limit` or equivalent bounded concurrency for batch plugin operations.
- Log plugin failures with plugin ID and contribution name, never with secrets.
- Keep plugin failures isolated: one failing plugin must not prevent papai startup unless explicitly configured as required.

## Final verification before merging implementation

Run the smallest relevant checks after each phase, then before merge run:

```bash
bun lint
bun typecheck
bun format:check
bun test
```

Run `bun security` if plugin implementation touches loading, path handling, storage, secrets, network access, or execution boundaries.
