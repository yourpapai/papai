<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status:** Re-baselined 2026-05-22 against the current `copilot/implement-plugin-system-implementation` worktree after merging `origin/master`.

**Goal:** Finish the trusted-local plugin-system MVP so approved plugins can safely contribute tools, prompt fragments, bot commands, scheduled jobs, and context-scoped storage without weakening authorization, provider capability checks, context isolation, or startup reliability.

**Architecture:** Keep plugins as trusted, repository-local extensions discovered from `plugins/<plugin-id>/plugin.json`, approved by the bot admin, and enabled per personal or managed-group context. Persist admin approval and context opt-in in SQLite; keep runtime activation/compatibility as recomputed process state. Expose plugins through narrow framework facades and merge eligible contributions into existing tool, prompt, command, scheduler, and `/config` paths.

**Tech Stack:** Bun, TypeScript, Zod v4, Drizzle SQLite, Vercel AI SDK `ToolSet`, existing papai chat/task provider capability types, pino logging, existing scheduler and config-editor flows.

---

## Source documents and current baseline

- Approved design spec: `docs/superpowers/specs/2026-03-30-plugin-system-design.md`.
- Developer docs to keep synchronized: `docs/plugins/developer-guide.md` and `docs/plugins/examples/hello-world/`.
- Current implementation already includes:
  - `src/plugins/types.ts`, `discovery.ts`, `store.ts`, `registry.ts`, `context.ts`, `contributions.ts`, `loader.ts`.
  - `src/db/plugin-schema.ts` and registered migration `src/db/migrations/039_plugins.ts`.
  - Plugin integration in `src/tools/index.ts`, `src/system-prompt.ts`, `src/commands/config.ts`, `src/commands/plugin.ts`, `src/chat/plugin-interaction-handler.ts`, `src/chat/interaction-router.ts`, and `src/index.ts`.
  - `plugins/.gitkeep` and example docs under `docs/plugins/examples/hello-world/`.

## Spec alignment decisions

The approved design aimed at both first-party modularity and future third-party extensibility. The current MVP must narrow that safely:

| Design topic        | Refined MVP decision                                                                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trust model         | Trusted local first-party plugins only. No sandbox, marketplace, npm package installation, arbitrary third-party loading, or permission-based process isolation.                                                             |
| Entry contract      | Canonical contract is a default-exported factory function returning a plugin instance with `activate(ctx)` and optional `deactivate(ctx)`. Existing object-export code must be migrated or explicitly compatibility-wrapped. |
| Runtime state       | Approval state is persisted; active/error/incompatible/config-missing eligibility is recomputed each startup or per context. Do not persist runtime `active` as a startup terminal state.                                    |
| Secrets             | No plugin KV secrets in MVP. Sensitive plugin config uses the existing config editor/storage masking path only. Encrypted plugin secret storage requires a later security design.                                            |
| Config missing      | Required config is context-specific. Treat it as an eligibility reason for a selected context, not a global plugin activation state that blocks all contexts.                                                                |
| Provider access     | Plugins do not receive raw chat/task providers. Tool executions receive context-bound facades derived from the active user/context/provider.                                                                                 |
| Prompt fragments    | Synchronous only. No async prompt builder migration in this plan.                                                                                                                                                            |
| Jobs and commands   | Still in MVP because the spec and manifest already advertise them, but they are not complete in the current implementation and need explicit phases below.                                                                   |
| Migration numbering | `039_plugins` is canonical in this branch because migrations `034`-`038` landed from `origin/master`. Do not renumber it. The unregistered `028_plugins` file is stale and must be removed or marked obsolete.               |
| Hot reload          | Out of scope. Admin approval and rejection affect the next startup unless a later explicit reload design is added. Per-context enable/disable takes effect on the next tool/prompt assembly.                                 |
| Provider-as-plugin  | Out of scope. The manifest can evolve later, but chat/task providers remain core code.                                                                                                                                       |

## Current implementation status by phase

| Original phase                         | Status         | Evidence / gap                                                                                                                                                    |
| -------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1: types and manifest validation | Mostly present | `src/plugins/types.ts` exists, but tests need directory mismatch, duplicate contributions, and contract coverage.                                                 |
| Phase 2: database schema and storage   | Mostly present | `039_plugins` is the canonical registered migration; Task 1 re-baselines docs and removes the stale unregistered `028_plugins.ts` file.                           |
| Phase 3: discovery                     | Partial        | Discovery exists, but tests cover only the happy path. Missing invalid JSON, missing dir, symlink/path escape, duplicate ID, and deterministic ordering coverage. |
| Phase 4: registry/compatibility        | Partial        | Approval and capability checks exist, but runtime states are persisted and can strand plugins across restarts. Required config is not evaluated.                  |
| Phase 5: context/services              | Partial        | KV/log/tool/prompt registration exist. Jobs, commands, task/chat facades, strict thrown rejection, and deep freezing are incomplete.                              |
| Phase 6: loader/lifecycle              | Partial        | Import, timeout, failure isolation, and reverse deactivation exist. Success path, cleanup, factory shape, timeout, and reverse-order tests are incomplete.        |
| Phase 7: tool integration              | Partial        | Tools are merged for active context, but plugin tool execution lacks context-bound provider/user facades.                                                         |
| Phase 8: prompt integration            | Mostly present | Prompt fragments are appended with budgets/delimiters; tests do not cover active/inactive context behavior.                                                       |
| Phase 9: commands/interactions         | Partial        | `/plugin` and `plg:` route exist. Admin UX, restart messaging, list/info details, and callback tests are thin.                                                    |
| Phase 10: `/config` opt-in/config      | Partial        | Active plugin toggles appear; plugin config requirements, sensitive masking, and missing-config gating are not implemented.                                       |
| Phase 11: startup/shutdown             | Partial        | Discovery/activation/deactivation are wired in `src/index.ts`; runtime-state re-evaluation semantics need correction.                                             |
| Phase 12: docs/examples                | Partial        | Developer guide and example exist but drift from code and spec.                                                                                                   |
| Phase 13: lifecycle tests              | Missing        | No end-to-end discover → approve → activate → opt-in → tool/prompt → deactivate test.                                                                             |

## Critical correctness gaps to fix before real plugin use

1. **Persisted runtime state breaks restarts.** `plugin_admin_state.state` currently stores runtime values such as `active`, `error`, and `incompatible`; startup restores them and only activates `approved` entries. A previously active plugin can therefore be skipped after restart.
2. **Plugin API drift.** The approved spec describes a default factory returning an instance. Current runtime accepts a default object with `activate()`. Developer docs and example are also inconsistent about where `PluginFactory` is exported from.
3. **Global plugin tools lack execution context.** Activation stores process-global tool functions. Tool execution does not receive the active task provider, storage context, chat user ID, or context-bound service facades.
4. **Advertised manifest surface is larger than runtime support.** `commands`, `jobs`, `scheduler`, `chat.send`, `tasks.read`, and `tasks.write` are declared but not implemented or meaningfully denied beyond storage.
5. **Required config is parsed but unused.** Active plugins can expose tools/prompts for contexts that are missing required plugin config.
6. **Test coverage does not match the risk.** Discovery, loader lifecycle, prompt/config/tool eligibility, plugin interactions, and end-to-end lifecycle tests are insufficient.

## Pre-implementation hardening pass (2026-05-23)

This short pass was completed before starting Task 2 implementation to reduce rework risk and lock immediate execution gates.

- [x] **Baseline verification run**

  Executed successfully:

  ```bash
  bun test tests/plugins tests/commands/plugin.test.ts tests/commands/config.test.ts tests/system-prompt.test.ts
  bun typecheck
  ```

  Observed: 105 tests passing, 0 failing, and TypeScript check clean.

- [x] **Plan-to-code drift recheck**

  Re-validated current code status against this plan in:
  - `src/plugins/{types,discovery,registry,context,contributions,loader,store}.ts`
  - `src/tools/index.ts`
  - `src/system-prompt.ts`
  - `src/commands/{plugin,config}.ts`
  - `src/chat/{plugin-interaction-handler,interaction-router}.ts`
  - `src/index.ts`

- [x] **Migration baseline recheck**

  Confirmed `src/db/index.ts` registers `migration039Plugins` exactly once and no `028_plugins` migration file is present.

- [x] **Missing test-file inventory recheck**

  Confirmed expected gaps remain:
  - missing: `tests/plugins/context.test.ts`
  - missing: `tests/plugins/integration.test.ts`
  - missing: `tests/chat/plugin-interaction-handler.test.ts`
  - present but not plugin-focused yet: `tests/commands/config.test.ts`

- [x] **Decision gate A: entry contract strictness (required before Task 3 merge)**

  Required explicit choice:
  - strict factory-only default export, or
  - temporary object-export compatibility wrapper.

  Recommended default for this MVP: strict factory-only contract with one transitional compatibility release note in developer docs.

  Decision: strict factory-only default export. Object-style default exports are rejected and documented in the developer guide.

- [x] **Decision gate B: durable vs runtime state split (required before Task 2 merge)**

  Required explicit choice:
  - keep durable admin state as `approved/discovered/rejected` only,
  - move `active/error/incompatible/config_missing` to recomputed runtime state + runtime events.

  Recommended default: keep transient states out of durable admin state and recompute runtime eligibility each startup.

  Decision: durable admin state is normalized to approval state on discovery; transient active/error/incompatible state stays in process memory and runtime events.

- [x] **Decision gate C: Task 7 MVP surface (required before Task 7 starts)**

  Required explicit choice:
  - implement plugin commands/jobs in MVP, or
  - remove them from MVP manifest/docs in a single deferral commit.

  Recommended default: implement minimal namespaced command/job support if it can be completed with deterministic cleanup and test coverage in this branch; otherwise defer explicitly in one commit.

  Decision: implement minimal namespaced command and scheduled-job contribution support in the MVP.

---

## Task 1: Re-baseline docs and canonical migration state

**Status:** Completed 2026-05-22.

**Files:**

- Modify: `docs/superpowers/remaining/2026-03-30-plugin-system-implementation.md`
- Modify: `docs/superpowers/plans/2026-03-30-plugin-system-implementation.md`
- Delete or explicitly obsolete: `src/db/migrations/028_plugins.ts`
- Keep: `src/db/migrations/039_plugins.ts`
- Test: `tests/db/migrations/039_plugins.test.ts`

- [x] **Step 1: Update remaining-work status**

  Replace the stale `not_implemented` summary with a phase matrix matching the table in this plan:
  - completed/mostly present: phases 1, 2, parts of 8, base docs
  - partial: phases 3-11
  - missing: phase 13 and several targeted tests

- [x] **Step 2: Remove ambiguity around `028_plugins`**

  Keep `039_plugins` as the canonical registered migration. Do not renumber it. Remove stale `028_plugins.ts` unless there is an explicit compatibility reason to keep an unregistered migration file. If kept, add a header comment saying it is obsolete and not registered, but deletion is preferred to avoid future accidental imports.

- [x] **Step 3: Verify migration list**

  Run:

  ```bash
  bun test tests/db/migrations/039_plugins.test.ts tests/db/index.test.ts
  ```

  Expected: all tests pass and `MIGRATIONS` includes `039_plugins` exactly once.

- [x] **Step 4: Commit**

  ```bash
  git add docs/superpowers/remaining/2026-03-30-plugin-system-implementation.md \
    docs/superpowers/plans/2026-03-30-plugin-system-implementation.md \
    src/db/migrations/028_plugins.ts src/db/migrations/039_plugins.ts \
    tests/db/migrations/039_plugins.test.ts
  git commit -m "docs: rebaseline plugin system implementation plan"
  ```

## Task 2: Fix persisted approval state vs runtime state

**Files:**

- Modify: `src/plugins/registry.ts`
- Modify: `src/plugins/store.ts`
- Modify: `src/index.ts`
- Test: `tests/plugins/registry.test.ts`
- Test: `tests/plugins/store.test.ts`
- Create: `src/plugins/compatibility.ts` (startup eligibility evaluation; replaces the optional `runtime.ts` considered in the original plan)

- [x] **Step 1: Write failing restart-state tests**

  Add tests proving these behaviors:
  - an entry persisted as `active` with a matching approved manifest hash is treated as eligible for activation on the next startup
  - an entry persisted as `error` with a matching approved manifest hash is reconsidered on the next startup, not permanently skipped
  - an `incompatible` plugin can recover to eligible when required capabilities later become available
  - a changed manifest hash still reverts to `discovered` and clears approval

- [x] **Step 2: Normalize persisted state on discovery**

  Implement a pure helper, for example:

  ```typescript
  const resolveStartupState = (state: PluginState, hasApprovedHash: boolean): PluginState => {
    if (state === 'rejected') return 'rejected'
    if (state === 'discovered') return 'discovered'
    if (hasApprovedHash) return 'approved'
    return 'discovered'
  }
  ```

  Use this during `registerDiscovered()` so runtime states from previous processes do not block activation.

- [x] **Step 3: Stop persisting transient `active` as the durable admin decision**

  Either:
  1. move active/error/incompatible to an in-memory runtime map in `src/plugins/runtime.ts`, or
  2. keep writing diagnostics to `plugin_runtime_events` and keep `plugin_admin_state.state` as `approved`/`discovered`/`rejected` only.

  The preferred shape is option 1 if `/plugin list` needs to show runtime status separately from durable approval.

- [x] **Step 4: Re-evaluate compatibility every startup**

  Ensure `src/index.ts` calls compatibility evaluation for every plugin whose durable state is approved, not only plugins restored as literal `approved` after previous runtime states.

- [x] **Step 5: Verify**

  Run:

  ```bash
  bun test tests/plugins/registry.test.ts
  bun typecheck
  ```

  Expected: registry tests pass and no TypeScript errors.

- [x] **Step 6: Commit**

  ```bash
  git add src/plugins/registry.ts src/plugins/store.ts src/index.ts tests/plugins/registry.test.ts src/plugins/compatibility.ts tests/plugins/store.test.ts
  git commit -m "fix: separate plugin approval from runtime state"
  ```

## Task 3: Align the plugin entry contract and context API

**Files:**

- Modify: `src/plugins/types.ts`
- Modify: `src/plugins/context.ts`
- Modify: `src/plugins/loader.ts`
- Modify: `docs/plugins/developer-guide.md`
- Modify: `docs/plugins/examples/hello-world/index.ts`
- Test: `tests/plugins/types.test.ts`
- Test: `tests/plugins/loader.test.ts`
- Create: `tests/plugins/context.test.ts`

- [x] **Step 1: Write failing contract tests**

  Cover:
  - default export function returning `{ activate, deactivate? }` is accepted
  - default export object is rejected or explicitly compatibility-wrapped; choose one behavior and document it
  - `activate(ctx)` returning contributions is not required; registration APIs are authoritative
  - undeclared tool/prompt registration throws an explicit error rather than only logging
  - `ctx`, `ctx.registration`, `ctx.kv`, and `ctx.log` are frozen or otherwise non-replaceable
  - storage permission denial throws when `ctx.kv` is used without `storage`

- [x] **Step 2: Define the canonical plugin types**

  Use this public shape unless a later design update explicitly changes it:

  ```typescript
  export type PluginInstance = {
    activate(ctx: PluginContext): Promise<void> | void
    deactivate?(ctx: PluginContext): Promise<void> | void
  }

  export type PluginFactory = () => PluginInstance
  ```

- [x] **Step 3: Update the loader import path**

  `importPluginModule()` should import the module, extract `default`, require it to be a function, call it once, and validate that the returned instance has an `activate` function.

- [x] **Step 4: Keep `PluginContext` intentionally narrow**

  For this task, keep the already-supported MVP context surface:
  - `pluginId`
  - `contextId`
  - `permissions`
  - `kv`
  - `log`
  - `registration.registerTool()`
  - `registration.registerPromptFragment()`

  Jobs, commands, task facades, and chat facades are added in later tasks so this task stays reviewable.

- [x] **Step 5: Sync developer docs and example**

  Update `docs/plugins/developer-guide.md` and `docs/plugins/examples/hello-world/index.ts` so the example imports `PluginFactory` from `src/plugins/types.js`, exports a function, and uses only supported context properties.

- [x] **Step 6: Verify**

  Run:

  ```bash
  bun test tests/plugins/types.test.ts tests/plugins/loader.test.ts tests/plugins/context.test.ts
  bun lint
  bun typecheck
  ```

- [x] **Step 7: Commit**

  ```bash
  git add src/plugins/types.ts src/plugins/context.ts src/plugins/loader.ts \
    docs/plugins/developer-guide.md docs/plugins/examples/hello-world/index.ts \
    tests/plugins/types.test.ts tests/plugins/loader.test.ts tests/plugins/context.test.ts
  git commit -m "fix: align plugin entry contract with design"
  ```

## Task 4: Complete discovery hardening and diagnostics

**Files:**

- Modify: `src/plugins/discovery.ts`
- Test: `tests/plugins/discovery.test.ts`

- [x] **Step 1: Write missing discovery tests**

  Add tests for:
  - missing `plugins/` directory returns no plugins and no errors
  - invalid JSON reports a discovery error without throwing
  - manifest `id` mismatch with directory name reports an error
  - unsafe `main` path with `..` or absolute path is rejected
  - symlinked plugin directory is rejected
  - symlinked entry point resolving outside the plugin dir is rejected
  - duplicate plugin IDs are defensively handled; current strict `manifest.id === directoryName` validation makes duplicate valid IDs unreachable through normal directory discovery, so coverage asserts that invariant instead of manufacturing an impossible duplicate fixture
  - discovered plugins are sorted by ID/directory order

- [x] **Step 2: Fix implementation only where tests expose gaps**

  Keep discovery synchronous if that remains simpler for startup. Preserve the existing `DiscoveryResult` shape and structured warning logs.

- [x] **Step 3: Verify**

  Run:

  ```bash
  bun test tests/plugins/discovery.test.ts
  bun lint
  ```

- [x] **Step 4: Commit**

  ```bash
  git add src/plugins/discovery.ts tests/plugins/discovery.test.ts
  git commit -m "test: harden plugin discovery coverage"
  ```

## Task 5: Implement context-bound plugin tool execution

**Files:**

- Modify: `src/plugins/types.ts`
- Modify: `src/plugins/contributions.ts`
- Modify: `src/tools/index.ts`
- Modify: `src/plugins/context.ts`
- Create: `src/plugins/tool-runtime.ts` (per-request `PluginToolRuntimeContext` and task provider facade; emerged from the optional `runtime.ts` in Task 2)
- Test: `tests/plugins/contributions.test.ts`
- Test: `tests/tools/tools-builder.test.ts`

- [x] **Step 1: Write failing tool eligibility and runtime-context tests**

  Cover:
  - built-in tools remain present when no plugin is active
  - an approved, active, context-enabled plugin contributes namespaced tools
  - disabled plugins do not contribute tools
  - a plugin tool receives the active `storageContextId`, `chatUserId`, provider-derived task facade, and plugin KV facade
  - plugin tools requiring `tasks.read` or `tasks.write` fail closed without that permission
  - collisions with built-in or other plugin names are rejected deterministically

- [x] **Step 2: Introduce a runtime tool context**

  Add a type similar to:

  ```typescript
  export type PluginToolRuntimeContext = {
    pluginId: string
    storageContextId: string
    chatUserId: string
    taskProvider: TaskProviderFacade
    kv: PluginKvStore
  }
  ```

  The facade should expose only operations allowed by plugin permissions. If a complete task facade is too large, start with no raw provider exposure and make task facades a separate subtask before enabling `tasks.read`/`tasks.write` permissions.

- [x] **Step 3: Build plugin tools per tool assembly**

  `makeTools(provider, options)` should build plugin tools for the active context using current `provider`, `storageContextId`, and `chatUserId`, not rely on globally bound execution state from activation.

- [x] **Step 4: Preserve wrapping and attribution**

  Plugin tool executions must continue to flow through `wrapToolExecution()` and include the namespaced tool name in logs/errors.

- [x] **Step 5: Verify**

  Run:

  ```bash
  bun test tests/plugins/contributions.test.ts tests/tools/tools-builder.test.ts
  bun typecheck
  ```

- [x] **Step 6: Commit**

  ```bash
  git add src/plugins/types.ts src/plugins/contributions.ts src/tools/index.ts src/plugins/context.ts \
    src/plugins/tool-runtime.ts tests/plugins/contributions.test.ts tests/tools/tools-builder.test.ts
  git commit -m "feat: bind plugin tools to active execution context"
  ```

## Task 6: Make required plugin config part of context eligibility

**Files:**

- Modify: `src/plugins/registry.ts`
- Modify: `src/commands/config.ts`
- Modify: `src/chat/plugin-interaction-handler.ts`
- Modify: `src/config.ts` only if existing helpers are insufficient
- Test: `tests/plugins/registry.test.ts`
- Test: `tests/commands/config.test.ts`
- Test: `tests/chat/plugin-interaction-handler.test.ts`
- Test: `tests/tools/tools-builder.test.ts`
- Test: `tests/system-prompt.test.ts`

- [x] **Step 1: Write failing eligibility tests**

  Cover:
  - active plugin with missing required config is shown as unavailable/missing config for that target context
  - missing required config prevents tool and prompt exposure for that context
  - optional config does not block exposure
  - sensitive config values are masked with existing `maskValue()` behavior or an explicit plugin-sensitive mask
  - managed-group target validation matches existing `/config` group-target rules

- [x] **Step 2: Add an eligibility helper**

  Add a helper such as:

  ```typescript
  export type PluginContextEligibility =
    | { eligible: true }
    | { eligible: false; reason: 'inactive' | 'disabled' | 'config_missing'; missingKeys?: readonly string[] }
  ```

  Use it from tools, prompt, config rendering, and interaction responses so all surfaces agree.

- [x] **Step 3: Render plugin config requirements in `/config`**

  For the selected target context, show plugin config rows under the plugin entry. Required missing fields should be visible and actionable. Sensitive values must never be printed raw.

- [x] **Step 4: Verify**

  Run:

  ```bash
  bun test tests/plugins/registry.test.ts tests/commands/config.test.ts \
    tests/chat/plugin-interaction-handler.test.ts tests/tools/tools-builder.test.ts tests/system-prompt.test.ts
  bun lint
  bun typecheck
  ```

- [x] **Step 5: Commit**

  ```bash
  git add src/plugins/registry.ts src/commands/config.ts src/chat/plugin-interaction-handler.ts \
    tests/plugins/registry.test.ts tests/commands/config.test.ts tests/chat/plugin-interaction-handler.test.ts \
    tests/tools/tools-builder.test.ts tests/system-prompt.test.ts
  git commit -m "feat: gate plugins by context config"
  ```

## Task 7: Implement command and scheduler job contributions or remove them from MVP manifest

**Files:**

- Modify: `src/plugins/types.ts`
- Modify: `src/plugins/context.ts`
- Modify: `src/plugins/contributions.ts`
- Modify: `src/plugins/loader.ts`
- Modify: `src/bot.ts`
- Modify: `src/scheduler-instance.ts` or the existing scheduler integration point
- Create: `src/plugins/command-contributions.ts` (namespaced command registration and cleanup)
- Create: `src/plugins/contribution-names.ts` (contribution naming/namespacing helpers)
- Test: `tests/plugins/context.test.ts`
- Test: `tests/plugins/contributions.test.ts`
- Test: `tests/plugins/loader.test.ts`
- Test: command/scheduler tests as needed

- [x] **Step 1: Decide the MVP surface**

  Because the approved design and manifest currently include commands and jobs, the preferred path is to implement them. If implementation is intentionally deferred, remove `commands`, `jobs`, `scheduler`, and `commands` permission from the MVP schema/docs in one explicit commit and record the deferral.

- [x] **Step 2: Write failing tests for the chosen path**

  If implementing:
  - declared plugin command registers under a safe namespaced command or explicit plugin command namespace
  - undeclared command registration throws
  - declared scheduled job registers with a namespaced owner such as `plugin:<pluginId>:<jobName>`
  - job execution is scoped to contexts where the plugin is enabled
  - deactivation unregisters commands/jobs owned by that plugin

- [x] **Step 3: Implement framework-owned registration and cleanup**

  Track all command/job registrations by plugin ID in `contributionRegistry` or a companion registry. Deactivation must remove every contribution even if plugin `deactivate()` throws.

- [x] **Step 4: Verify**

  Run:

  ```bash
  bun test tests/plugins/context.test.ts tests/plugins/contributions.test.ts tests/plugins/loader.test.ts
  bun typecheck
  ```

- [x] **Step 5: Commit**

  ```bash
  git add src/plugins/types.ts src/plugins/context.ts src/plugins/contributions.ts src/plugins/loader.ts \
    src/plugins/command-contributions.ts src/plugins/contribution-names.ts \
    src/bot.ts src/scheduler-instance.ts tests/plugins/context.test.ts tests/plugins/contributions.test.ts tests/plugins/loader.test.ts
  git commit -m "feat: support plugin command and job contributions"
  ```

## Task 8: Tighten loader lifecycle, admin UX, and diagnostics

**Files:**

- Modify: `src/plugins/loader.ts`
- Modify: `src/plugins/store.ts`
- Modify: `src/commands/plugin.ts`
- Modify: `src/index.ts`
- Create: `src/plugins/prompt-contributions.ts` (prompt fragment contribution registry and budget enforcement)
- Test: `tests/plugins/loader.test.ts`
- Test: `tests/commands/plugin.test.ts`

- [x] **Step 1: Expand loader tests**

  Cover:
  - successful activation registers contributions and runtime event
  - import failure marks runtime error and records diagnostic
  - activation timeout cleans partial contributions
  - activation failure cleans partial contributions
  - deactivation runs in reverse activation order
  - deactivation error still cleans framework-owned contributions

- [x] **Step 2: Fix lifecycle behavior**

  Use bounded concurrency only where ordering does not matter. If reverse deactivation order is required, deactivation should execute deterministically rather than concurrently reversing a list and then racing all tasks.

- [x] **Step 3: Expand `/plugin` command tests**

  Cover list/info/approve/reject/enable/disable, non-admin denial, group-context denial, manifest-change reapproval message, incompatible diagnostics, runtime error diagnostics, and restart-required messaging.

- [x] **Step 4: Verify**

  Run:

  ```bash
  bun test tests/plugins/loader.test.ts tests/commands/plugin.test.ts
  bun lint
  ```

- [x] **Step 5: Commit**

  ```bash
  git add src/plugins/loader.ts src/plugins/store.ts src/commands/plugin.ts src/index.ts \
    src/plugins/prompt-contributions.ts tests/plugins/loader.test.ts tests/commands/plugin.test.ts
  git commit -m "fix: harden plugin lifecycle diagnostics"
  ```

## Task 9: Add end-to-end lifecycle coverage and final documentation sync

**Files:**

- Create: `tests/plugins/integration.test.ts`
- Modify: `tests/plugins/discovery.test.ts`
- Modify: `docs/plugins/developer-guide.md`
- Modify: `docs/plugins/examples/hello-world/index.ts`
- Modify: `docs/plugins/examples/hello-world/plugin.json`
- Modify: `docs/superpowers/remaining/2026-03-30-plugin-system-implementation.md`

- [x] **Step 1: Write the lifecycle integration test**

  Cover the complete happy path:
  1. create a temporary plugin directory with a valid manifest and entry point
  2. discover the plugin
  3. register it as discovered
  4. approve the manifest hash
  5. evaluate compatibility
  6. activate it
  7. enable it for a target context
  8. verify its tool appears in `makeTools()` only for that context
  9. verify its prompt fragment appears in `buildSystemPrompt()` only for that context
  10. deactivate it and verify contributions are gone

- [x] **Step 2: Add failure lifecycle tests**

  Cover manifest hash changes, missing provider capabilities, missing required config, activation failure, and context opt-out.

- [x] **Step 3: Sync docs to the finished MVP**

  The developer guide must accurately state:
  - trusted local plugin boundary
  - canonical factory contract
  - supported manifest fields
  - supported permissions and explicitly unsupported permissions
  - context-scoped enablement and config
  - no secrets in plugin KV
  - approval/restart behavior
  - validation commands for plugin developers

- [x] **Step 4: Update remaining-work doc**

  Mark completed phases and list only true follow-ups such as sandboxing, encrypted secrets, provider-as-plugin migration, and hot reload.

- [x] **Step 5: Final verification**

  Run:

  ```bash
  bun check:full
  bun security
  ```

  Expected: `bun check:full` passes 12/12 checks. `bun security` has no new plugin-loading, path traversal, secret exposure, or unsafe-network findings.

- [x] **Step 6: Commit**

  ```bash
  git add tests/plugins/integration.test.ts tests/plugins/discovery.test.ts \
    docs/plugins/developer-guide.md docs/plugins/examples/hello-world/index.ts \
    docs/plugins/examples/hello-world/plugin.json \
    docs/superpowers/remaining/2026-03-30-plugin-system-implementation.md
  git commit -m "test: cover plugin lifecycle end to end"
  ```

---

## Final verification before merge

Run these after all tasks are complete:

```bash
bun check:full
bun security
```

Expected:

- `bun check:full`: 12/12 checks passed.
- `bun security`: no findings related to plugin loading/path traversal/secret exposure/network access.

## Non-goals for this plan

- Untrusted third-party sandboxing.
- Marketplace or npm-based plugin distribution.
- Encrypted plugin secret storage.
- Hot reload or restartless admin approval.
- Migrating chat or task providers into plugins.
- Async prompt fragment support.
- Raw DB, raw chat provider, raw task provider, raw process env, or arbitrary network access in plugin context.

## Drift Log

| Date       | Category               | Item                                                                                             | Decision                                                                                                                                 |
| ---------- | ---------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-23 | In-plan, stale anchors | Task 2 Step 6 commit checkbox `[ ]`                                                              | Flipped to `[x]`; code merged to master via PR #105                                                                                      |
| 2026-05-23 | In-plan, stale anchors | Task 3 Step 7 commit checkbox `[ ]`                                                              | Flipped to `[x]`; code merged to master via PR #105                                                                                      |
| 2026-05-23 | In-plan, stale anchors | Task 4 Step 4 commit checkbox `[ ]`                                                              | Flipped to `[x]`; code merged to master via PR #105                                                                                      |
| 2026-05-23 | In-plan, stale anchors | Task 5 Step 6 commit checkbox `[ ]`                                                              | Flipped to `[x]`; code merged to master via PR #105                                                                                      |
| 2026-05-23 | In-plan, stale anchors | Task 6 Step 5 commit checkbox `[ ]`                                                              | Flipped to `[x]`; code merged to master via PR #105                                                                                      |
| 2026-05-23 | In-plan, stale anchors | Task 7 Step 5 commit checkbox `[ ]`                                                              | Flipped to `[x]`; code merged to master via PR #105                                                                                      |
| 2026-05-23 | In-plan, stale anchors | Task 8 Step 5 commit checkbox `[ ]`                                                              | Flipped to `[x]`; code merged to master via PR #105                                                                                      |
| 2026-05-23 | In-plan, stale anchors | Task 9 Step 6 commit checkbox `[ ]`                                                              | Flipped to `[x]`; code merged to master via PR #105                                                                                      |
| 2026-05-23 | In-plan, divergent     | Task 2 "Consider create: `src/plugins/runtime.ts`" — not created                                 | Runtime concern split into `compatibility.ts` (startup eligibility) and `tool-runtime.ts` (Task 5); plan updated to reflect actual files |
| 2026-05-23 | Out-of-plan, on-goal   | `src/plugins/command-contributions.ts` — namespaced command registration (Task 7 scope)          | Added to Task 7 Files list                                                                                                               |
| 2026-05-23 | Out-of-plan, on-goal   | `src/plugins/compatibility.ts` — startup eligibility evaluation (Task 2 scope)                   | Added to Task 2 Files list                                                                                                               |
| 2026-05-23 | Out-of-plan, on-goal   | `src/plugins/contribution-names.ts` — contribution naming helpers (Task 7 scope)                 | Added to Task 7 Files list                                                                                                               |
| 2026-05-23 | Out-of-plan, on-goal   | `src/plugins/prompt-contributions.ts` — prompt fragment registry and budget enforcement (Task 8) | Added to Task 8 Files list                                                                                                               |
| 2026-05-23 | Out-of-plan, on-goal   | `src/plugins/tool-runtime.ts` — per-request `PluginToolRuntimeContext` and task facade (Task 5)  | Added to Task 5 Files list                                                                                                               |
| 2026-05-23 | Out-of-plan, on-goal   | `tests/plugins/store.test.ts` — plugin store layer tests (Task 2 scope)                          | Added to Task 2 Files list                                                                                                               |
