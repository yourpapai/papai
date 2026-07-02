<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Plugin / Core Separation via Two-Tier Ports & Adapters

**Date:** 2026-07-02
**Status:** Approved (design); implementation plan pending
**Author:** Dmitriy Lazarev (with Claude Code)

## 1. Problem & Motivation

An abstraction-leakage audit of the codebase found that three first-party features —
`task-provider-kaneo`, `task-provider-youtrack`, and `acp` (coding sessions) — have leaked
by name into plugin-agnostic core code, on both backend and frontend. The plugin system has
a genuinely generic contribution model, but deep features took privileged shortcuts around
it. Representative confirmed leaks:

- **Orchestrator hardcodes plugin tool names** — `src/llm-orchestrator-tools.ts:37-46`
  enumerates five literal `plugin_acp__*` tool names to apply an operator "who-may-use"
  guardrail. (Deepest leak: core turn logic branches on one plugin's tool ids.)
- **Generic plugin runtime context privileges one plugin** — `PluginToolRuntimeContext`
  (`src/plugins/runtime-types.ts` / `tool-runtime.ts`) unconditionally exposes acp-shaped
  `codingSecrets` / `codingRepos` facades to _every_ plugin; the `coding.secrets`
  permission likewise leaks acp vocabulary into the shared enum.
- **acp-domain modules sit in top-level core** — `src/coding-credentials/` and
  `src/coding-repos/` (agent = claude/codex/opencode, forge = github/gitlab, a function
  literally named `forgeMagiKind`, a doc comment describing "the magi request") have no
  consumers outside acp's own settings routes and the plugin runtime.
- **Provider-name literals in the provider/tool/DB layer** —
  `command-language:youtrack` trait (`task-capability.ts:56`) and a whole
  `apply-youtrack-command.ts` tool in core `src/tools/`; the core DB table
  `kaneo_workspace_members`; `TaskProviderProvisionOutcome.kaneoUrl` in a generic type;
  `src/index.ts:196` branching on `activatedPluginIds.includes('task-provider-kaneo')`.
- **Frontend hand-writes plugin sections** — `KaneoAccessSection.svelte`,
  `CodingIdentitySection.svelte`, and Kaneo-specific blocks in `TaskProviderSection.svelte`
  are wired directly into the core `SettingsApp.svelte`, hardcoding endpoints
  (`/settings/api/kaneo/credentials`), field names, and business rules duplicated from the
  server (`compatibleProviders`, `needsInstanceUrl`) — with comments admitting the copy.

A generic capability/trait registry already exists and is clean; `src/run-control/`,
`src/live-status/`, and `src/debug/notify-route.ts` are also clean. The problem is not a weak
API — it is that the three deep features were never expressed _through_ it.

## 2. Goals & Non-Goals

**Goals**

- Establish a boundary such that **the kernel and the frontend never name a feature or
  provider**. This is the one enforceable invariant of the whole effort.
- Adopt a **two-tier extensibility model**: privileged in-repo **Trusted Modules** and
  sandboxed **Plugins**, both binding to core only through **interfaces (ports)**.
- Give the plugin API **full flexibility** by making every current leak a first-class,
  generic **port**.
- Make the design **symmetric and reusable** so the same shape applies to chat providers
  later with minimal new interface work.

**Non-Goals**

- **Chat provider refactoring is deferred** to a future session. This design establishes the
  reusable pattern (a domain host module + provider plugins) but does not migrate chat.
- No sandboxing / marketplace / hot-reload changes to the plugin runtime beyond removing
  leaked facades.
- No rewrite of immutable historical DB migrations.

## 3. Decisions (resolved during brainstorming)

| Decision                | Choice                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Boundary philosophy     | **Two tiers**: Trusted Modules + Plugins; core depends only on interfaces and names no feature.                                               |
| Architecture style      | **Approach 1 — Hexagonal Ports & Adapters**, with a single trust-gated loader underneath as an implementation detail.                         |
| Settings UI flexibility | **Schema-driven descriptors** only (no custom components, no micro-frontend). Covers 100% of audited sections.                                |
| audio-transcribe        | **Stays a plugin** (pure attachment transformer; needs no module privilege). `AttachmentTransformPort` becomes a real kernel port regardless. |
| ACP operator-gating     | **Declarative** `gate: 'operator'` metadata flag on tool contributions (Option A), not a policy callback.                                     |
| Credential vault scope  | **One unified `CredentialVaultPort`** — agent LLM keys and forge PATs as namespaced entries.                                                  |
| Membership storage      | **Host-owned** `task_provider_members` (shared by all provider plugins), not per-plugin.                                                      |

## 4. Architecture

### 4.1 Layering

```
        ┌─────────────────────────────────────────────────────────┐
        │  KERNEL  (bootstrap, config, storage, LLM orchestration, │
        │           chat routing, module+plugin loader)            │
        │           — knows NO feature or provider names —         │
        └───────────────▲───────────────────────▲─────────────────┘
                        │ binds via PORTS        │
        ┌───────────────┴──────────┐   ┌─────────┴───────────┐
        │  TRUSTED MODULES (Tier1) │   │ (later) CHAT HOST   │
        │  • task-tracker host ────┼── exposes provider ext. pt
        │  • coding / ACP          │   └─────────────────────┘
        └───────────────▲──────────┘
                        │ host extension registry
        ┌───────────────┴──────────┐
        │  PLUGINS (Tier 2)        │
        │  • kaneo  • youtrack     │  (task-provider plugins)
        │  • synthetic-web-search  │  (kernel-level plugin)
        │  • audio-transcribe      │  (attachment-transformer plugin)
        └──────────────────────────┘
```

**Key structural idea:** a **domain host is itself an adapter that fans out to plugins**.
The Task-Tracker host implements the kernel's `ProvisioningPort` / `MembershipStorePort` /
etc. by delegating to whichever provider plugin is bound. The kernel talks to one generic
port; the host talks to many providers via its own `registerProviderType()` extension point.
Chat later reuses the identical pattern (`ChatHost` → chat-provider plugins).

### 4.2 Directory shape

```
src/
  kernel/            bootstrap, config, storage, LLM orchestration, chat routing,
                     port registries, module+plugin loader  — zero feature names
  ports/             the interface catalog — pure types, no impls
  modules/           TRUSTED MODULES (Tier 1)
    task-tracker/    host: provider registry + adapters for TT-relevant ports
    coding/          absorbs src/coding-credentials + src/coding-repos + acp core bits
  composition/       composition root: instantiate kernel, load modules, load plugins
plugins/             TIER 2 sandboxed plugins: kaneo, youtrack, synthetic-web-search,
                     audio-transcribe
```

Nothing in `kernel/` imports from `modules/` or `plugins/`. Wiring happens once in
`composition/`.

### 4.3 Trust distinction

Same _port interfaces_, different _binding privileges_, enforced at the composition root —
not by a runtime god-object:

- **Trusted modules** may bind to any port, register DB migrations, and receive privileged
  handles (e.g. own a `CredentialVault` namespace). Loaded from `src/modules/`, compiled
  in-repo.
- **Plugins** may bind only to ports their manifest permissions allow, get the frozen
  sandboxed context, and cannot register migrations or own a vault namespace — they request
  access to one via permission.

## 5. Port Catalog

Each port maps directly to an audited leak.

| Port                      | Replaces / kills                                                               | Sketch                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `ProvisioningPort`        | `TaskProviderProvisionOutcome.kaneoUrl`, `/provision/kaneo`                    | `provision(ctx) → { instanceUrl?, credentials: Record<string,string> }` — generic             |
| `MembershipStorePort`     | `kaneo_workspace_members` table + `ensure-member.ts` literals                  | host-owned store; table renamed `task_provider_members`                                       |
| `CredentialVaultPort`     | `codingSecrets` / `codingRepos` on every plugin context; `coding.secrets` perm | namespaced `get/put/resolve(namespace, key)`; only owning module + opted-in plugins           |
| `ToolGatePort`            | `plugin_acp__*` allowlist in `llm-orchestrator-tools.ts`                       | tools carry `gate: 'operator' \| 'default'` metadata; orchestrator consults port, never names |
| `SettingsSectionPort`     | hand-written `KaneoAccessSection` / `CodingIdentitySection`                    | contribute field-schema descriptors; one generic renderer                                     |
| `HttpRoutePort`           | `/settings/api/kaneo/*` in core router                                         | modules/plugins register under `/ext/<id>/*`                                                  |
| `StatsContributionPort`   | `kaneoWorkspaces`, `kaneoWorkspacePresent` in core stats                       | contribute keyed anonymized counters                                                          |
| `AttachmentTransformPort` | generalizes existing transformer hook                                          | audio-transcribe plugin binds here                                                            |
| `ModuleLifecycle`         | `index.ts` `includes('task-provider-kaneo')` → `runKaneoLegacyRepair()`        | `onActivate()` / `migrate()` hooks; kernel calls generically                                  |

Two leaks need **no new port** — only relocation via the existing `contributes.tools`:
`apply_youtrack_command` and the `command-language:youtrack` trait move into the youtrack
**plugin** as a contributed tool, gated by the already-existing generic
`supports-command-language` trait. Core deletes `src/tools/apply-youtrack-command.ts`, the
trait literal, and the `tool-metadata` entry.

### 5.1 `ToolGatePort` detail (operator-gating)

Today core enumerates five `plugin_acp__*` tool names to restrict who may call dangerous
coding tools (`start_session`, `cancel_session`, etc.) to operators. Replacement: the tool
declares its requirement; core enforces it generically.

```ts
// inside the coding module's tool contribution
registerTool('start_session', { gate: 'operator' /* … */ })

// kernel ToolGatePort: for every tool where gate === 'operator',
// allow the call only if the acting chat user is an operator.
// Core never sees a tool name.
```

Declarative flag only (Option A) — it reproduces 100% of today's behavior. A conditional
policy callback is explicitly deferred (YAGNI) until a real conditional guardrail appears.

## 6. Module & Plugin Mapping

### 6.1 Task-Tracker host module (`src/modules/task-tracker/`)

Absorbs `src/providers/registry.ts`, `tools-builder.ts`, `providers/membership/`, and the
Kaneo-named settings/provision routes. It is the one adapter the kernel sees for
task-tracking and fans out to provider plugins via `registerProviderType()`.

- Implements `ProvisioningPort` → delegates to the active provider's `provision()`,
  returning generic `{ instanceUrl?, credentials }`. `kaneoUrl` dies; Kaneo places its URL in
  `instanceUrl`.
- Implements `MembershipStorePort` over `task_provider_members`; `ensure-member.ts` loses
  its `'kaneo'` literals (provider name comes from the bound instance).
- Contributes generic "Task provider" + "My access" sections to `SettingsSectionPort`
  (replaces `TaskProviderSection`'s hardcoded Kaneo block and `KaneoAccessSection`).
- Contributes provider counters to `StatsContributionPort` (replaces `kaneoWorkspaces`).

**Provider plugins (kaneo, youtrack)** stay in `plugins/`:

- `apply_youtrack_command` ships inside the youtrack plugin via `contributes.tools`.
- Kaneo's legacy-config repair moves into the Kaneo plugin's `ModuleLifecycle.onActivate()`;
  `index.ts` loses the `includes('task-provider-kaneo')` branch.

### 6.2 Coding / ACP trusted module (`src/modules/coding/`)

Absorbs `src/coding-credentials/`, `src/coding-repos/`, and the acp-specific bits currently
in the plugin runtime + orchestrator (largest consolidation).

- Owns its DB tables via `ModuleLifecycle.migrate()`; kernel `src/db` stops declaring them.
- `codingSecrets` / `codingRepos` disappear from the generic `PluginToolRuntimeContext`. The
  module resolves agent keys + forge PATs through `CredentialVaultPort` (namespaces
  `agent-provider`, `forge`). `forgeMagiKind` and the magi request shaping become internal
  module details.
- The `plugin_acp__*` allowlist is deleted; tools declare `gate: 'operator'`, enforced by
  `ToolGatePort`.
- Contributes its settings sections (coding identity, credentials, code-host, repos, admin
  guardrails) via `SettingsSectionPort` descriptors, and its routes via `HttpRoutePort` under
  `/ext/coding/*`. The duplicated client-side `compatibleProviders` / `needsInstanceUrl`
  logic is served from the module's descriptor, not re-implemented in Svelte.

### 6.3 audio-transcribe (stays a plugin)

Binds to `AttachmentTransformPort`; keeps its group-scoped KV cache. No module promotion —
it needs no privilege a sandboxed plugin lacks.

### 6.4 Resulting dependency direction

```
kernel ──depends-on──► ports (interfaces only)
modules ──implement──► ports         plugins ──implement──► ports (permission-limited)
                        ▲                                    │
task-tracker host ──────┘◄──── provider plugins register into host extension point
```

## 7. Frontend: Schema-Driven Settings Pipeline

The mechanism that lets us delete `KaneoAccessSection.svelte`,
`CodingIdentitySection.svelte`, and the hardcoded blocks in `TaskProviderSection.svelte`.

**Backend** — `SettingsSectionPort` contributes a descriptor:

```ts
type SettingsSection = {
  id: string // 'task-provider-access', 'coding-identity'
  title: string
  scope: 'context' | 'group' | 'admin'
  visibleWhen?: EligibilityRule // e.g. { activeProviderTrait: 'members.provision' } — no plugin names
  fields: SettingsField[] // extends today's ConfigField
  actions?: SettingsAction[] // { id:'provision', label:'Provision', route:'/ext/task-tracker/provision' }
}
```

`SettingsField` extends the existing `ConfigField` (which already drives
`ConfigFieldRow.svelte` generically) with the few controls the leaked sections need:
`reveal-secret` (Kaneo password reveal), `readonly-derived` (shows `instanceUrl`, login /
status), and `action-button` (provision). The client-side duplicated logic
(`compatibleProviders`, `needsInstanceUrl`) becomes `visibleWhen` / `options` computed on the
backend and serialized into the descriptor, so Svelte never re-implements it.

**Frontend** — the core SPA fetches `GET /settings/sections?scope=…`, and a single generic
renderer draws every section. `SettingsApp.svelte` loses all named imports and hardcoded
sidebar entries; the sidebar is generated from the returned descriptors.

**Deliberate limit (YAGNI):** the descriptor covers forms, toggles, selects, secret-reveal,
derived-readonly, and action-buttons — 100% of what the audited sections do. No custom
components. A registered-custom-component escape hatch is revisited only if a genuinely
bespoke UI ever appears.

## 8. Storage & Data Migration

Each trusted module owns its tables via `ModuleLifecycle.migrate()`; the kernel `src/db`
schema stops declaring feature tables.

| Table today                                | Becomes                                        | Compat approach                                                                         |
| ------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| `kaneo_workspace_members`                  | `task_provider_members` (host-owned)           | additive migration: create new, copy rows (keep `provider_name`); drop old next release |
| `coding_session_credentials`, repos        | owned by coding module (names already generic) | relocate ownership; no rename                                                           |
| `users.kaneo_workspace_id`                 | delete (audit found it dead/unused)            | drop column                                                                             |
| config keys `plugin:task-provider-kaneo:*` | unchanged                                      | already correctly namespaced                                                            |

Historical migrations (`004_kaneo_workspace`, etc.) stay as-is — immutable history.
`KANEO_PLUGIN_*` constants move from `src/types/config.ts` into the Kaneo plugin.

## 9. Rollout — Strangler, Port-by-Port, Always Green

Ordered so each step is independently shippable with tests passing:

1. **Define `ports/` + composition root** — no behavior change; kernel still calls old code.
2. **`ToolGatePort`** — replace the acp allowlist with the `gate` flag. Smallest,
   highest-value, self-contained.
3. **Coding module** — relocate `coding-credentials` / `coding-repos` into
   `src/modules/coding/`, introduce `CredentialVaultPort`, remove `codingSecrets` /
   `codingRepos` from `PluginToolRuntimeContext`.
4. **Task-tracker host** — `ProvisioningPort` (`kaneoUrl`→`instanceUrl`),
   `MembershipStorePort` (+ table rename), move `apply_youtrack_command` into the youtrack
   plugin.
5. **`SettingsSectionPort` + `HttpRoutePort`** — migrate sections to descriptors, delete the
   Svelte sections and named routes.
6. **`StatsContributionPort` + `ModuleLifecycle`** — move Kaneo repair, delete the
   `index.ts` branch.
7. **Cleanup pass** — help text, comments, the empty `builtinDescriptorSeeds`.

Each step ends with the `kernel/` and `client/` zero-grep assertion for the names it removes.

## 10. Testing Strategy

- **Port contract tests** — one shared suite per port that any adapter must pass (fake +
  real adapters). Makes "adding a 3rd provider needs no core edit" verifiable.
- **Architecture guard test** — an automated test asserting `kernel/**` and `client/**`
  (minus `client/stories/**`) contain none of `kaneo|youtrack|acp|magi|coding`. This is the
  regression fence that stops the leak returning — the single most valuable artifact.
- **Characterization tests first** — capture current provisioning / membership /
  operator-gate behavior before moving code, so refactors are provably behavior-preserving.
- Existing suites move with their modules.

## 11. The Invariant

The whole design reduces to one enforceable invariant:

> **`kernel/` and `client/` never name a feature.**

Ports make that achievable; the architecture guard test makes it permanent.

## 12. Open Questions / Deferred

- Chat provider migration to the `ChatHost` + chat-provider-plugin shape (future session).
- Whether a conditional operator-gate policy callback is ever needed (deferred until a real
  case appears).
- Exact eligibility-rule vocabulary for `SettingsSection.visibleWhen` (to be finalized in the
  implementation plan).
