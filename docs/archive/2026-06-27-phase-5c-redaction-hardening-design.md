<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 5c — Redaction Hardening — Design

**Date:** 2026-06-27
**Status:** Draft (detailed spec; spawns a plan)
**Parent:** `docs/superpowers/specs/2026-06-27-phase-5-guardrails-identity-design.md` (§ 5c)
**Builds on:** Phases 1–4, 5a, 5b (all shipped)

## Scope

The final hardening pass: **lock the secret-redaction behavior with regression-guard
assertions**. A full audit across both repos (below) found **no live secret leak** —
every path is already safe. 5c therefore **adds tests, not fixes**: assertions that
the coding-session secrets (provider API keys, forge tokens, operator shared key,
and the in-transit `secrets`/`forgeToken`) never reach a store column in plaintext,
a log line, a persisted `project_spec`, or a response/error body — so a future
change cannot silently regress. Treated as **release-gating**, like the `/stats`
anonymity contract.

## Audit result (grounded) — no fixes required

| Surface                                                                                                                                  | Status   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `coding_session_credentials` at rest — only `encrypted_config` (ciphertext via `encryptSecretPayload`); no plaintext/shadow column       | **safe** |
| Logging — `store.ts`/facade/resolvers/acp `callMagi`/`providerRuntime.httpFetch`/routes log only ids/host/method, never key/token values | **safe** |
| In-transit — `callMagi` and the plugin httpFetch never log the request body/headers                                                      | **safe** |
| `not_configured` returns — pure early returns, no secret                                                                                 | **safe** |
| magi router `handleStart`/`handleReview` — **zero logging**; managers log only ids                                                       | **safe** |
| Persisted `project_spec` — `store.create` excludes `secrets`/`forgeToken`; `ProjectSpec` has no secret field                             | **safe** |
| Responses — `{ id, status }` (202); errors are string messages; no echo of secrets/spec                                                  | **safe** |
| Git transport — forge token via `MAGI_GIT_TOKEN` env + askpass, never argv/URL/logs                                                      | **safe** |

**Existing redaction tests:** the encryption primitive (`secret-payload-crypto.test.ts`),
BYOK store ciphertext (`byok-llm/store.test.ts`), the settings-route api_key/forge-token
masking, and the admin shared-key no-leak are already covered. The git askpass
env-vs-argv test exists. The **gaps are the coding-credentials vault's own at-rest
ciphertext assertion, a log-spy assertion, and a magi response-shape assertion.**

## Locked decisions

1. **No production changes.** The audit confirmed no leak; 5c is test-only. If an
   implementer _discovers_ a leak while writing a guard, fix it (and call it out) —
   but none is expected.
2. **Assert at the boundary that matters:** read the **DB column directly** (not the
   decrypted round-trip) for ciphertext; spy the **logger** for log-line assertions;
   assert **response `Object.keys`** for shape. Mirror the existing BYOK
   ciphertext test and the settings-route no-leak tests.
3. **Cover all three coding namespaces** — `agent-provider` (provider key), `forge`
   (token), and the operator **shared key** (admin-context `agent-provider` vault) —
   plus the in-transit body on the magi side.

## What 5c adds

### papai (Task A)

- **At-rest ciphertext (store test):** after `updateCodingCredentials(ctx,
'agent-provider', { provider_api_key: 'sk-REAL', ... })`, query the
  `coding_session_credentials` row directly and assert `encrypted_config` does
  **not** contain `'sk-REAL'`. Repeat for `forge` (`forge_token`) and for the
  **shared key** stored at `adminCodingGuardrailsContextId(pi)`. (Mirror
  `tests/byok-llm/store.test.ts`.)
- **Log-spy:** with `mockLogger()` in spy mode, drive `updateCodingCredentials`
  (and `setGroupCodingIdentity`/the routes) and assert no captured log argument
  (message or metadata) contains the key/token string.
- **Resolve/acp path:** a focused test that resolves creds and builds the acp magi
  body, asserting the secret appears **only** in the request `secrets`/`forgeToken`
  fields — and that a logger spy over the whole turn never captured it.
- **not-configured reference:** assert the `not_configured` returns are byte-stable
  string literals with no secret (a cheap regression guard).

### magi (Task B)

- **Response shape:** in the router tests, assert the 202 body keys are exactly
  `['id','status']` (no `secrets`/`forgeToken`/`projectSpec`), and that a request
  carrying `secrets: { ANTHROPIC_API_KEY: 'sk-REAL' }` + `forgeToken: 'ghp_REAL'`
  yields a response + error bodies containing neither string.
- **Persisted spec:** assert the stored session row's `project_spec` contains no
  `secrets`/`forgeToken` (strengthen the existing manager test with an explicit
  `not.toContain`).
- **Log capture:** if magi has a test-time log capture, assert no log line over a
  start/review carries the secret; otherwise document that the router/managers have
  zero secret-bearing log calls (audit-confirmed) and rely on the shape assertions.

## Security

- These assertions are the **release gate** for the secret blast-radius established
  in Phase 1 and extended through 4a/4b/4c/5a/5b. Any future diff that routes a
  secret to a log, a plaintext column, the persisted spec, or a response body will
  now **fail a test**. No new secrets, no behavior change.

## Out of scope (5c)

- Re-architecting redaction (none needed). Encrypting already-non-secret config.
- Log-scrubbing middleware (the code already never logs secrets; a global scrubber
  is unnecessary and would mask the discipline the tests enforce).

## Testing

This phase **is** testing. Follow `tests/CLAUDE.md`: DB-direct reads for ciphertext,
`mockLogger()` spy for log assertions, `Object.keys`/`not.toContain` for response
shape. Keep assertions isolation-clean (no fixed-wall-clock).

## Files touched (anticipated)

**papai:** `tests/coding-credentials/store.test.ts` (+ maybe a new
`tests/coding-credentials/redaction.test.ts`), `tests/plugins/acp/*` (resolve/body

- log-spy), `tests/debug/settings/admin/coding-guardrails-routes.test.ts` (shared-key
  ciphertext). **No `src/` changes expected.**

**magi:** `tests/server/router.test.ts` (response shape + no-echo),
`tests/session/manager.test.ts` / `tests/review/manager.test.ts` (persisted-spec
no-secret). **No `src/` changes expected.**

## Decomposition

- **Task A (papai):** the papai redaction assertions (ciphertext, log-spy, resolve/acp,
  not-configured).
- **Task B (magi):** the magi redaction assertions (response shape, persisted spec).

Two small, independent test-only tasks (different repos) — run in parallel.

## Open questions

- **Centralize vs inline:** a single new `redaction.test.ts` per repo (a clear
  release-gate file) vs. extending the existing store/route/router test files.
  Recommend a dedicated `redaction.test.ts` per repo so the release gate is
  discoverable, plus the one-line strengthenings inline where natural.
- **Log-spy depth:** assert specific known callsites don't log the secret (cheap,
  precise) vs. a broad "no captured log arg contains the secret across the turn"
  (stronger, slightly more setup). Recommend the broad turn-level spy for the
  store + acp path, point-asserts elsewhere.
- **A standing lint?** Optionally a Semgrep rule (`bun security`) flagging a
  `log.*` whose metadata includes `api_key`/`forge_token`/`provider_api_key`.
  Out of scope for 5c (test guard suffices); note as a possible follow-up.
