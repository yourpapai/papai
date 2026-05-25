<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0123: Trusted-Local Plugin System

## Status

Implemented

## Date

2026-03-30 – 2026-05-23

## Context

papai's tool and prompt surface was growing in a flat, unstructured way. Every
new capability landed directly in core modules (`src/tools/`, `src/system-prompt.ts`,
`src/scheduler-instance.ts`). There was no way for the bot admin to add
domain-specific capabilities — such as finance tracking or CI/CD monitoring —
without forking core files and accepting merge conflicts on every upstream update.

The original design spec (`docs/archive/2026-03-30-plugin-system-design.md`)
aimed at two goals simultaneously: internal modularity and future third-party
extensibility. The MVP implementation narrowed these goals deliberately to reduce
risk and avoid shipping a partially-trusted security boundary.

The implementation plan (`docs/archive/2026-03-30-plugin-system-implementation.md`)
was re-baselined on 2026-05-22 after migrations `034`–`038` landed from
`origin/master` (which set the canonical migration to `039_plugins`). The full
implementation was merged via PR #105 and verified with 160 passing tests.

## Decision Drivers

- **Security first**: A partially-sandboxed plugin loading arbitrary npm packages
  is worse than no plugin system at all. Trust must be explicit and verifiable.
- **No regression risk**: Chat/task providers are core code; migrating them into
  plugins must not be a prerequisite for any plugin MVP feature.
- **Admin control**: The bot operator must review and approve each plugin before
  it can activate; per-user or per-group opt-in is a second gate.
- **Correctness over completeness**: Runtime activation state must not be
  persisted in a way that silently skips previously-broken plugins after restart.
- **Narrow context API**: Plugins must not receive raw DB handles, raw chat
  providers, raw task providers, or `process.env` access.

## Considered Options

### Option A: Full third-party plugin marketplace

Allow plugins installed from npm or a registry. Ship with per-plugin process
sandboxing and a secret store.

- **Pros**: Ecosystem growth potential; aligns with the spec's third-party goal.
- **Cons**: vm sandbox (Node/Bun) is not a security boundary for malicious code;
  secret store design is non-trivial; npm supply-chain risk; far exceeds MVP scope.

### Option B: Trusted-local plugins only (chosen)

Plugins live in `plugins/<plugin-id>/` inside the repository. The admin approves
each plugin by manifest hash. No sandbox, no npm install, no marketplace.

- **Pros**: Zero supply-chain attack surface; simple file-based discovery; easy
  code review; fits the existing mono-repo workflow.
- **Cons**: No third-party distribution; all plugins must be trusted repository
  contributors.

### Option C: Object-style plugin export with compatibility wrapper

Accept a default-exported object `{ activate, deactivate? }` in addition to the
factory function `() => { activate, deactivate? }`.

- **Pros**: Matches some existing code patterns; no migration needed.
- **Cons**: Ambiguous contract; factory function enables per-activation
  initialization that an object cannot express; compatibility wrappers accumulate
  technical debt.

### Option D: Persist runtime state (`active`, `error`, `incompatible`) in `plugin_admin_state`

Store the last-known activation outcome as the durable plugin state.

- **Pros**: Startup can skip re-evaluating known-bad plugins.
- **Cons**: A plugin that failed at last startup is silently skipped on the next
  restart even if the root cause (e.g. a missing capability) has been resolved.
  This is the "stranded plugin" failure mode.

## Decision

**Option B** for the trust model, with the following subsidiary decisions:

| Topic             | Decision                                                                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trust model       | Trusted local first-party plugins only. No sandbox, no marketplace, no npm install, no plugin secret store, no hot reload.                                                                                      |
| Entry contract    | Default-exported factory function `() => { activate(ctx), deactivate?(ctx) }`. Object-style default exports are rejected.                                                                                       |
| Durable state     | `plugin_admin_state.state` holds only `approved`, `discovered`, or `rejected`. `active`, `error`, `incompatible`, and `config_missing` are recomputed in-process on each startup.                               |
| Runtime events    | `plugin_runtime_events` records `activated`, `deactivated`, and `error` rows for diagnostics; this is not a restart-state store.                                                                                |
| Config missing    | Missing required plugin config is a per-context eligibility reason, not a global activation block. A plugin missing config for one context remains active for other contexts.                                   |
| Provider access   | Plugins receive a frozen `PluginContext` facade. Tool executions receive a `PluginToolRuntimeContext` with permission-gated `taskProvider` facade and context-scoped KV. No raw providers, DB, env, or network. |
| Prompt fragments  | Synchronous string or sync function only. No async prompt builder migration in this plan. Budget: 2,000 chars per fragment, 8,000 chars total.                                                                  |
| Commands and jobs | Included in MVP. Namespaced as `plugin_<id>_<command>` and `plugin:<id>:<job>`.                                                                                                                                 |
| KV store          | Per-(plugin, context, key) string KV, gated by the `storage` permission. Not a secret store.                                                                                                                    |
| Permissions (MVP) | `storage`, `tasks.read`, `tasks.write`, `commands`, `scheduler`, `chat.send`. Only `storage`, `tasks.read`, and `tasks.write` have runtime gating today.                                                        |
| Migration         | `039_plugins` is canonical (migrations `034`–`038` landed from master before this work). No renumbering. Stale `028_plugins.ts` removed.                                                                        |

## Consequences

### Positive

- Zero supply-chain attack surface: only repository code activates.
- Admin manifest-hash approval means any change to plugin source clears approval
  and forces re-review before the next startup.
- Context-scoped enablement and config gating means a misconfigured plugin for
  one user does not block all users.
- Plugin tools flow through the same `wrapToolExecution()` path as built-in
  tools, preserving attribution, logging, and error handling.
- Startup reliability: a plugin that failed previously is reconsidered on next
  restart rather than permanently stranded.

### Negative

- No third-party distribution; all plugins must be trusted repository code.
- No hot reload; admin approval and rejection take effect on next startup.
- No encrypted plugin secret storage; sensitive plugin config must use the
  existing config-editor masking path.
- Per-context activation adds one eligibility check per tool/prompt assembly.

### Risks

- The `activation_timeout_ms` window (100–10,000 ms, default 5,000 ms) is a
  best-effort guardrail, not a hard memory/CPU limit. A malicious local plugin
  could still consume resources.
- Mitigation: trust boundary is the repository; all plugin contributors are
  trusted repository access holders.

## Implementation Notes

Key modules (`src/plugins/`):

| File                       | Role                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `types.ts`                 | `PluginManifest`, `PluginFactory`, `PluginInstance`, `PluginContext`, `PluginToolRuntimeContext`, permission types |
| `discovery.ts`             | Scans `plugins/`, validates manifests, rejects unsafe paths and symlinks                                           |
| `store.ts`                 | Drizzle-backed persistence for `plugin_admin_state`, `plugin_context_state`, `plugin_kv`, `plugin_runtime_events`  |
| `registry.ts`              | Approval, eligibility (`getPluginContextEligibility`), and runtime status map                                      |
| `compatibility.ts`         | Per-startup capability evaluation; resets from durable `approved` state                                            |
| `context.ts`               | Builds frozen `PluginContext` and `PluginToolRuntimeContext`                                                       |
| `contributions.ts`         | Assembles tool/prompt/command/job sets for a given context                                                         |
| `command-contributions.ts` | Namespaced command registration and cleanup on deactivation                                                        |
| `contribution-names.ts`    | Naming/namespacing helpers (`plugin_<id>__<tool>`, `plugin_<id>_<command>`)                                        |
| `prompt-contributions.ts`  | Prompt fragment budget enforcement and delimiter injection                                                         |
| `tool-runtime.ts`          | Per-request `PluginToolRuntimeContext` and permission-gated task provider facade                                   |
| `loader.ts`                | Import, activation timeout, failure isolation, reverse-order deactivation                                          |

Database: migration `039_plugins` creates `plugin_admin_state`, `plugin_context_state`,
`plugin_kv`, and `plugin_runtime_events`.

Integration points: `src/tools/index.ts` (tool assembly), `src/system-prompt.ts`
(prompt fragments), `src/commands/plugin.ts` (`/plugin` admin command),
`src/commands/config.ts` (per-context opt-in and config display),
`src/chat/plugin-interaction-handler.ts` (`plg:` callback routing),
`src/index.ts` (startup discovery/activation, shutdown deactivation).

Developer docs: `docs/plugins/developer-guide.md` and example at
`docs/plugins/examples/hello-world/`.

## Related Decisions

- ADR-0009: Multi-Provider Task Tracker Support — provider capability model that
  plugin compatibility evaluation builds on.
- ADR-0014: Multi-Chat Provider Abstraction — chat provider model; plugins do not
  receive raw chat providers.
- ADR-0036: Centralized Scheduler Utility — the scheduler integration point used
  by plugin job contributions.
