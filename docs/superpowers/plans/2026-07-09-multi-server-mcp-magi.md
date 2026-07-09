<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-server MCP multiplexing — magi broker Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make magi's MCP broker accept and run **N MCP upstreams per coding session** (today: exactly one), with per-server tool-policy gating, fail-closed validation, and a hard ceiling — while keeping the mediator, gate, worker-client, and tunnel code unchanged.

**Architecture:** `projectSpec.mcp` becomes an array `[{ id, ... }]` and `mcpToken` becomes an `mcpTokens` map. magi launches one worker enclosure per upstream (dirs/sockets keyed by `serverId`) and stands up **one** mediator whose `handleConnection` is a new `serverId → handler` router (each handler is the existing `makeWorkerHandleConnection`, optionally wrapped by the existing per-server `makeGatedHandleConnection`). The coding agent opens one tunnel per server and natively merges/namespaces their tools — so no JSON-RPC merge logic is added.

**Tech Stack:** TypeScript (ESM, NodeNext, `.js` import extensions, **no semicolons, single quotes, no `any`, explicit return types, no `?.`** — enforced by oxlint/oxfmt), Bun test runner, `@agentclientprotocol/sdk`.

**Repo:** All work is in **`/Users/ki/Projects/yourpapai/magi`** (NOT papai). Design spec: `~/Projects/yourpapai/papai/docs/superpowers/specs/2026-07-09-multi-server-mcp-multiplexing-design.md`.

---

## Repo conventions (read before starting — enforced by hooks)

- **TDD hook:** writing/editing a `src/**` file is **blocked** unless a matching `tests/**` file (mirroring the path) exists and imports the module — write the test first, in the same session. Sequence every task test-first.
- **No suppressions:** editing `.oxlintrc.json` or adding `@ts-ignore`/`@ts-expect-error`/`oxlint-disable` is blocked. Fix the underlying issue.
- **No `git stash` / `git checkout --`** (blocked). Use worktrees if needed.
- Style: no semicolons, single quotes, 120-col, explicit return types, no optional chaining, no `any` (oxlint type-aware). Run `bun run fix` (lint:fix + format) before committing.
- Tests: `bun test <path>`; full gate `bun run check:full`; staged gate (pre-commit) `bun run check`.
- On stop, `check:full --skip-tests` runs and blocks on failure. Keep the tree green.

## File Structure

| File                                                                                                    | Change                                                                                                                        |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/project/config.ts`                                                                                 | `ProjectSpec.mcp` singular → `McpUpstream[]`; export `McpUpstream` type + `MAX_MCP_UPSTREAMS = 8`                             |
| `src/project/spec-validation.ts`                                                                        | `resolveMcp` → per-entry array parser (id uniqueness, count ≤ ceiling, fail-closed)                                           |
| `src/server/router.ts`                                                                                  | `mcpToken` (string) → `mcpTokens` (`Record<string,string>`) in `handleStart` + `handleFollowUp`                               |
| `src/launcher/launcher.ts`                                                                              | `LaunchMcpConfig` gains `id`; `LaunchSpec.mcp?: LaunchMcpConfig[]`                                                            |
| `src/session/helpers.ts`                                                                                | `mcpLaunchConfig` → `mcpLaunchConfigs` (array; per-id token pairing, fail-closed)                                             |
| `src/session/lifecycle.ts`                                                                              | `buildLaunchSpec` uses `mcpLaunchConfigs`; `mcpServersFor` derives the CSV of ids; `StartSessionInput.mcpToken` → `mcpTokens` |
| `src/session/manager.ts` (or wherever `SessionManager.startSession`/`followUpSession` input types live) | `mcpToken` → `mcpTokens` on the session-start/follow-up input                                                                 |
| `src/mcp-broker/worker/enclosure.ts`                                                                    | `defaultWorkerDir(sessionId, serverId)` + `ctrlSocketPath` keyed by `serverId`                                                |
| `src/mcp-broker/server-router.ts` **(new)**                                                             | `makeServerRouter(Map<serverId, handler>)` — dispatch by `serverId`, fail-closed on unknown                                   |
| `src/runtime/geofront/geofront-runtime.ts`                                                              | `McpApparatus.workers[]`; `startMcpApparatus` loops N; router wiring; teardown all                                            |

**Unchanged (already N-capable):** `src/mcp-broker/mediator.ts`, `handshake.ts`, `tunnel.ts`, `tunnel-main.ts`, `declare.ts`, `gate.ts`, `worker-client.ts`, `worker/bridge.ts`, `worker/outbound.ts`, `worker/config.ts`, `worker/worker-main.ts`, `src/acp/client.ts`. Do NOT modify these.

---

## Task 1: `McpUpstream` type + `MAX_MCP_UPSTREAMS` (config.ts)

**Files:**

- Modify: `src/project/config.ts` (`ProjectSpec.mcp` at lines 67-84; add exports)
- Test: `tests/project/config.test.ts` (create if absent; if present, add cases)

- [ ] **Step 1: Write/extend the failing test**

```ts
// tests/project/config.test.ts
import { describe, expect, it } from 'bun:test'

import { MAX_MCP_UPSTREAMS, type McpUpstream, type ProjectSpec } from '../../src/project/config.js'

describe('config mcp multi-upstream types', () => {
  it('exposes a hard ceiling of 8', () => {
    expect(MAX_MCP_UPSTREAMS).toBe(8)
  })

  it('types ProjectSpec.mcp as an array of McpUpstream', () => {
    const entry: McpUpstream = {
      id: 'plugin:web-search',
      url: 'https://bot.example.com/mcp/plugin/web-search',
      host: 'bot.example.com',
      header: 'Authorization',
      allowedHosts: ['bot.example.com'],
    }
    const spec: Pick<ProjectSpec, 'mcp'> = { mcp: [entry] }
    expect(spec.mcp?.[0]?.id).toBe('plugin:web-search')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test tests/project/config.test.ts`
Expected: FAIL — `MAX_MCP_UPSTREAMS`/`McpUpstream` not exported.

- [ ] **Step 3: Edit `src/project/config.ts`**

Replace the current `mcp?: { ... }` block in `ProjectSpec` (lines 76-83) with `mcp?: McpUpstream[]`, and add the exported type + constant near the other module constants. New/edited code:

```ts
// One MCP upstream a coding session may reach. `id` is the stable serverId used as the
// ACP McpServer.name, the tunnel handshake tag, and the mediator's routing key.
export interface McpUpstream {
  id: string
  url: string
  host: string
  header: string
  allowedHosts: string[]
  toolPolicy?: { default: Permission; tools?: Record<string, Permission> }
}

// Absolute per-session upstream ceiling enforced at magi's trust boundary regardless of
// caller config (papai enforces a lower operator-configurable soft cap separately).
export const MAX_MCP_UPSTREAMS = 8
```

And in `ProjectSpec`:

```ts
  mcp?: McpUpstream[]
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun test tests/project/config.test.ts`
Expected: PASS (2).

- [ ] **Step 5: `bun run fix && bun run typecheck`** — expect clean (other files that read `spec.mcp` as an object will now type-error; that's expected and fixed in later tasks — if typecheck is red ONLY in `spec-validation.ts`/`helpers.ts`/`geofront-runtime.ts`/`lifecycle.ts`, proceed; those are this plan's later tasks).

> Note: because this changes a shared type, `bun run typecheck` will be red until Tasks 2/4/5/6/8 land. Commit this task anyway (the pre-commit `check` runs on staged files; if it blocks on cross-file typecheck, land Tasks 1-2 together in one commit). If the hook blocks, combine Task 1's and Task 2's edits into a single commit at the end of Task 2.

- [ ] **Step 6: Commit** (see the note — may be combined with Task 2)

```bash
git add src/project/config.ts tests/project/config.test.ts
git commit -m "feat(mcp): ProjectSpec.mcp becomes McpUpstream[]; add MAX_MCP_UPSTREAMS"
```

---

## Task 2: Array validation in `resolveMcp` (spec-validation.ts)

**Files:**

- Modify: `src/project/spec-validation.ts` (`resolveMcp` lines 89-131; `validateRepoSpec` line 183)
- Test: `tests/project/spec-validation.test.ts` (extend existing)

- [ ] **Step 1: Write failing tests**

```ts
// add to tests/project/spec-validation.test.ts
import { MAX_MCP_UPSTREAMS } from '../../src/project/config.js'
import { validateRepoSpec } from '../../src/project/spec-validation.js'

const POLICY = { allowedHosts: ['bot.example.com', 'api.github.com'] as const }
const base = {
  name: 'r',
  repoUrl: 'https://github.com/o/r',
  baseBranch: 'main',
  permissionPreset: 'default',
  agent: 'claude',
}
const entry = (id: string, host: string) => ({
  id,
  url: `https://${host}/mcp`,
  host,
  header: 'Authorization',
  allowedHosts: [host],
})

describe('resolveMcp array', () => {
  it('accepts multiple valid upstreams', () => {
    const spec = validateRepoSpec(
      { ...base, mcp: [entry('a', 'bot.example.com'), entry('b', 'api.github.com')] },
      POLICY,
    )
    expect(spec.mcp?.map((m) => m.id)).toEqual(['a', 'b'])
  })
  it('rejects a duplicate id', () => {
    expect(() =>
      validateRepoSpec({ ...base, mcp: [entry('a', 'bot.example.com'), entry('a', 'api.github.com')] }, POLICY),
    ).toThrow(/duplicate/i)
  })
  it('rejects the whole spec when one entry host is not allowed (fail-closed)', () => {
    expect(() =>
      validateRepoSpec({ ...base, mcp: [entry('a', 'bot.example.com'), entry('b', 'evil.example.com')] }, POLICY),
    ).toThrow(/not allowed/i)
  })
  it('rejects more than the ceiling', () => {
    const many = Array.from({ length: MAX_MCP_UPSTREAMS + 1 }, (_v, i) => entry(`s${i}`, 'bot.example.com'))
    expect(() => validateRepoSpec({ ...base, mcp: many }, POLICY)).toThrow(/too many|ceiling|maximum/i)
  })
  it('treats absent mcp as no upstreams', () => {
    expect(validateRepoSpec(base, POLICY).mcp).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`resolveMcp` still parses a single object)

Run: `bun test tests/project/spec-validation.test.ts`

- [ ] **Step 3: Rewrite `resolveMcp`**

Keep the existing single-entry validation logic but extract it into a per-entry helper and wrap it in an array loop. Replace `resolveMcp` (lines 89-131) with:

```ts
function resolveMcpEntry(raw: unknown, policy: RepoPolicy): McpUpstream {
  if (!isRecord(raw)) throw new Error('projectSpec.mcp[] entry is not a valid object')
  const idRaw = raw['id']
  if (typeof idRaw !== 'string' || idRaw.length === 0) throw new Error('projectSpec.mcp[].id is required')
  const urlRaw = raw['url']
  if (typeof urlRaw !== 'string' || urlRaw.length === 0) throw new Error('projectSpec.mcp[].url is required')
  let mcpUrl: URL
  try {
    mcpUrl = new URL(urlRaw)
  } catch {
    throw new Error('projectSpec.mcp[].url is not a valid URL')
  }
  if (mcpUrl.protocol !== 'https:') throw new Error('projectSpec.mcp[].url must be https')
  const hostRaw = raw['host']
  if (typeof hostRaw !== 'string' || hostRaw.length === 0) throw new Error('projectSpec.mcp[].host is required')
  if (hostRaw !== mcpUrl.hostname) throw new Error('projectSpec.mcp[].host must match url hostname')
  if (!policy.allowedHosts.includes(hostRaw)) throw new Error(`mcp host not allowed: ${hostRaw}`)
  const headerRaw = raw['header']
  if (typeof headerRaw !== 'string' || headerRaw.length === 0) throw new Error('projectSpec.mcp[].header is required')
  const allowedHostsRaw = raw['allowedHosts']
  if (!Array.isArray(allowedHostsRaw) || allowedHostsRaw.length === 0) {
    throw new Error('projectSpec.mcp[].allowedHosts is required')
  }
  const allowedHosts = allowedHostsRaw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim().toLowerCase())
  if (allowedHosts.length !== allowedHostsRaw.length || allowedHosts.some((h) => !isBareHost(h))) {
    throw new Error('projectSpec.mcp[].allowedHosts must be bare host names')
  }
  if (!allowedHosts.includes(hostRaw)) throw new Error('projectSpec.mcp[].allowedHosts must include host')
  const toolPolicy = resolveMcpToolPolicy(raw['toolPolicy'])
  return { id: idRaw, url: urlRaw, host: hostRaw, header: headerRaw, allowedHosts, toolPolicy }
}

function resolveMcp(o: Record<string, unknown>, policy: RepoPolicy): McpUpstream[] | undefined {
  const raw = o['mcp']
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) throw new Error('projectSpec.mcp must be an array')
  if (raw.length === 0) return undefined
  if (raw.length > MAX_MCP_UPSTREAMS)
    throw new Error(`projectSpec.mcp has too many upstreams (max ${MAX_MCP_UPSTREAMS})`)
  const entries = raw.map((entry) => resolveMcpEntry(entry, policy))
  const ids = new Set<string>()
  for (const e of entries) {
    if (ids.has(e.id)) throw new Error(`projectSpec.mcp has a duplicate id: ${e.id}`)
    ids.add(e.id)
  }
  return entries
}
```

Add imports at the top of the file: `import { MAX_MCP_UPSTREAMS, type McpUpstream } from './config.js'` (merge with the existing `./config.js` import — it already imports `Permission`/`RepoPolicy`). `validateRepoSpec` at line 183 already assigns `const mcp = resolveMcp(o, policy)` and returns `mcp` — no change needed there (the type now flows as `McpUpstream[] | undefined`).

- [ ] **Step 4: Run — expect PASS**

Run: `bun test tests/project/spec-validation.test.ts`
Expected: PASS.

- [ ] **Step 5: `bun run fix && bun run typecheck`** (config.ts + spec-validation.ts now consistent; remaining red is in helpers/launcher/lifecycle/geofront-runtime — Tasks 4-8).

- [ ] **Step 6: Commit**

```bash
git add src/project/config.ts src/project/spec-validation.ts tests/project/config.test.ts tests/project/spec-validation.test.ts
git commit -m "feat(mcp): validate projectSpec.mcp as an array (id uniqueness, host, ceiling, fail-closed)"
```

---

## Task 3: `mcpTokens` map on the request (router.ts)

**Files:**

- Modify: `src/server/router.ts` (`handleStart` line 104 + `startSession` call 113-122; `handleFollowUp` line 236)
- Test: `tests/server/router.test.ts` (extend existing)

- [ ] **Step 1: Write a failing test** asserting a `POST /sessions` body with `mcpTokens: { 'plugin:x': 'tok' }` is accepted and threaded to `manager.startSession` as `mcpTokens` (mirror the existing router test harness — read `tests/server/router.test.ts` for its `deps`/fake-manager pattern; assert the fake manager receives `mcpTokens`, not `mcpToken`).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Edit `router.ts`.** Add a small parser near `asStringRecord`:

```ts
function asStringRecord(v: unknown): Record<string, string> | undefined {
  // (already exists — reuse it for mcpTokens)
}
```

Replace `handleStart` line 104:

```ts
const mcpTokens = asStringRecord(body['mcpTokens'])
```

and in the `startSession({...})` call replace `mcpToken,` with `mcpTokens,`. In `handleFollowUp` (line 236) replace `mcpToken: asString(body['mcpToken']) ?? undefined,` with `mcpTokens: asStringRecord(body['mcpTokens']),`.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: `bun run fix && bun run typecheck`** (manager input type still says `mcpToken` → red until Task 5/6; acceptable mid-plan).
- [ ] **Step 6: Commit**

```bash
git add src/server/router.ts tests/server/router.test.ts
git commit -m "feat(mcp): accept mcpTokens map on session start/follow-up requests"
```

---

## Task 4: `LaunchMcpConfig.id` + array `LaunchSpec.mcp` (launcher.ts)

**Files:**

- Modify: `src/launcher/launcher.ts` (lines 8-24)
- Test: `tests/launcher/launcher-types.test.ts` (create a minimal type-level test if none imports these types; if `launcher.ts` has an existing test, extend it)

- [ ] **Step 1: Write a failing test** that constructs a `LaunchMcpConfig` with `id` and a `LaunchSpec` with `mcp: LaunchMcpConfig[]` and asserts shape (compile-level + a trivial runtime assert). Import from `../../src/launcher/launcher.js`.

- [ ] **Step 2: Run — expect FAIL** (`id` not on the type / `mcp` not an array).

- [ ] **Step 3: Edit `launcher.ts`.** Add `id: string` to `LaunchMcpConfig`; change `LaunchSpec.mcp?: LaunchMcpConfig` → `mcp?: LaunchMcpConfig[]`:

```ts
export interface LaunchMcpConfig {
  id: string
  url: string
  host: string
  header: string
  allowedHosts: string[]
  token: string
  toolPolicy?: { default: Permission; tools?: Record<string, Permission> }
}

export interface LaunchSpec {
  sessionId: string
  cwd: string
  agent: string
  // Present (non-empty) only when the session declares MCP tunnels.
  mcp?: LaunchMcpConfig[]
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: `bun run fix && bun run typecheck`** (helpers/lifecycle/geofront-runtime still red — Tasks 5/6/8).
- [ ] **Step 6: Commit**

```bash
git add src/launcher/launcher.ts tests/launcher/launcher-types.test.ts
git commit -m "feat(mcp): LaunchMcpConfig carries id; LaunchSpec.mcp is an array"
```

---

## Task 5: `mcpLaunchConfigs` (helpers.ts)

**Files:**

- Modify: `src/session/helpers.ts` (replace `mcpLaunchConfig` lines 39-52)
- Test: `tests/session/helpers.test.ts` (extend)

- [ ] **Step 1: Write failing tests**

```ts
import { mcpLaunchConfigs } from '../../src/session/helpers.js'

const up = (id: string) => ({ id, url: `https://h/${id}`, host: 'h', header: 'Authorization', allowedHosts: ['h'] })

describe('mcpLaunchConfigs', () => {
  it('returns undefined for no upstreams', () => {
    expect(mcpLaunchConfigs(undefined, undefined)).toBeUndefined()
    expect(mcpLaunchConfigs([], {})).toBeUndefined()
  })
  it('pairs each upstream with its token by id', () => {
    const out = mcpLaunchConfigs([up('a'), up('b')], { a: 'ta', b: 'tb' })
    expect(out?.map((c) => [c.id, c.token])).toEqual([
      ['a', 'ta'],
      ['b', 'tb'],
    ])
  })
  it('fails closed naming the upstream when a token is missing', () => {
    expect(() => mcpLaunchConfigs([up('a')], {})).toThrow(/a/)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Replace `mcpLaunchConfig` with `mcpLaunchConfigs`:**

```ts
// Builds one LaunchMcpConfig per declared upstream from the validated projectSpec.mcp[]
// and the per-request mcpTokens map. An upstream without a matching token is a
// misconfigured request for a credential-holding enclosure and fails the session fast
// (fail-closed), naming the offending upstream. Absent/empty mcp means no MCP.
export function mcpLaunchConfigs(
  mcp: ProjectSpec['mcp'],
  mcpTokens: Record<string, string> | undefined,
): LaunchMcpConfig[] | undefined {
  if (mcp === undefined || mcp.length === 0) return undefined
  const tokens = mcpTokens ?? {}
  return mcp.map((entry): LaunchMcpConfig => {
    const token = tokens[entry.id]
    if (token === undefined || token.length === 0) {
      throw new Error(`projectSpec.mcp upstream '${entry.id}' has no matching mcpToken`)
    }
    return { ...entry, token }
  })
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: `bun run fix && bun run typecheck`** (lifecycle still calls the old name — Task 6).
- [ ] **Step 6: Commit**

```bash
git add src/session/helpers.ts tests/session/helpers.test.ts
git commit -m "feat(mcp): mcpLaunchConfigs pairs each upstream with its token (fail-closed)"
```

---

## Task 6: `buildLaunchSpec`, `mcpServersFor`, and the session-start input type (lifecycle.ts + manager)

**Files:**

- Modify: `src/session/lifecycle.ts` (`buildLaunchSpec` 104-111; `mcpServersFor` 113-120; `StartSessionInput` type — find it in this file or `manager.ts`)
- Modify: the file defining `SessionManager.startSession`/`followUpSession` input (grep `mcpToken` across `src/session/`)
- Test: `tests/session/lifecycle.test.ts` (extend)

- [ ] **Step 1: Write failing tests** for `mcpServersFor`: no `mcp` → `[]`; `mcp: [{id:'a'},{id:'b'}]` → two `McpServerStdio` with `name: 'a'` and `'b'` (assert `.map((s) => s.name)` = `['a','b']`). And a `buildLaunchSpec` test that a spec with two upstreams + a tokens map yields `spec.mcp` length 2.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Edit `lifecycle.ts`.** Replace `buildLaunchSpec` (104-111) and `mcpServersFor` (113-120):

```ts
export function buildLaunchSpec(id: string, cwd: string, input: StartSessionInput): LaunchSpec {
  return { sessionId: id, cwd, agent: input.agent, mcp: mcpLaunchConfigs(input.projectSpec.mcp, input.mcpTokens) }
}

// One tunnel MCP server per configured upstream; the agent spawns one mcp-tunnel per
// server name (its serverId), all dialing the single bind-mounted broker socket. Empty
// when the spec declares no upstreams.
export function mcpServersFor(spec: ProjectSpec): acp.McpServer[] {
  const csv = spec.mcp === undefined || spec.mcp.length === 0 ? undefined : spec.mcp.map((m) => m.id).join(',')
  return buildTunnelMcpServers(csv)
}
```

Change `StartSessionInput` (and the follow-up input type): replace `mcpToken?: string` with `mcpTokens?: Record<string, string>`. Update `SessionManager.startSession`/`followUpSession` bodies to pass `mcpTokens` through to `buildLaunchSpec` (grep for `mcpToken` in `src/session/` and replace each with `mcpTokens`; the follow-up path builds a launch spec the same way).

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: `bun run fix && bun run typecheck`** (geofront-runtime still singular — Tasks 7-8). `grep -rn "mcpToken\b" src/` should now return only `src/mcp-broker/worker/**` (the `MAGI_MCP_UPSTREAM_TOKEN` env var, unrelated) — confirm no stray singular `mcpToken` remains in session/router/launcher.
- [ ] **Step 6: Commit**

```bash
git add src/session/ tests/session/lifecycle.test.ts
git commit -m "feat(mcp): derive N tunnel servers + thread mcpTokens through session start"
```

---

## Task 7: Per-server worker dirs/sockets + the `serverId` router (enclosure.ts + new server-router.ts)

**Files:**

- Modify: `src/mcp-broker/worker/enclosure.ts` (`defaultWorkerDir` 55-59; `ctrlSocketPath` line 187)
- Create: `src/mcp-broker/server-router.ts`
- Test: `tests/mcp-broker/worker/enclosure.test.ts` (extend), `tests/mcp-broker/server-router.test.ts` (create)

- [ ] **Step 1: Write failing tests.**

For enclosure (extend): `defaultWorkerDir('sess', 'plugin:x')` ends with a path segment derived from both `sess` and a sanitized `plugin:x` (assert it differs from `defaultWorkerDir('sess', 'y')`).

For the router (new `tests/mcp-broker/server-router.test.ts`):

```ts
import { describe, expect, it } from 'bun:test'
import { PassThrough } from 'node:stream'

import { makeServerRouter } from '../../src/mcp-broker/server-router.js'

describe('makeServerRouter', () => {
  it('dispatches to the handler registered for the serverId', () => {
    const calls: string[] = []
    const router = makeServerRouter(
      new Map([
        [
          'a',
          (id: string): void => {
            calls.push(`a:${id}`)
          },
        ],
        [
          'b',
          (id: string): void => {
            calls.push(`b:${id}`)
          },
        ],
      ]),
    )
    router('b', new PassThrough(), new PassThrough())
    expect(calls).toEqual(['b:b'])
  })

  it('fails closed on an unknown serverId (writes a JSON-RPC error, does not throw)', () => {
    const router = makeServerRouter(new Map())
    const outbound = new PassThrough()
    let out = ''
    outbound.on('data', (c: Buffer): void => {
      out += c.toString()
    })
    expect(() => router('nope', new PassThrough(), outbound)).not.toThrow()
    expect(out).toContain('error')
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3a: Edit `enclosure.ts`.** Key both the dir and the socket by a sanitized `serverId` (server ids like `plugin:web-search` contain `:` and `/` — sanitize to a filesystem-safe token):

```ts
function sanitizeServerId(serverId: string): string {
  return serverId.replace(/[^a-zA-Z0-9_-]/gu, '_')
}

export function defaultWorkerDir(sessionId: string, serverId: string): string {
  return join(tmpdir(), 'magi-mcp-worker', sessionId, sanitizeServerId(serverId))
}
```

And in `launchWorker`, thread a `serverId` param and build `ctrlSocketPath` from it: change the signature to `launchWorker(dir: string, sessionId: string, serverId: string, opts: LaunchWorkerOptions = {})` and line 187 to `const ctrlSocketPath = join(dir, \`worker-ctrl-${sessionId}-${sanitizeServerId(serverId)}.sock\`)`. (The socket path length matters on some platforms; `tmpdir()`+ short sanitized ids stay well under the 108-char AF_UNIX limit for realistic ids — if a very long id risks overflow, hash it instead. Keep sanitized-truncated to 32 chars as a guard:`sanitizeServerId(serverId).slice(0, 32)`.)

- [ ] **Step 3b: Create `src/mcp-broker/server-router.ts`:**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import type { MediatorDeps } from './mediator.js'

// The mediator's single downstream when a session runs multiple MCP upstreams: routes
// each tunnel connection to the handler for its serverId (the handshake tag the mediator
// already threads). Each handler is the existing makeWorkerHandleConnection for that
// upstream's worker, optionally wrapped by that upstream's makeGatedHandleConnection.
// Unknown serverId → fail-closed JSON-RPC error, no worker touched.
export function makeServerRouter(
  routes: Map<string, MediatorDeps['handleConnection']>,
): MediatorDeps['handleConnection'] {
  return (serverId: string, inbound: NodeJS.ReadableStream, outbound: NodeJS.WritableStream): void => {
    const handler = routes.get(serverId)
    if (handler === undefined) {
      logger.warn({ serverId }, 'mcp-broker: unknown serverId; refusing (fail-closed)')
      const err = JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32601, message: `unknown mcp server: ${serverId}` },
      })
      outbound.write(`${err}\n`)
      outbound.end()
      inbound.resume()
      return
    }
    handler(serverId, inbound, outbound)
  }
}
```

- [ ] **Step 4: Run — expect PASS** (`bun test tests/mcp-broker/server-router.test.ts tests/mcp-broker/worker/enclosure.test.ts`).
- [ ] **Step 5: `bun run fix && bun run typecheck`** (geofront-runtime still calls the old singular `launchWorker`/`defaultWorkerDir`/`startMcpApparatus` — Task 8).
- [ ] **Step 6: Commit**

```bash
git add src/mcp-broker/server-router.ts src/mcp-broker/worker/enclosure.ts tests/mcp-broker/server-router.test.ts tests/mcp-broker/worker/enclosure.test.ts
git commit -m "feat(mcp): per-serverId worker dirs/sockets + serverId mediator router"
```

---

## Task 8: N-worker apparatus (geofront-runtime.ts)

**Files:**

- Modify: `src/runtime/geofront/geofront-runtime.ts` (`McpApparatus` 75-79; `selectMcpHandler` 84-91; `startMcpApparatus` 103-132; `teardownMcpApparatus` 137-143; `launch` 258-295; `buildShutdown` 145-168)
- Test: `tests/runtime/geofront/geofront-runtime.test.ts` (extend — mirror the existing apparatus test; if it shells out to real geofront, gate the new multi-worker assertions behind the same test seam the current MCP test uses)

- [ ] **Step 1: Write failing tests.** Read the existing geofront-runtime test to see how it fakes `launchWorker`/`startMediator` (DI or module boundary). Assert: given `spec.mcp` with two `LaunchMcpConfig`s, `startMcpApparatus` launches **two** workers (two `launchWorker` calls with distinct dirs/serverIds) and stands up **one** mediator whose routed `handleConnection` dispatches serverId `a` to worker A's ctrlSocket and `b` to worker B's, and applies each entry's `toolPolicy` independently. And teardown shuts down **all** workers.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Edit `geofront-runtime.ts`.**

`McpApparatus`:

```ts
interface McpApparatus {
  mediator: Mediator
  mcpSocketPath: string
  workers: LaunchedWorker[]
}
```

Replace `startMcpApparatus` (accept `mcp: LaunchMcpConfig[]`, loop; build the router; keep the single mediator socket):

```ts
async function startMcpApparatus(
  sessionId: string,
  bin: string,
  readyTimeoutMs: number,
  mcp: LaunchMcpConfig[],
): Promise<McpApparatus> {
  const mcpSocketPath = join(tmpdir(), 'magi-mcp', `mcp-${sessionId}.sock`)
  await mkdir(dirname(mcpSocketPath), { recursive: true })
  const workers: LaunchedWorker[] = []
  const routes = new Map<string, MediatorDeps['handleConnection']>()
  try {
    for (const entry of mcp) {
      const workerDir = defaultWorkerDir(sessionId, entry.id)
      const plan = buildWorkerPlan(entry, resolveWorkerBinary())
      await provisionWorkerDir(workerDir, plan, { MCP_UPSTREAM_TOKEN: entry.token })
      const worker = await launchWorker(workerDir, sessionId, entry.id, { bin, readyTimeoutMs })
      workers.push(worker)
      const inner = makeWorkerHandleConnection(worker.ctrlSocketPath)
      const handler =
        entry.toolPolicy === undefined ? inner : makeGatedHandleConnection(entry.toolPolicy, sessionId, inner)
      routes.set(entry.id, handler)
    }
    const mediator = await startMediator(mcpSocketPath, { handleConnection: makeServerRouter(routes) })
    return { mediator, mcpSocketPath, workers }
  } catch (error: unknown) {
    for (const w of workers) await w.shutdown()
    throw error
  }
}
```

Delete `selectMcpHandler` (its per-server logic now lives inline in the loop). Update `teardownMcpApparatus`:

```ts
async function teardownMcpApparatus(apparatus: McpApparatus | undefined): Promise<void> {
  if (apparatus === undefined) return
  await closeMediatorQuietly(apparatus.mediator, apparatus.mcpSocketPath)
  for (const w of apparatus.workers) await w.shutdown()
}
```

In `launch` (258-295), change the narrowing + call: `const mcp = spec.mcp` is now `LaunchMcpConfig[] | undefined`; guard on non-empty and pass the array:

```ts
const mcp = spec.mcp
const apparatus =
  mcp === undefined || mcp.length === 0
    ? undefined
    : await startMcpApparatus(spec.sessionId, this.bin, this.readyTimeoutMs, mcp)
```

The `--mcp-mount apparatus.mcpSocketPath` arg is **unchanged** (still one mount → the single mediator socket). `buildShutdown` is unchanged (it calls `teardownMcpApparatus`, now looping internally). Add imports: `makeServerRouter` from `../../mcp-broker/server-router.js`, and `type MediatorDeps` from `../../mcp-broker/mediator.js`, and ensure `makeGatedHandleConnection`/`makeWorkerHandleConnection` imports remain.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: `bun run check:full`** — full gate (lint + typecheck + format + knip + test). `grep -rn "mcpToken\b" src/ | grep -v worker/` should be empty; `selectMcpHandler` should be gone. Expect all green.
- [ ] **Step 6: Commit**

```bash
git add src/runtime/geofront/geofront-runtime.ts tests/runtime/geofront/geofront-runtime.test.ts
git commit -m "feat(mcp): launch one worker enclosure per upstream behind a single mediator router"
```

---

## Task 9: Two-upstream broker integration test

**Files:**

- Test: `tests/mcp-broker/multi-upstream-e2e.test.ts` (create; mirror `tests/mcp-broker/transport-e2e.test.ts` structure)

- [ ] **Step 1: Write the integration test.** Following the existing `transport-e2e.test.ts` pattern (real `node:net` sockets, in-test fake workers), stand up: a mediator wired with `makeServerRouter` over two fake worker control sockets `a` and `b`; drive two tunnel-style connections (handshake `{server:'a'}` and `{server:'b'}`); assert a request on connection `a` reaches fake worker A and its reply returns on `a`, and likewise for `b`, with no cross-talk. Add a per-server gate: give server `a` a `toolPolicy` denying `tools/call` for tool `x` and assert a `tools/call x` on `a` is denied while the same call on `b` (no policy) passes.

- [ ] **Step 2: Run — expect PASS** (the code from Tasks 7-8 already supports this).

Run: `bun test tests/mcp-broker/multi-upstream-e2e.test.ts`

- [ ] **Step 3: Full gate**

Run: `bun run check:full`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add tests/mcp-broker/multi-upstream-e2e.test.ts
git commit -m "test(mcp): two-upstream broker e2e (routing + per-server gate isolation)"
```

---

## Self-review notes (author)

- **Spec coverage:** contract array/map → Tasks 1,3,4; per-entry validation + id-uniqueness + hard ceiling + fail-closed → Task 2; N-worker launch + per-serverId dirs/sockets → Tasks 7,8; single mediator + serverId router (mediator/gate/worker-client unchanged) → Tasks 7,8; per-server toolPolicy → Task 8; token pairing fail-closed → Task 5; tunnel-per-server derivation → Task 6; two-upstream proof → Task 9. `--mcp-mount` stays singular (Task 8, noted). geofront: no change (out of this plan).
- **Type consistency:** `McpUpstream` (Task 1) flows into `resolveMcp` (2), `mcpLaunchConfigs` (5), `mcpServersFor` (6); `LaunchMcpConfig.id` (4) consumed by 5/8; `mcpTokens: Record<string,string>` consistent across 3/5/6; `makeServerRouter` signature (7) consumed by 8.
- **TDD-hook sequencing:** every task writes the test file before the `src` edit. Task 1's shared-type change makes cross-file typecheck red until Task 8 — flagged; combine Task 1+2 commits if the staged `check` hook blocks.
- **Cross-repo join:** this plan makes magi accept the new array/map contract. papai (Plan 2) sends it. Because there is no backward compatibility, deploy magi and papai together.
