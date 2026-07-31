<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Sandbox MCP Broker — Phase 1 (Transport Plumbing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the stdio transport of design D end-to-end — a coding agent spawns `mcp-tunnel`, which dials a bind-mounted host socket, and `magi-main` round-trips an MCP tool call through a stub responder — without the agent gaining any new network egress.

**Architecture:** The agent spawns `mcp-tunnel` (declared as an ACP `McpServerStdio`, or opencode `mcp.local`). The tunnel is a dumb pipe: it dials a **bind-mounted host unix socket** (Option X), sends a one-line handshake naming its server, then splices its stdio to the socket. `magi-main` listens on that socket, reads the handshake, and (Phase 1 only) hands the MCP stream to a **stub responder** instead of a real worker. geofront's sole change is bind-mounting magi's socket into the sandbox.

**Tech Stack:** Bun + TypeScript (magi, `~/Projects/yourpapai/magi`); Rust (geofront, `~/Projects/experiments/geofront`); `@agentclientprotocol/sdk@0.28.1`; `node:net` unix sockets; ndjson JSON-RPC framing.

**Spec:** `docs/superpowers/specs/2026-07-05-sandbox-mcp-broker-design.md` (design D; §5.1 tunnel, §5.2 Option X, §5.3 mediation).

**Scope note:** Phase 1 is transport only. The **real credential-holding worker enclosure** (Phase 2), **papai catalog/vault/settings/gating/audit** (Phase 3), and **`McpServerAcp`** (future) are out of scope. The Phase-1 downstream is a stub. The geofront non-agent-workload spike is already resolved (`AgentKind::Other` — see spec §12.3); the only geofront work here is the bind-mount.

**Repos & commands:** All magi work runs in `~/Projects/yourpapai/magi` with `bun test <path>` and `bun run check`. geofront work runs in `~/Projects/experiments/geofront` with `cargo test` / `./handoff.sh --quiet`. **Branch first** in each repo (do not commit to `main`/`master`). Use `.js` import extensions in magi TS. No semicolons, single quotes, explicit return types, no `any`, no optional chaining (magi oxlint rules).

---

## File structure

**magi — new module `src/mcp-broker/`:**

- `tunnel.ts` — pure tunnel logic (arg parse + dial + handshake + byte pump). Testable with in-memory streams.
- `tunnel-main.ts` — thin executable entry (`#!/usr/bin/env bun`) that wires `process.argv`/`process.stdin`/`process.stdout` into `tunnel.ts`. This is what gets compiled + staged.
- `handshake.ts` — read the one-line `{ server }` handshake off a socket, returning `{ serverId, rest }`.
- `mediator.ts` — listen on the host socket, parse each connection's handshake, delegate to an injected downstream.
- `stub-responder.ts` — Phase-1 downstream: a minimal MCP server (initialize / tools/list / tools/call-echo).
- `declare.ts` — build the `McpServerStdio[]` (and opencode `mcp.local`) declarations magi hands the agent.
- `index.ts` — barrel re-export.

**magi — modified:**

- `src/acp/types.ts` — add `mcpServers?` to `RunAcpSessionOptions`.
- `src/acp/client.ts` — thread `mcpServers` into `session/new` (`.withMcpServer`) and `session/load`.
- `src/session/helpers.ts`, `src/session/lifecycle.ts` — thread `mcpServers` from the turn down into `runAcpSession`.
- `src/runtime/geofront/provisioning/opencode-config.ts` — add an `mcp.local` entry.
- `src/runtime/geofront/provisioning/plan.ts` (+ a preset/config seam) — stage the `mcp-tunnel` binary via `copyFiles`.
- `src/runtime/geofront/geofront-runtime.ts` — create the host socket + pass a mount flag to geofront.

**geofront — modified (Rust):**

- `crates/cli/src/cli/root.rs` — add a `--mcp-mount <HOST_SOCK>` global flag.
- `crates/cli/src/app.rs`, `crates/cli/src/renderer/facade.rs` — thread it onto the renderer config.
- `crates/runtime-docker/src/agent.rs` (container create/run) — add the `-v <host_sock>:/run/magi/mcp.sock` bind mount.

**Tests mirror source** (`tests/mcp-broker/*.test.ts` in magi; `crates/**/tests/**` in geofront).

---

## Task 1: `mcp-tunnel` core (dumb dial + handshake + byte pump)

**Files:**

- Create: `~/Projects/yourpapai/magi/src/mcp-broker/tunnel.ts`
- Test: `~/Projects/yourpapai/magi/tests/mcp-broker/tunnel.test.ts`

- [ ] **Step 1: Branch**

```bash
cd ~/Projects/yourpapai/magi && git checkout -b feat/mcp-broker-phase1
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/mcp-broker/tunnel.test.ts
import { afterEach, describe, expect, it } from 'bun:test'
import { createServer, type Server, type Socket } from 'node:net'
import { PassThrough } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTunnelArgs, runTunnel } from '../../src/mcp-broker/tunnel.js'

let server: Server | undefined
let dir: string | undefined
afterEach(() => {
  server?.close()
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
})

describe('parseTunnelArgs', () => {
  it('parses --server and --socket', () => {
    expect(parseTunnelArgs(['--server', 'jira', '--socket', '/run/magi/mcp.sock'])).toEqual({
      server: 'jira',
      socket: '/run/magi/mcp.sock',
    })
  })
  it('throws when a flag is missing', () => {
    expect(() => parseTunnelArgs(['--server', 'jira'])).toThrow()
  })
})

describe('runTunnel', () => {
  it('sends a handshake then pumps bytes both ways', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tunnel-'))
    const socketPath = join(dir, 'mcp.sock')
    const received: Buffer[] = []
    const accepted = new Promise<Socket>((resolve) => {
      server = createServer((conn) => {
        conn.on('data', (d: Buffer) => received.push(d))
        resolve(conn)
      })
      server.listen(socketPath)
    })

    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const done = runTunnel({ server: 'jira', socket: socketPath }, stdin, stdout)

    const conn = await accepted
    stdin.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n')
    await Bun.sleep(20)
    // server saw handshake line first, then the agent frame
    expect(Buffer.concat(received).toString()).toBe('{"server":"jira"}\n{"jsonrpc":"2.0","id":1,"method":"ping"}\n')

    // reply from server flows back out of the tunnel's stdout
    const out = new Promise<string>((resolve) => stdout.once('data', (d: Buffer) => resolve(d.toString())))
    conn.write('{"jsonrpc":"2.0","id":1,"result":{}}\n')
    expect(await out).toBe('{"jsonrpc":"2.0","id":1,"result":{}}\n')

    stdin.end()
    await done
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ~/Projects/yourpapai/magi && bun test tests/mcp-broker/tunnel.test.ts`
Expected: FAIL — `Cannot find module '../../src/mcp-broker/tunnel.js'`.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/mcp-broker/tunnel.ts
import { connect } from 'node:net'

export interface TunnelArgs {
  server: string
  socket: string
}

export function parseTunnelArgs(argv: readonly string[]): TunnelArgs {
  let server: string | undefined
  let socket: string | undefined
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--server') {
      server = argv[i + 1]
      i += 1
    } else if (argv[i] === '--socket') {
      socket = argv[i + 1]
      i += 1
    }
  }
  if (server === undefined || socket === undefined) {
    throw new Error('mcp-tunnel: both --server and --socket are required')
  }
  return { server, socket }
}

// Dumb pipe: dial the host socket, announce which server this connection carries
// (one-line handshake), then splice stdin<->socket verbatim. No MCP parsing, no
// secrets, no policy — it is deliberately valueless (spec §5.1).
export function runTunnel(
  args: TunnelArgs,
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
): Promise<void> {
  return new Promise<void>((resolve, reject): void => {
    const sock = connect(args.socket)
    sock.on('error', reject)
    sock.on('connect', (): void => {
      sock.write(`${JSON.stringify({ server: args.server })}\n`)
      stdin.pipe(sock)
      sock.pipe(stdout)
    })
    stdin.on('end', (): void => {
      sock.end()
    })
    sock.on('close', (): void => {
      resolve()
    })
  })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/mcp-broker/tunnel.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 6: Commit**

```bash
git add src/mcp-broker/tunnel.ts tests/mcp-broker/tunnel.test.ts
git commit -m "feat(mcp-broker): dumb mcp-tunnel dial + handshake + byte pump"
```

---

## Task 2: tunnel executable entry

**Files:**

- Create: `~/Projects/yourpapai/magi/src/mcp-broker/tunnel-main.ts`
- Test: covered indirectly (thin wrapper); add a smoke assertion in `tests/mcp-broker/tunnel.test.ts`.

- [ ] **Step 1: Write the failing test** (append to `tunnel.test.ts`)

```ts
import { existsSync } from 'node:fs'
it('ships an executable entry with a shebang', () => {
  expect(existsSync('src/mcp-broker/tunnel-main.ts')).toBe(true)
  const src = require('node:fs').readFileSync('src/mcp-broker/tunnel-main.ts', 'utf8') as string
  expect(src.startsWith('#!/usr/bin/env bun')).toBe(true)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/mcp-broker/tunnel.test.ts`
Expected: FAIL — file missing.

- [ ] **Step 3: Write the entry**

```ts
#!/usr/bin/env bun
// src/mcp-broker/tunnel-main.ts
// Executable wrapper: parse argv, splice process stdio. Compiled + staged into the
// sandbox at /usr/local/bin/mcp-tunnel (Task 8). Kept trivial on purpose.
import { parseTunnelArgs, runTunnel } from './tunnel.js'

const args = parseTunnelArgs(process.argv.slice(2))
runTunnel(args, process.stdin, process.stdout)
  .then((): void => process.exit(0))
  .catch((error: unknown): void => {
    process.stderr.write(`mcp-tunnel: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/mcp-broker/tunnel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-broker/tunnel-main.ts tests/mcp-broker/tunnel.test.ts
git commit -m "feat(mcp-broker): add mcp-tunnel executable entry"
```

---

## Task 3: handshake reader (mediator side)

**Files:**

- Create: `~/Projects/yourpapai/magi/src/mcp-broker/handshake.ts`
- Test: `~/Projects/yourpapai/magi/tests/mcp-broker/handshake.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp-broker/handshake.test.ts
import { describe, expect, it } from 'bun:test'
import { PassThrough } from 'node:stream'
import { readHandshake } from '../../src/mcp-broker/handshake.js'

describe('readHandshake', () => {
  it('parses the server id and returns bytes buffered after the newline', async () => {
    const stream = new PassThrough()
    const p = readHandshake(stream)
    stream.write('{"server":"jira"}\n{"jsonrpc":"2.0"')
    const { serverId, rest } = await p
    expect(serverId).toBe('jira')
    expect(rest.toString()).toBe('{"jsonrpc":"2.0"')
  })

  it('rejects a malformed handshake line', async () => {
    const stream = new PassThrough()
    const p = readHandshake(stream)
    stream.write('not json\n')
    await expect(p).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/mcp-broker/handshake.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
// src/mcp-broker/handshake.ts
import { z } from 'zod'

const handshakeSchema = z.object({ server: z.string().min(1) })

export interface Handshake {
  serverId: string
  rest: Buffer
}

// Read exactly one newline-terminated JSON handshake line off the socket, then
// hand back the server id and any bytes that arrived after the newline (which
// belong to the MCP stream and must be forwarded downstream).
export function readHandshake(stream: NodeJS.ReadableStream): Promise<Handshake> {
  return new Promise<Handshake>((resolve, reject): void => {
    const chunks: Buffer[] = []
    const onData = (chunk: Buffer): void => {
      chunks.push(chunk)
      const buffered = Buffer.concat(chunks)
      const nl = buffered.indexOf(0x0a)
      if (nl === -1) return
      stream.removeListener('data', onData)
      stream.removeListener('error', reject)
      const line = buffered.subarray(0, nl).toString('utf8')
      const rest = buffered.subarray(nl + 1)
      try {
        const parsed = handshakeSchema.parse(JSON.parse(line))
        resolve({ serverId: parsed.server, rest })
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    stream.on('data', onData)
    stream.on('error', reject)
  })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/mcp-broker/handshake.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-broker/handshake.ts tests/mcp-broker/handshake.test.ts
git commit -m "feat(mcp-broker): read connection handshake (server id + rest)"
```

---

## Task 4: Phase-1 stub MCP responder

**Files:**

- Create: `~/Projects/yourpapai/magi/src/mcp-broker/stub-responder.ts`
- Test: `~/Projects/yourpapai/magi/tests/mcp-broker/stub-responder.test.ts`

The stub is the Phase-1 stand-in for the real worker (Phase 2 replaces it). It speaks minimal MCP over an ndjson stream: answers `initialize`, `tools/list` (one canned tool `echo`), and `tools/call` (echoes the arguments back). It proves the round-trip without any network/credential.

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp-broker/stub-responder.test.ts
import { describe, expect, it } from 'bun:test'
import { PassThrough } from 'node:stream'
import { serveStub } from '../../src/mcp-broker/stub-responder.js'

function rpc(stream: PassThrough, msg: unknown): void {
  stream.write(`${JSON.stringify(msg)}\n`)
}
function nextJson(stream: PassThrough): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let buf = ''
    const on = (d: Buffer): void => {
      buf += d.toString()
      const nl = buf.indexOf('\n')
      if (nl === -1) return
      stream.removeListener('data', on)
      resolve(JSON.parse(buf.slice(0, nl)) as Record<string, unknown>)
    }
    stream.on('data', on)
  })
}

describe('serveStub', () => {
  it('answers tools/call by echoing arguments', async () => {
    const inbound = new PassThrough()
    const outbound = new PassThrough()
    serveStub('jira', inbound, outbound)

    rpc(inbound, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: { a: 1 } } })
    const res = await nextJson(outbound)
    expect(res['id']).toBe(1)
    expect(res['result']).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ server: 'jira', echo: { a: 1 } }) }],
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/mcp-broker/stub-responder.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
// src/mcp-broker/stub-responder.ts
import { logger } from '../logger.js'

interface JsonRpc {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: Record<string, unknown>
}

function reply(out: NodeJS.WritableStream, id: number | string | undefined, result: unknown): void {
  out.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

// Phase-1 downstream stand-in for the real worker (spec §5.3/§5.4, Phase 2).
// Speaks minimal MCP over ndjson; never touches network or credentials.
export function serveStub(serverId: string, inbound: NodeJS.ReadableStream, outbound: NodeJS.WritableStream): void {
  let buf = ''
  inbound.on('data', (chunk: Buffer): void => {
    buf += chunk.toString('utf8')
    let nl = buf.indexOf('\n')
    while (nl !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (line.trim().length > 0) handleLine(serverId, line, outbound)
      nl = buf.indexOf('\n')
    }
  })
}

function handleLine(serverId: string, line: string, out: NodeJS.WritableStream): void {
  let msg: JsonRpc
  try {
    msg = JSON.parse(line) as JsonRpc
  } catch {
    logger.warn({ serverId }, 'mcp-broker stub: dropping non-JSON line')
    return
  }
  if (msg.method === 'initialize') {
    reply(out, msg.id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'stub', version: '0' },
    })
  } else if (msg.method === 'tools/list') {
    reply(out, msg.id, {
      tools: [{ name: 'echo', description: 'Echo arguments back', inputSchema: { type: 'object' } }],
    })
  } else if (msg.method === 'tools/call') {
    const echo = msg.params?.['arguments'] ?? {}
    reply(out, msg.id, { content: [{ type: 'text', text: JSON.stringify({ server: serverId, echo }) }] })
  } else if (msg.id !== undefined) {
    reply(out, msg.id, {})
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/mcp-broker/stub-responder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-broker/stub-responder.ts tests/mcp-broker/stub-responder.test.ts
git commit -m "feat(mcp-broker): phase-1 stub MCP responder (echo)"
```

---

## Task 5: mediator (listen, handshake, delegate downstream)

**Files:**

- Create: `~/Projects/yourpapai/magi/src/mcp-broker/mediator.ts`
- Test: `~/Projects/yourpapai/magi/tests/mcp-broker/mediator.test.ts`

The mediator listens on the host socket, reads each connection's handshake, forwards the post-handshake bytes, and delegates the connection's MCP stream to an injected `handleConnection(serverId, inbound, outbound)`. Downstream is injected (DI) so Phase 2 can swap the stub for the worker without touching the mediator.

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp-broker/mediator.test.ts
import { afterEach, describe, expect, it } from 'bun:test'
import { connect } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMediator } from '../../src/mcp-broker/mediator.js'
import { serveStub } from '../../src/mcp-broker/stub-responder.js'

let cleanup: (() => Promise<void>) | undefined
let dir: string | undefined
afterEach(async () => {
  if (cleanup !== undefined) await cleanup()
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
})

describe('startMediator', () => {
  it('routes a handshaked connection to the downstream by server id', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mediator-'))
    const socketPath = join(dir, 'mcp.sock')
    const seen: string[] = []
    const mediator = await startMediator(socketPath, {
      handleConnection: (serverId, inbound, outbound): void => {
        seen.push(serverId)
        serveStub(serverId, inbound, outbound)
      },
    })
    cleanup = mediator.close

    const client = connect(socketPath)
    await new Promise<void>((r) => client.once('connect', () => r()))
    client.write('{"server":"jira"}\n')
    client.write('{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"echo","arguments":{"x":9}}}\n')

    const out = await new Promise<string>((r) => client.once('data', (d: Buffer) => r(d.toString())))
    expect(seen).toEqual(['jira'])
    const parsed = JSON.parse(out.trim()) as Record<string, unknown>
    expect(parsed['id']).toBe(7)
    expect(parsed['result']).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ server: 'jira', echo: { x: 9 } }) }],
    })
    client.end()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/mcp-broker/mediator.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
// src/mcp-broker/mediator.ts
import { createServer, type Socket } from 'node:net'
import { unlink } from 'node:fs/promises'
import { PassThrough } from 'node:stream'
import { logger } from '../logger.js'
import { readHandshake } from './handshake.js'

export interface MediatorDeps {
  // Handle one tunnel connection's MCP stream. `inbound` carries the agent's MCP
  // requests; write MCP responses to `outbound`. Injected so Phase 2 can swap the
  // stub for the credential-holding worker without touching the mediator.
  handleConnection: (serverId: string, inbound: NodeJS.ReadableStream, outbound: NodeJS.WritableStream) => void
}

export interface Mediator {
  close: () => Promise<void>
}

export async function startMediator(socketPath: string, deps: MediatorDeps): Promise<Mediator> {
  await unlink(socketPath).catch((): void => {
    // fresh path or nothing to remove — ignore
  })
  const server = createServer((conn: Socket): void => {
    handleSocket(conn, deps).catch((error: unknown): void => {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'mcp-broker: connection setup failed',
      )
      conn.destroy()
    })
  })
  await new Promise<void>((resolve): void => {
    server.listen(socketPath, resolve)
  })
  logger.debug({ socketPath }, 'mcp-broker mediator listening')
  return {
    close: (): Promise<void> =>
      new Promise<void>((resolve): void => {
        server.close((): void => resolve())
      }),
  }
}

async function handleSocket(conn: Socket, deps: MediatorDeps): Promise<void> {
  const { serverId, rest } = await readHandshake(conn)
  // `inbound` = post-handshake bytes already buffered, then the rest of the socket.
  const inbound = new PassThrough()
  if (rest.length > 0) inbound.write(rest)
  conn.pipe(inbound)
  // downstream writes MCP responses straight back onto the socket.
  deps.handleConnection(serverId, inbound, conn)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/mcp-broker/mediator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-broker/mediator.ts tests/mcp-broker/mediator.test.ts
git commit -m "feat(mcp-broker): mediator listens, reads handshake, delegates downstream"
```

---

## Task 6: end-to-end transport integration test (tunnel → mediator → stub)

**Files:**

- Test: `~/Projects/yourpapai/magi/tests/mcp-broker/transport-e2e.test.ts`
- Create: `~/Projects/yourpapai/magi/src/mcp-broker/index.ts` (barrel)

This is the **Phase-1 verification target**: a simulated agent (in-memory stdio) drives a tool call through the real `runTunnel` → real `startMediator` → real `serveStub` and gets the echo back. No agent binary, no container.

- [ ] **Step 1: Write the barrel**

```ts
// src/mcp-broker/index.ts
export { parseTunnelArgs, runTunnel } from './tunnel.js'
export { readHandshake } from './handshake.js'
export { startMediator } from './mediator.js'
export { serveStub } from './stub-responder.js'
export type { MediatorDeps, Mediator } from './mediator.js'
export type { TunnelArgs } from './tunnel.js'
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/mcp-broker/transport-e2e.test.ts
import { afterEach, describe, expect, it } from 'bun:test'
import { PassThrough } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTunnel, startMediator, serveStub, type Mediator } from '../../src/mcp-broker/index.js'

let mediator: Mediator | undefined
let dir: string | undefined
afterEach(async () => {
  if (mediator !== undefined) await mediator.close()
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
})

describe('mcp-broker transport (tunnel -> mediator -> stub)', () => {
  it('round-trips a tools/call from a simulated agent', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-e2e-'))
    const socketPath = join(dir, 'mcp.sock')
    mediator = await startMediator(socketPath, {
      handleConnection: (id, inbound, outbound): void => serveStub(id, inbound, outbound),
    })

    // simulated agent stdio <-> tunnel
    const agentToTunnel = new PassThrough()
    const tunnelToAgent = new PassThrough()
    const tunnelDone = runTunnel({ server: 'jira', socket: socketPath }, agentToTunnel, tunnelToAgent)

    agentToTunnel.write(
      '{"jsonrpc":"2.0","id":42,"method":"tools/call","params":{"name":"echo","arguments":{"ok":true}}}\n',
    )

    const out = await new Promise<string>((r) => tunnelToAgent.once('data', (d: Buffer) => r(d.toString())))
    const parsed = JSON.parse(out.trim()) as Record<string, unknown>
    expect(parsed['id']).toBe(42)
    expect(parsed['result']).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ server: 'jira', echo: { ok: true } }) }],
    })

    agentToTunnel.end()
    await tunnelDone
  })
})
```

- [ ] **Step 3: Run to verify it fails, then passes**

Run: `bun test tests/mcp-broker/transport-e2e.test.ts`
Expected: FAIL first (barrel missing) → after Step 1 present, PASS.

- [ ] **Step 4: Full check**

Run: `bun run check`
Expected: lint + typecheck + format pass for the new files.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-broker/index.ts tests/mcp-broker/transport-e2e.test.ts
git commit -m "test(mcp-broker): end-to-end transport round-trip (tunnel->mediator->stub)"
```

---

## Task 7: build the `McpServerStdio` declaration + thread `mcpServers` into the ACP client

**Files:**

- Create: `~/Projects/yourpapai/magi/src/mcp-broker/declare.ts`
- Modify: `~/Projects/yourpapai/magi/src/acp/types.ts` (add `mcpServers?`)
- Modify: `~/Projects/yourpapai/magi/src/acp/client.ts` (`runSession` ~line 109; `runLoadedSession` line 163)
- Test: `~/Projects/yourpapai/magi/tests/mcp-broker/declare.test.ts`

`McpServerStdio = { name, command, args: string[], env: EnvVariable[] }`, `EnvVariable = { name, value }`, no `type` discriminant (verified: `@agentclientprotocol/sdk/dist/schema/types.gen.d.ts:4636`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp-broker/declare.test.ts
import { describe, expect, it } from 'bun:test'
import { buildTunnelMcpServer } from '../../src/mcp-broker/declare.js'

describe('buildTunnelMcpServer', () => {
  it('produces an McpServerStdio pointing at the staged tunnel', () => {
    expect(buildTunnelMcpServer('jira', '/usr/local/bin/mcp-tunnel', '/run/magi/mcp.sock')).toEqual({
      name: 'jira',
      command: '/usr/local/bin/mcp-tunnel',
      args: ['--server', 'jira', '--socket', '/run/magi/mcp.sock'],
      env: [],
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/mcp-broker/declare.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the declaration builder**

```ts
// src/mcp-broker/declare.ts
import type * as acp from '@agentclientprotocol/sdk'

// The container-side path where the tunnel binary is staged (Task 8) and the
// bind-mounted host socket (Task 9 / geofront). Fixed constants for Phase 1.
export const TUNNEL_BIN = '/usr/local/bin/mcp-tunnel'
export const MOUNTED_SOCKET = '/run/magi/mcp.sock'

export function buildTunnelMcpServer(serverId: string, bin: string, socket: string): acp.McpServerStdio {
  return {
    name: serverId,
    command: bin,
    args: ['--server', serverId, '--socket', socket],
    env: [],
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/mcp-broker/declare.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `mcpServers` to `RunAcpSessionOptions`**

In `src/acp/types.ts`, add to the `RunAcpSessionOptions` interface (after `resumeSessionId?`):

```ts
  // MCP servers to declare to the agent for this turn (Phase 1: tunnel entries).
  mcpServers?: acp.McpServer[]
```

Ensure the file imports the SDK type: `import type * as acp from '@agentclientprotocol/sdk'` (add if missing).

- [ ] **Step 6: Thread into `session/new` and `session/load` in `src/acp/client.ts`**

Replace the `runSession` builder line (currently `return cx.buildSession(opts.cwd).withSession(...)` at ~line 109) with:

```ts
let builder = cx.buildSession(opts.cwd)
for (const s of opts.mcpServers ?? []) {
  builder = builder.withMcpServer(s)
}
return builder.withSession(async (session: acp.ActiveSession): Promise<acp.PromptResponse> => {
  opts.handlers.onSessionCreated(session.sessionId)
  logger.debug(
    { sessionId: session.sessionId, configOptions: session.newSessionResponse.configOptions },
    'acp session config options offered by agent',
  )
  await applySelectedModel(cx, session, opts)
  return runPromptTurn(session, opts)
})
```

Replace the `runLoadedSession` request (client.ts:163) `mcpServers: []` with `mcpServers: opts.mcpServers ?? []`:

```ts
await cx.request(acp.methods.agent.session.load, { sessionId, cwd: opts.cwd, mcpServers: opts.mcpServers ?? [] })
```

- [ ] **Step 7: Add a client test that the servers are declared** (`tests/acp/client.test.ts`)

Follow the existing `startStubAgent` harness. Add a test that passes `mcpServers: [buildTunnelMcpServer('jira', '/usr/local/bin/mcp-tunnel', '/run/magi/mcp.sock')]` in the options and asserts the run still completes (`result.stopReason` present) — proving the option is accepted and threaded without breaking the turn. (The stub agent ignores MCP; real declaration is exercised by the E2E in Task 11.)

- [ ] **Step 8: Run tests + check**

Run: `bun test tests/mcp-broker/declare.test.ts tests/acp/client.test.ts && bun run check`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/mcp-broker/declare.ts src/acp/types.ts src/acp/client.ts tests/mcp-broker/declare.test.ts tests/acp/client.test.ts
git commit -m "feat(mcp-broker): declare tunnel McpServerStdio and thread mcpServers through ACP client"
```

---

## Task 8: thread `mcpServers` from the session turn down into the ACP client

**Files:**

- Modify: `~/Projects/yourpapai/magi/src/session/helpers.ts` (`RunRecordedTurnInput` ~177-189; `runRecordedTurn` ~203)
- Modify: `~/Projects/yourpapai/magi/src/session/lifecycle.ts` (`runSessionTurn` ~133-170 → builds the turn input)
- Test: extend an existing lifecycle/helpers test (mirror the file that already covers `runRecordedTurn`).

For Phase 1, the set of MCP servers is a **single tunnel entry per configured server**; wire a `mcpServers: acp.McpServer[]` param through so a later phase can source it from project/catalog config. In Phase 1, source it from a constant list (empty by default; the E2E test in Task 11 sets one).

- [ ] **Step 1: Add `mcpServers` to `RunRecordedTurnInput`** in `helpers.ts` (mirror the field), and pass it into the `runAcpSession({... mcpServers: input.mcpServers ...})` call inside `runRecordedTurn`.

- [ ] **Step 2: Add a `mcpServers` parameter to `runSessionTurn`** in `lifecycle.ts` and include it when constructing the `RunRecordedTurnInput`. Default to `[]` at the outermost caller for now.

- [ ] **Step 3: Write/extend a test** asserting the value flows through (a DI/spy on `runAcpSession` or the existing recorded-turn test): given `mcpServers: [entry]`, `runAcpSession` receives it.

- [ ] **Step 4: Run + check**

Run: `bun test tests/session && bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session/helpers.ts src/session/lifecycle.ts tests/session
git commit -m "feat(mcp-broker): thread mcpServers from session turn into ACP client"
```

---

## Task 9: opencode native `mcp.local` config (the opencode declaration path)

**Files:**

- Modify: `~/Projects/yourpapai/magi/src/runtime/geofront/provisioning/opencode-config.ts` (`generateOpencodeConfig`, lines 22-37)
- Modify: caller `~/Projects/yourpapai/magi/src/runtime/geofront/provisioning/secret-stager.ts:43`
- Test: `~/Projects/yourpapai/magi/tests/runtime/geofront/provisioning/opencode-config.test.ts` (mirror existing style)

opencode ignores ACP `mcpServers` for stdio in a way we prefer to bypass; declare the tunnel via its native `mcp.local` config which magi already emits (`OPENCODE_CONFIG_CONTENT`).

- [ ] **Step 1: Write the failing test** (append to the existing opencode-config test)

```ts
it('adds an mcp local server entry when tunnels are provided', () => {
  const parsed: unknown = JSON.parse(
    generateOpencodeConfig('https://api.example/v1', undefined, [
      {
        name: 'jira',
        command: '/usr/local/bin/mcp-tunnel',
        args: ['--server', 'jira', '--socket', '/run/magi/mcp.sock'],
      },
    ]),
  )
  expect((parsed as { mcp: unknown }).mcp).toEqual({
    jira: {
      type: 'local',
      command: ['/usr/local/bin/mcp-tunnel', '--server', 'jira', '--socket', '/run/magi/mcp.sock'],
    },
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/runtime/geofront/provisioning/opencode-config.test.ts`
Expected: FAIL — `generateOpencodeConfig` takes 2 args / no `mcp` key.

- [ ] **Step 3: Extend `generateOpencodeConfig`**

Add a third parameter and an `mcp` block before `JSON.stringify` (mirroring the existing conditional `model` field):

```ts
export interface OpencodeMcpLocal {
  name: string
  command: string
  args: string[]
}

export function generateOpencodeConfig(
  baseUrl: string,
  model: string | undefined,
  mcpServers: OpencodeMcpLocal[] = [],
): string {
  // ... existing provider/config construction ...
  if (mcpServers.length > 0) {
    const mcp: Record<string, unknown> = {}
    for (const s of mcpServers) {
      mcp[s.name] = { type: 'local', command: [s.command, ...s.args] }
    }
    config['mcp'] = mcp
  }
  return JSON.stringify(config)
}
```

Update the `secret-stager.ts:43` call to pass the tunnel list through (thread it from the provisioning plan; default `[]`).

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/runtime/geofront/provisioning/opencode-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/geofront/provisioning/opencode-config.ts src/runtime/geofront/provisioning/secret-stager.ts tests/runtime/geofront/provisioning/opencode-config.test.ts
git commit -m "feat(mcp-broker): declare tunnel via opencode native mcp.local config"
```

---

## Task 10: stage the `mcp-tunnel` binary into the sandbox

**Files:**

- Modify: `~/Projects/yourpapai/magi/package.json` (add a `build:mcp-tunnel` script)
- Modify: `~/Projects/yourpapai/magi/src/runtime/geofront/provisioning/plan.ts` (append a `ProvisioningFile` to `copyFiles`)
- Test: `~/Projects/yourpapai/magi/tests/runtime/geofront/provisioning/plan.test.ts`

`ProvisioningFile = { source, target, mode? }` (`src/project/config.ts:31`). `dockerfile.ts` already `COPY`s each `copyFiles` entry and chmods it. `/usr/local/bin` is on PATH.

- [ ] **Step 1: Add the compile script** to `package.json` scripts:

```json
"build:mcp-tunnel": "bun build ./src/mcp-broker/tunnel-main.ts --compile --target=bun-linux-x64 --outfile ./dist/mcp-tunnel"
```

(Cross-arch note: also produce `bun-linux-arm64` for arm sandboxes; pick by target platform. Phase 1 targets x64; arm64 is a follow-up.)

- [ ] **Step 2: Write the failing test**

```ts
// tests/runtime/geofront/provisioning/plan.test.ts (add a case)
import { resolvePlan } from '../../../../src/runtime/geofront/provisioning/plan.js'
it('stages the mcp-tunnel binary onto PATH', () => {
  const plan = resolvePlan(/* provisioning */ {}, /* project */ {} as never, 'linux')
  expect(plan.copyFiles).toContainEqual(expect.objectContaining({ target: '/usr/local/bin/mcp-tunnel', mode: '755' }))
})
```

(Adjust the `resolvePlan` args to match its real signature — see `plan.ts:31`.)

- [ ] **Step 3: Run to verify it fails**

Run: `bun test tests/runtime/geofront/provisioning/plan.test.ts`
Expected: FAIL — tunnel not staged.

- [ ] **Step 4: Append the staged file in `resolvePlan`**

In `plan.ts`, where `copyFiles` is assembled, append:

```ts
    copyFiles: [
      ...(config.files ?? []),
      { source: resolveMcpTunnelBinary(), target: '/usr/local/bin/mcp-tunnel', mode: '755' },
    ],
```

Add a helper that resolves the compiled binary path (e.g. relative to magi's dist dir), and document that `bun run build:mcp-tunnel` must run before provisioning.

- [ ] **Step 5: Run to verify it passes + check**

Run: `bun test tests/runtime/geofront/provisioning/plan.test.ts && bun run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json src/runtime/geofront/provisioning/plan.ts tests/runtime/geofront/provisioning/plan.test.ts
git commit -m "feat(mcp-broker): stage compiled mcp-tunnel binary into the sandbox"
```

---

## Task 11: magi creates the host socket + passes the mount to geofront

**Files:**

- Modify: `~/Projects/yourpapai/magi/src/runtime/geofront/geofront-runtime.ts` (`launch`, lines 216-240)
- Test: `~/Projects/yourpapai/magi/tests/runtime/geofront/geofront-runtime.test.ts`

magi must: (a) start the mediator listening on a per-session host socket **before** `workspace up`, (b) pass that socket path to geofront via the new `--mcp-mount` flag so geofront bind-mounts it.

- [ ] **Step 1: Write the failing test** — assert `launch` invokes geofront with `--mcp-mount <mcpSocketPath>` alongside `--acp` and that a mediator was started. Use the existing DI/spawn seam in the runtime test (mirror how `--acp` is asserted; if `spawnGeofront` isn't injectable, add a minimal injection point).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement in `launch`:**

```ts
const mcpSocketPath = join(socketDir, `mcp-${spec.sessionId}.sock`)
const mediator = await startMediator(mcpSocketPath, {
  handleConnection: (id, inbound, outbound): void => serveStub(id, inbound, outbound), // Phase 1 stub; Phase 2 swaps for the worker
})
const child = spawnGeofront(this.bin, ['workspace', 'up', '--acp', socketPath, '--mcp-mount', mcpSocketPath], spec.cwd)
```

Extend the returned `shutdown` to also `await mediator.close()` and `unlink(mcpSocketPath)`.

- [ ] **Step 4: Run to verify it passes + check.**

- [ ] **Step 5: Commit**

```bash
git add src/runtime/geofront/geofront-runtime.ts tests/runtime/geofront/geofront-runtime.test.ts
git commit -m "feat(mcp-broker): start mediator + pass --mcp-mount to geofront workspace up"
```

---

## Task 12: geofront `--mcp-mount` bind-mount flag (Rust)

**Files (geofront, `~/Projects/experiments/geofront`):**

- Modify: `crates/cli/src/cli/root.rs` (global flag, next to `acp`)
- Modify: `crates/cli/src/app.rs` (~line 23, next to `acp_socket`)
- Modify: `crates/cli/src/renderer/facade.rs` (expose it)
- Modify: `crates/runtime-docker/src/agent.rs` (container create — add the `-v` mount)
- Tests: `crates/**/tests/**` (mirror existing container-args tests)

**Follow the exact pattern of the existing `--acp` flag** (traced by exploration). This flag does **not** create a relay — it only adds a bind mount.

- [ ] **Step 1: Branch geofront**

```bash
cd ~/Projects/experiments/geofront && git checkout -b feat/mcp-mount
```

- [ ] **Step 2: Add the global flag** in `crates/cli/src/cli/root.rs`, mirroring `acp`:

```rust
/// Host unix socket to bind-mount into the sandbox at /run/magi/mcp.sock (MCP broker).
#[arg(long, value_name = "SOCKET", global = true)]
pub mcp_mount: Option<PathBuf>,
```

- [ ] **Step 3: Thread it** through `app.rs` (`mcp_mount: cli.mcp_mount.clone()`) and `renderer/facade.rs` (add an accessor, mirroring `acp_socket()`), down to the docker runtime config that `crates/runtime-docker` consumes when creating the container.

- [ ] **Step 4: Write the failing test** — a container-args test asserting that when `mcp_mount = Some(/host/mcp.sock)`, the docker create/run arguments include `-v /host/mcp.sock:/run/magi/mcp.sock`. Mirror the existing test that asserts the workspace bind-mount is present (search `crates/runtime-docker/tests` for the workspace `-v` assertion and copy its structure).

- [ ] **Step 5: Implement the mount** in `crates/runtime-docker/src/agent.rs` where volumes are assembled for container creation: when a `mcp_mount` host path is present, push `format!("{}:/run/magi/mcp.sock", host_path)` into the `-v` volume args (same list the workspace mount uses). Ensure permissions allow the non-root runtime uid to connect (the socket is created 0600 by magi; if the container uid differs, relax to 0660 + a shared group, or `0666` for Phase 1 with a TODO to tighten — document the choice).

- [ ] **Step 6: Run tests + handoff**

```bash
cargo test -p geofront-runtime-docker
./handoff.sh --quiet
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/cli/src/cli/root.rs crates/cli/src/app.rs crates/cli/src/renderer/facade.rs crates/runtime-docker/src/agent.rs crates/runtime-docker/tests
git commit -m "feat(runtime): --mcp-mount bind-mounts a host socket into the sandbox"
```

---

## Task 13: end-to-end verification with a real agent (manual)

**Goal:** prove the whole chain with a real coding agent in a real sandbox, and confirm **no new agent egress**.

- [ ] **Step 1:** Build the tunnel binary: `cd ~/Projects/yourpapai/magi && bun run build:mcp-tunnel`.
- [ ] **Step 2:** Build/point magi at the geofront branch (`geofront` binary with `--mcp-mount`).
- [ ] **Step 3:** Start a coding session (via the normal magi `/sessions` path) configured to declare one tunnel MCP server `echo` (set the Phase-1 constant list so `mcpServers` contains one `buildTunnelMcpServer('echo', ...)`; for opencode, confirm the `mcp.local` entry is emitted). Use a prompt that asks the agent to call the `echo` tool with `{ "hello": "world" }`.
- [ ] **Step 4:** Confirm the agent's transcript shows the tool call returning `{"server":"echo","echo":{"hello":"world"}}` (the stub's echo). This proves agent → tunnel → mounted socket → mediator → stub → back.
- [ ] **Step 5: Verify INV-2 (no new egress).** Inspect the session's `geofront.toml` egress allowlist — it must be **unchanged** from a no-MCP session (no MCP host added). From inside the sandbox (or via magi logs), confirm the agent made **no** network connection for the tool call — only the unix socket. Record the check in the verification notes.
- [ ] **Step 6:** Tear down; confirm the mediator closed and `mcp-<sessionId>.sock` was unlinked (Task 11 shutdown).
- [ ] **Step 7: Commit verification notes**

```bash
cd ~/Projects/yourpapai/papai
# add a short docs/superpowers/plans/2026-07-06-phase-1-verification.md with the observed outputs
git add docs/superpowers/plans/2026-07-06-phase-1-verification.md
git commit -m "docs(mcp-broker): phase 1 end-to-end verification notes"
```

---

## Definition of done (Phase 1)

- [ ] `agent → mcp-tunnel → bind-mounted socket → magi-main mediator → stub responder → back` round-trips a `tools/call` (Task 6 automated; Task 13 with a real agent).
- [ ] The agent's egress allowlist is **byte-identical** to a no-MCP session (INV-2 verified, Task 13 Step 5).
- [ ] `mcp-tunnel` holds no secret, makes no policy decision, does no MCP parsing (Tasks 1-2).
- [ ] geofront bind-mounts the host socket via `--mcp-mount`; no relay, no egress change (Task 12).
- [ ] All magi tests green (`bun run check:full`); geofront green (`./handoff.sh --quiet`).
- [ ] The Phase-1 downstream is a stub; the real worker + credentials are explicitly deferred to Phase 2.

## Handoff to Phase 2 (record while fresh)

- The mediator's `handleConnection` DI seam is where the Phase-2 worker replaces `serveStub`.
- Confirmed during Phase 1: geofront runs a non-agent workload via `AgentKind::Other` (spec §12.3), so Phase 2's worker enclosure has no geofront blocker; the open Phase-2 items are the enclosure cost and the magi↔worker control channel.
- `magi-main` must authorize `tools/call` against the **session's enabled-server set**, not the tunnel's server-id tag (spec §5.1) — build that into the Phase-2 mediation, not the stub.
