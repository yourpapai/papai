<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0236: Phase 5c — Redaction Hardening

## Status

Implemented (with divergence)

## Date

2026-06-27

## Context

Phases 1–4c built the agent-credential vault (`coding_session_credentials`, ciphertext via `encryptSecretPayload`), per-user forge identity, typed forge connections, multi-provider/agent picker, derived egress, and (5a/5b) operator guardrails + group-session identity. Each phase extended the **secret blast-radius**: more secret-bearing fields (provider key, forge token, operator shared key, MCP tokens), more surfaces (the DB column, log lines, the in-transit `secrets`/`forgeToken` body to magi, the persisted `project_spec`, response/error bodies). The audit run for this phase surveyed every one of those surfaces across both papai and magi and found **no live leak** — every path was already safe by construction (`store.ts` logs only `contextId`/`namespace`/`updatedBy`; the column holds only ciphertext; the not-configured returns are pure literals; magi's `{id,status}` 202 body never echoes its inputs).

**5c's scope** is therefore not a fix pass but a **lock pass**: add release-gating regression assertions so a *future* diff cannot silently route a secret to a plaintext column, a log line, the persisted spec, or a response body. The spec explicitly models this on the `/stats` anonymity contract — a test-only gate that fails on regression. No `src/` change was expected (or shipped).

The relationship to ADR-0224 (Remove Debug Log Redaction) is the load-bearing context: 0224 **removed** the centralized log-content redactor (`redactLogEntry`) because its default-deny allowlist made the Log Explorer unreadable, and explicitly flagged "no safety net for accidentally-logged secrets" as the cost — the `CLAUDE.md` "never log tokens, API keys" rule became a load-bearing convention rather than a convention with a backstop. 5c is the targeted answer to that gap: instead of a global runtime scrubber (which the spec's "out of scope" section rejects as "would mask the discipline the tests enforce"), it locks the per-callsite discipline with spy tests, scoped to the highest-value secret surface — the coding-credentials store and the not-configured refusals. Where 0224 removed a broken general redactor, 5c adds precise regression guards.

## Decision Drivers

- **Test-only, no behavior change** — the audit found no leak; 5c adds regression guards, not fixes. Any `src/` change would be a real leak and must be called out (none was needed).
- **Assert at the boundary that matters** — read the **DB column directly** for ciphertext (not the decrypted round-trip, which would pass even if a plaintext shadow column existed); spy the **logger** for log-line assertions; assert **`Object.keys`/substring** for response shape. Mirror the existing BYOK ciphertext test (`tests/byok-llm/store.test.ts`) and settings-route no-leak tests.
- **Cover all three coding namespaces** — `agent-provider` (provider API key), `forge` (token), and the operator **shared key** stored at the admin context (`adminCodingGuardrailsContextId(pi)`) — the three secret shapes the vault holds.
- **Treat as release-gating** — like the `/stats` anonymity contract, these guards must fail a future leaky diff in CI.
- **No runtime scrubber** — the spec deliberately rejects a global log-scrubbing middleware; the code already never logs secrets by construction, and a scrubber would mask the per-callsite discipline the tests enforce (the 0224 lesson).
- **Honest log-spy** — if the spy is genuinely infeasible at a given callsite (module-load logger binding), fall back to the ciphertext/masking gates rather than inventing a `src/` change to make the spy work.

## Considered Options

### Option 1: Dedicated release-gate test file(s) per repo (chosen)

A discoverable `redaction.test.ts` (papai `tests/coding-credentials/`) asserting ciphertext at rest, no-secret logging, and the not-configured reference; magi asserts response shape + persisted spec.

- **Pros:** the release gate is discoverable in one named file; DB-direct reads prove ciphertext (not round-trip); spy assertions are precise; mirrors the established BYOK/stats redaction-gate pattern; no runtime overhead (test-only).
- **Cons:** the store binds `log = logger.child(...)` at module load, so a top-level import in the same file fixes the binding before any logger mock can install — the log-spy cannot live alongside the ciphertext gate in one file (it needs a cachebuster delayed-import, mirroring `tests/authorized-groups.test.ts`).

### Option 2: Inline the assertions into the existing store/route tests

Strengthen `tests/coding-credentials/store.test.ts` and the acp route tests with the `not.toContain` assertions instead of a dedicated gate file.

- **Pros:** no new file; assertions sit next to the feature tests.
- **Cons:** the release gate is no longer discoverable as a single named surface; the ciphertext assertion is redundant with the store's own round-trip test unless isolated; the spec's open question explicitly recommended a dedicated `redaction.test.ts` "so the release gate is discoverable."

### Option 3: A Semgrep/lint rule instead of tests

Add a `bun security` Semgrep rule flagging any `log.*` whose metadata includes `api_key`/`forge_token`/`provider_api_key`.

- **Pros:** general; catches new callsites without per-callsite test setup.
- **Cons:** the spec's open question explicitly scoped this out for 5c ("test guard suffices"); a lint rule cannot prove ciphertext-at-rest or response shape (those are runtime/DB properties, not syntactic patterns). Noted as a possible follow-up, not the gate.

## Decision

Option 1 shipped across papai. (magi Task B lives in a separate repo and is not verifiable from this worktree — see Implementation Notes.) No `src/` changes. What shipped:

### papai Task A — ciphertext at rest + not-configured + log-spy

1. **At-rest ciphertext (core gate).** `tests/coding-credentials/redaction.test.ts` queries the `coding_session_credentials` row directly via `getDrizzleDb()` and asserts `encrypted_config` does **not** contain the secret string, for all three namespaces: agent-provider (`sk-REAL-SECRET`), forge (`ghp_REAL_SECRET`), and the operator shared key at `adminCodingGuardrailsContextId('pi-1')` (`sk-SHARED-SECRET`). Mirrors `tests/byok-llm/store.test.ts`'s DB-direct ciphertext pattern.
2. **not-configured reference.** The same file asserts the static `NOT_CONFIGURED` object serializes with no `sk-`/`ghp_`/`glpat-`, **and** drives `startSessionTool` with a null secrets resolver to confirm the not-configured result carries no secret (a byte-stable guard over the refusal path).
3. **Log-spy (separate file).** `tests/coding-credentials/redaction-log.test.ts` installs a `createTrackedLoggerMock` via `mock.module('../../src/logger.js', …)`, imports the store through a cachebuster query (`?test=${crypto.randomUUID()}`) so the module re-evaluates and binds the mocked logger, drives `updateCodingCredentials`, and asserts no captured log arg contains the secret — with a **non-vacuous guard** (`tracked.getCalls().length > 0`) that proves the write *does* log (contextId/namespace/updatedBy), so the absence of the secret is meaningful. Covers the provider key (`sk-LOG-SECRET`) and forge token (`ghp_LOG_SECRET`).

## Consequences

### Positive

- The coding-credentials store's no-leak properties are now **regression-guarded**: ciphertext at rest across all three namespaces, no-secret logging (provider key + forge), and the not-configured refusal. A future diff that routes a secret to a plaintext column or a log line now **fails CI**.
- The plan's open question — whether the log-spy is feasible given `store.ts`'s module-load logger binding — was **resolved positively**: the cachebuster delayed-import pattern (mirroring `tests/authorized-groups.test.ts`) yields a real child-logger spy. The "if infeasible, fall back" branch was not needed.
- The non-vacuous `getCalls().length > 0` guard makes the absence assertions meaningful: they prove the write logs *something* (ids) while never logging the secret, so the test is not a no-op against an empty capture.
- Closes the gap ADR-0224 opened ("no safety net for accidentally-logged secrets"), scoped to the highest-value secret surface, without reintroducing the broken general redactor 0224 removed.
- No `src/` change, as the audit predicted — production behavior is byte-identical; only the test surface grew.

### Negative

- **The log-spy required a SECOND file**, not the single `redaction.test.ts` the plan sketched. `store.ts` binds `const log = logger.child(...)` at module load; the ciphertext file's top-level `import … from '../../src/coding-credentials/store.js'` fixes that binding before any logger mock can install. The log-spy therefore lives in `redaction-log.test.ts` with a cachebuster query import. This is a mild discoverability cost against the spec's "single release-gate file" goal.
- **The spec's "resolve/acp path" focused log-spy did not land.** The design named a third assertion: resolve creds and build the acp magi request body, asserting the secret appears only in the `secrets`/`forgeToken` fields and a turn-level logger spy never captured it. The shipped guards cover the store write + not-configured; the broader resolve/acp turn-level spy was not added.
- **magi Task B (response shape + persisted spec) is not verifiable from this repo.** It lives in a separate magi repo (`/Users/ki/Projects/yourpapai/magi`) and is out of scope for this papai worktree; the papai guards cover papai's half of the contract.

### Risks

- **The log-spy depends on Bun's query-string cachebuster import working.** A future bundler/loader change that strips query params would re-fix the binding; the non-vacuous `getCalls().length > 0` guard would then *fail* (alerting) rather than silently pass, which is the safer failure mode.
- **The not-configured literal guards use `sk-`/`ghp_`/`glpat-` prefixes.** A secret format that does not start with those prefixes would evade the literal guard; the ciphertext and log-spy tests are secret-value-specific and not affected, but the not-configured guard is prefix-shaped.
- **No `src/` redaction logic exists to test** — the guards are pure regression locks on already-safe code. A future feature that adds a NEW secret-bearing surface needs its own guard; these are scoped to the coding-credentials store + not-configured refusals.
- **No runtime scrubber backstop.** Consistent with 0224 and the spec's explicit out-of-scope, there is no global log-content redactor. The `CLAUDE.md` "never log secrets" rule plus these spy tests are the control; a leak in a non-spy'd callsite would not be caught by 5c.

## Related Decisions

- **ADR-0224: Remove Debug Log Redaction** — the direct predecessor; removed the broken centralized log redactor and flagged "no safety net for accidentally-logged secrets." 5c is the targeted test-based answer to that gap (scoped to the credential store), where 0224 took down a general runtime scrubber.
- **ADR-0234: Phase 5a — Operator Guardrails** — the `forceSharedKey` feature whose admin-context (`adminCodingGuardrailsContextId`) shared-key ciphertext 5c asserts.
- **ADR-0235: Phase 5b — Group-Session Identity** — the per-identity resolver path whose credential reads these guards cover.
- **ADR-0221: Phase 1 — Agent-Credential Vault and Per-Session Secret Channel** — the `encryptSecretPayload` / `coding_session_credentials` vault whose at-rest ciphertext 5c locks.
- **ADR-0197: Debug Observability Fixes** — introduced the log redactor (Decision 3) that ADR-0224 superseded; context for the redaction-history 5c sits in.

## Implementation Notes

Verified present against the shipped tree via `grep`/`read`/`git log`; the two papai commit messages match the plan's intent (the log-spy became a runtime gate, not a "no-log" claim).

| File | Role | Evidence |
| --- | --- | --- |
| `tests/coding-credentials/redaction.test.ts:56-106` | Ciphertext-at-rest describe: agent-provider / forge / operator-shared-key (admin ctx) — DB-direct `encrypted_config` read, `not.toContain` the secret. | `read` confirms. |
| `tests/coding-credentials/redaction.test.ts:112-172` | not-configured describe: `NOT_CONFIGURED` constant literal guard + `startSessionTool` not-configured result guard (no `sk-`/`ghp_`/`glpat-`). | `read` confirms. |
| `tests/coding-credentials/redaction-log.test.ts:19-20` | Cachebuster delayed-import `import(`../../src/coding-credentials/store.js?test=${crypto.randomUUID()}`)` — yields a fresh module that binds the mocked logger (mirrors `tests/authorized-groups.test.ts`). | `read` confirms. |
| `tests/coding-credentials/redaction-log.test.ts:39-58` | Log-spy tests: provider key (`sk-LOG-SECRET`) + forge token (`ghp_LOG_SECRET`) never captured; non-vacuous `getCalls().length > 0` guard. | `read` confirms. |
| `src/coding-credentials/store.ts:20` | `const log = logger.child({ scope: 'coding-credentials:store' })` — the module-load binding that forced the two-file split. | `read` confirms. |
| `src/coding-credentials/store.ts:97,110` | `encryptSecretPayload(cleaned)` (ciphertext written) and `log.info({ contextId, namespace, updatedBy }, …)` (only ids logged — never the config). | `read` confirms. |
| `src/db/coding-credentials-schema.ts:13` | `encryptedConfig: text('encrypted_config').notNull()` — the single ciphertext column; no plaintext shadow column. | `grep` confirms. |
| `src/coding-credentials/guardrails.ts:22` | `adminCodingGuardrailsContextId(platformInstanceId)` — the admin context the shared-key ciphertext test reads. | `grep` confirms. |
| `plugins/acp/client.ts:10` | `export const NOT_CONFIGURED = { error: 'not_configured', message: … }` — the static refusal the literal guard serializes. | `grep` confirms. |
| `plugins/acp/session-tools.ts:75` | `if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED` — the `startSessionTool` path the not-configured result test drives. | `grep` confirms. |
| papai commits `b1e6a547d`, `78be7b9b2` | "redaction release-gate (ciphertext + no-log)" + "runtime log-spy gate — store never logs secrets". | `git log` confirms. |

Plan-vs-implementation notes:

- **Two files, not one.** The plan's Steps 1+3 sketched both the ciphertext gate and the log-spy in a single `redaction.test.ts`. The log-spy is infeasible in that file: its top-level `import { updateCodingCredentials } from '../../src/coding-credentials/store.js'` fixes `store.ts`'s module-load `const log = logger.child(...)` binding before any logger mock can install (documented in the file's header comment). The shipped log-spy lives in a separate `redaction-log.test.ts` using the cachebuster delayed-import, mirroring `tests/authorized-groups.test.ts`.
- **The log-spy fallback was not needed.** The plan said "if capture is genuinely infeasible here, keep the ciphertext + masking gates … do not invent a `src/` change to make the spy work." The cachebuster pattern made the spy feasible, so the broader store-level log-spy shipped; no `src/` change was made. The spec's open question on log-spy depth was resolved toward the store-level spy (with a non-vacuous guard).
- **not-configured shipped as two tests.** Plan Step 4 named only the constant reference. The implementation also drives `startSessionTool` with a null resolver and asserts the serialized not-configured result carries no secret prefix — a stronger, path-level guard than the literal-only sketch.
- **The spec's "resolve/acp path" focused log-spy did not land.** The design named a third assertion (resolve creds → build the acp magi body → turn-level logger spy never captures the secret, which appears only in `secrets`/`forgeToken`). The shipped guards cover the store write + not-configured; the broader resolve/acp turn-level spy was not added.
- **magi Task B is out-of-repo.** The plan's Task B (`tests/server/redaction.test.ts` asserting `{id,status}` response shape + persisted `project_spec` no-secret) targets the separate magi repo (`/Users/ki/Projects/yourpapai/magi`), not verifiable from this papai worktree. papai's half of the contract is fully guarded here.
- **No `src/` changes shipped**, as the audit predicted; the guards are test-only. No real leak was discovered during implementation.

The source plan `docs/superpowers/plans/2026-06-27-phase-5c-redaction-hardening.md` and design `docs/superpowers/specs/2026-06-27-phase-5c-redaction-hardening-design.md` are archived alongside this ADR to `docs/archive/`.
