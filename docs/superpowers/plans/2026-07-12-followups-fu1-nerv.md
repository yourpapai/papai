<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# nerv — FU1 (MCP Wire Alignment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align nerv's outbound MCP wire shape to magi's contract so a task with MCP configured actually starts. Today nerv sends `projectSpec.mcp` as a single object and a singular `mcpToken: string` on `startSession`/`followUp`/`resumeSession`; magi requires `projectSpec.mcp: McpUpstream[]` (array, each entry carrying a stable `id`) and a top-level `mcpTokens: Record<string,string>` keyed by that `id`. The mismatch means `resolveMcp` throws `projectSpec.mcp must be an array` and magi 400s on session start for any task with MCP configured — currently invisible because no `Project` has `mcp` populated yet.

**Architecture:** Introduce one stable, fixed `id` constant (`MCP_GATEWAY_ID = 'gateway'`) for nerv's single MCP gateway upstream, used both as the sole `McpUpstream.id` in the array and as the sole key of the `mcpTokens` record — so the two always agree. `MagiClient`'s wire types change: a new `McpUpstream` interface (existing `MagiMcpSpec` + `id`) replaces the array-element shape; `StartSessionInput`/`followUp`/`resumeSession` swap singular `mcpToken` for `mcpTokens: Record<string,string>`. `magiCredentials.ts` splits `MagiCredentials` into an input shape `MagiCredentialDefaults` (singular `mcpToken?`, matches `Project.mcpToken`/`MagiProjectDefaults.mcpToken`, unchanged in the DB) and an output shape `MagiCredentials` (plural `mcpTokens?: Record<string,string>`, ready to spread into a magi request); `resolveMagiCredentials` wraps the single resolved token into a one-entry record keyed by `MCP_GATEWAY_ID`, or omits `mcpTokens` entirely when there's no token. `SupervisorService.startTask` wraps its single MCP descriptor into a one-element `McpUpstream[]` array at spec-build time (the `id` is synthesized, never persisted). No `Project` schema change, no multi-upstream support, no magi changes.

**Tech Stack:** Node/TypeScript, Vitest (`npx vitest run <path>` from the nerv repo root), `tsc --noEmit` via `npm run type-check`.

**Repo:** /Users/ki/Projects/yourpapai/nerv

**Cross-repo note:** This is Component A of `docs/superpowers/specs/2026-07-12-followups-fu1-mcp-wire-alignment-design.md` (in the `papai` repo). Component B (a one-line `upstream.body?.cancel()` fix in `papai/src/debug/transcript-viewer.ts`) has its own plan, `docs/superpowers/plans/2026-07-12-followups-fu1-papai.md`. The two components are independent — neither depends on the other, and they may land in either order. No `magi` repo changes are needed anywhere in this plan; magi's contract (`McpUpstream[]` + `mcpTokens`) is already correct and is read-only reference material here.

---

## File Structure

Modified:

- `src/services/MagiClient.ts` — new `McpUpstream` interface (`MagiMcpSpec` + `id`); `MagiProjectSpec.mcp` becomes `McpUpstream[]`; `StartSessionInput.mcpToken` → `mcpTokens: Record<string,string>`; `followUp`/`resumeSession` opts swap `mcpToken` → `mcpTokens`.
- `src/supervisor/magiCredentials.ts` — new `MCP_GATEWAY_ID` constant; `MagiCredentials` split into `MagiCredentialDefaults` (input, singular `mcpToken?`) and `MagiCredentials` (output, plural `mcpTokens?`); `resolveMagiCredentials` rewritten to build the one-entry record.
- `src/supervisor/worker.ts` — `WorkerDeps.magiDefaults` type: `MagiCredentials` → `MagiCredentialDefaults` (it holds the raw config-level defaults, not resolved credentials).
- `src/supervisor/handlers.ts` — `HandlerCtx.magiDefaults` type: same rename as `worker.ts`.
- `src/supervisor/SupervisorService.ts` — builds `projectSpec.mcp` as a one-element `McpUpstream[]` (`[{ id: MCP_GATEWAY_ID, ...mcpDescriptor }]`) and `mcpTokens: { [MCP_GATEWAY_ID]: token }` instead of the singular object/string.
- `tests/services/MagiClient.test.ts` — existing follow-up credentials test renamed field `mcpToken` → `mcpTokens`; new contract test asserting the one-element array + matching `mcpTokens` key.
- `tests/supervisor/foundationHandlers.test.ts` — `chat_instruction handler` test updated for the new resolved-credentials shape; `SupervisorService.startTask` tests updated (existing "forwards ... mcpToken ..." and "omits projectSpec.mcp ..." tests) plus a new "sends neither mcp nor mcpTokens for a Project without MCP configured" contract test.

New:

- `tests/supervisor/magiCredentials.test.ts` — unit tests for `resolveMagiCredentials`'s new token-wrapping behavior (no existing test file covers `magiCredentials.ts` directly today).

No `Project` schema change (`src/db/models/Project.ts` untouched), no `src/config.ts` change, no `magi` repo change.

---

### Task 1: `MagiClient` wire shape — `McpUpstream[]` + `mcpTokens`

**Files:**

- Modify: `src/services/MagiClient.ts:8-53,90-123`
- Test: `tests/services/MagiClient.test.ts`

- [ ] **Step 1: Write the failing tests**

  In `tests/services/MagiClient.test.ts`, first change the existing "forwards forgeToken/mcpToken/secrets on the follow-up body" test to use the new plural field (this test currently passes `mcpToken: 'mcp-tok'` — change both the `followUp` call opts and the body assertion):

  ```ts
  it('forwards forgeToken/mcpToken/secrets on the follow-up body when supplied (magi does not inherit them across turns)', async () => {
    const f = fakeFetch(200, { ok: true })
    const client = new MagiClient(cfg, f)
    await client.followUp('sess-1', 'fix it', {
      forgeToken: 'forge-tok',
      mcpTokens: { gateway: 'mcp-tok' },
      secrets: { ANTHROPIC_API_KEY: 'sk-1' },
    })
    const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      prompt: 'fix it',
      forgeToken: 'forge-tok',
      mcpTokens: { gateway: 'mcp-tok' },
      secrets: { ANTHROPIC_API_KEY: 'sk-1' },
    })
  })
  ```

  Then add a new contract test right after the first test (`'starts a session and returns parsed body'`, currently ending at line 41) and before the follow-up-path test:

  ```ts
  it('sends projectSpec.mcp as a one-element McpUpstream[] array and mcpTokens keyed by the same id (magi contract)', async () => {
    const f = fakeFetch(200, { id: 'sess-2', status: 'queued' })
    const client = new MagiClient(cfg, f)
    await client.startSession({
      contextId: 'c1',
      prompt: 'do X',
      projectSpec: {
        name: 'g/r',
        repoUrl: 'https://example.com/g/r',
        baseBranch: 'main',
        permissionPreset: 'cautious',
        agent: 'claude',
        mcp: [
          {
            id: 'gateway',
            url: 'https://gw.example.com',
            host: 'gw.example.com',
            header: 'X-Mcp-Auth',
            allowedHosts: ['gw.example.com'],
          },
        ],
      },
      mcpTokens: { gateway: 'mcp-tok' },
    })
    const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string) as {
      projectSpec: { mcp: Array<{ id: string }> }
      mcpTokens: Record<string, string>
    }
    expect(Array.isArray(body.projectSpec.mcp)).toBe(true)
    expect(body.projectSpec.mcp).toHaveLength(1)
    const [upstream] = body.projectSpec.mcp
    expect(Object.keys(body.mcpTokens)).toEqual([upstream.id])
    expect(body).toMatchObject({
      projectSpec: {
        mcp: [
          {
            id: 'gateway',
            url: 'https://gw.example.com',
            host: 'gw.example.com',
            header: 'X-Mcp-Auth',
            allowedHosts: ['gw.example.com'],
          },
        ],
      },
      mcpTokens: { gateway: 'mcp-tok' },
    })
  })
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `npx vitest run tests/services/MagiClient.test.ts`

  Expected: FAIL — both edited/new tests fail to type-check and run, because `StartSessionInput` has no `mcpTokens` field yet (only `mcpToken?: string`) and `MagiProjectSpec.mcp` is typed as a single `MagiMcpSpec`, not an array:

  ```
  error TS2353: Object literal may only specify known properties, and 'mcpTokens' does not exist in type '{ forgeToken?: string; mcpToken?: string; secrets?: Record<string, string>; }'.
  error TS2322: Type '{ id: string; url: string; ... }[]' is not assignable to type 'MagiMcpSpec'.
  ```

- [ ] **Step 3: Write minimal implementation**

  In `src/services/MagiClient.ts`, add the `McpUpstream` interface right after `MagiMcpSpec` (after line 26):

  ```ts
  /**
   * Wire-level MCP upstream entry magi validates in `projectSpec.mcp[]`
   * (magi/src/project/config.ts#McpUpstream, magi/src/project/spec-validation.ts#resolveMcpEntry).
   * Same fields as MagiMcpSpec plus a stable `id` — the ACP McpServer.name / tunnel tag / mediator
   * routing key, and the key nerv's `mcpTokens` record uses to supply this upstream's token.
   */
  export interface McpUpstream extends MagiMcpSpec {
    id: string
  }
  ```

  Change `MagiProjectSpec.mcp` (currently `mcp?: MagiMcpSpec` at line 41) to the array shape:

  ```ts
  /** magi's projectSpec envelope (magi/src/project/spec-validation.ts#validateRepoSpec). */
  export interface MagiProjectSpec {
    name: string
    repoUrl: string
    baseBranch: string
    permissionPreset: string
    agent: string
    forge?: { kind: 'github' | 'gitlab'; apiBaseUrl: string }
    /** Model selector string magi applies (magi/src/project/spec-validation.ts#parseModel). */
    model?: string
    /** Egress host for the provider (magi/src/project/config.ts#ProjectSpec.providerHost). */
    providerHost?: string
    /** MCP gateway upstreams; nerv sends exactly one. Each id requires a matching entry in top-level `mcpTokens`. */
    mcp?: McpUpstream[]
  }
  ```

  Change `StartSessionInput.mcpToken` (currently `mcpToken?: string` at line 51) to `mcpTokens`:

  ```ts
  /** Body of magi's `POST /sessions` (magi/src/server/router.ts#handleStart). */
  export interface StartSessionInput {
    contextId: string
    prompt: string
    projectSpec: MagiProjectSpec
    secrets?: Record<string, string>
    forgeToken?: string
    /** Keyed by McpUpstream.id; magi throws if an upstream in projectSpec.mcp has no matching entry. */
    mcpTokens?: Record<string, string>
    prNumber?: number
  }
  ```

  Change `followUp` (currently lines 90-103):

  ```ts
  /**
   * `POST /sessions/:id/follow-up` (magi/src/server/router.ts#handleFollowUp). magi does not
   * inherit the parent session's forgeToken/mcpTokens/secrets across turns, so every follow-up
   * that expects magi to push/comment/use provider secrets must resupply them here — same
   * top-level field names as `startSession`'s `StartSessionInput`.
   */
  followUp(
    sessionId: string,
    prompt: string,
    opts?: { forgeToken?: string; mcpTokens?: Record<string, string>; secrets?: Record<string, string> },
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.call('POST', `/sessions/${sessionId}/follow-up`, {
      prompt,
      ...(opts?.secrets !== undefined ? { secrets: opts.secrets } : {}),
      ...(opts?.forgeToken !== undefined ? { forgeToken: opts.forgeToken } : {}),
      ...(opts?.mcpTokens !== undefined ? { mcpTokens: opts.mcpTokens } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    })
  }
  ```

  Change `resumeSession` (currently lines 105-123):

  ```ts
  /**
   * `POST /sessions/:id/resume` (magi/src/server/router.ts#handleResume) — resumes an
   * `interrupted` session onto a fresh worktree/container on its original branch. Mirrors
   * `followUp`'s credential-resupply contract (magi does not inherit forgeToken/mcpTokens/secrets
   * across turns) but takes no `prompt`: magi drives a standard "continue the interrupted work"
   * continuation via ACP `session/load`. Returns the new child session (same shape as `startSession`).
   */
  async resumeSession(
    sessionId: string,
    opts?: { forgeToken?: string; mcpTokens?: Record<string, string>; secrets?: Record<string, string> },
    idempotencyKey?: string,
  ): Promise<MagiSession> {
    return (await this.call('POST', `/sessions/${sessionId}/resume`, {
      ...(opts?.secrets !== undefined ? { secrets: opts.secrets } : {}),
      ...(opts?.forgeToken !== undefined ? { forgeToken: opts.forgeToken } : {}),
      ...(opts?.mcpTokens !== undefined ? { mcpTokens: opts.mcpTokens } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    })) as MagiSession
  }
  ```

  This step temporarily breaks `src/supervisor/SupervisorService.ts` (still builds the old singular `mcp`/`mcpToken` shape) — that's expected and fixed in Task 4. `npx vitest run tests/services/MagiClient.test.ts` only exercises `MagiClient.ts` in isolation and does not type-check the whole repo, so it goes green before `SupervisorService.ts` is fixed.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npx vitest run tests/services/MagiClient.test.ts`

  Expected: PASS —

  ```
   Test Files  1 passed (1)
        Tests  11 passed (11)
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add src/services/MagiClient.ts tests/services/MagiClient.test.ts
  git commit -m "feat(magi-client): align MCP wire shape to McpUpstream[] + mcpTokens"
  ```

---

### Task 2: `MagiCredentials` split + `MCP_GATEWAY_ID` + propagate the input-shape type

**Files:**

- Modify: `src/supervisor/magiCredentials.ts`
- Modify: `src/supervisor/worker.ts:8,20`
- Modify: `src/supervisor/handlers.ts:10,22`
- Test: `tests/supervisor/magiCredentials.test.ts` (new)

**Resolved `id` decision:** `MCP_GATEWAY_ID = 'gateway'`, a fixed constant. Evidence: nerv's MCP gateway descriptor chain — `IProject.mcp?: MagiMcpSpec` (`src/db/models/Project.ts:29-30`), `MagiProjectDefaults.mcp?: MagiMcpSpec` (`src/supervisor/SupervisorService.ts:25-26`), and the env-var-built default (`src/config.ts:97-120`, sourced from `MAGI_MCP_URL`/`MAGI_MCP_HOST`/`MAGI_MCP_HEADER`/`MAGI_MCP_ALLOWED_HOSTS`) — carries only `{url, host, header, allowedHosts, toolPolicy?}`; no name/id field exists anywhere in this chain. `'gateway'` trivially matches magi's `MCP_ID_PATTERN = /^[a-zA-Z0-9_.:/-]+$/u` (magi repo, `src/project/spec-validation.ts:102`).

- [ ] **Step 1: Write the failing tests**

  Create `tests/supervisor/magiCredentials.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { resolveMagiCredentials, MCP_GATEWAY_ID } from '../../src/supervisor/magiCredentials.js'
  import type { IProject } from '../../src/db/models/Project.js'

  describe('resolveMagiCredentials', () => {
    it('wraps a config-default mcpToken into an mcpTokens record keyed by MCP_GATEWAY_ID', () => {
      const result = resolveMagiCredentials(undefined, { mcpToken: 'default-tok' })
      expect(result.mcpTokens).toEqual({ [MCP_GATEWAY_ID]: 'default-tok' })
    })

    it('prefers the Project mcpToken over the config default, still keyed by MCP_GATEWAY_ID', () => {
      const project = { mcpToken: 'project-tok' } as IProject
      const result = resolveMagiCredentials(project, { mcpToken: 'default-tok' })
      expect(result.mcpTokens).toEqual({ [MCP_GATEWAY_ID]: 'project-tok' })
    })

    it('falls back to the config default mcpToken when the Project has none', () => {
      const project = {} as IProject
      const result = resolveMagiCredentials(project, { mcpToken: 'default-tok' })
      expect(result.mcpTokens).toEqual({ [MCP_GATEWAY_ID]: 'default-tok' })
    })

    it('omits mcpTokens entirely when neither Project nor defaults carry an mcpToken (no-MCP Project sends nothing)', () => {
      const result = resolveMagiCredentials(undefined, {})
      expect(result.mcpTokens).toBeUndefined()
      expect(result).not.toHaveProperty('mcpTokens')
    })

    it('still resolves forgeToken/secrets independently of mcpTokens', () => {
      const result = resolveMagiCredentials(undefined, { forgeToken: 'forge-tok', secrets: { A: 'b' } })
      expect(result).toEqual({ forgeToken: 'forge-tok', secrets: { A: 'b' } })
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run tests/supervisor/magiCredentials.test.ts`

  Expected: FAIL — `MCP_GATEWAY_ID` does not exist in `../../src/supervisor/magiCredentials.js`, and `resolveMagiCredentials`'s return type has no `mcpTokens` property yet:

  ```
  error TS2305: Module '"../../src/supervisor/magiCredentials.js"' has no exported member 'MCP_GATEWAY_ID'.
  ```

- [ ] **Step 3: Write minimal implementation**

  Replace the full contents of `src/supervisor/magiCredentials.ts`:

  ```ts
  /**
   * Resolves the forgeToken/mcpTokens/secrets nerv forwards to magi so it can push commits,
   * comment on the forge, and use provider secrets during a session turn.
   *
   * magi does NOT inherit these across turns: a follow-up session
   * (`magi/src/server/router.ts#handleFollowUp`) is a fresh credential-less request unless the
   * caller resupplies `forgeToken`/`mcpTokens`/`secrets` on that same POST — see
   * `magi/src/session/auto-finish.ts` (~line 85), where a dirty follow-up turn with no
   * `forgeToken` is never pushed/published; magi just tells the user to connect a code host.
   * So every call site that starts OR follows up a session must resolve credentials the same
   * way: project-level override first, else the deployment-wide `magiProjectDefaults`.
   */

  import type { IProject } from '../db/models/Project.js'

  /**
   * Stable id for nerv's single MCP gateway upstream — see magi's McpUpstream.id contract
   * (magi repo, src/project/config.ts:69-76) and MCP_ID_PATTERN (magi repo,
   * src/project/spec-validation.ts:102). nerv resolves exactly one gateway from
   * Project.mcp / MagiProjectDefaults.mcp, neither of which carries a name/id field
   * (see src/config.ts:97-120), so a fixed constant is used instead of deriving one.
   * Used for BOTH the mcp[] entry's id and the mcpTokens record key so they always agree.
   */
  export const MCP_GATEWAY_ID = 'gateway'

  /** Config-level/project-level credential defaults — singular `mcpToken`, mirrors `Project.mcpToken`. */
  export interface MagiCredentialDefaults {
    forgeToken?: string
    mcpToken?: string
    secrets?: Record<string, string>
  }

  /** Resolved credentials ready to spread into a magi request body — plural `mcpTokens`, keyed by upstream id. */
  export interface MagiCredentials {
    forgeToken?: string
    mcpTokens?: Record<string, string>
    secrets?: Record<string, string>
  }

  /**
   * project overrides ?? config defaults, one field at a time. Returns only the keys that
   * resolved to a defined value (no `undefined`-valued keys), so callers can spread the result
   * straight into a magi request body. A resolved mcpToken is wrapped into a one-entry
   * `mcpTokens` record keyed by `MCP_GATEWAY_ID` — nerv resolves exactly one gateway today.
   */
  export function resolveMagiCredentials(
    project: IProject | undefined,
    defaults: MagiCredentialDefaults,
  ): MagiCredentials {
    const forgeToken = project?.forgeToken ?? defaults.forgeToken
    const mcpToken = project?.mcpToken ?? defaults.mcpToken
    const secrets = project?.secrets ?? defaults.secrets
    return {
      ...(forgeToken !== undefined ? { forgeToken } : {}),
      ...(mcpToken !== undefined ? { mcpTokens: { [MCP_GATEWAY_ID]: mcpToken } } : {}),
      ...(secrets !== undefined ? { secrets } : {}),
    }
  }
  ```

  In `src/supervisor/worker.ts`, change the import (line 8) and the `WorkerDeps.magiDefaults` field (line 20) — `magiDefaults` holds the raw config-level defaults passed straight to `resolveMagiCredentials`, not resolved output, so it belongs to the input shape:

  ```ts
  import type { MagiCredentialDefaults } from './magiCredentials.js'
  ```

  ```ts
  /** Deployment-wide forgeToken/mcpToken/secrets fallback for magi follow-ups (see resolveMagiCredentials). */
  magiDefaults: MagiCredentialDefaults
  ```

  In `src/supervisor/handlers.ts`, apply the identical rename to the import (line 10) and `HandlerCtx.magiDefaults` (line 22):

  ```ts
  import type { MagiCredentialDefaults } from './magiCredentials.js'
  ```

  ```ts
  /** Deployment-wide forgeToken/mcpToken/secrets fallback for magi follow-ups (see resolveMagiCredentials). */
  magiDefaults: MagiCredentialDefaults
  ```

  Note: `worker.ts`/`handlers.ts` are updated here for type accuracy (the field genuinely holds `MagiCredentialDefaults`-shaped data — see `src/index.ts:118-122`), but this rename does not change what `npm run type-check` reports either way, because every real call site assigns through a named variable rather than a fresh object literal (TypeScript's excess-property checks don't apply to named-variable assignment, and the two interfaces are otherwise structurally compatible for how they're used). It is included for correctness and so `resolveMagiCredentials(project, magiDefaults ?? {})` in `foundationHandlers.ts`/`ciHandlers.ts`/`reviewHandlers.ts`/`selfReviewHandlers.ts` reads consistently with the type it's actually passing.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npx vitest run tests/supervisor/magiCredentials.test.ts`

  Expected: PASS —

  ```
   Test Files  1 passed (1)
        Tests  5 passed (5)
  ```

  Then run the full type-check to confirm the split + rename introduced no regressions:

  Run: `npm run type-check`

  Expected: 2 pre-existing errors remain (fixed in Task 4), both in `src/supervisor/SupervisorService.ts`, e.g.:

  ```
  src/supervisor/SupervisorService.ts(74,9): error TS2339: Property 'mcpToken' does not exist on type 'MagiCredentials'. Did you mean 'mcpTokens'?
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add src/supervisor/magiCredentials.ts src/supervisor/worker.ts src/supervisor/handlers.ts tests/supervisor/magiCredentials.test.ts
  git commit -m "feat(magi-credentials): split MagiCredentials into defaults/resolved shapes, add MCP_GATEWAY_ID"
  ```

---

### Task 3: `chat_instruction` handler test — resolved `mcpTokens` shape

**Files:**

- Test: `tests/supervisor/foundationHandlers.test.ts:647-664`

No source change in this task — `resolveMagiCredentials` (Task 2) already produces the plural shape; this task brings the `chat_instruction handler` describe block's assertion in line with that resolved shape, since it previously asserted the follow-up was called with `magiDefaults` verbatim (which happened to structurally equal the old resolved-credentials shape before the split).

- [ ] **Step 1: Write the failing test**

  In `tests/supervisor/foundationHandlers.test.ts`, update the test currently titled `'resupplies forgeToken/mcpToken/secrets from magiDefaults on the follow-up (magi does not inherit them across turns)'` (lines 647-664):

  ```ts
  it('resupplies forgeToken/mcpTokens/secrets from magiDefaults on the follow-up (magi does not inherit them across turns)', async () => {
    const magi = { followUp: vi.fn(async () => ({})) }
    const papai = { notify: vi.fn(async () => {}) }
    const t = await tasks.create({
      kind: 'gitlab-mr-supervision',
      contextRef: { contextId: 'c1' },
      source: 'chat',
      prompt: 'p',
      repos: [{ projectPath: 'g/r' }],
    })
    t.taskRepositories[0].magiSessionId = 'sess-9'
    await t.save()

    const magiDefaults = { forgeToken: 'forge-tok', mcpToken: 'mcp-tok', secrets: { ANTHROPIC_API_KEY: 'sk-1' } }
    const handler = makeChatInstructionHandler()
    const ctx = {
      task: t,
      item: { payload: { prompt: 'also do Y' } },
      magi,
      papai,
      magiDefaults,
    } as unknown as HandlerCtx
    await handler(ctx)
    expect(magi.followUp).toHaveBeenCalledWith('sess-9', expect.stringContaining('also do Y'), {
      forgeToken: 'forge-tok',
      mcpTokens: { gateway: 'mcp-tok' },
      secrets: { ANTHROPIC_API_KEY: 'sk-1' },
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run tests/supervisor/foundationHandlers.test.ts -t "resupplies forgeToken"`

  Expected: FAIL —

  ```
  AssertionError: expected "spy" to be called with arguments: [ 'sess-9', StringContaining{…}, { forgeToken: 'forge-tok', mcpTokens: { gateway: 'mcp-tok' }, secrets: { ANTHROPIC_API_KEY: 'sk-1' } } ]

  Received: "sess-9", "also do Y", {"forgeToken": "forge-tok", "mcpTokens": {"gateway": "mcp-tok"}, "secrets": {"ANTHROPIC_API_KEY": "sk-1"}}
  ```

  (The handler already resupplies the correctly-shaped resolved credentials via `resolveMagiCredentials` from Task 2 — the test fails only because it still asserts against the raw `magiDefaults` object, whose `mcpToken` field no longer matches the resolved `mcpTokens` field.)

- [ ] **Step 3: No implementation change needed**

  `src/supervisor/foundationHandlers.ts`'s `makeChatInstructionHandler` already calls `resolveMagiCredentials(project, magiDefaults ?? {})` and forwards the result to `magi.followUp` (see `src/supervisor/foundationHandlers.ts:182-190`) — this was correct before Task 2 and remains correct after it. Nothing to change here.

- [ ] **Step 4: Run test to verify it passes**

  Run: `npx vitest run tests/supervisor/foundationHandlers.test.ts -t "resupplies forgeToken"`

  Expected: PASS —

  ```
   Test Files  1 passed (1)
        Tests  1 passed (1)
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add tests/supervisor/foundationHandlers.test.ts
  git commit -m "test(foundation-handlers): assert chat_instruction follow-up resupplies mcpTokens"
  ```

---

### Task 4: `SupervisorService` builds `projectSpec.mcp` as a one-element `McpUpstream[]`

**Files:**

- Modify: `src/supervisor/SupervisorService.ts:1-9,67-106`
- Test: `tests/supervisor/foundationHandlers.test.ts:83-124,149-173`

- [ ] **Step 1: Write the failing tests**

  In `tests/supervisor/foundationHandlers.test.ts`, update the test currently titled `'forwards model/providerHost/mcp/mcpToken/forgeToken/secrets from config defaults when configured'` (lines 83-124):

  ```ts
  it('forwards model/providerHost/mcp/mcpTokens/forgeToken/secrets from config defaults when configured', async () => {
    const magi = { startSession: vi.fn(async () => ({ id: 'sess-11', status: 'queued' })) }
    const mcp = {
      url: 'https://gw.example.com',
      host: 'gw.example.com',
      header: 'X-Mcp-Auth',
      allowedHosts: ['gw.example.com'],
    }
    const defaults = {
      baseBranch: 'main',
      permissionPreset: 'cautious',
      agent: 'claude',
      model: 'claude-opus-4',
      providerHost: 'api.anthropic.com',
      forgeToken: 'forge-tok',
      mcpToken: 'mcp-tok',
      mcp,
      secrets: { ANTHROPIC_API_KEY: 'sk-1' },
    }
    const sup = new SupervisorService(tasks, magi as never, { magiProjectDefaults: defaults })
    const t = await tasks.create({
      kind: 'gitlab-mr-supervision',
      contextRef: { contextId: 'c-wired' },
      source: 'chat',
      prompt: 'build X',
      repos: [{ projectPath: 'g/r' }],
    })

    await sup.startTask(t._id.toString())
    expect(magi.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        contextId: 'c-wired',
        prompt: expect.stringContaining('build X'),
        projectSpec: expect.objectContaining({
          name: 'g/r',
          model: 'claude-opus-4',
          providerHost: 'api.anthropic.com',
          mcp: [{ id: 'gateway', ...mcp }],
        }),
        mcpTokens: { gateway: 'mcp-tok' },
        forgeToken: 'forge-tok',
        secrets: { ANTHROPIC_API_KEY: 'sk-1' },
      }),
    )
  })
  ```

  Update the test currently titled `'omits projectSpec.mcp and logs a warning when mcp is configured but no mcpToken is set (fail-safe)'` (lines 149-173):

  ```ts
  it('omits projectSpec.mcp and logs a warning when mcp is configured but no mcpToken is set (fail-safe)', async () => {
    const magi = { startSession: vi.fn(async (_input: unknown) => ({ id: 'sess-13', status: 'queued' })) }
    const mcp = {
      url: 'https://gw.example.com',
      host: 'gw.example.com',
      header: 'X-Mcp-Auth',
      allowedHosts: ['gw.example.com'],
    }
    const defaults = { baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude', mcp }
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const sup = new SupervisorService(tasks, magi as never, { magiProjectDefaults: defaults }, log)
    const t = await tasks.create({
      kind: 'gitlab-mr-supervision',
      contextRef: { contextId: 'ctx-mcp-no-token' },
      source: 'chat',
      prompt: 'build X',
      repos: [{ projectPath: 'g/r' }],
    })

    await sup.startTask(t._id.toString())
    const call = magi.startSession.mock.calls[0][0] as unknown as {
      projectSpec: Record<string, unknown>
      mcpTokens?: Record<string, string>
    }
    expect(call.projectSpec.mcp).toBeUndefined()
    expect(call.mcpTokens).toBeUndefined()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('mcpToken'))
  })

  it('sends neither projectSpec.mcp nor mcpTokens for a Project without MCP configured (magi contract: absent mcp needs no token)', async () => {
    const magi = { startSession: vi.fn(async (_input: unknown) => ({ id: 'sess-15', status: 'queued' })) }
    const defaults = { baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude' }
    const sup = new SupervisorService(tasks, magi as never, { magiProjectDefaults: defaults })
    const t = await tasks.create({
      kind: 'gitlab-mr-supervision',
      contextRef: { contextId: 'c-no-mcp' },
      source: 'chat',
      prompt: 'build X',
      repos: [{ projectPath: 'g/r' }],
    })

    await sup.startTask(t._id.toString())
    const call = magi.startSession.mock.calls[0][0] as unknown as {
      projectSpec: Record<string, unknown>
      mcpTokens?: Record<string, string>
    }
    expect(call.projectSpec.mcp).toBeUndefined()
    expect(call.mcpTokens).toBeUndefined()
  })
  ```

  Place the new `'sends neither ...'` test immediately after the `'omits projectSpec.mcp ...'` test and before `'prepends the operating-instructions preamble ...'` (which currently starts at line 175).

- [ ] **Step 2: Run tests to verify they fail**

  Run: `npx vitest run tests/supervisor/foundationHandlers.test.ts -t "mcp"`

  Expected: FAIL — this also surfaces the 2 pre-existing type-check errors from Task 2's Step 4 (`SupervisorService.ts` still reads `credentials.mcpToken`, which no longer exists), plus a runtime assertion failure on the array-vs-object shape:

  ```
  src/supervisor/SupervisorService.ts(74,9): error TS2339: Property 'mcpToken' does not exist on type 'MagiCredentials'. Did you mean 'mcpTokens'?

  AssertionError: expected "spy" to be called with arguments: [ ObjectContaining{…} ]
  ```

- [ ] **Step 3: Write minimal implementation**

  In `src/supervisor/SupervisorService.ts`, change the import line (line 3) to add `McpUpstream` and change the `magiCredentials` import (line 6) to also bring in `MCP_GATEWAY_ID`:

  ```ts
  import type {
    MagiClient,
    MagiMcpSpec,
    MagiProjectSpec,
    McpUpstream,
    StartSessionInput,
  } from '../services/MagiClient.js'
  import type { ProjectService } from '../services/ProjectService.js'
  import type { PapaiTaskNotifier } from '../services/PapaiTaskNotifier.js'
  import { MCP_GATEWAY_ID, resolveMagiCredentials } from './magiCredentials.js'
  ```

  Update the doc comment on `MagiProjectDefaults.mcpToken` (currently line 24) to reflect the wire-level wrapping:

  ```ts
    /** Bearer forwarded as `mcpTokens[MCP_GATEWAY_ID]`; required by magi whenever `mcp` is set. */
    mcpToken?: string
  ```

  Change the MCP-descriptor resolution block in `startTask` (currently lines 67-82):

  ```ts
  // magi requires a matching mcpTokens[id] entry whenever `projectSpec.mcp` is set (it
  // throws otherwise) — fail-safe by omitting `mcp` rather than sending a payload magi
  // will reject.
  const mcpDescriptor = project?.mcp ?? defaults.mcp
  let mcp: McpUpstream[] | undefined
  let mcpTokens: Record<string, string> | undefined
  if (mcpDescriptor !== undefined) {
    const token = credentials.mcpTokens?.[MCP_GATEWAY_ID]
    if (token !== undefined) {
      mcp = [{ id: MCP_GATEWAY_ID, ...mcpDescriptor }]
      mcpTokens = { [MCP_GATEWAY_ID]: token }
    } else {
      this.log.warn(
        `projectSpec.mcp is configured for context ${contextId} but no mcpToken is configured — omitting mcp from the magi session start`,
      )
    }
  }
  ```

  Change the `startInput` build (currently lines 98-106) to send `mcpTokens` instead of `mcpToken`:

  ```ts
  const startInput: StartSessionInput = {
    contextId,
    prompt: promptWithPreamble,
    projectSpec,
    ...(repo.mrIid !== undefined ? { prNumber: repo.mrIid } : {}),
    ...(secrets !== undefined ? { secrets } : {}),
    ...(forgeToken !== undefined ? { forgeToken } : {}),
    ...(mcpTokens !== undefined ? { mcpTokens } : {}),
  }
  ```

  The `projectSpec` build itself (currently lines 87-97) is unchanged — it already does `...(mcp !== undefined ? { mcp } : {})`, and `mcp` is now array-typed from the block above, so `MagiProjectSpec.mcp: McpUpstream[]` (from Task 1) is satisfied automatically.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npx vitest run tests/supervisor/foundationHandlers.test.ts`

  Expected: PASS —

  ```
   Test Files  1 passed (1)
        Tests  29 passed (29)
  ```

  Run: `npm run type-check`

  Expected: clean, no output after the `tsc` invocation line.

- [ ] **Step 5: Commit**

  ```bash
  git add src/supervisor/SupervisorService.ts tests/supervisor/foundationHandlers.test.ts
  git commit -m "feat(supervisor): build projectSpec.mcp as a one-element McpUpstream[] with mcpTokens"
  ```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full type-check**

  Run: `npm run type-check`

  Expected: clean —

  ```
  > nerv@0.0.0 type-check
  > tsc -p tsconfig.json --noEmit
  ```

  (no errors printed; `tsc --noEmit` exits 0)

- [ ] **Step 2: Run the full test suite**

  Run: `npx vitest run`

  Expected: PASS —

  ```
   Test Files  39 passed (39)
        Tests  345 passed (345)
  ```

  (38 pre-existing files + the new `tests/supervisor/magiCredentials.test.ts` = 39; 338 pre-existing tests + 1 from Task 1 + 5 from Task 2 + 1 from Task 4 = 345.)

- [ ] **Step 3: Confirm the working tree only contains the 5 commits from this plan**

  Run: `git status --short`

  Expected: empty (everything from Tasks 1-4 was already committed at the end of each task; nothing left uncommitted).
