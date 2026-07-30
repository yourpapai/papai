<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 5a — Operator Guardrails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a bot-admin bound coding-session self-serve — allowed agents, who-may-use, force-shared-key — with magi enforcing allowed-agent + a fail-fast egress ceiling + per-user rate limits server-side.

**Architecture:** A per-platform-instance guardrail policy lives in papai admin config (`__admin_coding_guardrails__:<id>`, mirroring `__admin_tool_defaults__`); the operator shared key is just an `agent-provider` vault stored at that admin context (reuses the encrypted `coding_session_credentials` store). Enforcement is host-side: who-may-use filters the acp session-tool descriptors in `buildFullToolSet`; force-shared-key points `resolveAgentSecrets`/`resolveProviderHost` at the admin context. magi re-enforces allowed-agent in `validateRepoSpec`, fail-fasts the egress ceiling on `deriveEgress`, and rate-limits `/sessions`+`/reviews`.

**Tech Stack:** Bun + `bun:test`, Drizzle (SQLite), Zod v4, Svelte 5 (runes). Two repos: **papai** (`/Users/ki/Projects/yourpapai/papai`) and **magi** (`/Users/ki/Projects/yourpapai/magi`).

**Spec:** `docs/superpowers/specs/2026-06-27-phase-5a-operator-guardrails-design.md`

> **Execute on the current branches** (papai `master`, magi `main`), test-first. **Knip ordering:** A1's `resolveCodingGuardrails` reader is consumed within A1 (route GET + agent-picker filter); A2/A4 add more consumers. A2/A3/A4 are papai (sequential, shared files); B1∥B2 (magi) run parallel to the A-tasks. Explicit `git add` paths (untracked WIP may be present — never add files that aren't yours, e.g. `docs/superpowers/plans/2026-06-26-acp-cleanup.md`).

---

## File Structure

**Part A — papai**

- Create `src/coding-credentials/guardrails.ts` — policy type + reader/setter + admin context id.
- Create `src/debug/settings/admin/coding-guardrails-routes.ts` — GET/POST admin route.
- Modify `src/debug/settings-api-router.ts` — register the route.
- Create `client/settings/sections/CodingGuardrailsSection.svelte` — admin section.
- Modify the coding-credentials route + `CodingCredentialsSection.svelte` — agent-picker filter.
- Modify `src/coding-credentials/resolve-agent-secrets.ts` — force-shared-key.
- Modify `src/llm-orchestrator-tools.ts` — who-may-use filter.
- Modify `CLAUDE.md`.

**Part B — magi**

- Modify `src/project/config.ts` — `RepoPolicy.allowedAgents`/`egressCeiling`; allowed-agent check.
- Modify `src/server/router.ts` — egress-ceiling fail-fast + rate limit.
- Modify `src/main.ts` — source the new policy fields + rate-limit config from env.

---

# Part A — papai

## Task A1: guardrail policy + admin route + admin section + agent-picker filter

**Files:** create `src/coding-credentials/guardrails.ts`, `src/debug/settings/admin/coding-guardrails-routes.ts`, `client/settings/sections/CodingGuardrailsSection.svelte`; modify `src/debug/settings-api-router.ts`, the coding-credentials settings route, `client/settings/sections/CodingCredentialsSection.svelte`. Tests: guardrails store, route, section, agent-filter.

> Read first: `src/tools/admin-tool-defaults.ts` (reserved-context id), `src/debug/settings/admin/tool-defaults-routes.ts` (route shape: `requireAdmin(authed,'read'|'write')`, `requireCsrf`, Zod body, `authed.principal.platformInstanceId`), `src/debug/settings-api-router.ts` (`routeAdminApi` registration), `src/cache.ts` (`getCachedConfig`/`setCachedConfig`), `src/coding-credentials/{types,store}.ts` (`AGENTS`, `updateCodingCredentials`/`getCodingCredentials`), and an existing admin `*.svelte` section for the UI pattern.

- [ ] **Step 1: Failing test — guardrails reader defaults + round-trip**

```ts
// tests/coding-credentials/guardrails.test.ts
import {
  resolveCodingGuardrails,
  setCodingGuardrails,
  adminCodingGuardrailsContextId,
} from '../../src/coding-credentials/guardrails.js'
import { setupTestDb } from '../utils/test-helpers.js'

test('resolveCodingGuardrails defaults to allow-all when unset', async () => {
  await setupTestDb()
  const g = resolveCodingGuardrails('pi-1')
  expect(g.whoMayUse).toBe('members')
  expect(g.forceSharedKey).toBe(false)
  expect(g.allowedAgents).toEqual(['claude', 'codex', 'opencode'])
})
test('setCodingGuardrails round-trips', async () => {
  await setupTestDb()
  setCodingGuardrails('pi-1', { allowedAgents: ['claude'], whoMayUse: ['u1'], forceSharedKey: true })
  const g = resolveCodingGuardrails('pi-1')
  expect(g.allowedAgents).toEqual(['claude'])
  expect(g.whoMayUse).toEqual(['u1'])
  expect(g.forceSharedKey).toBe(true)
  expect(adminCodingGuardrailsContextId('pi-1')).toBe('__admin_coding_guardrails__:pi-1')
})
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: `guardrails.ts`**

```ts
import { z } from 'zod'
import { getCachedConfig, setCachedConfig } from '../cache.js'
import { AGENTS } from './types.js'

const PREFIX = '__admin_coding_guardrails__:'
const KEY = 'coding_guardrails'

export const guardrailsSchema = z.object({
  allowedAgents: z.array(z.string()).default([...AGENTS]),
  whoMayUse: z.union([z.literal('members'), z.array(z.string())]).default('members'),
  forceSharedKey: z.boolean().default(false),
})
export type CodingGuardrails = z.infer<typeof guardrailsSchema>

export function adminCodingGuardrailsContextId(platformInstanceId: string): string {
  return `${PREFIX}${platformInstanceId}`
}
const DEFAULTS = (): CodingGuardrails => ({ allowedAgents: [...AGENTS], whoMayUse: 'members', forceSharedKey: false })

export function resolveCodingGuardrails(platformInstanceId: string): CodingGuardrails {
  const raw = getCachedConfig(adminCodingGuardrailsContextId(platformInstanceId), KEY)
  if (raw === null) return DEFAULTS()
  try {
    return guardrailsSchema.parse(JSON.parse(raw))
  } catch {
    return DEFAULTS()
  }
}
export function setCodingGuardrails(platformInstanceId: string, g: CodingGuardrails): void {
  setCachedConfig(adminCodingGuardrailsContextId(platformInstanceId), KEY, JSON.stringify(guardrailsSchema.parse(g)))
}
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Admin route** `src/debug/settings/admin/coding-guardrails-routes.ts` — mirror `tool-defaults-routes.ts`:
  - `GET /settings/api/admin/coding-guardrails` → `requireAdmin(authed,'read')`; returns `{ guardrails: resolveCodingGuardrails(pi), sharedKeySet: getCodingCredentials(adminCodingGuardrailsContextId(pi), 'agent-provider') !== null }` (NEVER return the key itself).
  - `POST` → `requireCsrf` + `requireAdmin(authed,'write')`; Zod discriminated body `{ kind: 'policy', guardrails }` → `setCodingGuardrails`; `{ kind: 'shared-key', provider, api_key, base_url? }` → `updateCodingCredentials(adminCodingGuardrailsContextId(pi), 'agent-provider', {...}, principalId)`; `{ kind: 'shared-key-clear' }` → clear. `pi = authed.principal.platformInstanceId`. Return the GET shape.
  - Test: super-admin/admin gate (401/403 unauth), policy round-trip via the route, shared-key set→`sharedKeySet:true` without leaking the key.

- [ ] **Step 6: Register** in `settings-api-router.ts` `routeAdminApi`: `if (p === '/settings/api/admin/coding-guardrails') return handleAdminCodingGuardrailsRoutes(req, url, p)`.

- [ ] **Step 7: Admin section** `CodingGuardrailsSection.svelte` — fetch GET; render allowed-agents checkboxes (from `AGENTS`), who-may-use (`members` vs an allowlist textarea of user ids), force-shared-key toggle, and the shared-key fields (provider select + masked api-key + base-url; show "set"/Replace when `sharedKeySet`). Each save PATCHes the corresponding `kind`. Wire into the admin settings page. Client test (happy-dom): renders + a policy save issues the POST.

- [ ] **Step 8: Agent-picker filter** — in the existing coding-credentials settings route, add `allowedAgents: resolveCodingGuardrails(principal.platformInstanceId).allowedAgents` to the response; in `CodingCredentialsSection.svelte` `selectOptionsFor`, when `field.key === 'agent'`, filter options to `allowedAgents`. Client test: agent select shows only allowed agents.

- [ ] **Step 9: Run all changed tests + `bun run knip` (exit 0).**

- [ ] **Step 10: Commit**

```bash
git add src/coding-credentials/guardrails.ts src/debug/settings/admin/coding-guardrails-routes.ts src/debug/settings-api-router.ts client/settings/sections/CodingGuardrailsSection.svelte client/settings/sections/CodingCredentialsSection.svelte src/debug/settings/coding-credentials-routes.ts tests/coding-credentials/guardrails.test.ts tests/debug/settings/ tests/client/settings/
git commit -m "feat(coding-credentials): operator guardrails admin config + section + agent filter"
```

---

## Task A2: force-shared-key resolution

**Files:** `src/coding-credentials/resolve-agent-secrets.ts`. Tests: `tests/coding-credentials/resolve-agent-secrets.test.ts`.

> The shared key is an `agent-provider` vault at `adminCodingGuardrailsContextId(pi)`. When `forceSharedKey`, resolve there instead of the user's config-context. Forge resolvers are unchanged.

- [ ] **Step 1: Failing tests** — with guardrails `forceSharedKey:true` for `pi-1` and a shared-key vault stored at the admin context: `resolveAgentSecrets(<group storage ctx on pi-1>)` returns the SHARED key's env map (not the user's); `resolveProviderHost` returns the shared key's host; `resolveForgeToken` still returns the USER's token. With `forceSharedKey:false`: unchanged (user's key).

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — add a private helper and use it in `resolveAgentSecrets` + `resolveProviderHost`:

```ts
import { parseScopedContextId } from '../chat/scoped-context.js'
import { adminCodingGuardrailsContextId, resolveCodingGuardrails } from './guardrails.js'

/** When the platform instance forces a shared key, returns the admin context that holds it; else null. */
function sharedKeyContext(storageContextId: string): string | null {
  const pi = parseScopedContextId(storageContextId)?.platformInstanceId
  if (pi === undefined) return null
  return resolveCodingGuardrails(pi).forceSharedKey ? adminCodingGuardrailsContextId(pi) : null
}
```

In `resolveAgentSecrets` and `resolveProviderHost`, change the lookup context from `configContextOf(storageContextId)` to `sharedKeyContext(storageContextId) ?? configContextOf(storageContextId)`. Leave `resolveAgent`, `resolveForgeToken`, `resolveForge` reading `configContextOf` (forge + agent stay per-identity unless you also want the shared agent — see open question; default: agent stays user's, only the provider key is shared).

- [ ] **Step 4: Run → pass; `bun run knip` (exit 0).**

- [ ] **Step 5: Commit**

```bash
git add src/coding-credentials/resolve-agent-secrets.ts tests/coding-credentials/resolve-agent-secrets.test.ts
git commit -m "feat(coding-credentials): force-shared-key resolves the operator agent-provider key"
```

---

## Task A3: who-may-use tool filter

**Files:** `src/llm-orchestrator-tools.ts`. Tests: `tests/` orchestrator-tools.

> Read the `buildFullToolSet` region (~170–210) where `applyGuestReadOnlyFilter`/`applyToolPreferences` produce `prefTools`. Add a who-may-use post-filter. `platformInstanceId = parseScopedContextId(opts.contextId)?.platformInstanceId`.

- [ ] **Step 1: Failing test** — build the tool set for a group context on `pi-1` with guardrails `whoMayUse: ['allowed-user']`: an actor whose `chatUserId` is `allowed-user` keeps `plugin_acp__start_session`/`plugin_acp__review_pr`; an actor `other-user` (non-guest) loses the state-changing acp tools but keeps `plugin_acp__list_sessions`. With `whoMayUse:'members'`: reference-identical (both keep all).

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — a pure helper + apply it after the pref/guest filter:

```ts
const ACP_SESSION_ACTION_TOOLS = new Set([
  'plugin_acp__start_session',
  'plugin_acp__review_pr',
  'plugin_acp__finish_session',
  'plugin_acp__cancel_session',
  'plugin_acp__answer_permission',
])
export function applyWhoMayUseFilter(tools: ToolSet, whoMayUse: 'members' | string[], chatUserId: string): ToolSet {
  if (whoMayUse === 'members') return tools
  if (whoMayUse.includes(chatUserId)) return tools
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    if (t !== undefined && !ACP_SESSION_ACTION_TOOLS.has(name)) out[name] = t
  }
  return out
}
```

Apply in `buildFullToolSet` after `prefTools` is computed:

```ts
const pi = parseScopedContextId(contextId)?.platformInstanceId
const gatedTools =
  pi === undefined ? prefTools : applyWhoMayUseFilter(prefTools, resolveCodingGuardrails(pi).whoMayUse, chatUserId)
```

…and use `gatedTools` downstream wherever `prefTools` was consumed.

- [ ] **Step 4: Run → pass; `bun run knip` (exit 0).**

- [ ] **Step 5: Doc** — `CLAUDE.md`: operator guardrails (allowed agents / who-may-use / force-shared-key), the admin section, and the magi enforcement (5a). Commit:

```bash
git add src/llm-orchestrator-tools.ts CLAUDE.md tests/
git commit -m "feat(orchestrator): who-may-use gate on coding-session tools"
```

---

# Part B — magi (`/Users/ki/Projects/yourpapai/magi`)

## Task B1: allowed-agent enforcement + egress-ceiling fail-fast

**Files:** `src/project/config.ts`, `src/server/router.ts`, `src/main.ts`. Tests: `tests/project/*`, `tests/server/router.test.ts`.

> Read `RepoPolicy` (`{ allowedHosts }`), `validateRepoSpec(value, policy)`, `isSpecAgent`, `SAAS_API_HOSTS`, `deriveEgress` in `config.ts`; the `handleStart`/`handleReview` 400 paths + `ServerDeps` in `router.ts`; the `policy` construction in `main.ts`.

- [ ] **Step 1: Failing tests** —
  - `validateRepoSpec` with `policy.allowedAgents: ['claude']` and a spec `agent:'codex'` → throws `agent not permitted: codex`; with the agent in the list → ok; with `allowedAgents` undefined → unchanged.
  - router: `POST /sessions` with a `providerHost` deriving an egress host not in `policy.egressCeiling` (and not SAAS) → **400** `egress host not permitted by operator ceiling: <host>`; within the ceiling → 202. (Add `egressCeiling` to the test `DEMO_POLICY`.)

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: `config.ts`** — extend the policy + add an assertion:

```ts
export interface RepoPolicy {
  allowedHosts: readonly string[]
  allowedAgents?: readonly string[]
  egressCeiling?: readonly string[]
}
```

In `validateRepoSpec`, after `isSpecAgent(agentRaw)`:

```ts
if (policy.allowedAgents !== undefined && !policy.allowedAgents.includes(agentRaw))
  throw new Error(`agent not permitted: ${agentRaw}`)
```

Add an exported ceiling assertion (used by the router):

```ts
export function assertEgressWithinCeiling(spec: ProjectSpec, defaults: ProjectDefaults, policy: RepoPolicy): void {
  if (policy.egressCeiling === undefined) return
  const allowed = new Set([...policy.egressCeiling, ...SAAS_API_HOSTS])
  for (const host of deriveEgress(spec, defaults)) {
    if (!allowed.has(host)) throw new Error(`egress host not permitted by operator ceiling: ${host}`)
  }
}
```

- [ ] **Step 4: `router.ts`** — in `handleStart` and `handleReview`, after `validateRepoSpec(...)` succeeds, wrap a ceiling check that maps to 400:

```ts
try {
  assertEgressWithinCeiling(projectSpec, deps.defaults, deps.policy)
} catch (error: unknown) {
  return json({ error: error instanceof Error ? error.message : 'egress not permitted' }, 400)
}
```

- [ ] **Step 5: `main.ts`** — source the new policy fields from env:

```ts
const agentsEnv = process.env['MAGI_ALLOWED_AGENTS']
const ceilingEnv = process.env['MAGI_EGRESS_CEILING']
const policy: RepoPolicy = {
  allowedHosts: /* unchanged */,
  ...(agentsEnv ? { allowedAgents: agentsEnv.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
  ...(ceilingEnv ? { egressCeiling: ceilingEnv.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
}
```

- [ ] **Step 6: Run → pass; `bun run typecheck && bun run lint` clean.**

- [ ] **Step 7: Commit**

```bash
git add src/project/config.ts src/server/router.ts src/main.ts tests/
git commit -m "feat(provisioning): enforce allowed-agent + fail-fast egress ceiling"
```

---

## Task B2: per-user rate limit on `/sessions` + `/reviews`

**Files:** `src/server/router.ts` (+ a small `src/server/rate-limit.ts`), `src/main.ts`. Tests: `tests/server/`.

> No rate-limit infra exists. Add a fixed-window counter keyed by `contextId`, mirroring the simple `Map` state pattern of `SessionStore`. Inject via `ServerDeps` (so tests can construct one with a tiny window).

- [ ] **Step 1: Failing test** — a limiter with `limit:2, windowMs:60000`: `check('ctx')` twice → allowed, third → blocked; a different `contextId` is independent. Router: 3rd `POST /sessions` for the same `contextId` within the window → **429**.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: `rate-limit.ts`**

```ts
export interface RateLimiter {
  check(key: string): boolean // true = allowed, false = over limit
}
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return {
    check(key) {
      const t = now()
      const cur = hits.get(key)
      if (cur === undefined || t >= cur.resetAt) {
        hits.set(key, { count: 1, resetAt: t + windowMs })
        return true
      }
      if (cur.count >= limit) return false
      cur.count += 1
      return true
    },
  }
}
```

- [ ] **Step 4: Wire** — add `rateLimiter: RateLimiter` to `ServerDeps`; in `handleStart`/`handleReview`, after the required-field check and before `validateRepoSpec`:

```ts
if (!deps.rateLimiter.check(contextId)) return json({ error: 'rate limit exceeded; try again later' }, 429)
```

In `main.ts`, construct `createRateLimiter(Number(process.env['MAGI_SESSION_RATE_LIMIT'] ?? 20), Number(process.env['MAGI_SESSION_RATE_WINDOW_MS'] ?? 3_600_000))` and pass it in. Update any `ServerDeps` test fixtures to supply a limiter.

- [ ] **Step 5: Run → pass; `bun run typecheck && bun run lint` clean.**

- [ ] **Step 6: Commit**

```bash
git add src/server/rate-limit.ts src/server/router.ts src/main.ts tests/
git commit -m "feat(server): per-context rate limit on sessions and reviews"
```

---

## Final verification

- [ ] **papai:** `bun run check:full` — green.
- [ ] **magi:** `bun run check:full` — green.
- [ ] **Cross-repo review:** allowed-agent (papai picker filter ∧ magi reject); force-shared-key injects the operator key while forge stays the user's; who-may-use drops session tools for non-allowlisted non-guests; egress-ceiling 400 + rate-limit 429 fire; all guardrails **default-allow / reference-identical when unset**.
- [ ] **Operator doc:** `magi` deployment/env notes for `MAGI_ALLOWED_AGENTS`, `MAGI_EGRESS_CEILING`, `MAGI_SESSION_RATE_LIMIT`/`_WINDOW_MS`.

---

## Spec-coverage self-check

| Spec item                                                      | Task            |
| -------------------------------------------------------------- | --------------- |
| Guardrail admin config + section + route                       | A1              |
| allowed-agents picker filter (UX)                              | A1              |
| force-shared-key (agent-provider key only; forge per-identity) | A2              |
| who-may-use (members \| allowlist; guests already excluded)    | A3              |
| magi allowed-agent enforcement                                 | B1              |
| `MAGI_EGRESS_CEILING` fail-fast                                | B1              |
| per-user rate limit                                            | B2              |
| allowedImages dropped (operator-owned image)                   | (n/a — decided) |

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-27-phase-5a-operator-guardrails.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
**2. Inline Execution** — execute here with checkpoints.

Suggested order A1 → A2 → A3 (papai), with B1 ∥ B2 (magi) in parallel. **Which approach?**
