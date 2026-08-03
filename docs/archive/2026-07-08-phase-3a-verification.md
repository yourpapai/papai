<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Sandbox MCP Broker — Phase 3A verification (config-flow test coverage + Linux E2E handoff)

Date: 2026-07-08

**Spec:** `docs/superpowers/specs/2026-07-05-sandbox-mcp-broker-design.md` (§5.5 papai vault; §3 tiered trust).
**Plan:** `docs/superpowers/plans/2026-07-08-sandbox-mcp-broker-phase-3a.md`.

Phase 3A is config-plumbing: it retires Phase 2's magi-process env config (`MAGI_MCP_UPSTREAM_*`, `MAGI_MCP_TUNNEL_SERVERS`) and sources the worker's upstream URL + credential per-session from a new per-identity `mcp` vault namespace, threaded through `projectSpec.mcp` + a sibling `mcpToken` exactly like the existing forge token. It does not touch the worker enclosure, outbound client, or geofront — those were already validated in Phase 2 (`docs/superpowers/plans/2026-07-07-phase-2-verification.md`). Verification here is therefore test-level only; no new docker/enclosure run is needed.

## Covered by per-task tests

- **`mcp` vault namespace + field metadata** (papai) — the namespace, its fields (`upstream_url`/`upstream_header`/`upstream_token`), and required-field set: `tests/coding-credentials/types.test.ts`. Field metadata for the generic settings route (labels, `required`, `sensitive` on `upstream_token`): `tests/debug/settings/coding-credentials-fields-meta.test.ts` and `tests/debug/settings/coding-credentials-routes.test.ts`.
- **`resolveMcp`/`resolveMcpToken` resolvers** (papai) — per-identity resolution (honoring the `coding_identity` group policy), the non-secret/secret split, token isolation (the credential never appears in `resolveMcp`'s return value), and fail-closed behavior on an unconfigured or partial vault: `tests/coding-credentials/resolve-agent-secrets.test.ts`.
- **`projectSpec.mcp` + `mcpToken`-as-sibling wiring** (papai) — `buildSessionProjectSpec` includes `mcp: {url,host,header,allowedHosts}` when configured, and `startSessionTool`'s `/sessions` POST body carries `mcpToken` alongside `forgeToken` (not inside the spec): `tests/plugins/acp/start-session.test.ts`.
- **`validateRepoSpec` fail-closed intake** (magi) — `projectSpec.mcp` re-validation at the trust boundary: https-only, host must be in `policy.allowedHosts` (SSRF-shaped host-allowlist guard, mirroring the forge check), and `mcpToken` is accepted as a sibling field, never persisted into or echoed back from the stored spec: `tests/project/spec-validation.test.ts` (magi) and `tests/server/redaction.test.ts` (magi, confirms `mcpToken`/credential fields are excluded from any served/redacted representation of the session).
- **Retire-env proof + worker sourced from the spec** (magi) — a decoy-`process.env` vs. `spec.mcp` test proving the worker config now comes from the validated session spec and not `MAGI_MCP_UPSTREAM_*`/`MAGI_MCP_TUNNEL_SERVERS`; fail-closed when `spec.mcp` is present but the request's `mcpToken` is missing; and confirmation the credential is staged into the worker enclosure's request-secrets only, never magi-main's own env or the agent enclosure: `tests/session/manager.test.ts` (magi, tunnel-server declaration now derived from `spec.mcp`) and `tests/runtime/geofront/geofront-runtime.test.ts` (magi, `launch()`/`startMcpApparatus` building `WorkerConfig` from `spec.mcp` + `mcpToken`, byte-identical no-MCP path when `spec.mcp` is absent regardless of `process.env`).

All of the above were green on the commits landing Phase 3A (papai `67f252293`, `3a495ba45`, `957ad8fad`; magi `5108e13`, `d78fb8e`).

## INV-1/INV-2 status

3A only changed **where** the worker's config and credential come from — it did not touch the worker path itself (kernel-enforced enclosure isolation, opaque outbound handling, egress restriction to the upstream host), which was validated end-to-end in Phase 2 (Part A of the Phase-2 verification doc: compiled-bundle run with real TLS verification, fail-closed config, credential-header injection). INV-1 (the upstream credential never enters the agent sandbox) and INV-2 (the agent gains no new egress) both still hold under 3A: the credential now flows from the papai vault through the same `mcpToken` secret channel that `forgeToken` already used, staged into the worker enclosure's `magi-init` secret manifest only — never magi-main's process env, never the agent sandbox's env or config mounts.

## Real docker E2E — Linux handoff (unchanged from Phase 2)

The full agent → tunnel → mediator → worker → upstream chain, driven this time by a real vaulted `mcp` credential end to end, still requires a same-kernel Linux host (the `--mcp-mount` bind-mount only forwards a live unix-socket `connect()` when magi and the sandbox share a kernel — not VM-backed docker on macOS) plus real geofront enclosures. This was already the Phase-2 handoff and 3A does not change the constraint; see `docs/superpowers/plans/2026-07-07-phase-2-verification.md` ("Full-chain E2E — Linux handoff") for the steps, including the INV-1/INV-2/SSRF verification checklist. The only 3A-specific addition to that checklist, when it is run: configure the session via the papai settings vault (once the Phase 3B UI exists) or a seeded `mcp` vault row instead of the Phase-2 `MAGI_MCP_UPSTREAM_*` env vars, and confirm the same observed behavior (credential present only in the worker enclosure's env, agent egress byte-identical, non-allowlisted host refused).

## Overall status

**Config-flow test coverage: DONE — PASS.** Vault → resolver → `projectSpec.mcp`/`mcpToken` → magi fail-closed validation → spec-sourced `WorkerConfig` is covered end-to-end at the test level across both repos, per-task, as landed.

**Real docker E2E: deferred to the Linux handoff**, unchanged in scope from Phase 2 — Phase 3A does not require a new docker run since the worker/enclosure path it feeds is unmodified.
