<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tier 2 Process-Real Smoke Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the shipped `papai` artifact boots, migrates from an empty DB, gates its surfaces, runs one full chat turn, and shuts down gracefully — asserted entirely from outside a real Docker container — and mint eight `@2` catalog records for it.

**Architecture:** A host-run test lane builds/tags the production `Dockerfile` as `papai:e2e`, brings up two deterministic host fakes (an OpenAI-compatible LLM server and a minimal Mattermost HTTP+WS server), starts the real container with its `LLM_BASE_URL`/`MATTERMOST_URL` pointed at those fakes via `host.docker.internal`, and asserts eight behaviors through HTTP status, container logs, and exit codes. Eight scenarios need only three container boots (P: valid env; D: `DEBUG_SERVER=true`; E: blank `ADMIN_USER_ID`). The catalog seam adds tier `'2'` to the live set and eight minted records — the sole frozen-tree change.

**Tech Stack:** Bun (runtime + `bun:test`), TypeScript (strict, `.js` import paths), `Bun.serve` (fakes, HTTP+WebSocket), `Bun.spawn` (docker), Docker, GitHub Actions.

## Global Constraints

_Every task's requirements implicitly include this section. Values are copied verbatim from `docs/superpowers/specs/2026-07-24-tier2-process-real-smoke-design.md`._

- **Zero production `src/` change.** The entire lane is test infra + Docker + env redirection. The T4 clock seam remains the program's only planned `src/` change. If a task appears to need a `src/` edit, stop and escalate.
- **Single frozen-tree change only.** The one permitted change under `tests/stories/` is catalog metadata: the eight `@2` records in `tests/stories/catalog/coverage.ts`, plus `LIVE_STORY_TIERS` gaining `'2'`. `TIER_SUITE_ROOTS['2']` (`'tests/smoke/'`) is already present. No other byte under `tests/stories/` changes. `tests/stories/harness/memory-task-provider.ts` and `tests/stories/harness/parity/canonicalize.ts` stay FROZEN.
- **`@2` story ids must start with `tests/smoke/`** — the value of `TIER_SUITE_ROOTS['2']`. The frozen guard "keeps every executable story under its own tier suite root" enforces this.
- **All T2 harness + scenario code lives OUTSIDE the frozen tree**, under `tests/smoke/`.
- **Scenario files use the non-discovered `.smoke.ts` suffix** so the default `bun test` pattern (`**{.test,.spec,_test_,_spec_}.{js,ts,jsx,tsx}`) never runs the Docker lane. The lane runs only via the explicit entry `bun test tests/smoke/run-smoke.ts`. Do NOT edit `bunfig.toml`.
- **No retries, ever (rule 4).** No scenario re-runs on failure. A scenario that cannot hold green is quarantined to nightly in the same PR with a ledger note — never retried.
- **PR gate with a hard cap (rule 5).** The wall-clock ceiling is measured during implementation, not guessed, then enforced with a `timeout-minutes` guard.
- **Docker-gated, no silent pass.** With Docker unavailable the lane skips with a clear message (`test.skipIf` / `describe.skipIf`), never silently green.
- **SPDX header on every new file** — the four-line `// SPDX-License-Identifier: BUSL-1.1` block (see any existing file). The pre-commit `license-headers` check enforces it.
- **No `lint-disable` / `type-ignore` comments** — hook policy blocks them; fix the underlying issue.
- **Conventions:** `.js` extension in import paths; Zod v4 for any validation; error extraction `error instanceof Error ? error.message : String(error)`; `p-limit` for any bounded concurrency over remote ops; **never log tokens, API keys, session cookies, or other secrets.**
- **Canonical container env** (used by every valid-env boot; defined once in Task 5):
  `CHAT_PROVIDER=mattermost`, `ADMIN_USER_ID=admin-user-1`, `MATTERMOST_BOT_TOKEN=smoke-bot-token`, `INSTANCE_CONFIG_KEY=1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef` (64 hex), `LLM_API_KEY=smoke-llm-key`, `MAIN_MODEL=smoke-model`, `DEBUG_HOSTNAME=0.0.0.0`, `SETTINGS_PUBLIC_BASE_URL=http://localhost:9100`. `MATTERMOST_URL` and `LLM_BASE_URL` are injected per-boot from the running fakes' `containerBaseUrl`.

---

### Task 1: Docker command helpers

Pure, DI-friendly wrappers around the `docker` CLI plus the two pure arg-builders and the port parser the rest of the lane composes.

**Files:**
- Create: `tests/smoke/harness/docker.ts`
- Test: `tests/smoke/harness/docker.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `type DockerResult = { code: number; stdout: string; stderr: string }`
  - `type RunDocker = (args: string[], opts?: { input?: string }) => Promise<DockerResult>`
  - `runDocker: RunDocker` — spawns the real `docker` CLI.
  - `repoRoot(): string` — absolute path to the repository root (build context).
  - `buildDockerRunArgs(opts: DockerRunSpec): string[]` where `type DockerRunSpec = { image: string; env: Record<string, string>; detached: boolean; publishContainerPort?: number; addHostGateway?: boolean }`.
  - `parsePublishedPort(dockerPortStdout: string): number` — parses `docker port <id> <n>` output (`127.0.0.1:54321\n`) to `54321`.
  - `isDockerAvailable(run?: RunDocker): Promise<boolean>` — true when `docker version` exits 0.

- [ ] **Step 1: Write the failing test**

```ts
// tests/smoke/harness/docker.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildDockerRunArgs, isDockerAvailable, parsePublishedPort, repoRoot } from './docker.js'

describe('docker helpers', () => {
  test('buildDockerRunArgs emits a detached run with published port, host-gateway and env', () => {
    const args = buildDockerRunArgs({
      image: 'papai:e2e',
      env: { CHAT_PROVIDER: 'mattermost', ADMIN_USER_ID: 'admin-user-1' },
      detached: true,
      publishContainerPort: 9100,
      addHostGateway: true,
    })

    expect(args.slice(0, 2)).toEqual(['run', '-d'])
    expect(args).toContain('--add-host=host.docker.internal:host-gateway')
    expect(args).toContain('-p')
    expect(args).toContain('127.0.0.1::9100')
    expect(args).toContain('-e')
    expect(args).toContain('CHAT_PROVIDER=mattermost')
    expect(args).toContain('ADMIN_USER_ID=admin-user-1')
    expect(args.at(-1)).toBe('papai:e2e')
  })

  test('buildDockerRunArgs emits a foreground --rm run when not detached', () => {
    const args = buildDockerRunArgs({ image: 'papai:e2e', env: { ADMIN_USER_ID: '' }, detached: false })

    expect(args.slice(0, 2)).toEqual(['run', '--rm'])
    expect(args).not.toContain('-d')
    expect(args).toContain('ADMIN_USER_ID=')
    expect(args.at(-1)).toBe('papai:e2e')
  })

  test('parsePublishedPort reads the host port from docker port output', () => {
    expect(parsePublishedPort('127.0.0.1:54321\n')).toBe(54321)
    expect(parsePublishedPort('0.0.0.0:7\n[::]:7\n')).toBe(7)
  })

  test('repoRoot points at a directory that contains the Dockerfile', async () => {
    const file = Bun.file(`${repoRoot()}Dockerfile`)
    expect(await file.exists()).toBe(true)
  })

  test('isDockerAvailable reports false when the docker CLI errors', async () => {
    const failing = () => Promise.resolve({ code: 127, stdout: '', stderr: 'not found' })
    expect(await isDockerAvailable(failing)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/smoke/harness/docker.test.ts`
Expected: FAIL — `Cannot find module './docker.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// tests/smoke/harness/docker.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { fileURLToPath } from 'node:url'

export type DockerResult = { code: number; stdout: string; stderr: string }
export type RunDocker = (args: string[], opts?: { input?: string }) => Promise<DockerResult>

export async function runDocker(args: string[], opts: { input?: string } = {}): Promise<DockerResult> {
  const proc = Bun.spawn(['docker', ...args], {
    stdin: opts.input === undefined ? 'ignore' : new TextEncoder().encode(opts.input),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  return { code, stdout, stderr }
}

export function repoRoot(): string {
  // this file lives at tests/smoke/harness/docker.ts; three levels up is the repo root.
  return fileURLToPath(new URL('../../../', import.meta.url))
}

export type DockerRunSpec = {
  image: string
  env: Record<string, string>
  detached: boolean
  publishContainerPort?: number
  addHostGateway?: boolean
}

export function buildDockerRunArgs(spec: DockerRunSpec): string[] {
  const args: string[] = ['run', spec.detached ? '-d' : '--rm']
  if (spec.addHostGateway === true) args.push('--add-host=host.docker.internal:host-gateway')
  if (spec.publishContainerPort !== undefined) args.push('-p', `127.0.0.1::${spec.publishContainerPort}`)
  for (const [key, value] of Object.entries(spec.env)) args.push('-e', `${key}=${value}`)
  args.push(spec.image)
  return args
}

export function parsePublishedPort(dockerPortStdout: string): number {
  const firstLine = dockerPortStdout.split('\n').find((line) => line.trim().length > 0)
  if (firstLine === undefined) throw new Error(`docker port produced no output: ${JSON.stringify(dockerPortStdout)}`)
  const port = Number(firstLine.trim().split(':').at(-1))
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Could not parse published port from: ${firstLine}`)
  return port
}

export async function isDockerAvailable(run: RunDocker = runDocker): Promise<boolean> {
  try {
    const { code } = await run(['version'])
    return code === 0
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/smoke/harness/docker.test.ts`
Expected: PASS (5 tests). Note: the `repoRoot` test requires `Dockerfile` at the repo root (it exists).

- [ ] **Step 5: Commit**

```bash
git add tests/smoke/harness/docker.ts tests/smoke/harness/docker.test.ts
git commit -m "test(smoke): docker command helpers for the T2 lane"
```

---

### Task 2: `papai:e2e` image builder

Build-if-absent wrapper that tags the production `Dockerfile` as `papai:e2e`. Local runs build on demand; CI pre-loads the tag (Task 12) so `ensurePapaiE2eImage` is a fast no-op there.

**Files:**
- Create: `tests/smoke/harness/image.ts`
- Test: `tests/smoke/harness/image.test.ts`

**Interfaces:**
- Consumes: `RunDocker`, `runDocker`, `repoRoot` from `./docker.js` (Task 1).
- Produces:
  - `const PAPAI_E2E_IMAGE = 'papai:e2e'`
  - `buildImageBuildArgs(tag: string, contextDir: string): string[]`
  - `imageExists(tag: string, run?: RunDocker): Promise<boolean>`
  - `ensurePapaiE2eImage(opts?: { run?: RunDocker; contextDir?: string }): Promise<void>` — no-op when the tag exists; otherwise `docker build`, throwing on non-zero exit.

- [ ] **Step 1: Write the failing test**

```ts
// tests/smoke/harness/image.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { DockerResult } from './docker.js'
import { buildImageBuildArgs, ensurePapaiE2eImage, imageExists, PAPAI_E2E_IMAGE } from './image.js'

const ok: DockerResult = { code: 0, stdout: '', stderr: '' }

describe('papai:e2e image builder', () => {
  test('buildImageBuildArgs tags the given context', () => {
    expect(buildImageBuildArgs('papai:e2e', '/repo/')).toEqual(['build', '-t', 'papai:e2e', '/repo/'])
  })

  test('imageExists is true when docker image inspect exits 0', async () => {
    expect(await imageExists(PAPAI_E2E_IMAGE, () => Promise.resolve(ok))).toBe(true)
  })

  test('ensurePapaiE2eImage skips the build when the image already exists', async () => {
    const calls: string[][] = []
    await ensurePapaiE2eImage({
      run: (args) => {
        calls.push(args)
        return Promise.resolve(ok)
      },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.slice(0, 2)).toEqual(['image', 'inspect'])
  })

  test('ensurePapaiE2eImage builds when the image is absent and throws on failure', async () => {
    const run = (args: string[]): Promise<DockerResult> => {
      if (args[0] === 'image') return Promise.resolve({ code: 1, stdout: '', stderr: 'No such image' })
      return Promise.resolve({ code: 1, stdout: '', stderr: 'build blew up' })
    }
    await expect(ensurePapaiE2eImage({ run, contextDir: '/repo/' })).rejects.toThrow('build blew up')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/smoke/harness/image.test.ts`
Expected: FAIL — `Cannot find module './image.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// tests/smoke/harness/image.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../../src/logger.js'
import { type RunDocker, repoRoot, runDocker } from './docker.js'

const log = logger.child({ scope: 'smoke:image' })

export const PAPAI_E2E_IMAGE = 'papai:e2e'

export function buildImageBuildArgs(tag: string, contextDir: string): string[] {
  return ['build', '-t', tag, contextDir]
}

export async function imageExists(tag: string, run: RunDocker = runDocker): Promise<boolean> {
  const { code } = await run(['image', 'inspect', tag])
  return code === 0
}

export async function ensurePapaiE2eImage(opts: { run?: RunDocker; contextDir?: string } = {}): Promise<void> {
  const run = opts.run ?? runDocker
  const contextDir = opts.contextDir ?? repoRoot()
  if (await imageExists(PAPAI_E2E_IMAGE, run)) {
    log.info({ image: PAPAI_E2E_IMAGE }, 'papai:e2e image present, skipping build')
    return
  }
  log.info({ image: PAPAI_E2E_IMAGE, contextDir }, 'Building papai:e2e image')
  const { code, stderr } = await run(buildImageBuildArgs(PAPAI_E2E_IMAGE, contextDir))
  if (code !== 0) throw new Error(`docker build for ${PAPAI_E2E_IMAGE} failed: ${stderr}`)
  log.info({ image: PAPAI_E2E_IMAGE }, 'papai:e2e image built')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/smoke/harness/image.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/smoke/harness/image.ts tests/smoke/harness/image.test.ts
git commit -m "test(smoke): build-if-absent papai:e2e image helper"
```

---

### Task 3: Deterministic OpenAI-compatible fake LLM server

The reusable machinery T3 later extends. It answers `POST …/chat/completions` (the openai-compatible client appends `/chat/completions` to `LLM_BASE_URL`) with plain non-streamed JSON, shifting scripted responses from a FIFO queue. Tool-call `arguments` are JSON-**encoded strings**, as the wire contract requires.

**Files:**
- Create: `tests/smoke/harness/fake-llm-server.ts`
- Test: `tests/smoke/harness/fake-llm-server.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module; `Bun.serve`).
- Produces:
  - `type LlmToolCall = { id: string; name: string; arguments: Record<string, unknown> }`
  - `type ScriptedLlmResponse = { kind: 'tool'; call: LlmToolCall } | { kind: 'text'; content: string }`
  - `toolResponse(id: string, name: string, args: Record<string, unknown>): ScriptedLlmResponse`
  - `textResponse(content: string): ScriptedLlmResponse`
  - `type FakeLlmServer = { containerBaseUrl: string; localBaseUrl: string; enqueue(r: ScriptedLlmResponse[]): void; requestCount(): number; stop(): Promise<void> }`
  - `startFakeLlmServer(): FakeLlmServer` — binds `0.0.0.0:0`; `containerBaseUrl`/`localBaseUrl` both end in `/v1`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/smoke/harness/fake-llm-server.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { startFakeLlmServer, textResponse, toolResponse } from './fake-llm-server.js'

describe('fake LLM server', () => {
  test('serves scripted tool then text responses with JSON-encoded arguments', async () => {
    const llm = startFakeLlmServer()
    try {
      llm.enqueue([toolResponse('call_1', 'load_tool', { names: ['list_memory'] }), textResponse('all done')])

      const first = await (
        await fetch(`${llm.localBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'smoke-model', messages: [] }),
        })
      ).json()
      expect(first.model).toBe('smoke-model')
      expect(first.choices[0].finish_reason).toBe('tool_calls')
      const toolCall = first.choices[0].message.tool_calls[0]
      expect(toolCall.function.name).toBe('load_tool')
      expect(typeof toolCall.function.arguments).toBe('string')
      expect(JSON.parse(toolCall.function.arguments)).toEqual({ names: ['list_memory'] })

      const second = await (
        await fetch(`${llm.localBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'smoke-model', messages: [] }),
        })
      ).json()
      expect(second.choices[0].finish_reason).toBe('stop')
      expect(second.choices[0].message.content).toBe('all done')
      expect(llm.requestCount()).toBe(2)
    } finally {
      await llm.stop()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/smoke/harness/fake-llm-server.test.ts`
Expected: FAIL — `Cannot find module './fake-llm-server.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// tests/smoke/harness/fake-llm-server.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type LlmToolCall = { id: string; name: string; arguments: Record<string, unknown> }
export type ScriptedLlmResponse = { kind: 'tool'; call: LlmToolCall } | { kind: 'text'; content: string }

export function toolResponse(id: string, name: string, args: Record<string, unknown>): ScriptedLlmResponse {
  return { kind: 'tool', call: { id, name, arguments: args } }
}

export function textResponse(content: string): ScriptedLlmResponse {
  return { kind: 'text', content }
}

export type FakeLlmServer = {
  containerBaseUrl: string
  localBaseUrl: string
  enqueue(responses: ScriptedLlmResponse[]): void
  requestCount(): number
  stop(): Promise<void>
}

function buildCompletion(scripted: ScriptedLlmResponse, model: string, n: number): unknown {
  const base = {
    id: `chatcmpl-${n}`,
    object: 'chat.completion',
    created: 0,
    model,
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
  if (scripted.kind === 'tool') {
    return {
      ...base,
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: scripted.call.id,
                type: 'function',
                function: { name: scripted.call.name, arguments: JSON.stringify(scripted.call.arguments) },
              },
            ],
          },
        },
      ],
    }
  }
  return {
    ...base,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: scripted.content } }],
  }
}

export function startFakeLlmServer(): FakeLlmServer {
  const queue: ScriptedLlmResponse[] = []
  let count = 0
  const server = Bun.serve({
    hostname: '0.0.0.0',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (req.method === 'POST' && url.pathname.endsWith('/chat/completions')) {
        const body = (await req.json().catch(() => ({}))) as { model?: string }
        count += 1
        const scripted = queue.shift() ?? textResponse('__UNSCRIPTED__')
        return Response.json(buildCompletion(scripted, body.model ?? 'unknown', count))
      }
      return new Response('not found', { status: 404 })
    },
  })
  const port = server.port
  return {
    containerBaseUrl: `http://host.docker.internal:${port}/v1`,
    localBaseUrl: `http://127.0.0.1:${port}/v1`,
    enqueue(responses) {
      queue.push(...responses)
    },
    requestCount() {
      return count
    },
    async stop() {
      await server.stop(true)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/smoke/harness/fake-llm-server.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add tests/smoke/harness/fake-llm-server.ts tests/smoke/harness/fake-llm-server.test.ts
git commit -m "test(smoke): deterministic openai-compatible fake LLM server"
```

---

### Task 4: Minimal fake Mattermost HTTP+WS server

Drives the real `MattermostChatProvider` end to end. Serves the exact endpoints the provider calls, sequences the `posted` event only after the `/users/me` + WS `hello` handshake (killing the WS race on the no-retry gate), and captures the bot's outbound reply through a bounded awaited promise.

**Files:**
- Create: `tests/smoke/harness/fake-mattermost-server.ts`
- Test: `tests/smoke/harness/fake-mattermost-server.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module; `Bun.serve` websocket).
- Produces:
  - `type IncomingPost = { channelId: string; message: string; userId: string; userName?: string; postId?: string }`
  - `type CapturedPost = { channel_id: string; message: string; root_id?: string }`
  - `type FakeMattermostServer = { containerBaseUrl: string; localBaseUrl: string; botUserId: string; botUsername: string; whenConnected(): Promise<void>; deliverMessage(post: IncomingPost): void; waitForPost(timeoutMs?: number): Promise<CapturedPost>; stop(): Promise<void> }`
  - `startFakeMattermostServer(opts?: { botUserId?: string; botUsername?: string }): FakeMattermostServer` — defaults `botUserId: 'bot-user-1'`, `botUsername: 'smokebot'`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/smoke/harness/fake-mattermost-server.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { startFakeMattermostServer } from './fake-mattermost-server.js'

describe('fake Mattermost server', () => {
  test('handshakes, delivers a posted event, and captures the outbound reply', async () => {
    const mm = startFakeMattermostServer({ botUserId: 'bot-1', botUsername: 'smokebot' })
    try {
      const me = await (await fetch(`${mm.localBaseUrl}/api/v4/users/me`)).json()
      expect(me).toEqual({ id: 'bot-1', username: 'smokebot' })

      const channel = await (await fetch(`${mm.localBaseUrl}/api/v4/channels/dm-1`)).json()
      expect(channel.type).toBe('D')

      const ws = new WebSocket(`${mm.localBaseUrl.replace('http', 'ws')}/api/v4/websocket`)
      const frames: Array<Record<string, unknown>> = []
      ws.addEventListener('message', (e) => frames.push(JSON.parse(String(e.data))))
      await new Promise<void>((resolve) => ws.addEventListener('open', () => resolve()))
      ws.send(JSON.stringify({ seq: 1, action: 'authentication_challenge', data: { token: 't' } }))
      await mm.whenConnected()
      expect(frames.some((f) => f['event'] === 'hello')).toBe(true)

      mm.deliverMessage({ channelId: 'dm-1', message: 'hello there', userId: 'admin-user-1' })
      await Bun.sleep(25)
      const posted = frames.find((f) => f['event'] === 'posted') as { data: { post: string } } | undefined
      expect(posted).toBeDefined()
      const embedded = JSON.parse(posted!.data.post)
      expect(embedded.message).toBe('hello there')
      expect(embedded.user_id).toBe('admin-user-1')

      const captured = mm.waitForPost()
      await fetch(`${mm.localBaseUrl}/api/v4/posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel_id: 'dm-1', message: 'reply body', root_id: 'in-1' }),
      })
      expect(await captured).toEqual({ channel_id: 'dm-1', message: 'reply body', root_id: 'in-1' })
      ws.close()
    } finally {
      await mm.stop()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/smoke/harness/fake-mattermost-server.test.ts`
Expected: FAIL — `Cannot find module './fake-mattermost-server.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// tests/smoke/harness/fake-mattermost-server.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ServerWebSocket } from 'bun'

export type IncomingPost = { channelId: string; message: string; userId: string; userName?: string; postId?: string }
export type CapturedPost = { channel_id: string; message: string; root_id?: string }

export type FakeMattermostServer = {
  containerBaseUrl: string
  localBaseUrl: string
  botUserId: string
  botUsername: string
  whenConnected(): Promise<void>
  deliverMessage(post: IncomingPost): void
  waitForPost(timeoutMs?: number): Promise<CapturedPost>
  stop(): Promise<void>
}

const CHANNEL_RE = /^\/api\/v4\/channels\/[^/]+$/
const MEMBER_RE = /^\/api\/v4\/channels\/[^/]+\/members\/[^/]+$/

export function startFakeMattermostServer(opts: { botUserId?: string; botUsername?: string } = {}): FakeMattermostServer {
  const botUserId = opts.botUserId ?? 'bot-user-1'
  const botUsername = opts.botUsername ?? 'smokebot'

  let activeWs: ServerWebSocket<unknown> | null = null
  let markConnected: () => void = () => {}
  const connected = new Promise<void>((resolve) => {
    markConnected = resolve
  })

  let inCount = 0
  let outCount = 0
  const postBuffer: CapturedPost[] = []
  const postWaiters: Array<(post: CapturedPost) => void> = []

  const onPost = (post: CapturedPost): void => {
    const waiter = postWaiters.shift()
    if (waiter !== undefined) waiter(post)
    else postBuffer.push(post)
  }

  const handleHttp = async (req: Request, url: URL): Promise<Response> => {
    const path = url.pathname
    if (req.method === 'GET' && path === '/api/v4/users/me') {
      return Response.json({ id: botUserId, username: botUsername })
    }
    if (req.method === 'GET' && CHANNEL_RE.test(path)) {
      return Response.json({ id: path.split('/').at(-1), type: 'D' })
    }
    if (req.method === 'GET' && MEMBER_RE.test(path)) {
      const segments = path.split('/')
      return Response.json({ channel_id: segments[4], user_id: segments.at(-1), roles: 'channel_member' })
    }
    if (req.method === 'POST' && path === '/api/v4/posts') {
      const body = (await req.json().catch(() => ({}))) as { channel_id?: string; message?: string; root_id?: string }
      outCount += 1
      const captured: CapturedPost = { channel_id: body.channel_id ?? '', message: body.message ?? '' }
      if (body.root_id !== undefined) captured.root_id = body.root_id
      onPost(captured)
      return Response.json({ id: `out-${outCount}` })
    }
    // Tolerate any other v4 GET the provider probes at startup rather than 404-crashing it.
    if (req.method === 'GET' && path.startsWith('/api/v4/')) return Response.json({})
    return new Response('not found', { status: 404 })
  }

  const server = Bun.serve<unknown, undefined>({
    hostname: '0.0.0.0',
    port: 0,
    fetch(req, srv) {
      const url = new URL(req.url)
      if (url.pathname === '/api/v4/websocket') {
        return srv.upgrade(req) ? undefined : new Response('upgrade failed', { status: 400 })
      }
      return handleHttp(req, url)
    },
    websocket: {
      open(ws) {
        activeWs = ws
      },
      message(_ws, message) {
        const frame = JSON.parse(typeof message === 'string' ? message : message.toString()) as {
          action?: string
        }
        if (frame.action === 'authentication_challenge') {
          _ws.send(JSON.stringify({ event: 'hello', data: {} }))
          markConnected()
        }
        // user_typing and any other client frames are intentionally ignored.
      },
      close() {
        activeWs = null
      },
    },
  })
  const port = server.port

  return {
    containerBaseUrl: `http://host.docker.internal:${port}`,
    localBaseUrl: `http://127.0.0.1:${port}`,
    botUserId,
    botUsername,
    whenConnected() {
      return connected
    },
    deliverMessage(post) {
      if (activeWs === null) throw new Error('deliverMessage called before the WS connected')
      inCount += 1
      const embedded = {
        id: post.postId ?? `in-${inCount}`,
        user_id: post.userId,
        channel_id: post.channelId,
        message: post.message,
        user_name: post.userName ?? post.userId,
      }
      activeWs.send(
        JSON.stringify({ event: 'posted', data: { post: JSON.stringify(embedded), sender_name: post.userName ?? post.userId } }),
      )
    },
    waitForPost(timeoutMs = 10_000) {
      const buffered = postBuffer.shift()
      if (buffered !== undefined) return Promise.resolve(buffered)
      return new Promise<CapturedPost>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for an outbound post')), timeoutMs)
        postWaiters.push((post) => {
          clearTimeout(timer)
          resolve(post)
        })
      })
    },
    async stop() {
      await server.stop(true)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/smoke/harness/fake-mattermost-server.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add tests/smoke/harness/fake-mattermost-server.ts tests/smoke/harness/fake-mattermost-server.test.ts
git commit -m "test(smoke): minimal fake Mattermost HTTP+WS ingress server"
```

---

### Task 5: Container lifecycle harness

The `docker run`/probe/teardown machinery, mirroring `tests/e2e/docker-lifecycle.ts`. Publishes the debug/web port (default `9100`) to a random loopback host port, probes `GET /settings` for readiness, and offers SIGTERM-drain and foreground-to-exit lifecycles. Pure helpers (`settingsProbeUrl`, `buildContainerEnv`) are unit-tested; the Docker paths are exercised by the scenario tasks.

**Files:**
- Create: `tests/smoke/harness/container.ts`
- Test: `tests/smoke/harness/container.test.ts`

**Interfaces:**
- Consumes: `RunDocker`, `runDocker`, `buildDockerRunArgs`, `parsePublishedPort` from `./docker.js`; `PAPAI_E2E_IMAGE` from `./image.js`.
- Produces:
  - `const DEBUG_DEFAULT_PORT = 9100`
  - `type PapaiContainer = { id: string; webBaseUrl: string; stop(): Promise<{ logs: string; exitCode: number }>; remove(): Promise<void> }`
  - `type EnvOverrides = { adminUserId?: string; debugServer?: boolean }`
  - `buildContainerEnv(fakes: { llmBaseUrl: string; mattermostUrl: string }, over?: EnvOverrides): Record<string, string>`
  - `settingsProbeUrl(webBaseUrl: string): string`
  - `waitForSettings(webBaseUrl: string, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<void>`
  - `startPapaiContainer(opts: { env: Record<string, string>; run?: RunDocker; readyTimeoutMs?: number }): Promise<PapaiContainer>`
  - `stopContainerWithSigterm(id: string, run?: RunDocker): Promise<{ logs: string; exitCode: number }>`
  - `removeContainer(id: string, run?: RunDocker): Promise<void>`
  - `runPapaiContainerToExit(opts: { env: Record<string, string>; run?: RunDocker }): Promise<{ logs: string; exitCode: number }>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/smoke/harness/container.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildContainerEnv, settingsProbeUrl } from './container.js'

describe('container lifecycle helpers', () => {
  test('settingsProbeUrl targets the unconditional readiness route', () => {
    expect(settingsProbeUrl('http://127.0.0.1:5000')).toBe('http://127.0.0.1:5000/settings')
  })

  test('buildContainerEnv wires the fakes and the canonical defaults', () => {
    const env = buildContainerEnv({ llmBaseUrl: 'http://host.docker.internal:1/v1', mattermostUrl: 'http://host.docker.internal:2' })
    expect(env['CHAT_PROVIDER']).toBe('mattermost')
    expect(env['ADMIN_USER_ID']).toBe('admin-user-1')
    expect(env['LLM_BASE_URL']).toBe('http://host.docker.internal:1/v1')
    expect(env['MATTERMOST_URL']).toBe('http://host.docker.internal:2')
    expect(env['DEBUG_HOSTNAME']).toBe('0.0.0.0')
    expect(env['SETTINGS_PUBLIC_BASE_URL']).toBe('http://localhost:9100')
    expect(env['INSTANCE_CONFIG_KEY']).toHaveLength(64)
    expect(env['DEBUG_SERVER']).toBeUndefined()
  })

  test('buildContainerEnv honors a blank admin and the debug flag', () => {
    const env = buildContainerEnv({ llmBaseUrl: 'x', mattermostUrl: 'y' }, { adminUserId: '', debugServer: true })
    expect(env['ADMIN_USER_ID']).toBe('')
    expect(env['DEBUG_SERVER']).toBe('true')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/smoke/harness/container.test.ts`
Expected: FAIL — `Cannot find module './container.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// tests/smoke/harness/container.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../../src/logger.js'
import { type RunDocker, buildDockerRunArgs, parsePublishedPort, runDocker } from './docker.js'
import { PAPAI_E2E_IMAGE } from './image.js'

const log = logger.child({ scope: 'smoke:container' })

export const DEBUG_DEFAULT_PORT = 9100

const INSTANCE_CONFIG_KEY = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

export type PapaiContainer = {
  id: string
  webBaseUrl: string
  stop(): Promise<{ logs: string; exitCode: number }>
  remove(): Promise<void>
}

export type EnvOverrides = { adminUserId?: string; debugServer?: boolean }

export function buildContainerEnv(
  fakes: { llmBaseUrl: string; mattermostUrl: string },
  over: EnvOverrides = {},
): Record<string, string> {
  const env: Record<string, string> = {
    CHAT_PROVIDER: 'mattermost',
    ADMIN_USER_ID: over.adminUserId ?? 'admin-user-1',
    MATTERMOST_URL: fakes.mattermostUrl,
    MATTERMOST_BOT_TOKEN: 'smoke-bot-token',
    INSTANCE_CONFIG_KEY,
    LLM_API_KEY: 'smoke-llm-key',
    LLM_BASE_URL: fakes.llmBaseUrl,
    MAIN_MODEL: 'smoke-model',
    DEBUG_HOSTNAME: '0.0.0.0',
    SETTINGS_PUBLIC_BASE_URL: 'http://localhost:9100',
  }
  if (over.debugServer === true) env['DEBUG_SERVER'] = 'true'
  return env
}

export function settingsProbeUrl(webBaseUrl: string): string {
  return `${webBaseUrl}/settings`
}

export async function waitForSettings(
  webBaseUrl: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 60_000
  const intervalMs = opts.intervalMs ?? 500
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const res = await fetch(settingsProbeUrl(webBaseUrl))
      if (res.status === 200) return
    } catch {
      // container web server not bound yet; keep polling until the deadline.
    }
    if (Date.now() >= deadline) throw new Error(`GET /settings never returned 200 within ${timeoutMs}ms`)
    await Bun.sleep(intervalMs)
  }
}

async function containerLogs(id: string, run: RunDocker): Promise<string> {
  const { stdout, stderr } = await run(['logs', id])
  return `${stdout}${stderr}`
}

export async function removeContainer(id: string, run: RunDocker = runDocker): Promise<void> {
  await run(['rm', '-f', id])
}

export async function stopContainerWithSigterm(
  id: string,
  run: RunDocker = runDocker,
): Promise<{ logs: string; exitCode: number }> {
  await run(['kill', '-s', 'SIGTERM', id])
  const deadline = Date.now() + 15_000
  for (;;) {
    const running = await run(['inspect', '-f', '{{.State.Running}}', id])
    if (running.stdout.trim() === 'false') break
    if (Date.now() >= deadline) throw new Error(`container ${id} did not stop within 15s of SIGTERM`)
    await Bun.sleep(250)
  }
  const exit = await run(['inspect', '-f', '{{.State.ExitCode}}', id])
  const logs = await containerLogs(id, run)
  return { logs, exitCode: Number(exit.stdout.trim()) }
}

export async function startPapaiContainer(opts: {
  env: Record<string, string>
  run?: RunDocker
  readyTimeoutMs?: number
}): Promise<PapaiContainer> {
  const run = opts.run ?? runDocker
  const started = await run(
    buildDockerRunArgs({
      image: PAPAI_E2E_IMAGE,
      env: opts.env,
      detached: true,
      publishContainerPort: DEBUG_DEFAULT_PORT,
      addHostGateway: true,
    }),
  )
  if (started.code !== 0) throw new Error(`docker run failed: ${started.stderr}`)
  const id = started.stdout.trim()
  const portResult = await run(['port', id, String(DEBUG_DEFAULT_PORT)])
  if (portResult.code !== 0) {
    await removeContainer(id, run)
    throw new Error(`docker port failed: ${portResult.stderr}`)
  }
  const webBaseUrl = `http://127.0.0.1:${parsePublishedPort(portResult.stdout)}`
  try {
    await waitForSettings(webBaseUrl, { timeoutMs: opts.readyTimeoutMs ?? 60_000 })
  } catch (error) {
    const logs = await containerLogs(id, run)
    await removeContainer(id, run)
    throw new Error(`papai container not ready: ${error instanceof Error ? error.message : String(error)}\n--- logs ---\n${logs}`)
  }
  log.info({ id, webBaseUrl }, 'papai container ready')
  return {
    id,
    webBaseUrl,
    stop: () => stopContainerWithSigterm(id, run),
    remove: () => removeContainer(id, run),
  }
}

export async function runPapaiContainerToExit(opts: {
  env: Record<string, string>
  run?: RunDocker
}): Promise<{ logs: string; exitCode: number }> {
  const run = opts.run ?? runDocker
  const result = await run(
    buildDockerRunArgs({ image: PAPAI_E2E_IMAGE, env: opts.env, detached: false, addHostGateway: true }),
  )
  return { logs: `${result.stdout}${result.stderr}`, exitCode: result.code }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/smoke/harness/container.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/smoke/harness/container.ts tests/smoke/harness/container.test.ts
git commit -m "test(smoke): papai container lifecycle harness"
```

---

### Task 6: `SMOKE_STORIES` candidate registry

The single source of truth for the eight `@2` scenario titles and their files. The scenario files (Tasks 7–8), the frozen catalog records (Task 10), and the crosscheck (Task 11) all consume these exact strings — so they are fixed here, once, verbatim.

**Files:**
- Create: `tests/smoke/scenarios/catalog.ts`
- Test: `tests/smoke/scenarios/catalog.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type SmokeStory = { scenarioId: string; title: string; file: string }`
  - `const SMOKE_STORIES` — a `Record` keyed by the eight scenario ids (values shown in the implementation below).
  - `smokeStoryId(story: SmokeStory): string` → `` `${story.file}#${story.title}` ``
  - `const SMOKE_STORY_IDS: Record<string, string>` — scenarioId → full story id.

- [ ] **Step 1: Write the failing test**

```ts
// tests/smoke/scenarios/catalog.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { SMOKE_STORIES, SMOKE_STORY_IDS, smokeStoryId } from './catalog.js'

describe('SMOKE_STORIES registry', () => {
  test('registers exactly eight @2 stories with well-formed, unique ids', () => {
    const entries = Object.entries(SMOKE_STORIES)
    expect(entries).toHaveLength(8)
    for (const [key, story] of entries) {
      expect(story.scenarioId).toBe(key)
      expect(story.file.startsWith('tests/smoke/')).toBe(true)
      expect(smokeStoryId(story)).toBe(`${story.file}#${story.title}`)
    }
    const ids = Object.values(SMOKE_STORY_IDS)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('maps each scenario to its owning container file', () => {
    expect(SMOKE_STORIES['SCN-boot-serve-empty-db'].file).toBe('tests/smoke/scenarios/container-p.smoke.ts')
    expect(SMOKE_STORIES['SCN-debug-surface-gated-on'].file).toBe('tests/smoke/scenarios/container-d.smoke.ts')
    expect(SMOKE_STORIES['SCN-required-env-admin'].file).toBe('tests/smoke/scenarios/container-e.smoke.ts')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/smoke/scenarios/catalog.test.ts`
Expected: FAIL — `Cannot find module './catalog.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// tests/smoke/scenarios/catalog.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type SmokeStory = { scenarioId: string; title: string; file: string }

const CONTAINER_P = 'tests/smoke/scenarios/container-p.smoke.ts'
const CONTAINER_D = 'tests/smoke/scenarios/container-d.smoke.ts'
const CONTAINER_E = 'tests/smoke/scenarios/container-e.smoke.ts'

export const SMOKE_STORIES = {
  'SCN-boot-serve-empty-db': {
    scenarioId: 'SCN-boot-serve-empty-db',
    title: 'boots, migrates an empty DB, and serves GET /settings with 200',
    file: CONTAINER_P,
  },
  'SCN-required-env-admin': {
    scenarioId: 'SCN-required-env-admin',
    title: 'exits 1 and logs the missing-required-env message when ADMIN_USER_ID is blank',
    file: CONTAINER_E,
  },
  'SCN-debug-surface-gated-off': {
    scenarioId: 'SCN-debug-surface-gated-off',
    title: 'returns 404 for GET /debug when DEBUG_SERVER is unset',
    file: CONTAINER_P,
  },
  'SCN-debug-surface-gated-on': {
    scenarioId: 'SCN-debug-surface-gated-on',
    title: 'returns 401 for GET /debug when DEBUG_SERVER is true',
    file: CONTAINER_D,
  },
  'SCN-protected-surfaces-bind': {
    scenarioId: 'SCN-protected-surfaces-bind',
    title: 'serves 401 for unauthenticated mcp, admin, and recurring surfaces',
    file: CONTAINER_P,
  },
  'SCN-plugin-registry-served': {
    scenarioId: 'SCN-plugin-registry-served',
    title: 'serves the shipped plugin set to an authenticated settings session',
    file: CONTAINER_P,
  },
  'SCN-chat-turn-tool-loop': {
    scenarioId: 'SCN-chat-turn-tool-loop',
    title: 'runs one full chat turn through the disclosure tool loop and posts a reply',
    file: CONTAINER_P,
  },
  'SCN-graceful-shutdown': {
    scenarioId: 'SCN-graceful-shutdown',
    title: 'drains and exits 0 on SIGTERM',
    file: CONTAINER_P,
  },
} as const satisfies Record<string, SmokeStory>

export function smokeStoryId(story: SmokeStory): string {
  return `${story.file}#${story.title}`
}

export const SMOKE_STORY_IDS: Record<string, string> = Object.fromEntries(
  Object.entries(SMOKE_STORIES).map(([scenarioId, story]) => [scenarioId, smokeStoryId(story)]),
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/smoke/scenarios/catalog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/smoke/scenarios/catalog.ts tests/smoke/scenarios/catalog.test.ts
git commit -m "test(smoke): SMOKE_STORIES candidate registry for the @2 lane"
```

---

### Task 7: Container P scenarios (1, 3, 5, 6, 7, 8)

Six behaviors against **one** valid-env boot with both fakes wired. This is the tier's heart: the readiness probe, the debug-off gate, the protected surfaces, the authenticated plugin registry (via the real `/config` link flow), the full disclosure chat turn, and — as teardown — the graceful-shutdown drain.

> **Integration test, not unit TDD.** These assertions describe the real container's behavior; they cannot be made to "fail first" against a stub. Step 2 runs them against Docker and expects PASS, or a visible SKIP when Docker is absent (never a silent green — the `describe.skipIf` marks the tests skipped).

**Files:**
- Create: `tests/smoke/scenarios/container-p.smoke.ts`

**Interfaces:**
- Consumes: `ensurePapaiE2eImage` (Task 2); `isDockerAvailable` (Task 1); `startPapaiContainer`, `buildContainerEnv`, `type PapaiContainer` (Task 5); `startFakeLlmServer`, `toolResponse`, `textResponse`, `type FakeLlmServer` (Task 3); `startFakeMattermostServer`, `type FakeMattermostServer` (Task 4); `SMOKE_STORIES` (Task 6).
- Produces: nothing importable (a runnable scenario module).

- [ ] **Step 1: Write the scenario file**

```ts
// tests/smoke/scenarios/container-p.smoke.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { buildContainerEnv, startPapaiContainer, type PapaiContainer } from '../harness/container.js'
import { isDockerAvailable } from '../harness/docker.js'
import { startFakeLlmServer, textResponse, toolResponse, type FakeLlmServer } from '../harness/fake-llm-server.js'
import { startFakeMattermostServer, type FakeMattermostServer } from '../harness/fake-mattermost-server.js'
import { ensurePapaiE2eImage } from '../harness/image.js'
import { SMOKE_STORIES } from './catalog.js'

const ADMIN_USER_ID = 'admin-user-1'
const SHIPPED_PLUGIN_IDS = ['acp', 'audio-transcribe', 'synthetic-web-search', 'task-provider-kaneo', 'task-provider-youtrack']

const title = (key: keyof typeof SMOKE_STORIES): string => SMOKE_STORIES[key].title

const DOCKER = await isDockerAvailable()
if (!DOCKER) console.warn('[smoke] Docker unavailable — skipping T2 container-P lane')

type Handle = { container: PapaiContainer; llm: FakeLlmServer; mm: FakeMattermostServer; stopped: boolean }
let handle: Handle | undefined

describe.skipIf(!DOCKER)('T2 container P — process-real smoke', () => {
  beforeAll(async () => {
    await ensurePapaiE2eImage()
    const llm = startFakeLlmServer()
    const mm = startFakeMattermostServer({ botUserId: 'bot-user-1', botUsername: 'smokebot' })
    const container = await startPapaiContainer({
      env: buildContainerEnv({ llmBaseUrl: llm.containerBaseUrl, mattermostUrl: mm.containerBaseUrl }),
      readyTimeoutMs: 90_000,
    })
    handle = { container, llm, mm, stopped: false }
  }, 180_000)

  afterAll(async () => {
    if (handle === undefined) return
    if (!handle.stopped) await handle.container.stop().catch(() => undefined)
    await handle.container.remove().catch(() => undefined)
    await handle.mm.stop()
    await handle.llm.stop()
  })

  test(title('SCN-boot-serve-empty-db'), async () => {
    const res = await fetch(`${handle!.container.webBaseUrl}/settings`)
    expect(res.status).toBe(200)
  })

  test(title('SCN-debug-surface-gated-off'), async () => {
    const res = await fetch(`${handle!.container.webBaseUrl}/debug`)
    expect(res.status).toBe(404)
  })

  test(title('SCN-protected-surfaces-bind'), async () => {
    for (const path of ['/mcp/status', '/admin/identity/mappings', '/recurring']) {
      const res = await fetch(`${handle!.container.webBaseUrl}${path}`)
      expect(res.status).toBe(401)
    }
  })

  test(title('SCN-plugin-registry-served'), async () => {
    await handle!.mm.whenConnected()
    const captured = handle!.mm.waitForPost()
    // /config only sets commandInput when the bot is @mentioned at index 0 (DM rule).
    handle!.mm.deliverMessage({ channelId: 'dm-config', message: `@${handle!.mm.botUsername} /config`, userId: ADMIN_USER_ID })
    const reply = await captured

    const codeMatch = /[?&]code=([^\s&]+)/.exec(reply.message)
    expect(codeMatch).not.toBeNull()
    const code = codeMatch![1]

    const exchange = await fetch(`${handle!.container.webBaseUrl}/settings/auth/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    expect(exchange.status).toBe(200)
    const cookieMatch = /papai_settings_session=[^;]+/.exec(exchange.headers.get('set-cookie') ?? '')
    expect(cookieMatch).not.toBeNull()

    const plugins = await fetch(`${handle!.container.webBaseUrl}/settings/api/plugins`, {
      headers: { cookie: cookieMatch![0] },
    })
    expect(plugins.status).toBe(200)
    const body = (await plugins.json()) as { plugins: Array<{ id: string }> }
    const ids = new Set(body.plugins.map((plugin) => plugin.id))
    for (const id of SHIPPED_PLUGIN_IDS) expect(ids.has(id)).toBe(true)
  }, 30_000)

  test(title('SCN-chat-turn-tool-loop'), async () => {
    await handle!.mm.whenConnected()
    handle!.llm.enqueue([
      toolResponse('call_load', 'load_tool', { names: ['list_memory'] }),
      toolResponse('call_list', 'list_memory', {}),
      textResponse('You have no saved memories yet.'),
    ])
    const captured = handle!.mm.waitForPost()
    handle!.mm.deliverMessage({ channelId: 'dm-chat', message: 'list my memories please', userId: ADMIN_USER_ID })
    const reply = await captured
    expect(reply.message).toContain('You have no saved memories yet.')
    expect(handle!.llm.requestCount()).toBe(3)
  }, 30_000)

  // Runs last: SIGTERM is both the graceful-shutdown assertion and container P's teardown.
  test(title('SCN-graceful-shutdown'), async () => {
    const { logs, exitCode } = await handle!.container.stop()
    handle!.stopped = true
    expect(logs).toContain('SIGTERM received, starting graceful shutdown...')
    expect(exitCode).toBe(0)
  }, 30_000)
})
```

- [ ] **Step 2: Run the scenarios against Docker**

Run: `bun test tests/smoke/scenarios/container-p.smoke.ts`
Expected: PASS (6 tests) when Docker is available; the first run builds `papai:e2e` (slower). Without Docker: all 6 report **skipped** with the `[smoke] Docker unavailable` warning — never silently green.

If a scenario fails, read the failure and the container logs the harness prints on a not-ready boot; fix the harness or the fake wire contract. Do **not** add a retry.

- [ ] **Step 3: Commit**

```bash
git add tests/smoke/scenarios/container-p.smoke.ts
git commit -m "test(smoke): container P scenarios — boot, gating, plugins, chat turn, shutdown"
```

---

### Task 8: Container D and E scenarios (4, 2)

The two remaining boots: D flips `DEBUG_SERVER=true` to prove the 404→401 gate delta; E blanks `ADMIN_USER_ID` to prove required-env validation fast-fails.

> **Integration test, not unit TDD** — same framing as Task 7.

**Files:**
- Create: `tests/smoke/scenarios/container-d.smoke.ts`
- Create: `tests/smoke/scenarios/container-e.smoke.ts`

**Interfaces:**
- Consumes: `ensurePapaiE2eImage` (Task 2); `isDockerAvailable` (Task 1); `startPapaiContainer`, `buildContainerEnv`, `runPapaiContainerToExit`, `type PapaiContainer` (Task 5); `startFakeLlmServer`, `type FakeLlmServer` (Task 3); `startFakeMattermostServer`, `type FakeMattermostServer` (Task 4); `SMOKE_STORIES` (Task 6).

- [ ] **Step 1: Write the container-D scenario file**

```ts
// tests/smoke/scenarios/container-d.smoke.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { buildContainerEnv, startPapaiContainer, type PapaiContainer } from '../harness/container.js'
import { isDockerAvailable } from '../harness/docker.js'
import { startFakeLlmServer, type FakeLlmServer } from '../harness/fake-llm-server.js'
import { startFakeMattermostServer, type FakeMattermostServer } from '../harness/fake-mattermost-server.js'
import { ensurePapaiE2eImage } from '../harness/image.js'
import { SMOKE_STORIES } from './catalog.js'

const title = (key: keyof typeof SMOKE_STORIES): string => SMOKE_STORIES[key].title

const DOCKER = await isDockerAvailable()
if (!DOCKER) console.warn('[smoke] Docker unavailable — skipping T2 container-D lane')

type Handle = { container: PapaiContainer; llm: FakeLlmServer; mm: FakeMattermostServer }
let handle: Handle | undefined

describe.skipIf(!DOCKER)('T2 container D — debug surface gated on', () => {
  beforeAll(async () => {
    await ensurePapaiE2eImage()
    const llm = startFakeLlmServer()
    const mm = startFakeMattermostServer({ botUserId: 'bot-user-1', botUsername: 'smokebot' })
    const container = await startPapaiContainer({
      env: buildContainerEnv({ llmBaseUrl: llm.containerBaseUrl, mattermostUrl: mm.containerBaseUrl }, { debugServer: true }),
      readyTimeoutMs: 90_000,
    })
    handle = { container, llm, mm }
  }, 180_000)

  afterAll(async () => {
    if (handle === undefined) return
    await handle.container.remove().catch(() => undefined)
    await handle.mm.stop()
    await handle.llm.stop()
  })

  test(title('SCN-debug-surface-gated-on'), async () => {
    const res = await fetch(`${handle!.container.webBaseUrl}/debug`)
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Write the container-E scenario file**

```ts
// tests/smoke/scenarios/container-e.smoke.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeAll, describe, expect, test } from 'bun:test'

import { buildContainerEnv, runPapaiContainerToExit } from '../harness/container.js'
import { isDockerAvailable } from '../harness/docker.js'
import { ensurePapaiE2eImage } from '../harness/image.js'
import { SMOKE_STORIES } from './catalog.js'

const title = (key: keyof typeof SMOKE_STORIES): string => SMOKE_STORIES[key].title

const DOCKER = await isDockerAvailable()
if (!DOCKER) console.warn('[smoke] Docker unavailable — skipping T2 container-E lane')

describe.skipIf(!DOCKER)('T2 container E — required-env validation', () => {
  beforeAll(async () => {
    await ensurePapaiE2eImage()
  }, 180_000)

  test(title('SCN-required-env-admin'), async () => {
    const { logs, exitCode } = await runPapaiContainerToExit({
      // E exits before reading MM/LLM env, so the fake URLs are placeholders it never dials.
      env: buildContainerEnv(
        { llmBaseUrl: 'http://host.docker.internal:1/v1', mattermostUrl: 'http://host.docker.internal:1' },
        { adminUserId: '' },
      ),
    })
    expect(logs).toContain('Missing required environment variables')
    expect(exitCode).toBe(1)
  }, 60_000)
})
```

- [ ] **Step 3: Run both scenario files against Docker**

Run: `bun test tests/smoke/scenarios/container-d.smoke.ts tests/smoke/scenarios/container-e.smoke.ts`
Expected: PASS (2 tests) with Docker; both **skipped** with the warning when Docker is absent.

- [ ] **Step 4: Commit**

```bash
git add tests/smoke/scenarios/container-d.smoke.ts tests/smoke/scenarios/container-e.smoke.ts
git commit -m "test(smoke): container D and E scenarios — debug gate and required-env fast-fail"
```

---

### Task 9: Lane aggregator + `test:smoke` script

A single entry point that registers all three container lanes in order, plus the `package.json` script the lane and CI run.

**Files:**
- Create: `tests/smoke/run-smoke.ts`
- Modify: `package.json` (scripts block, after `test:e2e:watch` at line 50)

**Interfaces:**
- Consumes: the three `.smoke.ts` scenario modules (Tasks 7–8) by side-effecting import.
- Produces: the runnable lane entry `bun test tests/smoke/run-smoke.ts`.

- [ ] **Step 1: Write the aggregator**

```ts
// tests/smoke/run-smoke.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Registers every T2 container lane in boot order. Run explicitly with
// `bun test tests/smoke/run-smoke.ts`; the `.smoke.ts` scenario files use a
// non-discovered suffix so the default `bun test` never runs this Docker lane.
import './scenarios/container-p.smoke.js'
import './scenarios/container-d.smoke.js'
import './scenarios/container-e.smoke.js'
```

- [ ] **Step 2: Add the `test:smoke` script**

Edit `package.json`, inserting the new line immediately after the `test:e2e:watch` entry:

```json
    "test:e2e:watch": "bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/e2e.test.ts --watch",
    "test:smoke": "bun test tests/smoke/run-smoke.ts",
```

- [ ] **Step 3: Verify the lane collects and the default suite excludes it**

Run: `bun run test:smoke`
Expected: collects 8 scenarios across three files (PASS with Docker; visibly **skipped** without Docker).

Run: `bun test tests/smoke`
Expected: runs only the `*.test.ts` unit tests under `tests/smoke/` (docker, image, fake-llm, fake-mattermost, container, catalog, crosscheck) — the `.smoke.ts` files are not discovered. Confirms the Docker lane is excluded from the default pattern.

- [ ] **Step 4: Commit**

```bash
git add tests/smoke/run-smoke.ts package.json
git commit -m "test(smoke): lane aggregator and test:smoke script"
```

---

### Task 10: `@2` catalog seam (the sole frozen-tree change)

Mint the eight `@2` records and open tier `'2'` as a live lane. This is the **only** permitted change under `tests/stories/`; it moves the `treeHash` once — the argued, recorded exception the ledger and T1 cycles established. The paired count assertions in the harness and totals tests update in the same task so the suite stays green.

**Files:**
- Modify: `tests/stories/catalog/coverage.ts` (frozen tree — metadata only)
- Modify: `tests/stories/harness/catalog-coverage.test.ts` (count assertions)
- Modify: `tests/scripts/story-coverage-totals.test.ts` (totals + format string)

**Interfaces:**
- Consumes: `SMOKE_STORY_IDS` values (Task 6) — the storyId strings must be byte-identical to the `${file}#${title}` values below.
- Produces: `catalogCoverage` now carries 8 executable records with `provingTier: '2'`; `LIVE_STORY_TIERS` includes `'2'`.

- [ ] **Step 1: Open tier `'2'` as live**

Edit `tests/stories/catalog/coverage.ts` line 16:

```ts
export const LIVE_STORY_TIERS: readonly StoryTier[] = Object.freeze(['0', '1', '2'])
```

- [ ] **Step 2: Extend `CATALOG_SOURCE` provenance**

Append to the `CATALOG_SOURCE` string literal (line 105–106) so it ends:

```ts
export const CATALOG_SOURCE =
  'scenario-catalog snapshot supplied 2026-07-13; extended 2026-07-23 with 12 SCN-parity-* provider-real (@1) ids (tier1-provider-real-parity); extended 2026-07-24 with 17 SCN-parity-* domain-retrofit (@1) ids (tier1b-e2e-parity-retrofit); extended 2026-07-24 with 8 SCN-* process-real smoke (@2) ids (tier2-process-smoke)' as const
```

- [ ] **Step 3: Add the eight `@2` scenario ids**

In `CATALOG_SCENARIO_IDS`, replace the final parity line + closer (lines 271–272):

```ts
  'SCN-parity-relation-multiple',
  // @2 — process-real smoke lane (tier2-process-smoke)
  'SCN-boot-serve-empty-db',
  'SCN-required-env-admin',
  'SCN-debug-surface-gated-off',
  'SCN-debug-surface-gated-on',
  'SCN-protected-surfaces-bind',
  'SCN-plugin-registry-served',
  'SCN-chat-turn-tool-loop',
  'SCN-graceful-shutdown',
] as const)
```

- [ ] **Step 4: Add the eight `@2` executable mappings**

In `EXECUTABLE_STORY_MAPPINGS`, replace the closing of the last `@1` entry so the eight `@2` entries land before the object's `}` (lines 1078–1085):

```ts
  'SCN-parity-relation-multiple': {
    verifiedAt: '2026-07-24',
    provingTier: '1',
    storyIds: [
      'tests/e2e/parity/provider-parity.test.ts#SCN-parity-relation-multiple: a task carries multiple distinct relations',
    ],
  },
  // @2 — process-real smoke lane (tier2-process-smoke); storyIds are byte-identical to SMOKE_STORY_IDS.
  'SCN-boot-serve-empty-db': {
    verifiedAt: '2026-07-24',
    provingTier: '2',
    storyIds: ['tests/smoke/scenarios/container-p.smoke.ts#boots, migrates an empty DB, and serves GET /settings with 200'],
  },
  'SCN-required-env-admin': {
    verifiedAt: '2026-07-24',
    provingTier: '2',
    storyIds: [
      'tests/smoke/scenarios/container-e.smoke.ts#exits 1 and logs the missing-required-env message when ADMIN_USER_ID is blank',
    ],
  },
  'SCN-debug-surface-gated-off': {
    verifiedAt: '2026-07-24',
    provingTier: '2',
    storyIds: ['tests/smoke/scenarios/container-p.smoke.ts#returns 404 for GET /debug when DEBUG_SERVER is unset'],
  },
  'SCN-debug-surface-gated-on': {
    verifiedAt: '2026-07-24',
    provingTier: '2',
    storyIds: ['tests/smoke/scenarios/container-d.smoke.ts#returns 401 for GET /debug when DEBUG_SERVER is true'],
  },
  'SCN-protected-surfaces-bind': {
    verifiedAt: '2026-07-24',
    provingTier: '2',
    storyIds: ['tests/smoke/scenarios/container-p.smoke.ts#serves 401 for unauthenticated mcp, admin, and recurring surfaces'],
  },
  'SCN-plugin-registry-served': {
    verifiedAt: '2026-07-24',
    provingTier: '2',
    storyIds: ['tests/smoke/scenarios/container-p.smoke.ts#serves the shipped plugin set to an authenticated settings session'],
  },
  'SCN-chat-turn-tool-loop': {
    verifiedAt: '2026-07-24',
    provingTier: '2',
    storyIds: ['tests/smoke/scenarios/container-p.smoke.ts#runs one full chat turn through the disclosure tool loop and posts a reply'],
  },
  'SCN-graceful-shutdown': {
    verifiedAt: '2026-07-24',
    provingTier: '2',
    storyIds: ['tests/smoke/scenarios/container-p.smoke.ts#drains and exits 0 on SIGTERM'],
  },
}
```

- [ ] **Step 5: Update the harness count assertions**

In `tests/stories/harness/catalog-coverage.test.ts`:

- Line 114: `expect(CATALOG_SCENARIO_IDS).toHaveLength(165)`
- Line 115: `expect(new Set(CATALOG_SCENARIO_IDS).size).toBe(165)`
- Line 216: `expect(catalogCoverage.filter((coverage) => coverage.kind === 'executable')).toHaveLength(138)`
- Line 225: `expect(executable).toHaveLength(138)`
- Line 227: `expect(new Set(executable.map((coverage) => coverage.provingTier))).toEqual(new Set(['0', '1', '2']))`

- [ ] **Step 6: Update the totals test**

In `tests/scripts/story-coverage-totals.test.ts`, replace the two expectations:

```ts
    expect(storyCoverageTotals()).toEqual({
      total: 165,
      executable: 138,
      pending: 27,
      readiness: { 'executable-as-is': 0, 'needs-seam': 5, blocked: 22 },
      executableByTier: { '0': 101, '1': 29, '2': 8, '3': 0, '4': 0 },
      pendingByUnblockingTier: { '0': 0, '1': 0, '2': 0, '3': 5, '4': 0 },
    })
```

```ts
    expect(formatStoryCoverageTotals()).toBe(
      'story catalog: 138/165 executable (T0 101, T1 29, T2 8, T3 0, T4 0); ' +
        'pending 27 (0 executable-as-is, 5 needs-seam, 22 blocked); ' +
        'pending unblocked by tier (T0 0, T1 0, T2 0, T3 5, T4 0)',
    )
```

- [ ] **Step 7: Run the catalog + totals suites**

Run: `bun test tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts`
Expected: PASS. Every `@2` record is confirmed executable, filed under `tests/smoke/`, and stamped tier `'2'`; the totals show `T2 8`.

- [ ] **Step 8: Commit (records the treeHash move)**

```bash
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts
git commit -m "feat(catalog): mint 8 @2 process-real smoke records; open tier 2 live

The catalog metadata change moves the frozen-tree treeHash once — the intended,
argued exception the tier-aware-ledger and T1 cycles established (rules 6/7).
No Tier 0 executable behavior changes."
```

---

### Task 11: Candidate-side `@2` crosscheck

The automated guard that ties each frozen `@2` catalog record to a real scenario invocation — the `@2` analogue of the `@1` parity-title crosscheck (which reads `PARITY_GROUPS`; `@2` has no frozen data source, so the candidate registry + file bytes are the source). It runs in the default `bun test` (no Docker).

**Files:**
- Create: `tests/smoke/catalog-crosscheck.test.ts`

**Interfaces:**
- Consumes: `catalogCoverage` from `../stories/catalog/coverage.js` (frozen, read-only); `SMOKE_STORIES`, `SMOKE_STORY_IDS` from `./scenarios/catalog.js` (Task 6); `repoRoot` from `./harness/docker.js` (Task 1).

- [ ] **Step 1: Write the crosscheck test**

```ts
// tests/smoke/catalog-crosscheck.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { catalogCoverage } from '../stories/catalog/coverage.js'
import { repoRoot } from './harness/docker.js'
import { SMOKE_STORIES, SMOKE_STORY_IDS } from './scenarios/catalog.js'

describe('@2 catalog crosscheck', () => {
  test('every @2 catalog record maps one-to-one to a SMOKE_STORIES id', () => {
    const executable = catalogCoverage.filter(
      (coverage): coverage is Extract<(typeof catalogCoverage)[number], { kind: 'executable' }> =>
        coverage.kind === 'executable',
    )
    const t2 = executable.filter((coverage) => coverage.provingTier === '2')

    expect(t2).toHaveLength(8)
    const byScenario = new Map(t2.map((coverage) => [coverage.scenarioId, coverage.storyIds]))
    for (const [scenarioId, storyId] of Object.entries(SMOKE_STORY_IDS)) {
      expect(byScenario.get(scenarioId)).toEqual([storyId])
    }
    // Reverse direction: no @2 catalog record lacks a candidate registry entry.
    for (const coverage of t2) expect(SMOKE_STORY_IDS[coverage.scenarioId]).toBeDefined()
  })

  test('each scenario file actually invokes its scenario id under that title', async () => {
    for (const story of Object.values(SMOKE_STORIES)) {
      const bytes = await Bun.file(`${repoRoot()}${story.file}`).text()
      expect(bytes.includes(`title('${story.scenarioId}')`)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run the crosscheck**

Run: `bun test tests/smoke/catalog-crosscheck.test.ts`
Expected: PASS (2 tests). Requires Task 10 (the `@2` records exist) and Tasks 7–8 (the scenario files exist and invoke `title('SCN-…')`). No Docker.

- [ ] **Step 3: Commit**

```bash
git add tests/smoke/catalog-crosscheck.test.ts
git commit -m "test(smoke): crosscheck @2 catalog records against scenario invocations"
```

---

### Task 12: CI gate job + measured budget

The PR gate. A new `smoke` job builds/loads `papai:e2e`, runs the lane, and enforces a **measured** wall-clock ceiling with a `timeout-minutes` guard (rule 5). No retries (rule 4). The whole lane is Docker-gated; CI provides Docker.

**Files:**
- Modify: `.github/workflows/ci.yml` (add a `smoke` job after the `e2e` job, before `mutation-testing` at line 171)

**Interfaces:**
- Consumes: the `test:smoke` script (Task 9); the production `Dockerfile` (self-contained build).

- [ ] **Step 1: Add the `smoke` job**

Insert this job between the `e2e` job (ends line 169) and `mutation-testing:` (line 171):

```yaml
  smoke:
    name: T2 Process-Real Smoke
    runs-on: ubuntu-latest
    # Backstop for a hung container or an unreachable host fake. The lane is two full
    # boots + one fast-fail; replace the value below only if the runaway guard proves
    # too tight after measurement (Step 2).
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: 1.3.13
      - name: Set up Docker
        uses: docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c # v4.2.0
        with:
          driver: docker
      - name: Install dependencies
        run: bun install
      - name: Build papai:e2e image
        run: docker build -t papai:e2e .
      - name: Run T2 smoke lane
        # Enforces the T2 measured wall-clock budget (Rule 5). The value below is the
        # measured lane time rounded up to ~2x headroom (see Step 2); it is a real
        # measurement, not a guess. host.docker.internal resolves via --add-host
        # (--add-host=host.docker.internal:host-gateway is set by the harness).
        timeout-minutes: 8
        run: bun run test:smoke
```

- [ ] **Step 2: Measure the budget and tighten the step ceiling**

The build step is excluded from the budget (it runs before the timed step). Measure only the lane:

Run: `time bun run test:smoke` (with `papai:e2e` already built and Docker available)
Expected: the eight scenarios pass across two boots + one fast-fail. Record the wall-clock. Set the `Run T2 smoke lane` step's `timeout-minutes` to roughly **2× the measured minutes, rounded up** (floor of 3). If the measured value implies a ceiling above 8, raise the `8` above and the job `timeout-minutes` accordingly; if well under, lower it. Write the measured number and the chosen ceiling into the PR description / ledger note (rule 5 requires the budget be stated).

- [ ] **Step 3: Validate the workflow file**

Run: `bun run lint` (oxlint ignores YAML; this confirms no repo-wide breakage) and visually confirm the YAML indentation matches the surrounding jobs. If `act` or a YAML linter is available locally, run it against `.github/workflows/ci.yml`.
Expected: no errors; the `smoke` job is a sibling of `e2e` and `mutation-testing`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add T2 process-real smoke gate job with measured budget"
```

---

## Self-Review

**1. Spec coverage.** Every spec element maps to a task:

| Spec element | Task |
| --- | --- |
| `papai:e2e` image build + build-if-absent | 2 (+ CI build in 12) |
| Container lifecycle harness (reuse `docker-lifecycle.ts` pattern) | 1, 5 |
| Readiness probe `GET /settings` → 200 | 5 (`waitForSettings`), scenario 1 in 7 |
| Deterministic OpenAI-compatible fake LLM (T3-reusable) | 3 |
| Minimal fake Mattermost HTTP+WS with handshake sequencing | 4 |
| `@2` catalog seam (`LIVE_STORY_TIERS` '2', suite-root, 8 records) | 10 |
| Scenario 1 `SCN-boot-serve-empty-db` | 7 |
| Scenario 2 `SCN-required-env-admin` | 8 (container E) |
| Scenario 3 `SCN-debug-surface-gated-off` | 7 |
| Scenario 4 `SCN-debug-surface-gated-on` | 8 (container D) |
| Scenario 5 `SCN-protected-surfaces-bind` | 7 |
| Scenario 6 `SCN-plugin-registry-served` (served registry via `/config` link) | 7 |
| Scenario 7 `SCN-chat-turn-tool-loop` (disclosure 2-step turn) | 7 |
| Scenario 8 `SCN-graceful-shutdown` (P teardown) | 7 |
| Container-reuse: P (1,3,5,6,7,8), D (4), E (2) | 7, 8 |
| Frozen-tree placement outside `tests/stories/` | Tasks 1–9, 11 under `tests/smoke/` |
| CI PR gate + measured budget + `timeout-minutes` | 12 |
| No retries; Docker-gated skip, never silently green | `describe.skipIf` (7, 8); no retry anywhere |
| Crosscheck tying records to real invocations | 11 |

**2. Placeholder scan.** No `TBD`/`TODO`/"add error handling"/"similar to Task N". The one measured value (CI step `timeout-minutes`) is a spec-mandated measurement with an explicit measure-and-set step (12.2), not a guess — the spec forbids guessing it.

**3. Type consistency.** Names verified across tasks: `RunDocker`/`runDocker`, `buildDockerRunArgs`, `parsePublishedPort`, `repoRoot` (Task 1) consumed unchanged in 2, 5, 11. `PAPAI_E2E_IMAGE` (2) used in 5. `FakeLlmServer`/`toolResponse`/`textResponse`/`enqueue`/`requestCount` (3) used in 7. `FakeMattermostServer`/`whenConnected`/`deliverMessage`/`waitForPost`/`botUsername` (4) used in 7, 8. `buildContainerEnv`/`startPapaiContainer`/`runPapaiContainerToExit`/`stopContainerWithSigterm`/`PapaiContainer` (5) used in 7, 8. `SMOKE_STORIES`/`SMOKE_STORY_IDS`/`smokeStoryId` (6) used in 7, 8, 10, 11. The eight storyId strings in Task 10 are byte-identical to `${file}#${title}` from Task 6. Catalog counts are internally consistent: 157→165 ids, 130→138 executable (101 T0 + 29 T1 + 8 T2), 27 pending unchanged.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-24-tier2-process-real-smoke.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
