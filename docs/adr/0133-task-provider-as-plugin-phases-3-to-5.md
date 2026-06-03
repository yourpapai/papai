<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0133: Task-Provider-as-Plugin Phases 3-5: Kaneo & YouTrack Migration

## Status

Implemented

## Date

2026-05-28 – 2026-06-02

## Context

The trusted-local plugin system (ADR-0123) shipped with a contributed-plugin
registration path for task providers, but the two built-in providers — Kaneo
and YouTrack — still lived in `src/providers/`. Their inline factories in
`src/providers/registry.ts`, built-in descriptor seeds in
`src/providers/builtin-descriptors.ts`, and env-driven task-instance bootstrap
in `src/instances/bootstrap.ts` constituted a parallel registration path that
the plugin model was designed to replace.

The prerequisites work (config-scope model, `papai/plugin-types` alias,
`validateConfig` wiring, descriptor-driven resolver) laid the groundwork, but
three structural issues remained:

1. **Two registration paths.** Built-in factories and plugin-contributed
   factories coexisted. The resolver had a per-type special-case for Kaneo's
   `workspaceId` that bypassed the descriptor-driven config assembly.
2. **Env-driven task-instance bootstrap.** `TASK_PROVIDER`,
   `KANEO_CLIENT_URL`, `KANEO_INTERNAL_URL`, and `YOUTRACK_URL` seeded a
   `task_instances` row on first run. This entangled provider deployment with
   process environment rather than the admin UI.
3. **Vestigial back-compat fields.** `TaskProvider.configRequirements` and
   `TaskProviderTypeDescriptor.configSchema` / `legacyConfigSchema` were kept
   alive for the transition but had no purpose once both providers migrated.

## Decision Drivers

- **Single registration path:** Task providers must register through one
  mechanism (contributed-plugin path) to eliminate per-type branches in the
  resolver and registry.
- **Descriptor-driven config assembly:** The resolver must resolve all
  provider config through `storageKeyForField` with zero per-type overrides.
- **Operator control over instances:** Task instances are created and managed
  via `/admin#instances`, not env vars. Bootstrap seeds only the platform
  instance and the admin row.
- **Explicit approval gate:** Operators must approve each provider plugin
  after upgrade. No auto-approval seed — the startup `WARN` makes the
  requirement visible without silently changing runtime state.
- **Data continuity:** Existing `user_config` credential rows must be migrated
  to plugin-namespaced keys (`plugin:<id>:provider:<field>`) so the resolver
  can find them after the builtin descriptor is removed.
- **No back-compat accumulation:** Vestigial fields are retired in one
  cleanup pass after both providers migrate, not preserved indefinitely.

## Considered Options

### Option A: Keep built-in providers alongside plugins indefinitely

Retain the `providers` map in `registry.ts`, the descriptor seeds, and the
env bootstrap. Plugin-contributed providers are an addition, not a replacement.

- **Pros:** Zero migration risk; no operator action required on upgrade.
- **Cons:** Per-type branches accumulate; resolver cannot be fully
  descriptor-driven; bootstrap stays coupled to specific providers; two
  registration paths diverge over time.

### Option B: Migrate providers into plugins, keep env bootstrap as fallback

Move Kaneo and YouTrack into `plugins/`, but keep `TASK_PROVIDER` env seeding
as a convenience for fresh deployments.

- **Pros:** Providers use the single plugin path; env bootstrap helps new
  operators.
- **Cons:** Env bootstrap re-introduces a provider-specific code path in
  core; env vars become confusing once task instances exist (they no-op);
  `BOOTSTRAP_ENV_MAP` must track every new provider type.

### Option C: Full migration + drop env bootstrap + explicit approval (chosen)

Move both providers into `plugins/`, remove env-driven task-instance seeding,
require `/plugin approve` after upgrade, and retire vestigial fields.

- **Pros:** Single registration path; fully descriptor-driven resolver;
  clean operator workflow; no provider-specific code in bootstrap.
- **Cons:** Operators must run `/plugin approve` once per provider after
  upgrade; deployments with unapproved providers fall to "needs /setup"
  until approved.

### Option D: Auto-approve built-in provider plugins on startup

Seed approval for `task-provider-kaneo` and `task-provider-youtrack`
automatically on first run after upgrade.

- **Pros:** No operator action required; seamless upgrade.
- **Cons:** Auto-approval contradicts the explicit trust model (ADR-0123);
  any manifest change clears approval and requires re-approval anyway;
  auto-seed hides the approval step operators must understand.

## Decision

**Option C** — full migration with three deliberate subsidiary decisions:

| Topic                      | Decision                                                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Env bootstrap              | `TASK_PROVIDER`, `KANEO_CLIENT_URL`, `KANEO_INTERNAL_URL`, `YOUTRACK_URL` removed from first-run bootstrap. Task instances created exclusively via `/admin#instances`.                   |
| Auto-approval              | Not implemented. Operators run `/plugin approve task-provider-kaneo` (and/or `task-provider-youtrack`) once after upgrade. Startup `WARN` lists pending approvals.                       |
| Provider config keys       | Context-scoped credentials are stored under `plugin:<id>:provider:<key>` (e.g. `plugin:task-provider-kaneo:provider:credential`). One-time SQLite migration per phase renames flat keys. |
| Manifest field keys        | Provider config field keys accept camelCase (`baseUrl`, `workspaceId`); plugin config keys remain snake_case. No `storageKey` in manifest — the resolver namespaces from `field.key`.    |
| First-party trust          | Migrated providers do not request `http` permission; `providerAllowedHosts: []`; they keep their existing `client.ts` fetch path, not `ctx.providerRuntime.httpFetch`.                   |
| Vestigial fields (Phase 5) | Both `TaskProvider.configRequirements` and `TaskProviderTypeDescriptor.configSchema` / `legacyConfigSchema` retired in one pass after Phases 3 and 4 land.                               |
| Kaneo workspaceId          | `user_config[kaneo_workspace_id]` is the single source of truth; `users.kaneo_workspace_id` column deprecated (drop is a follow-on migration).                                           |

## Consequences

### Positive

- Single registration path for all task providers — `createProvider` delegates
  only to contributed factories; no built-in factory map.
- Resolver is fully descriptor-driven: zero per-type branches.
  `readContextScopedField` is a single `deps.getConfig(contextId, storageKeyForField(descriptor, field))` call.
- Bootstrap is provider-agnostic — seeds only platform instance and admin.
- Plugin-namespaced config keys prevent future key collisions across providers.
- Startup `WARN` and `/admin#instances` unresolvable-instance label make the
  post-upgrade approval requirement visible without changing chat behavior.
- Vestigial `configRequirements` and `configSchema` surfaces removed, shrinking
  the public provider type contract.

### Negative

- Operators must run `/plugin approve` per provider after upgrade; until
  approved, affected contexts reply "needs /setup" (no differentiation from
  genuine setup-needed states).
- `TASK_PROVIDER`, `KANEO_CLIENT_URL`, `KANEO_INTERNAL_URL`, `YOUTRACK_URL`
  become inert env vars on existing deployments (no functional impact once
  `task_instances` is non-empty, but may confuse operators who still set them).
- Core-to-plugin import dependency: `src/commands/setup.ts` and
  `src/llm-orchestrator.ts` import `plugins/task-provider-kaneo/provision.ts`.
  This is accepted as transitional; a plugin-contributed provisioning hook is
  a follow-on design effort.
- The `users.kaneo_workspace_id` column survives this migration; its drop is
  a separate DB migration.

### Risks

- **Upgrade break for in-use providers.** An unapproved deployment falls to
  "needs /setup". Mitigated by startup `WARN`, `/admin#instances` label, and
  explicit release notes. Not eliminated by design (explicit approval is
  intentional).
- **Credential migration ordering.** The namespaced-key migration for a
  provider must land in the same phase as that provider's builtin descriptor
  removal — never earlier, or the still-builtin descriptor reading the flat
  key breaks. Mitigated by task ordering constraints in the implementation
  plan (Task 3.6a after Task 3.6; Task 4.5a after Task 4.5).
- **E2E harness boots the built-in.** The E2E test setup must call
  `/plugin approve` before the bot starts. Mitigated by updating
  `tests/e2e/bun-test-setup.ts` per phase; failure mode is the loud
  "no provider" path.

## Implementation Notes

Key artifacts:

| Artifact                                             | Role                                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `plugins/task-provider-kaneo/`                       | Kaneo provider plugin (manifest, factory, moved source from `src/providers/kaneo/`)                   |
| `plugins/task-provider-youtrack/`                    | YouTrack provider plugin (same structure)                                                             |
| `src/db/migrations/048_namespace_kaneo_config.ts`    | Renames `kaneo_apikey` / `kaneo_workspace_id` → namespaced plugin keys                                |
| `src/db/migrations/049_namespace_youtrack_config.ts` | Renames `youtrack_token` → `plugin:task-provider-youtrack:provider:token`                             |
| `src/instances/health.ts`                            | `warnUnresolvedTaskInstances()` — startup WARN for task instances whose provider plugin is not active |
| `src/instances/bootstrap.ts`                         | Simplified: seeds platform instance only, no `BuiltinTaskType`, no `TASK_PROVIDER`                    |
| `src/providers/resolver.ts`                          | No per-type branches; `readContextScopedField` is generic                                             |
| `src/providers/registry.ts`                          | No built-in provider map; `legacyConfigSchema` and `configSchema` descriptor field removed (Phase 5)  |
| `src/providers/types.ts`                             | `configRequirements` field removed from `TaskProvider` interface (Phase 5)                            |

Phase sequencing: Phase 3 (Kaneo) → Phase 4 (YouTrack) → Phase 5 (vestigial
field cleanup). Each phase shipped as a separate PR. Phase 5 is hard-blocked
on both Phase 3 and Phase 4.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — the plugin runtime, approval model,
  and `PluginContext` facade that the migrated providers use.
- ADR-0009: Multi-Provider Task Tracker Support — the provider capability model
  that plugin compatibility evaluation builds on.
- ADR-0014: Multi-Chat Provider Abstraction — chat provider model; plugins do
  not receive raw chat providers.
