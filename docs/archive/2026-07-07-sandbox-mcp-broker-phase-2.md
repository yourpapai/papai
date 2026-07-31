<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Sandbox MCP Broker — Phase 2 (Credential-Holding Worker Enclosure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase-1 stub responder with a **kernel-isolated, credential-holding worker** that reaches a real upstream MCP server through restricted egress and streams the response back opaque — the security launch gate (no secret in the sandbox, no new agent egress, no code-only egress boundary).

**Architecture:** magi spawns a **second geofront enclosure** per MCP-enabled session whose entrypoint is a dumb `mcp-worker` binary (not an ACP agent). The worker holds the upstream credential (staged host-side, shredded after read), has kernel-enforced egress restricted to the upstream MCP host, and speaks its control protocol over **stdio via geofront's existing `--acp` relay** (magi connects to the worker's control socket exactly as it connects to the agent's ACP socket). The mediator's `handleConnection` (was `serveStub`) forwards the agent's MCP stream to the worker's control connection and relays responses back. The worker translates stdio-MCP → HTTP-MCP (opaque POST per request), injecting the credential and streaming responses without parsing them.

**Tech Stack:** Bun + TypeScript (magi); Rust (geofront — reuse only, likely no code change); `node:net`/`undici` (proxy-aware HTTP); geofront `AgentKind::Other` + `--acp` relay + `proxy_container` egress.

**Spec:** `docs/superpowers/specs/2026-07-05-sandbox-mcp-broker-design.md` (§5.4 worker, §10 threats, §12.3 launch gate).

## Decisions (from Phase-2 exploration — no fork)

1. **Control channel = reuse `--acp`.** geofront `docker exec -i`s the worker entrypoint and byte-relays its stdio to a host socket (`serve_acp_bridge`, protocol-oblivious). magi connects to that socket and drives the worker. No new geofront flag/mount.
2. **Worker enclosure = a second geofront project dir.** magi builds a worker `ProvisioningPlan` (`agentEntrypoint = ['mcp-worker']`, `egressDomains = [upstream host]`, `secrets = [{ request:'MCP_UPSTREAM_TOKEN', targetEnv:'MCP_UPSTREAM_TOKEN', required:true }]`) and runs `writeBuildContext`/`stageSecrets`/`renderGeofrontToml` against a dedicated dir, then `geofront workspace up --acp <worker-ctrl.sock>` there. `magi-init` prefix gives free secret staging + shred.
3. **Secrets = magi's job.** The credential is staged via the existing `SecretSource` `request` variant → `.magi-private` manifest → `magi-init` exports it into the worker's env, then shreds it. Never enters the _agent_ sandbox.
4. **Config = env-based** (Phase 3 replaces with vault/catalog): `MAGI_MCP_UPSTREAM_URL`, `MAGI_MCP_UPSTREAM_HEADER` (default `Authorization`), `MAGI_MCP_UPSTREAM_TOKEN`, `MAGI_ALLOWED_MCP_HOSTS`.
5. **Scope: single upstream MCP server per session.** One worker, one upstream (env-configured). Multi-server multiplexing (routing by the Phase-1 `serverId` handshake tag) is a follow-up.
6. **Cost note (§12.3):** two enclosures per session (agent + worker), each with its egress proxy + iptables sidecar. Task 11 measures startup/resource cost — a launch-blocking data point.

## Invariants this phase must hold

- **INV-1:** the credential lives only in the worker enclosure (staged + shredded); it never touches the agent sandbox or magi's long-lived process env.
- **INV-2:** the agent gains no new egress — it still reaches only `mcp-tunnel`; the worker's egress is a _separate_ enclosure.
- **Opaque:** neither magi-main nor the worker parses upstream response bodies (newline-frame + stream only).
- **SSRF:** worker egress is kernel-enforced (enclosure proxy) AND in-code fail-closed allowlist; empty allowlist ⇒ refuse.

---

## File structure

**magi — new `src/mcp-broker/worker/`:**

- `config.ts` — parse + validate the worker's env config (`WorkerConfig`).
- `outbound.ts` — the hardened HTTP-MCP client (allowlist, proxy-aware, cred injection, opaque streaming, caps).
- `bridge.ts` — stdio ndjson ⇄ outbound (one upstream POST per request line; response line back).
- `worker-main.ts` — executable entry (`#!/usr/bin/env node`), wires `process.stdin/stdout` + env into `bridge`.
- `enclosure.ts` — build the worker `ProvisioningPlan` + provision a worker geofront dir + launch/teardown.
- `worker-client.ts` — magi-main side: connect to the worker control socket; a `handleConnection` implementation that forwards the mediator stream ⇄ worker.

**magi — modified:**

- `src/runtime/geofront/geofront-runtime.ts` — `launch()`: when MCP is enabled, provision+launch the worker enclosure and use `worker-client` (not `serveStub`) as the mediator downstream; tear it down on shutdown.
- `package.json` — `build:mcp-worker` script.
- `src/runtime/geofront/provisioning/plan.ts` (or `enclosure.ts`) — stage the `mcp-worker` binary into the worker image.

**geofront:** reuse only. A test confirming `AgentKind::Other` + `--acp` drives a non-agent entrypoint (likely no production code change).

**Tests mirror source** under `tests/mcp-broker/worker/`.

---

## Task 1: worker config parsing

**Files:** Create `src/mcp-broker/worker/config.ts`; Test `tests/mcp-broker/worker/config.test.ts`.

- [ ] **Step 1: Branch note** — magi work commits directly to `main` (per prior instruction; do NOT branch). geofront work (Task 10) commits onto the existing `feat/mcp-mount` branch.

- [ ] **Step 2: Write the failing test**

```ts
// tests/mcp-broker/worker/config.test.ts
import { describe, expect, it } from 'bun:test'
import { parseWorkerConfig } from '../../../src/mcp-broker/worker/config.js'

const base = {
  MAGI_MCP_UPSTREAM_URL: 'https://mcp.example.com/v1',
  MAGI_MCP_UPSTREAM_TOKEN: 'secret',
  MAGI_ALLOWED_MCP_HOSTS: 'mcp.example.com',
}

describe('parseWorkerConfig', () => {
  it('parses a valid config with defaults', () => {
    expect(parseWorkerConfig(base)).toEqual({
      url: 'https://mcp.example.com/v1',
      host: 'mcp.example.com',
      header: 'Authorization',
      token: 'secret',
      allowedHosts: ['mcp.example.com'],
    })
  })
  it('honors a custom header name', () => {
    expect(parseWorkerConfig({ ...base, MAGI_MCP_UPSTREAM_HEADER: 'X-Api-Key' }).header).toBe('X-Api-Key')
  })
  it('throws when the upstream host is not in the allowlist (fail-closed)', () => {
    expect(() => parseWorkerConfig({ ...base, MAGI_ALLOWED_MCP_HOSTS: 'other.com' })).toThrow()
  })
  it('throws on a non-https url', () => {
    expect(() => parseWorkerConfig({ ...base, MAGI_MCP_UPSTREAM_URL: 'http://mcp.example.com' })).toThrow()
  })
  it('throws on empty allowlist (fail-closed)', () => {
    expect(() => parseWorkerConfig({ ...base, MAGI_ALLOWED_MCP_HOSTS: '' })).toThrow()
  })
})
```

- [ ] **Step 3: Run to verify FAIL** — `cd ~/Projects/yourpapai/magi && bun test tests/mcp-broker/worker/config.test.ts`.

- [ ] **Step 4: Implement**

```ts
// src/mcp-broker/worker/config.ts
export interface WorkerConfig {
  url: string
  host: string
  header: string
  token: string
  allowedHosts: string[]
}

// Parse the worker's env into a validated config. Fail-closed: refuses unless the
// upstream is https and its host is in a non-empty allowlist.
export function parseWorkerConfig(env: Record<string, string | undefined>): WorkerConfig {
  const url = env['MAGI_MCP_UPSTREAM_URL']
  const token = env['MAGI_MCP_UPSTREAM_TOKEN']
  const header = env['MAGI_MCP_UPSTREAM_HEADER'] ?? 'Authorization'
  const allowedHosts = (env['MAGI_ALLOWED_MCP_HOSTS'] ?? '')
    .split(',')
    .map((h): string => h.trim().toLowerCase())
    .filter((h): boolean => h.length > 0)
  if (url === undefined || token === undefined) {
    throw new Error('mcp-worker: MAGI_MCP_UPSTREAM_URL and MAGI_MCP_UPSTREAM_TOKEN are required')
  }
  if (allowedHosts.length === 0) {
    throw new Error('mcp-worker: MAGI_ALLOWED_MCP_HOSTS must be non-empty (fail-closed)')
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`mcp-worker: invalid MAGI_MCP_UPSTREAM_URL: ${url}`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('mcp-worker: upstream URL must be https')
  }
  const host = parsed.hostname.toLowerCase()
  if (!allowedHosts.includes(host)) {
    throw new Error(`mcp-worker: upstream host ${host} not in MAGI_ALLOWED_MCP_HOSTS`)
  }
  return { url, host, header, token, allowedHosts }
}
```

- [ ] **Step 5: Run to verify PASS**; then `bun run check:full` (5/5). Fix lint minimally.

- [ ] **Step 6: Commit** — `git add src/mcp-broker/worker/config.ts tests/mcp-broker/worker/config.test.ts && git commit -m "feat(mcp-worker): fail-closed env config parsing"`.

(Note: `worker/*` files won't be reachable from `src/main.ts` until Task 7 wires the enclosure in. Add a `src/mcp-broker/worker/index.ts` barrel + a `knip.jsonc` `ignoreIssues` seam for each new `worker/*.ts` file as you create it, following the Phase-1 pattern, and remove the seams once Task 7 makes them reachable. `bun run check:full` must stay 5/5 each task.)

---

## Task 2: hardened outbound HTTP-MCP client

**Files:** Create `src/mcp-broker/worker/outbound.ts`; Test `tests/mcp-broker/worker/outbound.test.ts`.

The security core. It POSTs one opaque JSON-RPC request body to the upstream MCP URL, injects the credential header, and returns the response body as a stream — **without parsing** it. It is **proxy-aware** (uses `HTTPS_PROXY` when the enclosure sets it — that's how kernel-forced egress reaches the allowlisted host) and applies an in-code fail-closed host allowlist + size/time caps as defense-in-depth.

- [ ] **Step 1: Write the failing test.** The mock upstream MUST be an **HTTPS** server (the config path enforces `https://`), so use `node:https.createServer` with a self-signed cert (generate one in the test, or use a checked-in test fixture cert) and set `insecureTlsForTest: true` so the client skips cert verification against the loopback mock. The `node:http` sketch below shows the request/response shape — adapt it to `node:https` + a self-signed cert (`selfsigned` npm or a small `node:crypto`/`openssl` fixture). Do NOT relax the production `https` requirement to make the test easier.

```ts
// tests/mcp-broker/worker/outbound.test.ts
import { afterEach, describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { makeOutbound } from '../../../src/mcp-broker/worker/outbound.js'

let server: Server | undefined
afterEach(() => server?.close())

function startUpstream(
  handler: (body: string, authHeader: string | undefined) => { status: number; body: string },
): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let buf = ''
      req.on('data', (d: Buffer) => {
        buf += d.toString()
      })
      req.on('end', () => {
        const out = handler(buf, req.headers['authorization'])
        res.writeHead(out.status, { 'content-type': 'application/json' })
        res.end(out.body)
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server?.address()
      resolve(typeof addr === 'object' && addr !== null ? addr.port : 0)
    })
  })
}

describe('makeOutbound', () => {
  it('POSTs the request body to the upstream with the credential header and returns the response opaque', async () => {
    const port = await startUpstream((body, auth) => {
      expect(auth).toBe('Bearer tok')
      expect(body).toBe('{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
      return { status: 200, body: '{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}' }
    })
    const outbound = makeOutbound(
      {
        url: `https://127.0.0.1:${port}/`,
        host: '127.0.0.1',
        header: 'Authorization',
        token: 'Bearer tok',
        allowedHosts: ['127.0.0.1'],
      },
      { insecureTlsForTest: true },
    ) // test-only: upstream is plain http on loopback
    const res = await outbound('{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
    expect(res).toBe('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}')
  })

  it('refuses a request whose target host is not allowlisted', async () => {
    const outbound = makeOutbound(
      {
        url: 'https://evil.example/',
        host: 'evil.example',
        header: 'Authorization',
        token: 't',
        allowedHosts: ['good.example'],
      },
      {},
    )
    await expect(outbound('{}')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement** — use `undici` (already a Bun/magi-available dep; if not, add it) for `fetch` + `ProxyAgent`/`Agent`. The insecure-TLS + plain-loopback handling is **test-only** (guarded), never in the real path.

```ts
// src/mcp-broker/worker/outbound.ts
import { Agent, ProxyAgent, request } from 'undici'
import type { WorkerConfig } from './config.js'

export interface OutboundOptions {
  // TEST-ONLY escape hatches; never set in production.
  insecureTlsForTest?: boolean
  maxBytes?: number
  timeoutMs?: number
}

export type Outbound = (requestBody: string) => Promise<string>

// Build a hardened MCP-over-HTTP caller. Defense-in-depth on top of the enclosure's
// kernel-enforced egress: in-code fail-closed host allowlist, credential injected at
// the header, opaque response streaming with size/time caps. Proxy-aware (uses
// HTTPS_PROXY when the enclosure sets it — that is how egress reaches the allowlisted
// host under strict isolation).
export function makeOutbound(cfg: WorkerConfig, opts: OutboundOptions): Outbound {
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024
  const timeoutMs = opts.timeoutMs ?? 30_000
  const proxy = process.env['HTTPS_PROXY'] ?? process.env['https_proxy']
  const dispatcher =
    proxy !== undefined && proxy.length > 0
      ? new ProxyAgent(proxy)
      : new Agent(opts.insecureTlsForTest === true ? { connect: { rejectUnauthorized: false } } : {})

  return async (requestBody: string): Promise<string> => {
    const target = new URL(cfg.url)
    if (!cfg.allowedHosts.includes(target.hostname.toLowerCase())) {
      throw new Error(`mcp-worker: refusing call to non-allowlisted host ${target.hostname}`)
    }
    const controller = new AbortController()
    const timer = setTimeout((): void => controller.abort(), timeoutMs)
    try {
      const res = await request(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [cfg.header]: cfg.token },
        body: requestBody,
        dispatcher,
        maxRedirections: 0, // never follow redirects (SSRF)
        signal: controller.signal,
      })
      let out = ''
      for await (const chunk of res.body) {
        out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
        if (out.length > maxBytes) throw new Error('mcp-worker: upstream response exceeded size cap')
      }
      return out
    } finally {
      clearTimeout(timer)
    }
  }
}
```

- [ ] **Step 4: Run to verify PASS**; `bun run check:full` (5/5). If `undici` isn't already a dep, `bun add undici` and note it (Bun ships `fetch`, but `ProxyAgent` control is cleaner via undici; if the reviewer prefers Bun's built-in fetch + a proxy, that's acceptable as long as `HTTPS_PROXY` is honored and redirects are disabled).

- [ ] **Step 5: Commit** — `git add src/mcp-broker/worker/outbound.ts tests/mcp-broker/worker/outbound.test.ts package.json bun.lock && git commit -m "feat(mcp-worker): hardened opaque outbound HTTP-MCP client"`.

---

## Task 3: stdio ⇄ outbound bridge + entry

**Files:** Create `src/mcp-broker/worker/bridge.ts`, `src/mcp-broker/worker/worker-main.ts`; Test `tests/mcp-broker/worker/bridge.test.ts`.

The worker reads ndjson request lines on stdin, calls the outbound client per line, writes each response as a line to stdout. Uses `StringDecoder` for UTF-8 safety (Phase-1 lesson). Never parses the JSON beyond newline framing.

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp-broker/worker/bridge.test.ts
import { describe, expect, it } from 'bun:test'
import { PassThrough } from 'node:stream'
import { runBridge } from '../../../src/mcp-broker/worker/bridge.js'

describe('runBridge', () => {
  it('calls outbound once per request line and writes each response as a line', async () => {
    const calls: string[] = []
    const outbound = async (body: string): Promise<string> => {
      calls.push(body)
      return `{"echo":${body}}`
    }
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const out: string[] = []
    stdout.on('data', (d: Buffer) => out.push(d.toString()))
    const done = runBridge(outbound, stdin, stdout)
    stdin.write('{"id":1}\n{"id":2}\n')
    stdin.end()
    await done
    expect(calls).toEqual(['{"id":1}', '{"id":2}'])
    expect(out.join('')).toBe('{"echo":{"id":1}}\n{"echo":{"id":2}}\n')
  })
})
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement**

```ts
// src/mcp-broker/worker/bridge.ts
import { StringDecoder } from 'node:string_decoder'
import type { Outbound } from './outbound.js'

// Read ndjson request lines from `stdin`, call `outbound` once per line, write each
// response as a line to `stdout`. Frames by newline only — never parses the JSON.
export function runBridge(
  outbound: Outbound,
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
): Promise<void> {
  return new Promise<void>((resolve, reject): void => {
    const decoder = new StringDecoder('utf8')
    let buf = ''
    const chain: Promise<void> = Promise.resolve()
    let pending = chain
    const handleLine = (line: string): void => {
      pending = pending
        .then(async (): Promise<void> => {
          const res = await outbound(line)
          stdout.write(`${res}\n`)
        })
        .catch(reject)
    }
    stdin.on('data', (chunk: Buffer): void => {
      buf += decoder.write(chunk)
      let nl = buf.indexOf('\n')
      while (nl !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (line.trim().length > 0) handleLine(line)
        nl = buf.indexOf('\n')
      }
    })
    stdin.on('end', (): void => {
      pending.then((): void => resolve()).catch(reject)
    })
    stdin.on('error', reject)
  })
}
```

```ts
#!/usr/bin/env node
// src/mcp-broker/worker/worker-main.ts
import { runBridge } from './bridge.js'
import { makeOutbound } from './outbound.js'
import { parseWorkerConfig } from './config.js'

const cfg = parseWorkerConfig(process.env)
const outbound = makeOutbound(cfg, {})
runBridge(outbound, process.stdin, process.stdout)
  .then((): void => process.exit(0))
  .catch((error: unknown): void => {
    process.stderr.write(`mcp-worker: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
```

- [ ] **Step 4: Run to verify PASS**; `bun run check:full`.

- [ ] **Step 5: Commit** — `git add src/mcp-broker/worker/bridge.ts src/mcp-broker/worker/worker-main.ts tests/mcp-broker/worker/bridge.test.ts && git commit -m "feat(mcp-worker): stdio ndjson <-> outbound bridge + entry"`.

---

## Task 4: stage the `mcp-worker` binary

**Files:** Modify `package.json` (`build:mcp-worker` script mirroring `build:mcp-tunnel`); the worker image staging happens in Task 6's enclosure plan. Test: covered by Task 6.

- [ ] Add to `package.json` scripts: `"build:mcp-worker": "bun build ./src/mcp-broker/worker/worker-main.ts --target=node --outfile ./dist/mcp-worker"` (node bundle, ~KB, `#!/usr/bin/env node` shebang — same approach the tunnel uses after its 100MB-binary fix). Run `bun run build:mcp-worker` once to confirm it produces a small runnable node script; do not commit `dist/`.
- [ ] Commit `package.json` — `git commit -m "build(mcp-worker): node-bundle build script"`.

---

## Task 5: geofront non-agent worker enclosure — confirm + test (Rust)

**Files (geofront, branch `feat/mcp-mount`):** likely a test only; `crates/**/tests/**`.

The Phase-2 spike + exploration confirmed `AgentKind::Other` + `--acp` drives an arbitrary entrypoint with full egress isolation, no production change needed. Add a **regression test** locking this in so a future refactor can't silently break the worker path.

- [ ] Read `crates/core/tests/config_semantic.rs` and the `agent_container` tests. Add a test asserting: a `geofront.toml` with `[runtime.agent] kind="other" entrypoint=["/usr/local/bin/mcp-worker", ...]` and `[egress.policy.allowlist] domains=["mcp.example.com"] ports=[443]` validates and produces an egress-restricted container spec whose exec args run that entrypoint (mirror the existing `--acp`/egress test structure). Fail-first if practical.
- [ ] `./handoff.sh --quiet` (or the scoped `cargo build/fmt/clippy/nextest` equivalents — note the pre-existing macOS `handoff.sh` bash-3.2 quirk from Phase 1). Commit — `git commit -m "test(runtime): lock in non-agent (Other) entrypoint + egress for the mcp worker"`.

---

## Task 6: worker enclosure provisioning + launch (magi)

**Files:** Create `src/mcp-broker/worker/enclosure.ts`; Test `tests/mcp-broker/worker/enclosure.test.ts`. READ FIRST: `src/runtime/geofront/geofront-runtime.ts` (`provision`, `launch`, `renderGeofrontToml`, `resolvePlan`, `writeBuildContext`, `stageSecrets`), `src/runtime/geofront/provisioning/plan.ts`, `src/project/config.ts` (`SecretSource`, `ProvisioningConfig`).

Build a `WorkerEnclosure` that: (1) builds a worker `ProvisioningPlan` (entrypoint `['mcp-worker']`, `egressDomains=[cfg.host]`, `env` for `MAGI_MCP_UPSTREAM_URL`/`_HEADER`/`MAGI_ALLOWED_MCP_HOSTS`, `secrets=[{ request:'MCP_UPSTREAM_TOKEN', targetEnv:'MAGI_MCP_UPSTREAM_TOKEN', required:true }]`, and stages the `mcp-worker` binary at `/usr/local/bin/mcp-worker`), (2) provisions a dedicated worker dir (outside the agent worktree), (3) `geofront workspace up --acp <worker-ctrl.sock>` there, (4) returns `{ ctrlSocketPath, shutdown }`.

- [ ] **Step 1: failing test** — assert `buildWorkerPlan(cfg, tunnelBinPath)` yields a `ProvisioningPlan` with the worker entrypoint, `egressDomains=[cfg.host]`, the `MCP_UPSTREAM_TOKEN` request-secret, and the staged worker binary. (Unit-test the plan builder; the full provision+launch is exercised by Task 11's docker test.)
- [ ] **Step 2–4:** implement `buildWorkerPlan` (pure) + `provisionWorkerDir`/`launchWorker` (reusing `writeBuildContext`/`stageSecrets`/`renderGeofrontToml` + `spawnGeofront(['workspace','up','--acp',ctrlSock], workerDir)` + `waitForSocket`). The credential value is passed in from the caller's env (`process.env['MAGI_MCP_UPSTREAM_TOKEN']`) into the `secrets` map handed to `stageSecrets` — never logged. Tear-down = `geofront workspace down` + cleanup + `unlink(ctrlSock)`. Put the worker dir under `tmpdir()` (not the agent worktree).
- [ ] **Step 5:** `bun run check:full`. **Step 6:** commit — `git commit -m "feat(mcp-worker): provision + launch the credential-holding worker enclosure"`.

---

## Task 7: magi-main worker client + mediator forwarding

**Files:** Create `src/mcp-broker/worker-client.ts`; Test `tests/mcp-broker/worker-client.test.ts`. READ `src/mcp-broker/mediator.ts` (`MediatorDeps.handleConnection`) and `src/acp/client.ts` (`net.connect({ path })`).

`worker-client` connects to the worker control socket and returns a `handleConnection(serverId, inbound, outbound)` that **pipes** the mediator's `inbound` (agent MCP requests) to the worker control connection and the worker's replies back to `outbound`. magi-main stays a dumb relay (no parsing).

- [ ] **Step 1: failing test** — stand up a fake "worker" (a local unix socket server that echoes/transforms lines), build `makeWorkerHandleConnection(ctrlSocketPath)`, drive it through `startMediator` with a client that sends a request line, assert the transformed response comes back. (Real sockets, no mocks — mirror `tests/mcp-broker/mediator.test.ts`.)
- [ ] **Step 2–4:** implement `worker-client.ts`: `net.connect({ path: ctrlSocketPath })`; `handleConnection` does `inbound.pipe(workerConn); workerConn.pipe(outbound)` (single-upstream Phase-2 scope, so no per-serverId demux yet — document that multi-server multiplexing is a follow-up). Handle worker-conn errors/close by ending the mediator connection.
- [ ] **Step 5:** `bun run check:full`. **Step 6:** commit — `git commit -m "feat(mcp-worker): magi-main relays mediator stream to the worker control socket"`.

---

## Task 8: wire the worker into `geofront-runtime.launch`

**Files:** Modify `src/runtime/geofront/geofront-runtime.ts`; Test extends `tests/runtime/geofront/geofront-runtime.test.ts`. READ the Phase-1 `launch()` (mediator + `--mcp-mount`).

When MCP is enabled for the session (env config present / `MAGI_MCP_TUNNEL_SERVERS` non-empty), `launch()` must: build the worker config (`parseWorkerConfig(process.env)`), `launchWorker(...)` the enclosure, and pass `makeWorkerHandleConnection(worker.ctrlSocketPath)` as the mediator's `handleConnection` (instead of `serveStub`). Tear the worker down in the same shutdown paths (normal + launch-failure) already wired in Phase 1. When MCP is NOT enabled, behavior is byte-identical to today (no worker, `serveStub` unused — or the mediator isn't even started).

- [ ] Implement + test: assert that with MCP env set, `launch` provisions/launches the worker and the mediator downstream is the worker client; with MCP unset, no worker enclosure is spawned. Remove the now-reachable `worker/*` knip seams. Guard: the worker enclosure only spawns when MCP config is present (no cost for non-MCP sessions).
- [ ] `bun run check:full`. Commit — `git commit -m "feat(mcp-worker): launch worker enclosure + use it as the mediator downstream when MCP enabled"`.

---

## Task 9: remove the Phase-1 stub from the live path

**Files:** `src/mcp-broker/stub-responder.ts` (keep for tests only or delete), `geofront-runtime.ts`.

- [ ] `serveStub` is no longer the production downstream. Either delete it + its test, or keep it clearly marked test-only (used by `transport-e2e.test.ts`). Decide based on whether the transport E2E still wants a lightweight downstream (recommended: keep `serveStub` for the pure-transport test, but ensure the _production_ path in `geofront-runtime.ts` uses the worker client). Ensure no production code references `serveStub`.
- [ ] `bun run check:full`. Commit — `git commit -m "refactor(mcp-broker): stub responder is test-only; production uses the worker"`.

---

## Task 10: docs — INV-1/INV-2 + Phase-2 wiring

**Files:** `docs/architecture/coding-sessions.md` (papai) — add a short "MCP broker (Phase 2)" note; commit ONLY that file (papai has concurrent WIP from another session — never `git add -A`).

- [ ] Document: the worker enclosure, its egress isolation, credential staging+shred, the reused `--acp` control channel, env config, and that magi-main stays a dumb relay. Commit — `git commit -m "docs(coding-sessions): document the Phase 2 MCP worker enclosure"`.

---

## Task 11: docker-boundary verification (the launch-gate proof)

**Goal:** prove the whole Phase-2 chain in real docker on a Linux/same-kernel host, and measure the two-enclosure cost. **NOTE the Phase-1 same-kernel constraint** — run this on Linux/CI, not macOS-with-VM-docker (the socket crossing won't work there; that's an env limitation, not a defect).

- [ ] **Mock upstream MCP server:** a tiny HTTPS server (self-signed) that echoes `tools/call` and requires the credential header; run it on a host/network the worker's egress allowlist will admit.
- [ ] **Build** `mcp-tunnel` + `mcp-worker` (`bun run build:mcp-tunnel && bun run build:mcp-worker`).
- [ ] **Drive a session** (or a focused harness) with `MAGI_MCP_TUNNEL_SERVERS=echo`, `MAGI_MCP_UPSTREAM_URL=<mock>`, `MAGI_MCP_UPSTREAM_TOKEN=<tok>`, `MAGI_ALLOWED_MCP_HOSTS=<mock host>`. Confirm: a tool call travels agent → tunnel → mediator → **worker enclosure** → mock upstream (with the credential) → opaque response → back.
- [ ] **INV-1:** confirm the credential is present in the WORKER enclosure env only, NOT in the agent enclosure (exec into both; grep env). Confirm `magi-init` shredded `.magi-private` in the worker.
- [ ] **INV-2:** confirm the AGENT enclosure's egress allowlist is unchanged (no MCP host added); the worker enclosure's allowlist is exactly `[mock host]`.
- [ ] **SSRF:** point `MAGI_MCP_UPSTREAM_URL` at a non-allowlisted host (or the mock returns a redirect to `169.254.169.254`) and confirm the worker refuses / the enclosure egress blocks it.
- [ ] **Cost (§12.3):** record container count + startup time for a two-enclosure session vs a one-enclosure session. Flag if prohibitive.
- [ ] **Record** results in `docs/superpowers/plans/2026-07-07-phase-2-verification.md` (papai, commit that one file only). Include PASS/FAIL per invariant + the cost numbers.

---

## Definition of done (Phase 2)

- [ ] A tool call round-trips agent → tunnel → mediator → **kernel-isolated worker enclosure** → real upstream MCP (with credential) → opaque response → agent.
- [ ] **INV-1:** credential only in the worker enclosure (staged + shredded); never in the agent sandbox or magi's long-lived env.
- [ ] **INV-2:** agent egress allowlist byte-identical to a no-MCP session.
- [ ] Worker egress is **kernel-enforced** (enclosure proxy) restricted to the upstream host; SSRF/allowlist refusals verified.
- [ ] magi-main and the worker never parse upstream response bodies (opaque).
- [ ] Worker enclosure spawns only when MCP is enabled; non-MCP sessions unchanged.
- [ ] `check:full` green (magi); `handoff.sh`/scoped checks green (geofront); docker-boundary verification recorded.
- [ ] Two-enclosure cost measured and recorded (§12.3).

## Handoff to Phase 3

- Env config (`MAGI_MCP_UPSTREAM_*`, `MAGI_ALLOWED_MCP_HOSTS`) is replaced by the papai **operator catalog + per-identity vault**; `parseWorkerConfig`'s inputs come from the resolved catalog entry + vaulted credential instead of process env.
- **Per-tool allow/ask/deny gating + audit** is added in the magi-main mediator (it currently relays opaquely; Phase 3 adds a minimal method-name peek for policy — the one place magi reads the request).
- **Multi-server multiplexing:** route the Phase-1 `serverId` handshake tag to per-server upstreams within one worker (or per-server worker escalation for high-sensitivity creds).
