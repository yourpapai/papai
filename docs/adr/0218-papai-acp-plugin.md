<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0218: papai ACP Plugin

## Status

Implemented

## Date

2026-06-22

## Context

The 2026-06-16 ACP design spec (`docs/superpowers/specs/2026-06-16-acp-plugin-design.md`) lets a chat user drive sandboxed AI coding-agent sessions from papai: "start a session on repo X to do Y", "what's running?", "finish and open a PR", "review PR #123". The spec spans three deliverables — a thin papai plugin, a new TypeScript control service (`magi`), and ACP support in the Rust `acp-agent` sandbox. This ADR covers only the papai-side deliverable (spec plan #7): the `acp` plugin.

The spec established (§2) that the ACP runtime **cannot** live inside the plugin sandbox: the plugin runtime exposes only stateless `providerRuntime.httpFetch()` — no subprocess spawning, no persistent stdio/WebSocket, no local git. ACP requires spawning an agent subprocess and holding a JSON-RPC-over-stdio channel. Likewise, papai cannot proactively message a user from a plugin; the "background + milestone" notification model required one small core addition — a targeted `POST /api/notify` endpoint (ADR-0217) — which the `magi` Notifier calls back per milestone using the session's stored `contextId`.

The 2026-06-22 implementation plan (`docs/superpowers/plans/2026-06-22-papai-acp-plugin.md`) realized the plugin as a thin HTTP client of `magi`: nine LLM tools, an `/acp` command, and a prompt fragment, authenticated to `magi` by an admin-configured bearer token and base URL, with `plugin_kv` scoping session listings to the originating chat.

## Decision Drivers

- **Privilege separation.** The untrusted, code-executing agent must stay sandboxed; forge/push secrets and the ACP client must live in an operator-trusted control plane, never in the plugin or the sandbox.
- **Static-graph discipline.** `index.ts` and everything it statically imports must not import bare modules (`zod`, npm packages) — plugin discovery rejects them. Tool schemas and input validation must work without a schema library.
- **No restart on credential rotation.** Admin config (`magi_base_url`/`magi_token`) and per-context credentials must be read at execute time, not captured at activation.
- **Per-chat session isolation.** `list_sessions` must show only sessions started from the originating chat context, not every session `magi` knows about.
- **Milestone notify-back.** `magi` must be able to push progress/permission/finish milestones back to the originating chat thread via papai's `/api/notify`, so the plugin must hand `magi` a stable context id.
- **Per-user identity for privileged ops.** Pushing a branch or opening a PR must be gated on the user's own code-host token, not a shared bot account (a deliberate evolution from the spec's v1 "shared bot service account" non-goal).

## Considered Options

### Option A: Thin HTTP-client plugin over external `magi` control service

- **Pros:** Keeps all ACP/git/forge logic and secrets out of papai core and the plugin sandbox; the agent-launch boundary is an interface, so single-host `magi` today can evolve to remote/k8s fleets without reworking the plugin; the plugin reuses the existing `providerRuntime.httpFetch` primitive and the `providerAllowedHostsFromConfig` trust model for a LAN `http://magi:8787`.
- **Cons:** Introduces a new external service dependency and a single-host control plane; the plugin is only as available as `magi`; bearer token in admin config is a high-value secret.

### Option B: ACP runtime inside the plugin sandbox

- **Pros:** No new service to deploy; everything in-process.
- **Cons:** Rejected by spec §2 — the sandbox has no subprocess/stdio/git; ACP requires spawning an agent and holding a JSON-RPC channel. Fundamental impedance mismatch.

### Option C: ACP logic in papai core

- **Pros:** Full access to core capabilities; no HTTP hop.
- **Cons:** Bloats core with git/forge/session-state concerns that do not belong in an LLM-chat orchestrator; collapses the privilege boundary (forge tokens would enter the bot process); violates the "papai core stays LLM/chat-focused" boundary the plugin system exists to enforce.

## Decision

Implement the `acp` plugin as a thin, stateless HTTP client of `magi`. Each of the nine contributed tools is a typed wrapper over one `magi` REST endpoint, invoked through `ctx.providerRuntime.httpFetch`. The plugin holds **no** ACP, git, or forge logic.

### Key choices

- **Tool surface (no `acp_` prefix):** `start_session`, `list_sessions`, `session_status`, `finish_session`, `cancel_session`, `answer_permission`, `review_pr`, `list_projects`, `list_agents`. The spec §6.1 prefixed these with `acp_`; the plan and implementation drop the prefix (the plugin namespace `plugin_acp__` already disambiguates).
- **Static-graph-safe validation:** `inputSchema` values are raw JSON-Schema `as const` objects (zero imports); runtime inputs are narrowed with manual guards (`asObject`/`asString`/`optionalString`/`asPositiveInt`). No `zod` and no other bare-module imports anywhere in the plugin's static graph — the spec's "validates input with Zod" was deliberately overridden.
- **Admin-scoped config:** `magi_base_url` (non-sensitive) and `magi_token` (sensitive), both `scope: "admin"`. `magi_base_url` is listed in `providerAllowedHostsFromConfig` so a LAN `http://magi:8787` host bypasses the HTTPS/public-IP checks (admin-tier trust).
- **`plugin_kv` session scoping:** `start_session` and `review_pr` record each returned session id under `session:<id>`; `list_sessions` GETs `magi`'s list then filters to ids present in this context's kv, so each chat sees only its own sessions.
- **`contextId` injection:** `start_session` and `review_pr` forward `contextId = runtimeContext.storageContextId` to `magi`, so `magi`'s Notifier can post milestones back to the right chat via `/api/notify`.
- **Credential vault (phase-1/phase-2):** The manifest carries the `coding.secrets` permission; `RuntimeContext` exposes `codingSecrets: { resolve(), resolveForgeToken() }`. `start_session`/`review_pr` resolve and forward the sandboxed agent's LLM provider key (`agent-provider` namespace) and refuse with `error: 'not_configured'` when absent; `finish_session`/`review_pr` resolve the user's code-host token (`forge` namespace) and refuse when unconfigured, preventing push/PR without the user's own identity. This landed alongside the plugin (ADR-0221/ADR-0222), superseding the spec's v1 "shared bot account" non-goal.
- **`/acp` command + `acp-hint` fragment:** a help command and a prompt fragment teaching the NL→tool mapping and session vocabulary, within the 2,000-char/fragment budget.
- **Execute-time config read:** `readMagiConfig(runtimeContext.adminConfig)` runs on every tool invocation, so rotation/first-time setup takes effect on the next message without a restart (the `httpFetch` reference itself is captured at activate, which is fine).

### Files

- `plugins/acp/plugin.json` — manifest (id `acp`, permissions, contributions, config requirements).
- `plugins/acp/schemas.ts` — raw JSON-Schema `as const` objects, zero imports.
- `plugins/acp/client.ts` — `readMagiConfig`, `callMagi`, input guards.
- `plugins/acp/tools.ts` — tool factory functions + `sessionIdOf` helper; `RuntimeContext` with `codingSecrets`.
- `plugins/acp/index.ts` — default-export factory; `extractActivationContext` with type guards; registers all tools, the fragment, and the command.
- `tests/plugins/acp/` — read-tools, start-session, list-status, lifecycle, review-command, coding-secrets-injection, plus a shared `support.ts` harness.
- `knip.jsonc` — `ignoreIssues` entry for the dynamically-loaded `plugins/acp/index.ts` entry.

## Consequences

### Positive

- The untrusted agent never holds forge/push secrets; all privileged git/forge work runs host-side on `magi` against the worktree the agent edited.
- The plugin's static graph is clean: no bare-module imports, so discovery and approval are stable across the `acp` source tree.
- Credential rotation applies on the next message with no restart.
- `list_sessions` is context-scoped via kv, so chats never leak each other's sessions.
- Privileged ops (push/PR/review) are gated on the user's own code-host token, giving per-user forge attribution the spec deferred.
- Milestone notifications route back to the originating chat through the existing `/api/notify` trust plane.

### Negative

- **No `contextType`/`threadId` in the tool runtime context.** The plugin can only hand `magi` `contextId = storageContextId`. DM milestone delivery works; thread-scoped group delivery relies on papai's `/api/notify` inferring the thread; unambiguous non-thread (Discord) group notifications are a future enhancement requiring the runtime to expose `contextType`.
- **`acp_send` (multi-turn continuation) is omitted.** `magi` exposes no continuation endpoint in this phase; deferred from spec plan #5.
- **`answer_permission` resolves all pending permissions with one decision.** It GETs `/sessions/:id/permissions` and POSTs the same `decision` for every pending `toolCallId` in a single batch, returning `{ resolved: <count> }`. Per-`toolCallId` granularity is not exposed.
- **Manifest changes clear approval.** Adding `coding.secrets` (and any future manifest edit) clears the approval hash by design; admins must re-approve after deploy.

### Risks

- **`magi` is a single-host external service** and a single point of failure for all ACP sessions on all contexts; hardening `magi`'s availability is out of scope for this ADR.
- **The admin-scoped `magi_token` is high-value.** Compromise grants full control of every context's sessions; it is stored sensitive/admin-scoped and never logged.
- **The forge token is forwarded to `magi` per call.** This assumes `magi` is operator-controlled; a hostile `magi` could exfiltrate the user's PAT. The trust boundary is the admin who configures `magi_base_url`.

## Related Decisions

- **ADR-0123: Trusted-Local Plugin System** — the plugin activation model, contribution lifecycle, and the static-graph rule that forced raw JSON-Schema + manual guards instead of Zod.
- **ADR-0217: papai Core Notify Endpoint** — `POST /api/notify` with its own bearer-token trust plane, which `magi`'s Notifier calls back per milestone.
- **ADR-0221: Coding-Session Credential Vault (phase-1)** — the `agent-provider` vault namespace and the `coding.secrets`-gated `codingSecrets` capability consumed by `start_session`/`review_pr`.
- **ADR-0222: Forge Identity for Coding Sessions (phase-2)** — the `forge` vault namespace and per-user code-host token consumed by `finish_session`/`review_pr`.
- **ADR-0063: Web Fetch MVP** — the `providerAllowedHostsFromConfig` pattern extended here to allowlist a LAN `magi` host.
- **ADR-0168: Attachment Transformer Plugin Hook** — the `providerAllowedHostsFromConfig` + execute-time config-read pattern this plugin reuses.

## Implementation Notes

All paths confirmed present against the shipped tree.

- `plugins/acp/plugin.json` declares `id: "acp"`, `permissions: ["http", "storage", "commands", "coding.secrets"]`, nine contributed tools, the `/acp` command, the `acp-hint` fragment, `providerAllowedHostsFromConfig: ["magi_base_url"]`, admin-scoped `magi_base_url`/`magi_token` config requirements, `defaultEnabled: false`, `activationTimeoutMs: 5000`.
- `plugins/acp/schemas.ts` exports `emptySchema`, `startSessionSchema`, `listSessionsSchema`, `sessionIdSchema`, `finishSessionSchema`, `answerPermissionSchema`, `reviewPrSchema` — each a plain `as const` object with no imports.
- `plugins/acp/client.ts` exports `readMagiConfig` (returns `null` → `NOT_CONFIGURED` when either value is blank/missing, trims and strips trailing slashes from the base URL), `callMagi` (bearer `Authorization` header, `Content-Type: application/json` only when a body is present, returns `{ error: 'magi_error', status, body }` on non-OK), and the `asObject`/`asString`/`optionalString`/`asPositiveInt` guards.
- `plugins/acp/tools.ts` houses the tool factory functions (`getTool`, `startSessionTool`, `listSessionsTool`, `sessionStatusTool`, `finishSessionTool`, `cancelSessionTool`, `answerPermissionTool`, `reviewPrTool`) plus the `sessionIdOf` helper; its `RuntimeContext` type carries `storageContextId`, `adminConfig`, `kv`, and `codingSecrets`.
- `plugins/acp/index.ts` is the default-export factory only: `extractActivationContext` validates the context shape with type guards, then registers all nine tools, the `acp-hint` prompt fragment, and the `/acp` command.
- `tests/plugins/acp/` contains read-tools, start-session, list-status, lifecycle, review-command, and coding-secrets-injection suites plus a shared `support.ts` harness (mock `PluginContext`/`PluginToolRuntimeContext`, `activate`, `runtimeCtx`, `runtimeCtxWithKv`).
- `knip.jsonc` carries the `ignoreIssues` entry `"plugins/acp/index.ts": ["exports"]` for the dynamically-loaded entry.

### Divergences from the plan

- **Tools extracted into `plugins/acp/tools.ts`.** The plan inlined all tool functions in `index.ts`; the implementation moved them to `tools.ts`, leaving `index.ts` as factory/activation/wiring with a defensive `extractActivationContext` (the plan used a plain cast).
- **`coding.secrets` + `codingSecrets` runtime context added.** The plan's manifest listed only `http`/`storage`/`commands` and the tools forwarded no credentials. The shipped manifest adds `coding.secrets`; `start_session`/`review_pr` resolve and forward the `agent-provider` LLM secrets and refuse when absent, and `finish_session`/`review_pr` resolve and forward the `forge` token and refuse when unconfigured. This is the phase-1/phase-2 credential vault (ADR-0221/ADR-0222), which landed with the plugin.
- **Tool names drop the `acp_` prefix** the spec §6.1 used (`acp_start_session`); the implementation matches the plan's unprefixed names.
- **Validation uses raw JSON-Schema + manual guards, not Zod** (spec §6.1 said Zod); required by the static-graph rule.
