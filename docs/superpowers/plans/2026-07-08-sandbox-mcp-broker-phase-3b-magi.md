<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Sandbox MCP Broker — Phase 3B-magi (Per-Tool Gating + Audit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce per-tool **allow/deny** on brokered MCP calls in the magi-main mediator, and audit every decision — without breaking the opaque-response relay.

**Architecture:** A `toolPolicy` rides the existing `spec.mcp` thread (`ProjectSpec.mcp` → `LaunchMcpConfig` → `startMcpApparatus`). A **gating decorator** wraps the worker-client `handleConnection`: it line-parses the **request** side (ndjson JSON-RPC), and for `tools/call` looks up `params.name` in the policy — **allow** forwards the raw line bytes to the worker; **deny** writes a synthesized JSON-RPC error back and never forwards. Responses continue to stream byte-for-byte opaque. Every decision is logged (pino) as an audit record (no payload).

**Tech Stack:** Bun + TypeScript (magi); `node:net`/`PassThrough` streams; ndjson JSON-RPC; pino.

**Spec:** `docs/superpowers/specs/2026-07-05-sandbox-mcp-broker-design.md` (§5.3/§5.5/§9 — per-tool gate in the magi-main mediator, NOT papai `tool_prefs`).

**Scope (3B-magi only):** magi enforcement + audit. The operator **catalog**, the **settings UI**, and papai **populating** `toolPolicy` are **Phase 3B-papai**. Here `toolPolicy` is threaded + enforced with a **default of allow-all when absent** (byte-compatible with 3A — no behavior change until 3B-papai populates it).

**Gating scope:** **allow/deny only.** `'ask'` (interactive per-call permission needing a mid-session round-trip to the chat user) is a documented follow-up — it requires an ACP-`request_permission`-style flow, out of scope here. The policy type includes `'ask'` in its shape for forward-compat but 3B-magi treats `'ask'` as `'allow'` with a `warn` log (so a future task can implement it without a schema change) — OR rejects `'ask'` at validation; the plan uses **treat-as-allow-with-warn** so a catalog can't hard-break a session before the interactive flow exists.

---

## File structure

**magi — new:**

- `src/mcp-broker/gate.ts` — `ToolPolicy` type, `decideToolCall(policy, method, line)`, `makeGatedHandleConnection(policy, sessionId, inner)`.

**magi — modified:**

- `src/project/config.ts` — `ProjectSpec.mcp.toolPolicy?`.
- `src/project/spec-validation.ts` — validate `toolPolicy` in `resolveMcp`.
- `src/launcher/launcher.ts` — `LaunchMcpConfig.toolPolicy?`.
- `src/session/helpers.ts` — `mcpLaunchConfig` threads `toolPolicy`.
- `src/runtime/geofront/geofront-runtime.ts` — `startMcpApparatus` wraps `makeWorkerHandleConnection` with `makeGatedHandleConnection` when a policy is present.

**Tests mirror source** under `tests/mcp-broker/`, `tests/project/`, `tests/runtime/geofront/`.

---

## Task 1: `ToolPolicy` type + validation (magi)

**Files:** Modify `src/project/config.ts`, `src/project/spec-validation.ts`; Test `tests/project/spec-validation.test.ts`.

- [ ] **Step 1: Branch note** — magi commits directly to `main` (per standing instruction; do NOT branch).

- [ ] **Step 2: Write the failing test** — `validateRepoSpec` accepts an optional `mcp.toolPolicy = { default: 'allow'|'deny'|'ask', tools?: Record<string,'allow'|'deny'|'ask'> }`; rejects (throws/400) an invalid permission value; a missing `toolPolicy` is fine (undefined). READ the 3A `resolveMcp` in `spec-validation.ts` to mirror.

```ts
// add to tests/project/spec-validation.test.ts (mirror the existing mcp tests)
it('accepts a valid mcp.toolPolicy', () => {
  const spec = validateRepoSpec(withMcp({ toolPolicy: { default: 'deny', tools: { echo: 'allow' } } }), policy)
  expect(spec.mcp?.toolPolicy).toEqual({ default: 'deny', tools: { echo: 'allow' } })
})
it('rejects an invalid permission in toolPolicy', () => {
  expect(() => validateRepoSpec(withMcp({ toolPolicy: { default: 'nope' } }), policy)).toThrow()
})
it('leaves toolPolicy undefined when absent', () => {
  expect(validateRepoSpec(withMcp({}), policy).mcp?.toolPolicy).toBeUndefined()
})
```

(Use the test file's existing `withMcp`/spec-builder helper; add one if needed.)

- [ ] **Step 3: Run to verify FAIL.**

- [ ] **Step 4: Implement** — add to `ProjectSpec.mcp` (config.ts):

```ts
toolPolicy?: { default: Permission; tools?: Record<string, Permission> }
// where: export type Permission = 'allow' | 'ask' | 'deny'
```

In `spec-validation.ts`'s `resolveMcp`, after the existing url/host/allowedHosts checks, validate `toolPolicy` when present: `default` must be one of `allow|ask|deny` (throw otherwise); `tools` (if present) an object whose every value is `allow|ask|deny` (throw otherwise). Fail-closed on a present-but-invalid `toolPolicy`. Absent → leave undefined.

- [ ] **Step 5: Run to verify PASS**; `bun run check:full` (5/5). **Step 6: Commit** — `git add -A && git commit -m "feat(coding-mcp): validate optional mcp.toolPolicy (allow/ask/deny)"`.

---

## Task 2: thread `toolPolicy` through the launch config (magi)

**Files:** Modify `src/launcher/launcher.ts` (`LaunchMcpConfig`), `src/session/helpers.ts` (`mcpLaunchConfig`); Test `tests/session/helpers.test.ts`.

- [ ] **Step 1: failing test** — `mcpLaunchConfig(mcp, token)` copies `mcp.toolPolicy` into the returned `LaunchMcpConfig.toolPolicy` (undefined when absent). READ the current `mcpLaunchConfig` + `LaunchMcpConfig`.
- [ ] **Step 2–4:** add `toolPolicy?: { default: Permission; tools?: Record<string, Permission> }` to `LaunchMcpConfig`; in `mcpLaunchConfig`, set `toolPolicy: mcp.toolPolicy` on the returned object. No other change (the credential path is unchanged).
- [ ] **Step 5–6:** `bun run check:full`; commit — `git commit -m "feat(coding-mcp): thread mcp.toolPolicy into LaunchMcpConfig"`.

---

## Task 3: the gating decorator (magi) — the core

**Files:** Create `src/mcp-broker/gate.ts`; Test `tests/mcp-broker/gate.test.ts`. READ `src/mcp-broker/stub-responder.ts` (ndjson line-parse + `reply` shape), `src/mcp-broker/worker-client.ts` (the `handleConnection` signature + pipe pattern), `src/mcp-broker/mediator.ts` (`MediatorDeps`).

`makeGatedHandleConnection(policy, sessionId, inner)` returns a `MediatorDeps['handleConnection']`. It interposes a filtered stream between the mediator's `inbound` and the `inner` handler (the worker client): line-parse each request; `tools/call` → check `params.name` against the policy; **allow/ask** → forward the ORIGINAL raw line to the inner's inbound; **deny** → write a JSON-RPC error to `outbound`, do NOT forward. Non-`tools/call` requests (initialize, tools/list, notifications) forward unconditionally.

- [ ] **Step 1: Write the failing test** (real streams; a fake `inner` that records what it receives + echoes)

```ts
// tests/mcp-broker/gate.test.ts
import { describe, expect, it } from 'bun:test'
import { PassThrough } from 'node:stream'
import { makeGatedHandleConnection, type ToolPolicy } from '../../src/mcp-broker/gate.js'

function drive(policy: ToolPolicy, lines: string[]): Promise<{ forwarded: string[]; out: string }> {
  return new Promise((resolve) => {
    const forwarded: string[] = []
    // fake inner: collect what it's given on its inbound, echo a result per line to outbound
    const inner = (_s: string, innerIn: NodeJS.ReadableStream, innerOut: NodeJS.WritableStream): void => {
      let buf = ''
      innerIn.on('data', (d: Buffer) => {
        buf += d.toString()
        let nl = buf.indexOf('\n')
        while (nl !== -1) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          if (line.length > 0) {
            forwarded.push(line)
            innerOut.write(`{"forwarded":${line}}\n`)
          }
          nl = buf.indexOf('\n')
        }
      })
    }
    const handle = makeGatedHandleConnection(policy, 'sess1', inner)
    const inbound = new PassThrough()
    const outbound = new PassThrough()
    let out = ''
    outbound.on('data', (d: Buffer) => {
      out += d.toString()
    })
    handle('jira', inbound, outbound)
    for (const l of lines) inbound.write(`${l}\n`)
    inbound.end()
    setTimeout(() => resolve({ forwarded, out }), 50)
  })
}

describe('makeGatedHandleConnection', () => {
  it('forwards an allowed tools/call and non-tool requests, denies a denied tool', async () => {
    const policy: ToolPolicy = { default: 'deny', tools: { echo: 'allow' } }
    const { forwarded, out } = await drive(policy, [
      '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{}}}',
      '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"secret","arguments":{}}}',
    ])
    // tools/list (non-tool) + the allowed echo call are forwarded; the denied 'secret' call is not
    expect(forwarded).toEqual([
      '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{}}}',
    ])
    // the denied call gets a JSON-RPC error for id 3 on outbound, not forwarded
    expect(out).toContain('"id":3')
    expect(out).toContain('"error"')
    expect(out).not.toContain('{"forwarded":{"jsonrpc":"2.0","id":3')
  })

  it('default allow forwards everything when no tool override denies', async () => {
    const { forwarded } = await drive({ default: 'allow' }, [
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"anything","arguments":{}}}',
    ])
    expect(forwarded.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement** (`src/mcp-broker/gate.ts`):

```ts
import { PassThrough } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { logger } from '../logger.js'
import type { MediatorDeps } from './mediator.js'

export type Permission = 'allow' | 'ask' | 'deny'
export interface ToolPolicy {
  default: Permission
  tools?: Record<string, Permission>
}

interface JsonRpc {
  id?: number | string
  method?: string
  params?: { name?: string }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

// Decide the effective permission for one request line. Only `tools/call` is gated
// (by params.name); every other method (initialize, tools/list, notifications) is
// allowed. `ask` is treated as `allow` with a warn until interactive permission
// lands (follow-up). Returns { permission, tool } — tool undefined for non-tool-calls.
export function decideToolCall(policy: ToolPolicy, msg: JsonRpc): { permission: Permission; tool?: string } {
  if (msg.method !== 'tools/call') return { permission: 'allow' }
  const tool = typeof msg.params?.name === 'string' ? msg.params.name : ''
  const raw = policy.tools?.[tool] ?? policy.default
  return { permission: raw, tool }
}

// Wrap a downstream handleConnection (the worker client) with per-tool gating on the
// REQUEST side. Allowed/ask requests forward as ORIGINAL bytes; denied tools/call get
// a synthesized JSON-RPC error on outbound and are never forwarded. Responses stay
// opaque (the inner handler pipes worker→outbound untouched).
export function makeGatedHandleConnection(
  policy: ToolPolicy,
  sessionId: string,
  inner: MediatorDeps['handleConnection'],
): MediatorDeps['handleConnection'] {
  return (serverId: string, inbound: NodeJS.ReadableStream, outbound: NodeJS.WritableStream): void => {
    const gated = new PassThrough()
    inner(serverId, gated, outbound)
    const decoder = new StringDecoder('utf8')
    let buf = ''
    inbound.on('data', (chunk: Buffer): void => {
      buf += decoder.write(chunk)
      let nl = buf.indexOf('\n')
      while (nl !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (line.trim().length > 0) gateLine(policy, sessionId, serverId, line, gated, outbound)
        nl = buf.indexOf('\n')
      }
    })
    inbound.on('end', (): void => {
      gated.end()
    })
    inbound.on('error', (): void => {
      gated.destroy()
    })
  }
}

function gateLine(
  policy: ToolPolicy,
  sessionId: string,
  serverId: string,
  line: string,
  gated: NodeJS.WritableStream,
  outbound: NodeJS.WritableStream,
): void {
  let msg: JsonRpc
  try {
    const parsed: unknown = JSON.parse(line)
    msg = isRecord(parsed) ? narrow(parsed) : {}
  } catch {
    // unparseable request line — forward verbatim (fail-open on non-JSON; the worker/upstream will reject)
    gated.write(`${line}\n`)
    return
  }
  const { permission, tool } = decideToolCall(policy, msg)
  if (permission === 'deny') {
    logger.info({ sessionId, serverId, tool, decision: 'deny' }, 'mcp-broker: tool call gated')
    outbound.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: `mcp tool '${tool ?? ''}' denied by policy` } })}\n`,
    )
    return
  }
  if (permission === 'ask') {
    logger.warn(
      { sessionId, serverId, tool },
      'mcp-broker: tool policy is "ask" — treated as allow (interactive permission not yet implemented)',
    )
  }
  if (msg.method === 'tools/call') {
    logger.info({ sessionId, serverId, tool, decision: 'allow' }, 'mcp-broker: tool call gated')
  }
  gated.write(`${line}\n`)
}

function narrow(o: Record<string, unknown>): JsonRpc {
  const params = isRecord(o['params']) ? o['params'] : undefined
  const name = params !== undefined && typeof params['name'] === 'string' ? params['name'] : undefined
  const id = typeof o['id'] === 'number' || typeof o['id'] === 'string' ? o['id'] : undefined
  const method = typeof o['method'] === 'string' ? o['method'] : undefined
  return { id, method, params: name === undefined ? undefined : { name } }
}
```

- [ ] **Step 4: Run to verify PASS**; `bun run check:full` (5/5). Fix lint minimally (the `narrow`/`isRecord` guards avoid `no-unsafe-*`; the plan already avoids `as`).

- [ ] **Step 5: Commit** — `git add src/mcp-broker/gate.ts tests/mcp-broker/gate.test.ts && git commit -m "feat(coding-mcp): per-tool allow/deny gating decorator (opaque-safe) + audit log"`.

---

## Task 4: wire the gate into `startMcpApparatus` (magi)

**Files:** Modify `src/runtime/geofront/geofront-runtime.ts`; Test `tests/runtime/geofront/geofront-runtime.test.ts`. READ how `startMcpApparatus` builds `mediator.handleConnection = makeWorkerHandleConnection(worker.ctrlSocketPath)`.

- [ ] **Step 1: failing test** — with `spec.mcp.toolPolicy = { default:'deny', tools:{echo:'allow'} }`, the mediator downstream is the GATED worker handler (a denied tool gets an error, not forwarded to the worker); with `toolPolicy` absent, the downstream is the plain worker handler (default allow — byte-identical to 3A). Use the existing DI/recording seam + a fake worker socket.
- [ ] **Step 2–4:** in `startMcpApparatus`, when `mcp.toolPolicy !== undefined`, wrap: `handleConnection: makeGatedHandleConnection(mcp.toolPolicy, sessionId, makeWorkerHandleConnection(worker.ctrlSocketPath))`; else `makeWorkerHandleConnection(worker.ctrlSocketPath)` directly. Thread `mcp.toolPolicy` (from `LaunchMcpConfig`) + `sessionId`.
- [ ] **Step 5–6:** `bun run check:full`; commit — `git commit -m "feat(coding-mcp): apply per-tool gating in the mediator when a policy is present"`.

---

## Task 5: docs + verification

**Files:** `docs/architecture/coding-sessions.md` (papai — update the MCP-broker section; commit ONLY that file — papai has concurrent WIP, never `git add -A`).

- [ ] Update the coding-sessions MCP-broker section: per-tool allow/deny gating is enforced in the **magi-main mediator** (a request-side `params.name` peek; responses stay opaque), configured via `spec.mcp.toolPolicy` (populated by the operator catalog in 3B-papai); every decision is audit-logged (pino, no payload); `'ask'` is a documented follow-up (treated as allow for now). Commit — `git commit -m "docs(coding-sessions): per-tool gating + audit in the mediator (Phase 3B-magi)"`.
- [ ] **Verification (runnable now):** the gate unit test (Task 3) proves allow-forwards / deny-synthesizes-error / non-tool-passes-through on real streams; the wiring test (Task 4) proves the mediator applies it. Note the full docker E2E (a denied tool actually blocked at the mediator in a real session) remains the **Linux handoff** (`docs/superpowers/plans/2026-07-07-phase-2-verification.md`), since it needs the same-kernel bind-mount path.

---

## Definition of done (3B-magi)

- [ ] `ProjectSpec.mcp.toolPolicy` is validated fail-closed and threaded to the mediator via the existing `spec.mcp` path.
- [ ] The mediator gates `tools/call` by `params.name`: allow forwards the ORIGINAL bytes; deny returns a JSON-RPC error and never reaches the worker; non-tool requests pass through. **Responses remain opaque** (only requests are parsed).
- [ ] Every decision is audit-logged (pino: sessionId, serverId, tool, decision) — no payload.
- [ ] `'ask'` is treated as allow-with-warn (interactive permission is a documented follow-up).
- [ ] Absent `toolPolicy` → default allow-all → byte-identical to 3A.
- [ ] `check:full` green.

## Handoff to Phase 3B-papai

- **Operator catalog:** `__admin_mcp_catalog__:<pi>` config (mirror `coding_guardrails`) of `{ name, upstream_url, host, header?, default_tool_policy?, tool_policy? }`; admin route `/settings/api/admin/mcp-catalog` + `AdminMcpCatalogSection.svelte`.
- **User section:** net-new "Coding MCP servers" section (mirror `CodingCredentialsSection`) — the `mcp` vault's `upstream_url` becomes a `<select>` bound to catalog entries (URL/host/header derived from the pick; user supplies only `upstream_token`), surfaced via the generic coding-credentials route (`if namespace === 'mcp'` returns the catalog like `agent-provider` returns `allowedAgents`).
- **Policy population:** `resolveMcp` (papai) returns `toolPolicy` from the selected catalog entry → `projectSpec.mcp.toolPolicy` → magi enforces it (this plan).
- **`'ask'` (interactive permission):** a mid-session round-trip to the chat user (ACP-`request_permission`-style) — a separate feature.
