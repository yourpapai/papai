<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0273: Sandbox MCP Broker — Phase 3a Verification

## Status

Implemented

## Date

2026-07-08

## Context

ADR-0260 shipped **Phase 1** of the sandbox MCP broker (the stdio transport slice of design D), ADR-0262 verified that transport across a real container boundary, ADR-0264 shipped **Phase 2** (the credential-holding `mcp-worker` enclosure), and ADR-0263 verified the worker's own leg (real TLS verification + fail-closed config allowlisting in the compiled artifact). Both prior verifications confirmed the worker/enclosure/outbound path and the `tunnel → mediator → worker` composition up to a documented same-kernel Linux handoff for the full chain.

**Phase 3A is config-plumbing, not a new runtime path.** It retires Phase 2's magi-process env config (`MAGI_MCP_UPSTREAM_*`, `MAGI_MCP_TUNNEL_SERVERS`) and instead **sources the worker's upstream URL + credential per session from a new per-identity `mcp` vault namespace**, threaded through `projectSpec.mcp` plus a sibling `mcpToken` carried alongside the request body exactly like the existing `forgeToken`. It does not touch the worker enclosure, the hardened outbound client, or geofront — those were already validated in Phase 2 (ADR-0263). Verification here is therefore **test-level only**; no new docker/enclosure run is required for the Phase-3a slice.

This ADR's source plan (`docs/superpowers/plans/2026-07-08-phase-3a-verification.md`) is a **verification report, not a feature**: it confirms the vault → resolver → `projectSpec.mcp`/`mcpToken` → magi fail-closed validation → spec-sourced `WorkerConfig` config flow is covered end-to-end at the test level across both repos (papai + magi), per-task, as landed. The shared design (`docs/archive/2026-07-05-sandbox-mcp-broker-design.md`, "design D"; §5.5 papai vault, §3 tiered trust) is the spec, already archived alongside ADR-0260. No LLM credentials and no real coding agent were involved.

## Decision Drivers

- **INV-1 — the credential lives only in the worker enclosure's env.** Phase 3A changes *where* the credential originates (the papai vault instead of magi's process env) but must not change *where it lands*: it flows through the same `mcpToken` secret channel `forgeToken` already used, staged into the worker enclosure's `magi-init` request-secrets manifest only — never magi-main's own env, never the agent sandbox's env or config mounts.
- **INV-2 — agent egress byte-identical with/without MCP.** A no-MCP session must still launch byte-identically to pre-MCP behavior regardless of `process.env`; sourcing config from the spec rather than env must not perturb the agent path.
- **SSRF — non-allowlisted host refused, fail-closed.** `projectSpec.mcp` must be re-validated at the magi trust boundary (`https`-only, host in `policy.allowedHosts`), and a present-but-incomplete vault (spec without a matching `mcpToken`, or a partial vault) must fail closed rather than silently degrade.
- **Retire the env config path.** Phase 3A is only complete once the worker's config provably comes from the validated session spec and **not** from `MAGI_MCP_UPSTREAM_*`/`MAGI_MCP_TUNNEL_SERVERS`; a decoy-`process.env` must not influence the launched `WorkerConfig`.
- **Reproducibility / per-task coverage.** Each leg of the config flow must have a named, runnable test in each repo so a regression is caught in routine CI on any kernel — independent of the same-kernel Linux full-chain constraint the prior verifications carry.

## Considered Options

### Option 1 — Per-task test coverage across both repos; no new docker run (chosen)

Cover every leg of the Phase-3a config flow with its own unit/integration test in the repo that owns that leg: the `mcp` vault namespace + field metadata, the per-identity resolvers, the `projectSpec.mcp`/`mcpToken` sibling wiring (papai); the `validateRepoSpec` fail-closed intake + redaction, the retire-env proof, and the spec-sourced `WorkerConfig` (magi). Treat the full real-docker chain as an unchanged handoff from Phase 2.

- **Pros:** reproducible in routine CI on any kernel (no same-kernel `--mcp-mount` / real-geofront dependency); every invariant has a named test that pinpoints the regression; matches the established per-task pattern and is the appropriate level given Phase 3A touches no runtime/enclosure path; INV-1/INV-2 carry forward unchanged because the worker path itself is unmodified.
- **Cons:** test-level, not a live docker run — it does not exercise the real vaulted credential flowing through real geofront enclosures end to end; the resolver/spec naming (`resolveMcp`/`mcpToken`/`projectSpec.mcp`) was later generalized to the multi-server shape by Phase 3B, so the Phase-3a test names are partially superseded on the current trunk.

### Option 2 — Linux-only full-chain handoff executed now

Spin up the real `agent → tunnel → mediator → worker → upstream` chain on a native Linux host, this time driven by a real vaulted `mcp` credential end to end, and verify INV-1/INV-2/SSRF by direct `docker exec`/byte-diff observation.

- **Pros:** the only topology that proves the whole broker end to end in real kernel-enforced enclosures; exercises the real vault → spec → worker path under live TLS.
- **Cons:** blocked on this macOS dev machine (the same-kernel `--mcp-mount` constraint from ADR-0262 carries forward) and adds no Phase-3a-specific signal, since Phase 3A touches none of the runtime components the docker chain exercises; the worker leg it feeds is already verified kernel-agnostic by ADR-0263. Recorded as the documented Linux handoff (unchanged in scope from Phase 2) rather than re-run.

## Verification Outcome

**Config-flow test coverage: DONE — PASS.** Vault → resolver → `projectSpec.mcp`/`mcpToken` → magi fail-closed validation → spec-sourced `WorkerConfig` is covered end-to-end at the test level across both repos, per-task, as landed. Each cited test file was confirmed present in its repo (papai-side HERE; magi-side READ-ONLY under `~/Projects/yourpapai/magi`).

1. **`mcp` vault namespace + field metadata (papai) — PASS.** The namespace, its fields (`upstream_url`/`upstream_header`/`upstream_token`), and the required-field set are covered in `tests/coding-credentials/types.test.ts`; generic settings-route field metadata (labels, `required`, `sensitive` on `upstream_token`) in `tests/debug/settings/coding-credentials-fields-meta.test.ts` and `tests/debug/settings/coding-credentials-routes.test.ts`.
2. **`resolveMcp`/`resolveMcpToken` resolvers (papai) — PASS.** Per-identity resolution (honoring the `coding_identity` group policy), the non-secret/secret split, token isolation (the credential never appears in `resolveMcp`'s return value), and fail-closed behavior on an unconfigured or partial vault are covered in `tests/coding-credentials/resolve-agent-secrets.test.ts`.
3. **`projectSpec.mcp` + `mcpToken`-as-sibling wiring (papai) — PASS.** `buildSessionProjectSpec` includes `mcp: {url,host,header,allowedHosts}` when configured, and `startSessionTool`'s `/sessions` POST body carries `mcpToken` alongside `forgeToken` (as a sibling, not inside the spec) — covered in `tests/plugins/acp/start-session.test.ts`.
4. **`validateRepoSpec` fail-closed intake (magi) — PASS.** `projectSpec.mcp` re-validation at the trust boundary (`https`-only, host must be in `policy.allowedHosts` — an SSRF-shaped host-allowlist guard mirroring the forge check) and `mcpToken` accepted as a sibling field, never persisted into or echoed back from the stored spec: covered in `tests/project/spec-validation.test.ts`; `mcpToken`/credential fields excluded from any served/redacted representation of the session confirmed in `tests/server/redaction.test.ts`.
5. **Retire-env proof + worker sourced from the spec (magi) — PASS.** A decoy-`process.env` vs. `spec.mcp` test proving the worker config now comes from the validated session spec and not `MAGI_MCP_UPSTREAM_*`/`MAGI_MCP_TUNNEL_SERVERS`; fail-closed when `spec.mcp` is present but the request's `mcpToken` is missing; and the credential staged into the worker enclosure's request-secrets only, never magi-main's own env or the agent enclosure — covered in `tests/session/manager.test.ts` (tunnel-server declaration now derived from `spec.mcp`) and `tests/runtime/geofront/geofront-runtime.test.ts` (`launch()`/`startMcpApparatus` building `WorkerConfig` from `spec.mcp` + `mcpToken`; byte-identical no-MCP path when `spec.mcp` is absent regardless of `process.env`).
6. **INV-1 / INV-2 status — unchanged, still hold under 3A.** Phase 3A changed only *where* the worker's config and credential come from; it did not touch the worker path itself (kernel-enforced enclosure isolation, opaque outbound handling, egress restriction to the upstream host), which was validated end-to-end in Phase 2 (ADR-0263 Part A). The credential now flows from the papai vault through the same `mcpToken` secret channel `forgeToken` already used, staged into the worker enclosure's `magi-init` secret manifest only — never magi-main's process env, never the agent sandbox.
7. **Real docker E2E — deferred to the Linux handoff, unchanged in scope from Phase 2.** Phase 3A does not require a new docker run since the worker/enclosure path it feeds is unmodified. The full chain, driven this time by a real vaulted `mcp` credential, still requires a same-kernel Linux host plus real geofront enclosures; the Phase-3a-specific addition to the Phase-2 checklist is to configure the session via the papai settings vault (or a seeded `mcp` vault row) instead of `MAGI_MCP_UPSTREAM_*` env vars and confirm the same observed behavior.

All of the above were green on the commits landing Phase 3A (papai `67f252293` "add mcp namespace to the coding-credentials vault", `3a495ba45` "resolveMcp + resolveMcpToken per-identity vault resolvers", `957ad8fad` "thread projectSpec.mcp + mcpToken into the /sessions request"; magi `5108e13`, `d78fb8e`).

## Consequences

### Positive

- The Phase-3a config flow — vault namespace, per-identity resolution, spec/token sibling wiring, magi fail-closed intake + redaction, retire-env spec-sourced `WorkerConfig` — is verified covered end-to-end at the test level across both repos, each leg named and runnable in routine CI on any kernel.
- INV-1 (credential only in the worker enclosure) and INV-2 (agent egress byte-identical) carry forward unchanged: Phase 3A touches no runtime/enclosure path, and the credential still uses the proven `forgeToken`-style secret channel into the `magi-init` request-secrets manifest.
- The env config path is provably retired: a decoy `process.env` no longer influences the launched `WorkerConfig`, and the byte-identical no-MCP path holds regardless of env.
- SSRF fail-closed is load-bearing at the trust boundary (`validateRepoSpec` re-checks the host allowlist) and the credential is never persisted into or echoed back from the stored session.

### Negative

- The full real-docker chain driven by a vaulted credential is **still a Linux-only handoff**, not a pass recorded here; the config flow is verified at test level only.
- The verification is name/shape-coupled to the Phase-3a single-upstream model (`projectSpec.mcp: {url,host,header,allowedHosts}` + a single `mcpToken`), which Phase 3B later generalizes to the multi-server shape (see Risks).

### Risks

- **Full-chain regression is only caught at Linux sign-off.** Until the documented Linux/CI handoff runs the real vaulted credential through real geofront enclosures, a regression in the composed `tunnel → mediator → worker-client → worker` path (or a credential leak across enclosures) would not surface in routine CI on this machine.
- **Phase 3B multi-server generalization partially supersedes the Phase-3a test names.** Phase 3B (`8cfb245b6`, 2026-07-09 — an ancestor of the current trunk) replaced the single `projectSpec.mcp`/`mcpToken`/`resolveMcp` shape with the multi-server `mcp[]` array + `mcpTokens` record + `resolveMcpServers`/`resolveMcpTokens` shape in both repos. The Phase-3a config-flow invariants remain valid and are subsumed by the multi-server tests, but the exact Phase-3a identifiers cited in this report are no longer the live names on the trunk and must be re-verified against the Phase-3b shape (the subject of the forward-referenced ADRs 0274–0276).
- **Vault-partial-config fail-closed is test-level, not kernel-enforced here.** The "spec present, token missing" and partial-vault rejections are asserted in unit/integration tests, not under live kernel isolation in this report.

## Related Decisions

- **ADR-0260: Sandbox MCP Broker — Phase 1 (Stdio Transport)** — the feature whose shared design spec (`docs/archive/2026-07-05-sandbox-mcp-broker-design.md`, §5.5 papai vault) Phase 3A config-plumbs; the spec is archived alongside it.
- **ADR-0262: Sandbox MCP Broker — Phase 1 Verification** — established the same-kernel `--mcp-mount` Linux-handoff constraint this report inherits for the full-chain deferral.
- **ADR-0263: Sandbox MCP Broker — Phase 2 Verification** — verified the worker enclosure / outbound leg that Phase 3A now feeds from the vault; INV-1/INV-2 carry forward from it.
- **ADR-0264: Sandbox MCP Broker — Phase 2 (Worker Enclosure)** — the Phase-2 implementation whose env-based config (`MAGI_MCP_UPSTREAM_*`) Phase 3A retires in favor of the spec-sourced `WorkerConfig`.
- **ADR-0274 / ADR-0275 / ADR-0276 (forward references)** — the Phase-3a implementation ADR and the Phase-3b (multi-server) implementation/verification ADRs; Phase 3B generalizes the single-upstream shape this report verifies to the multi-server `servers[]` vault model.

## Implementation Notes

Evidence is the verification report itself (`docs/superpowers/plans/2026-07-08-phase-3a-verification.md`, archived alongside this ADR); section/line citations refer to that report. Every papai-side test file the report cites was confirmed present in this worktree; every magi-side test file was confirmed present READ-ONLY under `~/Projects/yourpapai/magi`. The plan's three cited papai commits (`67f252293`, `3a495ba45`, `957ad8fad`, all 2026-07-08) were confirmed to exist in this repo's history. No papai source was modified for this verification.

| Item | Result | Evidence |
| --- | --- | --- |
| Scope: config-plumbing only (no worker/enclosure/outbound change) | 3A retires `MAGI_MCP_UPSTREAM_*`/`MAGI_MCP_TUNNEL_SERVERS`; sources worker URL + credential from the per-identity `mcp` vault via `projectSpec.mcp` + sibling `mcpToken`. | Context, plan `:15`. |
| `mcp` vault namespace + fields + required set (papai) | **PASS** — namespace + `upstream_url`/`upstream_header`/`upstream_token` fields covered; file present HERE at `tests/coding-credentials/types.test.ts`. | plan `:19`; verified present. |
| Generic settings field metadata — labels, `required`, `sensitive` on `upstream_token` (papai) | **PASS** — files present HERE at `tests/debug/settings/coding-credentials-fields-meta.test.ts` and `tests/debug/settings/coding-credentials-routes.test.ts`. | plan `:19`; verified present. |
| `resolveMcp`/`resolveMcpToken` per-identity resolvers (papai) | **PASS** — group-policy-aware resolution, non-secret/secret split, token isolation, fail-closed on unconfigured/partial vault; file present HERE at `tests/coding-credentials/resolve-agent-secrets.test.ts`. | plan `:20`; verified present. |
| `projectSpec.mcp` + `mcpToken`-as-sibling wiring (papai) | **PASS** — `mcp: {url,host,header,allowedHosts}` spread only when configured; `mcpToken` carried alongside `forgeToken` in the `/sessions` POST body; file present HERE at `tests/plugins/acp/start-session.test.ts`. | plan `:21`; verified present. |
| `validateRepoSpec` fail-closed intake + redaction (magi) | **PASS** — `https`-only, host in `policy.allowedHosts` (SSRF guard mirroring forge), `mcpToken` accepted as sibling never persisted/echoed; files present READ-ONLY at `tests/project/spec-validation.test.ts` (`describe('validateRepoSpec: mcp')`) and `tests/server/redaction.test.ts` (`mcp_REAL` never in served representation). | plan `:22`; verified present. |
| Retire-env proof + spec-sourced `WorkerConfig` (magi) | **PASS** — decoy `process.env` vs. `spec.mcp` (config now spec-sourced); fail-closed when `spec.mcp` present but `mcpToken` missing; credential staged into worker request-secrets only; files present READ-ONLY at `tests/session/manager.test.ts` and `tests/runtime/geofront/geofront-runtime.test.ts`. | plan `:23`; verified present. |
| Landing commits green (papai) | Confirmed exist: `67f252293` "add mcp namespace to the coding-credentials vault", `3a495ba45` "resolveMcp + resolveMcpToken per-identity vault resolvers", `957ad8fad` "thread projectSpec.mcp + mcpToken into the /sessions request" (all 2026-07-08). | plan `:25`; verified via `git rev-parse`. |
| Landing commits green (magi) | `5108e13`, `d78fb8e` (per the plan; magi is READ-ONLY for this task). | plan `:25`. |
| INV-1 (credential only in worker enclosure env) | **Holds under 3A** — credential flows papai vault → `mcpToken` secret channel (same as `forgeToken`) → worker enclosure `magi-init` request-secrets; never magi-main env, never agent sandbox. | INV-1/INV-2 status, plan `:27-29`. |
| INV-2 (agent egress byte-identical with/without MCP) | **Holds under 3A** — 3A changes only the config source, not the worker path validated in Phase 2; no-MCP path byte-identical regardless of `process.env`. | INV-1/INV-2 status, plan `:27-29`. |
| Real docker E2E (full chain, vaulted credential) | **Deferred — Linux handoff**, unchanged in scope from Phase 2; 3A needs no new docker run. | Real docker E2E, plan `:31-33`. |
| Overall outcome | **Config-flow test coverage: DONE — PASS** across both repos, per-task; real docker E2E deferred to the Linux handoff. | Overall status, plan `:37`, `:39`. |

Plan-vs-implementation note:

- **Phase 3B later generalized the single-server shape this report verifies.** The plan (2026-07-08) describes and verified the Phase-3a single-upstream model: `projectSpec.mcp: {url,host,header,allowedHosts}` plus a single sibling `mcpToken`, resolved by `resolveMcp`/`resolveMcpToken`. Phase 3B (`8cfb245b6` "feat(mcp): multi-server selection — servers[] vault, resolveMcpServers/Tokens, fail-closed session start, maxMcpServers cap", 2026-07-09 — an ancestor of the current trunk) replaced that with a multi-server model in both repos: the vault holds a `servers` selection, the spec carries a `mcp[]` array, the body carries a `mcpTokens` record keyed by server id, and the resolvers are `resolveMcpServers`/`resolveMcpTokens` (the current test files — e.g. `tests/coding-credentials/types.test.ts:70` `FIELDS_BY_NAMESPACE.mcp` → `['servers']`, and `tests/plugins/acp/start-session.test.ts:333` `projectSpec includes mcp[] … mcpTokens` — reflect this newer shape, as does magi's `validateRepoSpec({ ...base, mcp: [validMcp] }, …)`). The Phase-3a config-flow invariants this report records (vault → resolver → spec/token sibling → fail-closed intake → spec-sourced `WorkerConfig`; INV-1/INV-2 unchanged) are subsumed by the multi-server tests; the Phase-3b layering itself is the subject of the forward-referenced ADRs 0274–0276.

The source plan `docs/superpowers/plans/2026-07-08-phase-3a-verification.md` is archived alongside this ADR to `docs/archive/`. Its design spec (`2026-07-05-sandbox-mcp-broker-design.md`) is a shared document already archived with ADR-0260.
