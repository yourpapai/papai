<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 5c — Redaction Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add release-gating redaction assertions that lock the (already-safe) secret handling: coding-session provider keys, forge tokens, the operator shared key, and the in-transit `secrets`/`forgeToken` never reach a plaintext store column, a log line, a persisted `project_spec`, or a response/error body.

**Architecture:** Test-only. A dedicated `redaction.test.ts` per repo as a discoverable release gate. papai asserts DB ciphertext + a logger-spy over the store/acp path. magi asserts the 202/error body shape + the persisted spec carry no secret. **The audit found no live leak — these are regression guards; no `src/` changes are expected.**

**Tech Stack:** Bun + `bun:test`. papai (`/Users/ki/Projects/yourpapai/papai`) + magi (`/Users/ki/Projects/yourpapai/magi`).

**Spec:** `docs/superpowers/specs/2026-06-27-phase-5c-redaction-hardening-design.md`

> **Execute on the current branches** (papai `master`, magi `main`). Tasks A (papai) ∥ B (magi) are independent test-only tasks. **If a guard ever fails, that's a real leak — fix the `src/` and call it out (none expected).** Explicit `git add` paths (never add untracked WIP, e.g. `docs/superpowers/plans/2026-06-26-acp-cleanup.md`).

---

## File Structure

- **papai:** create `tests/coding-credentials/redaction.test.ts`.
- **magi:** create `tests/server/redaction.test.ts` (+ optional one-line strengthening of an existing manager test).

---

## Task A: papai redaction guards

**Files:** create `tests/coding-credentials/redaction.test.ts`. (No `src/` changes expected.)

> Read first: `tests/byok-llm/store.test.ts` (the DB-direct ciphertext pattern: query the row, `not.toContain` the secret), `src/coding-credentials/store.ts` (`updateCodingCredentials`) + `src/db/coding-credentials-schema.ts` (the `codingSessionCredentials` table / `encrypted_config` column + how to import it), `src/coding-credentials/guardrails.ts` (`adminCodingGuardrailsContextId`), `tests/utils/logger-mock.ts` (`createTrackedLoggerMock` — `getCalls()` records top-level **and** child log calls), and an existing test that uses `createTrackedLoggerMock` (to copy the `mock.module('../../src/logger.js', ...)` install + timing pattern).

- [ ] **Step 1: At-rest ciphertext test (the core gate)**

```ts
import { and, eq } from 'drizzle-orm'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { codingSessionCredentials } from '../../src/db/coding-credentials-schema.js'
import { updateCodingCredentials } from '../../src/coding-credentials/store.js'
import { adminCodingGuardrailsContextId } from '../../src/coding-credentials/guardrails.js'

const rowCipher = (contextId: string, namespace: string): string | undefined =>
  getDrizzleDb()
    .select({ c: codingSessionCredentials.encryptedConfig })
    .from(codingSessionCredentials)
    .where(and(eq(codingSessionCredentials.contextId, contextId), eq(codingSessionCredentials.namespace, namespace)))
    .get()?.c

test('agent-provider api key is ciphertext at rest (never plaintext in the DB)', () => {
  updateCodingCredentials(
    'ctx-1',
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-REAL-SECRET' },
    'u',
  )
  const cipher = rowCipher('ctx-1', 'agent-provider')
  expect(cipher).toBeDefined()
  expect(cipher).not.toContain('sk-REAL-SECRET')
})
test('forge token is ciphertext at rest', () => {
  updateCodingCredentials('ctx-1', 'forge', { kind: 'github', forge_token: 'ghp_REAL_SECRET' }, 'u')
  expect(rowCipher('ctx-1', 'forge')).not.toContain('ghp_REAL_SECRET')
})
test('operator shared key is ciphertext at rest (admin context)', () => {
  const adminCtx = adminCodingGuardrailsContextId('pi-1')
  updateCodingCredentials(
    adminCtx,
    'agent-provider',
    { provider: 'openai', agent: 'codex', provider_api_key: 'sk-SHARED-SECRET' },
    'admin',
  )
  expect(rowCipher(adminCtx, 'agent-provider')).not.toContain('sk-SHARED-SECRET')
})
```

(Set `process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)` in `beforeEach` + `await setupTestDb()`, mirroring `resolve-agent-secrets.test.ts`.)

- [ ] **Step 2: Run → these pass immediately** (production is already safe). They are the regression guard; confirm they're green, then prove they'd catch a leak by temporarily asserting `.toContain` locally (do NOT commit that).

- [ ] **Step 3: Logger-spy test** — install `createTrackedLoggerMock`, drive the credential write, assert no captured log arg contains the secret:

```ts
import { createTrackedLoggerMock } from '../utils/logger-mock.js'
// In a describe with the tracked mock installed via mock.module BEFORE the store is exercised
// (mirror an existing createTrackedLoggerMock test for the install + timing).
test('updateCodingCredentials never logs the secret', () => {
  const tracked = createTrackedLoggerMock()
  // install: void mock.module('../../src/logger.js', () => ({ logger: tracked.logger, getLogLevel: tracked.getLogLevel }))
  updateCodingCredentials(
    'ctx-2',
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-LOG-SECRET' },
    'u',
  )
  expect(JSON.stringify(tracked.getCalls())).not.toContain('sk-LOG-SECRET')
})
```

> Timing caveat: `store.ts` may bind `logger.child(...)` at module load. If `getCalls()` comes back empty (capture missed), use the established delayed-import pattern (install the tracked mock, THEN `await import('../../src/coding-credentials/store.js')`) — copy whichever pattern an existing `createTrackedLoggerMock` test uses. If capture is genuinely infeasible here, keep the ciphertext + masking gates (already strong) and assert the **route** path instead (the settings route already has masking tests). Do not invent a `src/` change to make the spy work.

- [ ] **Step 4: not-configured reference** — assert the acp `not_configured` returns carry no secret (cheap byte-stable guard): import `NOT_CONFIGURED` (or invoke `start_session` with unconfigured secrets via the acp test harness) and assert the message contains no key/token. (Reuse the `tests/plugins/acp/coding-secrets-injection.test.ts` harness if simpler — or assert the literal in this file.)

- [ ] **Step 5: Run → pass; `bun run knip` (exit 0).**

- [ ] **Step 6: Commit**

```bash
git add tests/coding-credentials/redaction.test.ts
git commit -m "test(coding-credentials): redaction release-gate (ciphertext + no-log)"
```

---

## Task B: magi redaction guards

**Files:** create `tests/server/redaction.test.ts`; optionally strengthen `tests/session/manager.test.ts`. (No `src/` changes expected.)

> Read first: `tests/server/router.test.ts` (how `ServerDeps`/`createFetchHandler` is built + how `POST /sessions` requests are made + the auth bearer), `src/server/router.ts` (`handleStart`/`handleReview` → `json({ id, status }, 202)`), `src/session/store.ts` / `manager.ts` (the persisted `project_spec` excludes `secrets`/`forgeToken`).

- [ ] **Step 1: Response-shape + no-echo test**

```ts
// Build deps + handler as in router.test.ts; POST /sessions with secrets + forgeToken.
test('POST /sessions: 202 body is exactly {id,status}; never echoes secrets/forgeToken', async () => {
  const res = await handler(
    new Request('http://x/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        agent: 'claude',
        contextId: 'c1',
        prompt: 'go',
        secrets: { ANTHROPIC_API_KEY: 'sk-REAL' },
        forgeToken: 'ghp_REAL',
        projectSpec: {
          name: 'd',
          repoUrl: 'https://github.com/a/b.git',
          baseBranch: 'main',
          permissionPreset: 'cautious',
          agent: 'claude',
        },
      }),
    }),
  )
  expect(res.status).toBe(202)
  const text = await res.text()
  expect(text).not.toContain('sk-REAL')
  expect(text).not.toContain('ghp_REAL')
  expect(Object.keys(JSON.parse(text)).sort()).toEqual(['id', 'status'])
})
```

Add the analogous assertion for `POST /reviews`, and for an **error** path (e.g. a disallowed-host `projectSpec` → 400): assert the 400 body contains neither secret.

- [ ] **Step 2: Persisted-spec no-secret** — after starting a session that carried `secrets`/`forgeToken`, read the stored session (via the store/manager API used in `manager.test.ts`) and assert its serialized `project_spec` contains neither `'sk-REAL'` nor `'ghp_REAL'` (strengthen the existing persistence test with an explicit `not.toContain`).

- [ ] **Step 3: Run → pass; `bun run typecheck && bun run lint` clean.**

- [ ] **Step 4: Commit**

```bash
git add tests/server/redaction.test.ts tests/session/manager.test.ts
git commit -m "test(server): redaction release-gate (response shape + persisted spec)"
```

---

## Final verification

- [ ] **papai:** `bun run check:full` — green.
- [ ] **magi:** `bun run check:full` — green.
- [ ] Confirm the new tests are **release-gate quality**: each would fail if a future diff routed the secret to that surface (ciphertext → plaintext column; log line; response body; persisted spec). No `src/` changes were needed (audit-confirmed); if any were, they're called out as a real leak fix.

---

## Spec-coverage self-check

| Spec item                                                      | Task |
| -------------------------------------------------------------- | ---- |
| Vault ciphertext at rest (agent-provider / forge / shared key) | A    |
| No-log assertion over the credential write                     | A    |
| not-configured reference (no secret)                           | A    |
| magi response `{id,status}` + no-echo of secrets               | B    |
| magi persisted `project_spec` excludes secrets                 | B    |

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-27-phase-5c-redaction-hardening.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
**2. Inline Execution** — execute here with checkpoints.

Tasks A (papai) ∥ B (magi) are independent. **Which approach?**
