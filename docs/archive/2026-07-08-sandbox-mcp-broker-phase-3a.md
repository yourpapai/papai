<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Sandbox MCP Broker — Phase 3A (Per-Session Config + Credential Vault) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire Phase 2's magi-process env config — source the worker's upstream MCP config + credential **per session** from a per-identity papai vault, threaded through `projectSpec` to magi exactly like the existing forge token.

**Architecture:** papai gains a new `mcp` namespace in the `coding_session_credentials` vault (alongside `forge`/`agent-provider`) holding a user's upstream MCP URL + credential. A `resolveMcp` resolver (per-identity, mirroring `resolveForge`) feeds `projectSpec.mcp` (non-secret) + an `mcpToken` (secret, sibling to `forgeToken`) into the `/sessions` request. magi validates `projectSpec.mcp` in `validateRepoSpec` and sources the worker's `WorkerConfig` + credential + the enable-gate from the validated session spec instead of `process.env`. The Phase-2 worker enclosure, outbound client, gating, and geofront are unchanged — only where magi-main _gets the config_ changes.

**Tech Stack:** Bun + TypeScript (papai + magi); Drizzle/SQLite vault; Zod v4; existing `coding-credentials` route + `resolve-agent-secrets` patterns.

**Spec:** `docs/superpowers/specs/2026-07-05-sandbox-mcp-broker-design.md` (§5.5 papai vault; §3 tiered trust — the operator catalog is Phase **3B**).

**Scope (3A only):** the per-identity **vault + resolver + config wiring**. NOT in 3A: the operator catalog (admin-published server list), the settings-UI section, and magi-side per-tool gating/audit — those are **Phase 3B**. In 3A the user's `mcp` vault holds their upstream URL directly (bring-your-own); 3B later constrains the URL to operator-catalog entries.

**Naming (avoid collision):** the pre-existing `McpSection` / `mcp_endpoints` / `/settings/api/mcp` (`src/mcp/`) is papai's **orchestrator** MCP-client feature — DO NOT touch or reuse it. This work uses the `mcp` namespace inside `coding_session_credentials` (a different table) and rides the generic `coding-credentials` route.

---

## File structure

**papai — modified:**

- `src/coding-credentials/types.ts` — add `'mcp'` to `CODING_NAMESPACES`; `FIELDS_BY_NAMESPACE.mcp` / `REQUIRED_BY_NAMESPACE.mcp`.
- `src/debug/settings/coding-credentials-routes.ts` — `FIELDS_META.mcp` (field metadata for the generic route; the 3B section renders from this).
- `src/coding-credentials/resolve-agent-secrets.ts` — `resolveMcp` (→ non-secret config) + `resolveMcpToken` (→ credential); add both to `buildCodingSecretsFacade`.
- `plugins/acp/tools.ts` — `buildSessionProjectSpec` adds `projectSpec.mcp`; `RuntimeContext.codingSecrets` gains `resolveMcp`/`resolveMcpToken`.
- `plugins/acp/session-tools.ts` — `startSessionTool` adds `mcpToken` to the `/sessions` POST body; declares the tunnel server when MCP is configured.

**magi — modified:**

- `src/project/spec-validation.ts` — `ProjectSpec.mcp` + a `resolveMcp(o, policy)` validator (https + host in `policy.allowedHosts`).
- `src/project/config.ts` / wherever `ProjectSpec` is typed — the `mcp` field type.
- `src/runtime/geofront/geofront-runtime.ts` — `launch()`/`startMcpApparatus` source `mcpEnabled` + `WorkerConfig` + the token from the session `spec` (+ the request's `mcpToken`) instead of `process.env`.
- `src/session/manager.ts` — the tunnel-server declaration (`buildTunnelMcpServers`) becomes spec-driven, not `process.env['MAGI_MCP_TUNNEL_SERVERS']`.
- The `/sessions` request handler — accept + thread `mcpToken` (like `forgeToken`).

**Tests mirror source.**

---

## Task 1: add the `mcp` vault namespace (papai)

**Files:** Modify `src/coding-credentials/types.ts`; Test `tests/coding-credentials/types.test.ts` (or the nearest existing).

- [ ] **Step 1: Branch note** — papai work commits to `master` (per prior instruction / "commit into current branch"). Commit ONLY files you touch (papai has concurrent WIP on the unrelated `McpSection`/UX docs — never `git add -A`).

- [ ] **Step 2: Write the failing test** — assert `CODING_NAMESPACES` includes `'mcp'`, and that `FIELDS_BY_NAMESPACE.mcp` / `REQUIRED_BY_NAMESPACE.mcp` have the expected fields. READ the existing `forge` entry first to match the exact structure.

```ts
import { describe, expect, it } from 'bun:test'
import { CODING_NAMESPACES, FIELDS_BY_NAMESPACE, REQUIRED_BY_NAMESPACE } from '../../src/coding-credentials/types.js'

describe('mcp coding-credentials namespace', () => {
  it('is a known namespace', () => {
    expect(CODING_NAMESPACES).toContain('mcp')
  })
  it('declares upstream url/header/token fields, url+token required', () => {
    expect(FIELDS_BY_NAMESPACE.mcp).toEqual(['upstream_url', 'upstream_header', 'upstream_token'])
    expect(REQUIRED_BY_NAMESPACE.mcp).toEqual(['upstream_url', 'upstream_token'])
  })
})
```

- [ ] **Step 3: Run to verify FAIL.**

- [ ] **Step 4: Implement** — add `'mcp'` to `CODING_NAMESPACES` and the two maps, matching the exact shape the `forge` entry uses (read it). Fields: `upstream_url`, `upstream_header` (optional; default handled in the resolver), `upstream_token` (sensitive). Required: `upstream_url`, `upstream_token`.

- [ ] **Step 5: Run to verify PASS**; `bun run check` (or the repo's staged gate). **Step 6: Commit** `src/coding-credentials/types.ts` + the test — `git commit -m "feat(coding-mcp): add mcp namespace to the coding-credentials vault"`.

---

## Task 2: `FIELDS_META.mcp` for the generic settings route (papai)

**Files:** Modify `src/debug/settings/coding-credentials-routes.ts`; Test `tests/debug/settings/coding-credentials-routes.test.ts` (nearest existing).

The generic `coding-credentials` route drives the (3B) UI entirely from server-declared `FIELDS_META[namespace]`. Add the `mcp` metadata now so the vault is fully usable via the route (the 3B section renders it).

- [ ] **Step 1: failing test** — GET the coding-credentials field list for `namespace=mcp` and assert the field metadata (labels, `required`, `sensitive` on `upstream_token`, `control` types). READ the `forge` `FIELDS_META` entry to mirror shape.
- [ ] **Step 2–4:** add `FIELDS_META.mcp`:
  - `upstream_url` — `{ label: 'Upstream MCP URL', required: true, control: 'text' }`
  - `upstream_header` — `{ label: 'Auth header', required: false, control: 'text' }` (resolver defaults to `Authorization`)
  - `upstream_token` — `{ label: 'Credential', required: true, sensitive: true }`
    Match the exact metadata object shape the route already uses for `forge`/`agent-provider`.
- [ ] **Step 5–6:** `bun run check`; commit — `git commit -m "feat(coding-mcp): field metadata for the mcp credentials route"`.

---

## Task 3: `resolveMcp` + `resolveMcpToken` resolvers (papai)

**Files:** Modify `src/coding-credentials/resolve-agent-secrets.ts`; Test `tests/coding-credentials/resolve-agent-secrets.test.ts`.

Mirror `resolveForge`/`resolveForgeToken`: per-identity (via `identityContext`), read the `mcp` vault, return a validated non-secret config + the token separately.

- [ ] **Step 1: failing test** — with an `mcp` vault set for an identity context, `resolveMcp(...)` returns `{ url, host, header, token: <omitted>, allowedHosts }` shape (non-secret) and `resolveMcpToken(...)` returns the token; both return `null`/`undefined` when unconfigured. READ `resolveForge`/`resolveForgeToken` + their tests to mirror the identity-context wiring and the `null`-on-partial-vault guard.
- [ ] **Step 2–4: implement:**

```ts
export interface ResolvedMcp {
  url: string
  host: string
  header: string
  allowedHosts: string[]
}

// Per-identity: read the `mcp` vault, validate https + derive host, return the
// NON-secret config. Returns null when unconfigured or a partial/unreadable vault
// (mirrors resolveForge's guard). The credential is resolveMcpToken, not here.
export async function resolveMcp(/* same deps signature as resolveForge */): Promise<ResolvedMcp | null> {
  // read the mcp namespace for identityContext(...); if url/token missing → null
  // parse url; require https; host = url host lowercased; allowedHosts = [host]
  // header = stored upstream_header || 'Authorization'
}

export async function resolveMcpToken(/* same deps signature as resolveForgeToken */): Promise<string | undefined> {
  // read the mcp namespace; return upstream_token or undefined
}
```

Add both to `buildCodingSecretsFacade` alongside `resolveForge`/`resolveForgeToken`. Use the SAME `identityContext(storageContextId, chatUserId)` threading (per-identity, honoring the group `coding_identity` policy). Do NOT wire `forceSharedKey` for mcp in 3A (forge doesn't either).

- [ ] **Step 5–6:** `bun run check`; commit — `git commit -m "feat(coding-mcp): resolveMcp + resolveMcpToken (per-identity vault resolvers)"`.

---

## Task 4: thread `projectSpec.mcp` + `mcpToken` into the `/sessions` request (papai)

**Files:** Modify `plugins/acp/tools.ts` (`buildSessionProjectSpec`, `RuntimeContext.codingSecrets`), `plugins/acp/session-tools.ts` (`startSessionTool`). Tests: the acp plugin tests.

- [ ] **Step 1: failing test** — given a resolved mcp config + token, `buildSessionProjectSpec(...)` includes `mcp: { url, host, header, allowedHosts }` and the `/sessions` POST body includes `mcpToken`. Also: when mcp is configured, a tunnel server is declared so the agent spawns the tunnel (the enable-gate). READ how `forge`/`forgeToken` flow today to mirror exactly.
- [ ] **Step 2–4:**
  - Add `resolveMcp`/`resolveMcpToken` to the `RuntimeContext.codingSecrets` facade type + wiring.
  - In `buildSessionProjectSpec`, after `resolveForge()`, call `resolveMcp()` and (if non-null) add `mcp: resolved` to the spec.
  - In `startSessionTool`, add `mcpToken: await codingSecrets.resolveMcpToken()` to the POST body (sibling to `forgeToken`).
  - Enable-gate: when `mcp` is configured, ensure the session declares the tunnel MCP server (so the agent spawns `mcp-tunnel`). In Phase 1/2 this was `MAGI_MCP_TUNNEL_SERVERS`; now it should be driven by the presence of `projectSpec.mcp`. This magi-side change is Task 6 — here, just ensure `projectSpec.mcp` carries what magi needs; confirm no papai-side tunnel-name list is required (magi derives "one tunnel server" from `spec.mcp` in Task 6).
- [ ] **Step 5–6:** `bun run check`; commit — `git commit -m "feat(coding-mcp): thread projectSpec.mcp + mcpToken into the /sessions request"`.

---

## Task 5: validate `projectSpec.mcp` + intake `mcpToken` in magi

**Files (magi `~/Projects/yourpapai/magi`, branch `main`):** Modify `src/project/spec-validation.ts`, the `ProjectSpec` type, the `/sessions` request handler. Tests: `tests/project/spec-validation.test.ts`.

magi is the trust boundary — re-validate the untrusted `mcp` field defensively (mirror `resolveForge` in `spec-validation.ts`).

- [ ] **Step 1: failing test** — `validateRepoSpec` with a `mcp: { url, host, header, allowedHosts }` payload returns a `ProjectSpec` whose `mcp` is validated: `url` must be https, `host` must be in `policy.allowedHosts` (mirror the forge host check), `allowedHosts` bare-host-validated. Reject (422/throw) on http, or a host not allowlisted. READ the forge validation in `spec-validation.ts` to mirror.
- [ ] **Step 2–4:** add `resolveMcp(o, policy)` to `spec-validation.ts` (parallel to the forge resolver), add `mcp?` to `ProjectSpec`, and thread `mcpToken` from the request body into the session (parallel to how `forgeToken` is threaded — NOT inside `projectSpec`, a sibling field). The host-allowlist check reuses the same `policy.allowedHosts` / SaaS-host machinery the forge check uses. **Fail-closed:** a `mcp` field present but invalid rejects the session.
- [ ] **Step 5–6:** `bun run check:full` (5/5); commit — `git commit -m "feat(coding-mcp): validate projectSpec.mcp + intake mcpToken (magi trust boundary)"`.

---

## Task 6: source the worker config from the session spec, not `process.env` (magi)

**Files (magi):** Modify `src/runtime/geofront/geofront-runtime.ts` (`launch`/`startMcpApparatus`), `src/session/manager.ts` (tunnel declaration). Tests: `tests/runtime/geofront/geofront-runtime.test.ts`, `tests/session/manager.test.ts`.

This is the crux: retire the magi-process env sourcing. READ the current Phase-2 `startMcpApparatus` (calls `parseWorkerConfig(process.env)`) and the manager's `buildTunnelMcpServers(process.env['MAGI_MCP_TUNNEL_SERVERS'])`.

- [ ] **Step 1: failing test** — with a session whose `spec.mcp` is set (+ the request's `mcpToken`), `launch()` builds the worker `WorkerConfig` **from `spec.mcp` + `mcpToken`** (NOT `process.env`), and the tunnel server is declared because `spec.mcp` is present (NOT because of `MAGI_MCP_TUNNEL_SERVERS`). With `spec.mcp` absent, no worker/mediator/tunnel (byte-identical no-MCP), regardless of `process.env`.
- [ ] **Step 2–4:**
  - `startMcpApparatus` takes the session's MCP config (a `WorkerConfig` built from `spec.mcp` + the token) instead of calling `parseWorkerConfig(process.env)`. Build `WorkerConfig` = `{ url: spec.mcp.url, host: spec.mcp.host, header: spec.mcp.header, token: <mcpToken>, allowedHosts: spec.mcp.allowedHosts }`. Pass the token into `provisionWorkerDir`'s `requestSecrets` as today. (Keep `worker-main.ts`'s in-enclosure `parseWorkerConfig(process.env)` — it reads the per-session env `buildWorkerPlan` injects; unchanged.)
  - `mcpEnabled` = `spec.mcp !== undefined` (not the `MAGI_MCP_TUNNEL_SERVERS` env).
  - The tunnel-server declaration in `manager.ts` (`runLifecycle` → `runSessionTurn` `mcpServers`) is derived from `spec.mcp` (one tunnel server when configured), not `buildTunnelMcpServers(process.env[...])`. Keep `buildTunnelMcpServers` for building the `McpServerStdio` shape, but feed it a spec-derived server name (e.g. a fixed `'mcp'` or the catalog name in 3B).
  - Delete the now-dead `process.env['MAGI_MCP_TUNNEL_SERVERS']` / `MAGI_MCP_UPSTREAM_*` reads on the magi-main side (the enclosure env is set by `buildWorkerPlan`, unchanged). Grep to confirm no magi-main path still reads them.
- [ ] **Step 5–6:** `bun run check:full` (5/5); commit — `git commit -m "feat(coding-mcp): drive the worker from the session spec + vaulted credential (retire env config)"`.

---

## Task 7: docs + verification

**Files:** `docs/architecture/coding-sessions.md` (papai — update the MCP-broker section: config is now per-identity vault, not env) — commit ONLY that file. Plus a verification note.

- [ ] Update the coding-sessions MCP-broker section: the worker's upstream URL + credential now come from the per-identity `mcp` vault (not `process.env`), threaded via `projectSpec.mcp` + `mcpToken`; env config retired. Commit — `git commit -m "docs(coding-sessions): mcp broker config is now the per-identity vault (Phase 3A)"`.
- [ ] **Verification (unit/integration level, runnable here):** a test-level end-to-end proving the config flows: set a `mcp` vault for an identity → `resolveMcp`/`resolveMcpToken` return it → `buildSessionProjectSpec` includes `projectSpec.mcp` + the POST carries `mcpToken` → magi `validateRepoSpec` accepts it → `launch()` builds the `WorkerConfig` from the spec (asserted via the DI/recording seam). The **real docker E2E** (a vaulted credential actually driving a worker enclosure to a mock upstream) remains the **Linux handoff** from the Phase-2 verification doc — note that 3A only changed _where the config comes from_, and the Phase-2 verification already validated the worker path itself.

---

## Definition of done (3A)

- [ ] A per-identity `mcp` vault namespace exists (fields: upstream url/header/token) with `resolveMcp`/`resolveMcpToken` (per-identity, honoring `coding_identity`).
- [ ] `projectSpec.mcp` + `mcpToken` flow from papai into magi; magi re-validates fail-closed (https + host allowlist).
- [ ] The worker's `WorkerConfig` + credential + enable-gate come from the **session spec**, not magi `process.env`; no magi-main path reads `MAGI_MCP_UPSTREAM_*` / `MAGI_MCP_TUNNEL_SERVERS` anymore.
- [ ] INV-1 preserved: the credential rides the same secret channel as `forgeToken`, staged into the worker enclosure only, never the agent sandbox.
- [ ] Non-MCP sessions (no `mcp` vault) are byte-identical to before.
- [ ] `check` green (papai) + `check:full` green (magi).

## Handoff to Phase 3B

- **Operator catalog:** an admin config (like `coding_guardrails`) of vetted MCP servers; the user's `mcp` vault URL is then constrained to a catalog entry (the user picks a server + supplies only the credential).
- **Settings UI:** the "Coding MCP servers" section (a `CodeHostSection.svelte`-style wrapper on the `mcp` namespace via the generic coding-credentials route + the catalog).
- **Per-tool gating + audit:** in the magi-main mediator (a minimal request `method` peek → allow/ask/deny), configured via settings; audit each brokered call.
- **Multi-server:** more than one upstream per session (route by the `serverId` handshake tag).
