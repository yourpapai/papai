<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# papai — Migration Phase 1 (Assign-the-bot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the papai-repo half of Phase 1 ("assign-the-bot" trigger) — Component 4 of
`docs/superpowers/specs/2026-07-12-migration-p1-assign-the-bot-design.md`: extend the existing `/nerv`
plugin command to parse a `bind <projectPath>` subcommand, admin-gate it, and call nerv's
`POST /projects/bind` with `{ projectPath, notifyContextId: auth.storageContextId }` so an operator can
bind the current chat channel to a nerv Project without hand-copying a scoped context id.

**Architecture:** All changes live inside the existing `plugins/nerv/` plugin, which — like every papai
plugin — cannot statically import anything under `src/` or a bare module (plugin discovery rejects
non-relative imports), so all typing against the real `PluginCommand`/`AuthorizationResult`/
`IncomingMessage` shapes stays structural (`unknown` + runtime type guards), mirroring the existing
`extractActivationContext` pattern in `plugins/nerv/index.ts`. The bind flow is extracted into a new
sibling module, `plugins/nerv/bind-command.ts`, exporting three small pure/near-pure pieces —
`commandArgOf` (pulls the argument text off the command message), `parseBindPath` (parses
`bind <projectPath>`), and `handleBindCommand` (the admin gate + nerv call + reply) — so the admin-gating
and error-surfacing logic is unit-testable without going through full plugin activation. `plugins/nerv/index.ts`'s
`nerv` command handler then does only two things: parse the subcommand, and either dispatch to
`handleBindCommand` or fall back to the existing static `NERV_COMMAND_TEXT` help reply. The admin gate
itself needs no new primitive: every plugin command handler already receives the real
`AuthorizationResult` as its third argument (`auth.isBotAdmin` / `auth.isGroupAdmin` / `auth.storageContextId`
— see `src/plugins/runtime-types.ts:107-111` `PluginCommand.execute` and `src/plugins/command-contributions.ts:20-26`
`registerPluginCommands`, which invokes `command.execute(message, reply, auth)` with the same `auth` the
core chat layer already computed for that turn). Per `src/commands/CLAUDE.md` ("Admin-only commands must
stay DM-only unless there is an explicit group-safe flow"), `/nerv bind` is exactly that explicit
group-safe flow — it must be callable _inside_ the target group so `auth.storageContextId` captures that
group's (possibly thread-scoped) context id, so the gate is `auth.isBotAdmin === true || auth.isGroupAdmin
=== true` with no `contextType`/DM restriction, matching the group-admin branch of `src/commands/clear.ts:56`.
The one piece of new plumbing is that `plugins/nerv/index.ts`'s `extractActivationContext` did not
previously expose `ctx.adminConfig` (only tools received an admin-config reader, via their own
per-execution `runtimeContext.adminConfig`); this plan adds `adminConfig` to `ActivationContext` so the
command closure can call the existing `readNervConfig`/`callNerv` helpers from `plugins/nerv/client.ts`
exactly like `plugins/nerv/tools.ts` already does for tools.

**Tech Stack:** Bun runtime + `bun:test`, Zod v4 (not used by this plan — plugin code cannot import it),
structural/duck-typed TS throughout the plugin boundary. Test command: `bun test <path>` from the papai
repo root.

**Repo:** `/Users/ki/Projects/yourpapai/papai`
**Cross-repo note:** Land the sibling nerv-repo plan for this same spec **first**. `/nerv bind` calls
`POST /projects/bind` on nerv (Component 4's nerv half); until that route exists, `/nerv bind` will only
ever surface a `nerv_error` reply (or a 404 depending on nerv's default route-not-found behavior) — the
command code in this plan degrades safely either way (see Task 1's `nerv 404` test), but the feature is
only end-to-end functional once nerv's route lands.

---

## File Structure

New:

- `plugins/nerv/bind-command.ts` — `commandArgOf(message)`, `parseBindPath(arg)`, `handleBindCommand(reply, auth, adminConfig, httpFetch, projectPath)`. The admin gate, `readNervConfig`/`callNerv` wiring, and reply text (success / non-admin / not-configured / 404-unknown-project / generic-error) all live here.
- `tests/plugins/nerv/bind-command.test.ts` — unit tests for the three exports above, using a local `capturingFetch` helper (same pattern as `tests/plugins/nerv/create-task.test.ts`).
- `tests/plugins/nerv/index.test.ts` — integration tests that exercise the real `nerv` `PluginCommand` end-to-end through `activate()` from `tests/plugins/nerv/support.ts`: bare `/nerv` still replies with the static help text; admin `/nerv bind <path>` posts the right body and replies success; non-admin is refused with no nerv call; nerv 404 surfaces an "unknown project" reply.

Modified:

- `plugins/nerv/index.ts` — `ActivationContext` gains `adminConfig: AdminConfigReader`; `extractActivationContext` validates and extracts `ctx.adminConfig`; the `nerv` command's `execute` now parses `bind <projectPath>` out of the message and either dispatches to `handleBindCommand` or falls back to the existing `NERV_COMMAND_TEXT` reply.
- `tests/plugins/nerv/support.ts` — `activate(httpFetch, adminConfig?)` gains an optional second parameter so tests can inject a nerv-configured (or unconfigured) `adminConfig` reader; default unchanged (`{ get: () => undefined }`), so every existing caller (`manifest.test.ts`, `who-may-use-nerv.test.ts` via its own harness, etc.) is unaffected.

---

### Task 1: `plugins/nerv/bind-command.ts` — parsing, admin gate, nerv call, reply text

**Files:**

- Create: `plugins/nerv/bind-command.ts`
- Test: `tests/plugins/nerv/bind-command.test.ts`

- [ ] **Step 1: Write the failing test.** Create `tests/plugins/nerv/bind-command.test.ts`:

  ```ts
  // SPDX-License-Identifier: BUSL-1.1
  // Copyright (c) 2026 Dmitriy Lazarev
  // Use of this software is governed by the Business Source License 1.1.
  // See LICENSE in the project root for details.

  import { expect, test } from 'bun:test'

  import { commandArgOf, handleBindCommand, parseBindPath } from '../../../plugins/nerv/bind-command.js'

  const admin = (m: Record<string, string>): { get(k: string): string | undefined } => ({
    get: (k: string): string | undefined => m[k],
  })

  const cfgMap = { nerv_base_url: 'http://nerv:9000', nerv_token: 'tok' }

  type Captured = { url: string; body: unknown }

  function parsedBody(init: RequestInit | undefined): unknown {
    const b = init?.body
    return typeof b === 'string' && b.length > 0 ? JSON.parse(b) : null
  }

  function capturingFetch(captured: Captured[], response: unknown, status = 200) {
    return (url: string, init?: RequestInit): Promise<Response> => {
      captured.push({ url, body: parsedBody(init) })
      return Promise.resolve(
        new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } }),
      )
    }
  }

  test('commandArgOf trims commandMatch, empty when missing', () => {
    expect(commandArgOf({ commandMatch: '  bind foo/bar  ' })).toBe('bind foo/bar')
    expect(commandArgOf({})).toBe('')
    expect(commandArgOf(null)).toBe('')
  })

  test('parseBindPath extracts the path, null otherwise', () => {
    expect(parseBindPath('bind foo/bar')).toBe('foo/bar')
    expect(parseBindPath('bind')).toBeNull()
    expect(parseBindPath('')).toBeNull()
    expect(parseBindPath('projects')).toBeNull()
  })

  test('non-admin is refused and nerv is never called', async () => {
    const calls: string[] = []
    const httpFetch = (url: string): Promise<Response> => {
      calls.push(url)
      return Promise.resolve(new Response('{}', { status: 200 }))
    }
    const texts: string[] = []
    const reply = { text: (s: string): void => void texts.push(s) }
    await handleBindCommand(reply, { isBotAdmin: false, isGroupAdmin: false }, admin(cfgMap), httpFetch, 'acme/demo')
    expect(calls).toHaveLength(0)
    expect(texts.join('\n')).toMatch(/admin/iu)
  })

  test('admin bind posts the right body and replies success', async () => {
    const captured: Captured[] = []
    const texts: string[] = []
    const reply = { text: (s: string): void => void texts.push(s) }
    await handleBindCommand(
      reply,
      { isBotAdmin: true, isGroupAdmin: false, storageContextId: 'pi:aW5zdA:ctx:Y2hhbg:thread:dDE' },
      admin(cfgMap),
      capturingFetch(captured, { ok: true }),
      'acme/demo',
    )
    expect(captured).toEqual([
      {
        url: 'http://nerv:9000/projects/bind',
        body: { projectPath: 'acme/demo', notifyContextId: 'pi:aW5zdA:ctx:Y2hhbg:thread:dDE' },
      },
    ])
    expect(texts.join('\n')).toMatch(/bound.*acme\/demo/iu)
  })

  test('nerv 404 (unknown project) surfaces an error reply, not a crash', async () => {
    const httpFetch = (): Promise<Response> => Promise.resolve(new Response('{"error":"not_found"}', { status: 404 }))
    const texts: string[] = []
    const reply = { text: (s: string): void => void texts.push(s) }
    await handleBindCommand(
      reply,
      { isBotAdmin: true, isGroupAdmin: false, storageContextId: 'ctx1' },
      admin(cfgMap),
      httpFetch,
      'unknown/repo',
    )
    expect(texts.join('\n')).toMatch(/unknown nerv project/iu)
  })

  test('not configured (missing nerv admin config) is surfaced instead of throwing', async () => {
    const texts: string[] = []
    const reply = { text: (s: string): void => void texts.push(s) }
    await handleBindCommand(reply, { isBotAdmin: true, storageContextId: 'ctx1' }, admin({}), undefined, 'acme/demo')
    expect(texts.join('\n')).toMatch(/not configured/iu)
  })
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `bun test tests/plugins/nerv/bind-command.test.ts`
  Expected: fails to resolve — `error: Cannot find module '../../../plugins/nerv/bind-command.js'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation.** Create `plugins/nerv/bind-command.ts`:

  ```ts
  // SPDX-License-Identifier: BUSL-1.1
  // Copyright (c) 2026 Dmitriy Lazarev
  // Use of this software is governed by the Business Source License 1.1.
  // See LICENSE in the project root for details.

  import { callNerv, NOT_CONFIGURED, readNervConfig } from './client.js'
  import type { AdminConfigReader, HttpFetch } from './client.js'

  type Reply = { text(s: string): Promise<void> | void }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }

  function isAdminAuth(auth: unknown): boolean {
    return isRecord(auth) && (auth['isBotAdmin'] === true || auth['isGroupAdmin'] === true)
  }

  function storageContextIdOf(auth: unknown): string | null {
    if (!isRecord(auth)) return null
    const v = auth['storageContextId']
    return typeof v === 'string' && v.length > 0 ? v : null
  }

  /** Extracts the command's argument text (e.g. `bind foo/bar`) from a plugin command message. */
  export function commandArgOf(message: unknown): string {
    if (!isRecord(message)) return ''
    const v = message['commandMatch']
    return typeof v === 'string' ? v.trim() : ''
  }

  /** Parses `bind <projectPath>` from a command argument string; null when it doesn't match. */
  export function parseBindPath(arg: string): string | null {
    const match = /^bind\s+(\S+)$/u.exec(arg)
    return match?.[1] ?? null
  }

  /** Runs the admin-gated `/nerv bind <projectPath>` flow and replies with the outcome. */
  export async function handleBindCommand(
    reply: Reply,
    auth: unknown,
    adminConfig: AdminConfigReader,
    httpFetch: HttpFetch | undefined,
    projectPath: string,
  ): Promise<void> {
    if (!isAdminAuth(auth)) {
      await reply.text('Only bot or group admins can bind this channel to a nerv project.')
      return
    }
    const storageContextId = storageContextIdOf(auth)
    if (storageContextId === null) {
      await reply.text('Could not determine this conversation’s context id.')
      return
    }
    const cfg = readNervConfig(adminConfig)
    if (cfg === null || httpFetch === undefined) {
      await reply.text(NOT_CONFIGURED.message)
      return
    }
    const result = await callNerv(httpFetch, cfg, 'POST', '/projects/bind', {
      projectPath,
      notifyContextId: storageContextId,
    })
    if (isRecord(result) && result['error'] === 'nerv_error') {
      if (result['status'] === 404) {
        await reply.text(`Unknown nerv project: \`${projectPath}\`. Check the path and try again.`)
        return
      }
      await reply.text(`Failed to bind \`${projectPath}\`: nerv returned an error.`)
      return
    }
    await reply.text(`Bound \`${projectPath}\` → this channel.`)
  }
  ```

- [ ] **Step 4: Run the test to verify it passes.**

  Run: `bun test tests/plugins/nerv/bind-command.test.ts`
  Expected:

  ```
  6 pass
  0 fail
  ```

- [ ] **Step 5: Lint and typecheck.**

  Run: `bun run lint plugins/nerv/bind-command.ts tests/plugins/nerv/bind-command.test.ts` (or `bun run lint` for the whole repo) and `bun typecheck`
  Expected: `Found 0 warnings and 0 errors.` and `tsgo --noEmit` exits with no output.

- [ ] **Step 6: Commit.**

  ```bash
  git add plugins/nerv/bind-command.ts tests/plugins/nerv/bind-command.test.ts
  git commit -m "feat(nerv): add admin-gated bind-command handler for /nerv bind"
  ```

---

### Task 2: Wire `bind` into the `/nerv` command + admin-config plumbing

**Files:**

- Modify: `plugins/nerv/index.ts`
- Modify: `tests/plugins/nerv/support.ts`
- Create: `tests/plugins/nerv/index.test.ts`

- [ ] **Step 1: Write the failing integration test.** Create `tests/plugins/nerv/index.test.ts`:

  ```ts
  // SPDX-License-Identifier: BUSL-1.1
  // Copyright (c) 2026 Dmitriy Lazarev
  // Use of this software is governed by the Business Source License 1.1.
  // See LICENSE in the project root for details.

  import { describe, expect, test } from 'bun:test'

  import { createAuth, createGroupMessage, createMockReply } from '../../utils/test-helpers.js'
  import { activate } from './support.js'

  const NERV_CFG: Record<string, string> = { nerv_base_url: 'http://nerv:9000', nerv_token: 'tok' }
  const nervAdminConfig = { get: (k: string): string | undefined => NERV_CFG[k] }

  type Captured = { url: string; body: unknown }

  function parsedBody(init: RequestInit | undefined): unknown {
    const b = init?.body
    return typeof b === 'string' && b.length > 0 ? JSON.parse(b) : null
  }

  function capturingFetch(captured: Captured[], response: unknown, status = 200) {
    return (url: string, init?: RequestInit): Promise<Response> => {
      captured.push({ url, body: parsedBody(init) })
      return Promise.resolve(
        new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } }),
      )
    }
  }

  describe('/nerv command', () => {
    test('bare /nerv still returns the static help text', async () => {
      const { command } = activate(() => Promise.resolve(new Response('{}', { status: 200 })))
      const msg = createGroupMessage('u1', '/nerv', false, 'g1')
      msg.commandMatch = ''
      const { reply, textCalls } = createMockReply()
      const auth = createAuth('u1', { allowed: true })
      await command!.execute(msg, reply, auth)
      expect(textCalls.join('\n')).toMatch(/supervised coding tasks/iu)
    })

    test('admin /nerv bind <projectPath> posts to nerv with storageContextId and replies success', async () => {
      const captured: Captured[] = []
      const { command } = activate(capturingFetch(captured, { ok: true }), nervAdminConfig)
      const msg = createGroupMessage('u1', '/nerv bind acme/demo', true, 'g1')
      msg.commandMatch = 'bind acme/demo'
      const { reply, textCalls } = createMockReply()
      const auth = createAuth('g1', { allowed: true, isGroupAdmin: true })
      await command!.execute(msg, reply, auth)
      expect(captured).toEqual([
        { url: 'http://nerv:9000/projects/bind', body: { projectPath: 'acme/demo', notifyContextId: 'g1' } },
      ])
      expect(textCalls.join('\n')).toMatch(/bound.*acme\/demo/iu)
    })

    test('non-admin /nerv bind is refused and never calls nerv', async () => {
      const calls: string[] = []
      const httpFetch = (url: string): Promise<Response> => {
        calls.push(url)
        return Promise.resolve(new Response('{}', { status: 200 }))
      }
      const { command } = activate(httpFetch, nervAdminConfig)
      const msg = createGroupMessage('u1', '/nerv bind acme/demo', false, 'g1')
      msg.commandMatch = 'bind acme/demo'
      const { reply, textCalls } = createMockReply()
      const auth = createAuth('g1', { allowed: true, isBotAdmin: false, isGroupAdmin: false })
      await command!.execute(msg, reply, auth)
      expect(calls).toHaveLength(0)
      expect(textCalls.join('\n')).toMatch(/admin/iu)
    })

    test('nerv 404 on bind surfaces an unknown-project error', async () => {
      const httpFetch = (): Promise<Response> => Promise.resolve(new Response('{}', { status: 404 }))
      const { command } = activate(httpFetch, nervAdminConfig)
      const msg = createGroupMessage('u1', '/nerv bind ghost/repo', true, 'g1')
      msg.commandMatch = 'bind ghost/repo'
      const { reply, textCalls } = createMockReply()
      const auth = createAuth('g1', { allowed: true, isBotAdmin: true })
      await command!.execute(msg, reply, auth)
      expect(textCalls.join('\n')).toMatch(/unknown nerv project/iu)
    })
  })
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `bun test tests/plugins/nerv/index.test.ts`
  Expected: the `activate(httpFetch, nervAdminConfig)` calls fail to typecheck/run — `activate` currently
  only accepts one parameter (`support.ts` hasn't been extended yet) — or, once `support.ts` is patched in
  Step 3 first (see note below), the `bind` tests fail because `plugins/nerv/index.ts` doesn't parse
  `bind` yet and every bind test instead gets back `NERV_COMMAND_TEXT` (asserts fail: `expect(...).toMatch(/bound.*acme\/demo/iu)` etc. do not match the help text).

  Note: because `activate()`'s signature must change for this test file to even compile, do Step 3
  (harness change) immediately, then re-run to confirm the _behavioral_ red (help text instead of a bind
  reply) before writing Step 4's implementation.

- [ ] **Step 3: Extend the test harness.** In `tests/plugins/nerv/support.ts`, change the `activate`
      export to accept an optional `adminConfig` override (defaulting to the existing always-`undefined`
      stub) and thread it onto the fake `ctx`:

  ```ts
  export function activate(
    httpFetch: HttpFetch,
    adminConfig?: { get(key: string): string | undefined },
  ): ActivateResult {
  ```

  and change the last line of the fake `ctx` object literal from:

  ```ts
    adminConfig: { get: () => undefined },
  ```

  to:

  ```ts
    adminConfig: adminConfig ?? { get: (): undefined => undefined },
  ```

  (The explicit `(): undefined =>` return type is required — oxlint's `explicit-function-return-type`
  rule flags the bare arrow here, unlike the same-shaped `kv.get: () => undefined` a few lines above,
  because this one sits inside a `??` fallback expression rather than a bare object-literal property.)

  Run: `bun test tests/plugins/nerv/index.test.ts`
  Expected: now compiles and runs; the two `bind` tests fail on the reply-text assertions (they get
  `NERV_COMMAND_TEXT` back, not a bind reply), and `bare /nerv` already passes.

- [ ] **Step 4: Wire the command.** In `plugins/nerv/index.ts`, add the import and extend
      `ActivationContext`/`extractActivationContext`:

  ```ts
  import { commandArgOf, handleBindCommand, parseBindPath } from './bind-command.js'
  import type { AdminConfigReader, HttpFetch } from './client.js'
  ```

  (replaces the existing `import type { HttpFetch } from './client.js'` line)

  ```ts
  type ActivationContext = {
    registerTool: RegisterTool
    registerFragment: RegisterFragment
    registerCommand: RegisterCommand
    logInfo: LogInfo
    httpFetch: HttpFetch | undefined
    adminConfig: AdminConfigReader
  }
  ```

  Add a guard next to the existing `isHttpFetch`:

  ```ts
  function isAdminConfig(value: unknown): value is AdminConfigReader {
    return isRecord(value) && typeof value['get'] === 'function'
  }
  ```

  In `extractActivationContext`, add the check and extraction (right after the existing
  `isRegisterCommand` check/before the `httpFetch` block):

  ```ts
  if (!isRegisterCommand(registration['registerCommand'])) throw new Error('nerv: registerCommand must be a function')
  if (!isAdminConfig(context['adminConfig'])) throw new Error('nerv: adminConfig must be an object with get()')

  const logInfo = log['info']
  const registerTool = registration['registerTool']
  const registerFragment = registration['registerPromptFragment']
  const registerCommand = registration['registerCommand']
  const adminConfig = context['adminConfig']

  let httpFetch: HttpFetch | undefined
  if (isRecord(providerRuntime) && isHttpFetch(providerRuntime['httpFetch'])) {
    httpFetch = providerRuntime['httpFetch']
  }

  return { registerTool, registerFragment, registerCommand, logInfo, httpFetch, adminConfig }
  ```

  Finally, replace the `nerv` command registration's `execute`:

  ```ts
  ctx.registerCommand({
    name: 'nerv',
    description: 'About nerv supervised coding tasks',
    execute: async (
      message: unknown,
      reply: { text(s: string): Promise<void> | void },
      auth: unknown,
    ): Promise<void> => {
      const bindPath = parseBindPath(commandArgOf(message))
      if (bindPath !== null) {
        await handleBindCommand(reply, auth, ctx.adminConfig, ctx.httpFetch, bindPath)
        return
      }
      await reply.text(NERV_COMMAND_TEXT)
    },
  })
  ```

- [ ] **Step 5: Run the tests to verify they pass.**

  Run: `bun test tests/plugins/nerv/`
  Expected:

  ```
  51 pass
  0 fail
  ```

  (this is every test file under `tests/plugins/nerv/`, confirming `manifest.test.ts` — which asserts the
  registered command's name is still exactly `'nerv'` — and `who-may-use-nerv.test.ts` are both still green
  alongside the two new files from Task 1 and this task)

- [ ] **Step 6: Lint and typecheck.**

  Run: `bun run lint plugins/nerv/index.ts tests/plugins/nerv/support.ts tests/plugins/nerv/index.test.ts` and `bun typecheck`
  Expected: `Found 0 warnings and 0 errors.` and `tsgo --noEmit` exits with no output.

- [ ] **Step 7: Commit.**

  ```bash
  git add plugins/nerv/index.ts tests/plugins/nerv/support.ts tests/plugins/nerv/index.test.ts
  git commit -m "feat(nerv): wire /nerv bind <projectPath> into the nerv command"
  ```

---

## Verification checklist (spec → task mapping)

- `/nerv bind <projectPath>` parses the subcommand, keeps bare `/nerv` help intact → Task 2.
- Admin-gated (bot-admin or group-admin), refuses non-admins with no nerv call → Task 1 (`handleBindCommand`) + Task 2 (integration).
- Reads `auth.storageContextId`, calls `callNerv('POST', '/projects/bind', { projectPath, notifyContextId })` → Task 1 + Task 2.
- Replies "bound `<projectPath>` → this channel" on success, surfaces a 404/error → Task 1 (`handleBindCommand`'s reply branches) + Task 2 (integration).
