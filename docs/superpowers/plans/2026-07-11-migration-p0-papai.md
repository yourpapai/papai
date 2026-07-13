<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# papai — Migration Phase 0 (Reliability & Enablement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the papai-repo portion of Phase 0 (Reliability & Enablement) of the kiss→papai migration: fix the `followup_coding_task` wire payload so nerv actually receives the instruction text (C1), remove the never-implemented `steer_coding_task` tool so the LLM-facing surface only offers the one honest entry point (C2), thread a context-scoped `output_language` config value into `create_coding_task` so nerv (and, downstream, magi) can honor the user's language (C4), and surface nerv connectivity as an admin-visible health probe — both a settings-API route and a UI badge — plus an enablement runbook (C5). Component 3 ("cancel reaps magi") is nerv-only and out of scope for this repo.

**Architecture:** All changes are additive/narrowing inside the existing `plugins/nerv/` plugin and its two small integration seams into papai core: `src/llm-orchestrator-tools.ts`'s `whoMayUse` action-tool gate, and `src/debug/settings-api-router.ts`'s admin route dispatch. C1 and C2 touch only `plugins/nerv/event-tools.ts` (the shared `eventTool()` helper that both `followup_coding_task` and, until C2, `steer_coding_task` used) plus `plugins/nerv/index.ts`/`plugin.json` for tool registration. C4 declares a new `scope: "context"` entry in `plugin.json`'s `configRequirements` — no new plumbing is needed because `src/plugins/tool-runtime.ts`'s `buildRuntimeContextConfig()` already auto-wires any declared context-scoped key onto every tool's `runtimeContext.contextConfig`; nerv's own narrower `RuntimeContext` type (in `plugins/nerv/tools.ts`) just needs a `contextConfig` field added and a read call in `createCodingTaskTool`. C5 adds a new admin-only settings route `GET /settings/api/admin/nerv-health` (`src/debug/settings/admin/nerv-health-routes.ts`, registered in `src/debug/settings-api-router.ts`'s `routeAdminApi()`) that probes nerv's already-existing `GET /health` endpoint using the plain global `fetch` + `AbortSignal.timeout` pattern already established at `src/coding-credentials/provider-models.ts:62` (no DI wrapper, per `tests/CLAUDE.md`'s "don't mock `globalThis.fetch` directly, use `setMockFetch()`" rule), and a small badge in the existing "Admin · Coding sessions" section (`client/settings/sections/admin/AdminCodingGuardrailsSection.svelte`) that calls it. C5 also adds a deployment runbook, `docs/deployment/nerv-enablement.md`, docs-only (no test/run step).

**Tech Stack:** Bun runtime, Zod v4, Vercel AI SDK (`ai` package's `tool()`/`ToolSet`), Svelte 5 (runes) for the settings SPA. Test command: `bun test <path>` from the papai repo root for server-side/plugin suites; client (Svelte) suites require the browser-conditions client harness: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>` (matches `package.json`'s `test:client` script — `bunfig.toml`'s `pathIgnorePatterns` excludes `tests/client/**` by default, so omitting `--path-ignore-patterns ''` silently reports "did not match any test files" instead of running anything).

**Repo:** `/Users/ki/Projects/yourpapai/papai`
**Cross-repo note:** Land the sibling nerv-repo plan (`docs/superpowers/plans/2026-07-11-migration-p0-nerv.md`, repo `/Users/ki/Projects/yourpapai/nerv`) **before** this plan. nerv's C1 fix makes `POST /tasks/:id/events`'s `chat_followup` route require `payload.prompt` (not `payload.text`); nerv's C4 fix is what actually consumes the `outputLanguage` field this plan starts sending on `POST /tasks`. Landing this plan first would have papai silently sending a field nerv doesn't (yet) read.

---

## File Structure

Modified:

- `plugins/nerv/event-tools.ts` — `eventTool()`'s wire payload key `text` → `prompt` (C1); `steerCodingTaskTool` removed entirely, `eventTool()`'s type param narrowed to the single literal `'chat_followup'` (C2).
- `plugins/nerv/tools.ts` — new `ContextConfigReader` type + `contextConfig` field on `RuntimeContext`; `buildCreateTaskBody` gains an `outputLanguage` parameter; `createCodingTaskTool.execute()` reads `runtimeContext.contextConfig.get('output_language')` (C4).
- `plugins/nerv/index.ts` — `steerCodingTaskTool` import/registration removed; `NERV_PROMPT_FRAGMENT` no longer mentions `steer_coding_task` (C2).
- `plugins/nerv/plugin.json` — `"steer_coding_task"` removed from `contributes.tools` (C2); new `configRequirements` entry for `output_language`, `scope: "context"` (C4).
- `src/llm-orchestrator-tools.ts` — `'plugin_nerv__steer_coding_task'` removed from `NERV_TASK_ACTION_TOOLS` (C2).
- `src/debug/settings-api-router.ts` — new import + route line for `handleAdminNervHealthRoutes` at `/settings/api/admin/nerv-health` (C5).
- `client/settings/fetcher-schemas-coding-guardrails.ts` — new `NervHealthResponseSchema`/`NervHealthResponse` (C5).
- `client/settings/admin-fetchers.ts` — new `fetchAdminNervHealth()` (C5).
- `client/settings/sections/admin/AdminCodingGuardrailsSection.svelte` — new nerv-health badge wired into the existing load `$effect` (C5).
- `docs/architecture/coding-stack-overview.md` — §3.8 updated: tool count/list, `output_language` behavior, "three nerv action tools" (docs accuracy for C2/C4).
- `tests/plugins/nerv/event-tools.test.ts` — followup test's expected wire body corrected; new anti-drift contract test; `steer` test block removed (C1, C2).
- `tests/plugins/nerv/create-task.test.ts` — new `outputLanguage` passthrough test (C4).
- `tests/plugins/nerv/manifest.test.ts` — unmodified (already derives its expectation from `plugin.json` + `activate()`, so it fails/passes automatically as C2's registration changes land).
- `tests/plugins/nerv/who-may-use-nerv.test.ts` — `NAMES` array + expected count shrink from 6/6 to 5/5 (C2).
- `tests/debug/settings-api-router.test.ts` — new route-dispatch test for `/settings/api/admin/nerv-health` (C5).
- `tests/client/settings/admin-coding-guardrails-section.test.ts` — two new tests for the nerv-health badge (C5).

New:

- `src/debug/settings/admin/nerv-health-routes.ts` — `probeNervHealth()` + `handleAdminNervHealthRoutes()` (C5).
- `tests/debug/settings/admin/nerv-health-routes.test.ts` — route + probe tests, written first per the TDD write-hook (C5).
- `docs/deployment/nerv-enablement.md` — enablement runbook: token matrix, config keys, smoke-test checklist (C5).

---

### Task 1: Fix `followup_coding_task`'s wire payload (`text` → `prompt`) — C1

nerv's `POST /tasks/:id/events` route requires `payload.prompt` for a `chat_followup` event; papai currently sends `payload.text`, so every follow-up instruction resolves to an empty string on nerv's side and is silently dropped. This task fixes the wire body and pins it with a standing anti-drift contract test.

**Files:**

- `tests/plugins/nerv/event-tools.test.ts` (all 107 lines — small file, edited throughout)
- `plugins/nerv/event-tools.ts:16-36` (the shared `eventTool()` helper)

Steps:

- [ ] Write the failing test. In `tests/plugins/nerv/event-tools.test.ts`, change the existing `'followup posts chat_followup with text to the thread task'` test's final assertion, and add a new standing contract test right after it:

  ```ts
  test('followup posts chat_followup with text to the thread task', async () => {
    const captured: Captured[] = []
    const store = new Map<string, string>()
    withActive(store, 't1')
    const tool = followupCodingTaskTool(capturingFetch(captured))
    await tool.execute({ text: 'address review comments' }, runtimeCtx(store), options())
    expect(captured[0]?.url).toBe('http://nerv:9000/tasks/t1/events')
    expect(captured[0]?.body).toEqual({ type: 'chat_followup', payload: { prompt: 'address review comments' } })
  })

  // Anti-drift contract pin: papai emits payload.prompt (not payload.text) on the wire. nerv's
  // tasks.ts route schema requires payload.prompt — a silent field-name mismatch here previously
  // made the followup instruction resolve to '' on the nerv side and get silently dropped.
  test('contract: chat_followup wire body is exactly {type, payload:{prompt}}', async () => {
    const captured: Captured[] = []
    const store = new Map<string, string>()
    withActive(store, 't1')
    const tool = followupCodingTaskTool(capturingFetch(captured))
    await tool.execute({ text: 'ship it' }, runtimeCtx(store), options())
    expect(captured[0]?.body).toEqual({ type: 'chat_followup', payload: { prompt: 'ship it' } })
  })
  ```

- [ ] Run it — confirm it fails for the right reason (implementation still sends `payload: { text }`, so both the modified assertion and the new contract test fail; the other 5 pre-existing tests, including `steer`, are untouched and still pass):

  ```
  $ bun test tests/plugins/nerv/event-tools.test.ts
  ```

  Expected output:

  ```
  bun test v1.3.13 (bf2e2cec)

  tests/plugins/nerv/event-tools.test.ts:
  (fail) followup posts chat_followup with text to the thread task
  (fail) contract: chat_followup wire body is exactly {type, payload:{prompt}}

   5 pass
   2 fail
   9 expect() calls
  Ran 7 tests across 1 file.
  ```

- [ ] Implement the minimal fix. In `plugins/nerv/event-tools.ts`, inside `eventTool()`'s `execute`, change the wire payload:

  ```ts
  const result = await callNerv(httpFetch, cfg, 'POST', `/tasks/${encodeURIComponent(taskId)}/events`, {
    type,
    payload: { prompt: text },
  })
  ```

- [ ] Run the suite again — this exposes a ripple: `eventTool()` is shared by `followupCodingTaskTool` **and** (until Task 2 removes it) `steerCodingTaskTool`, so the pre-existing `'steer posts steer with text'` test — which still asserts the old `payload: { text }` shape — now fails too. Since each task must land independently green, fix that test's expectation in the same commit (it gets deleted outright in Task 2, but must not be left broken here):

  ```
  $ bun test tests/plugins/nerv/event-tools.test.ts
  ```

  Expected output (partial — `followup`/contract now pass, `steer` now fails):

  ```
  bun test v1.3.13 (bf2e2cec)

  tests/plugins/nerv/event-tools.test.ts:
  (fail) steer posts steer with text

   6 pass
   1 fail
   9 expect() calls
  Ran 7 tests across 1 file.
  ```

- [ ] Update the `steer` test's expected body in `tests/plugins/nerv/event-tools.test.ts` to match the new wire shape (`payload: { prompt: 'go' }` in place of `payload: { text: 'go' }` — check the exact existing assertion text in the file and mirror the `prompt` rename there).

- [ ] Run the full file — confirm all green:

  ```
  $ bun test tests/plugins/nerv/event-tools.test.ts
  ```

  Expected output:

  ```
  bun test v1.3.13 (bf2e2cec)

   7 pass
   0 fail
   9 expect() calls
  Ran 7 tests across 1 file. [661.00ms]
  ```

- [ ] Commit:

  ```
  git add plugins/nerv/event-tools.ts tests/plugins/nerv/event-tools.test.ts
  git commit -m "fix(nerv): send payload.prompt on chat_followup so nerv receives the instruction text"
  ```

---

### Task 2: Remove the never-implemented `steer_coding_task` tool — C2

`steer_coding_task` and `followup_coding_task` both hit the identical nerv-side `chat_followup` path and implied a distinction (immediate steering vs. queued follow-up) that never existed — nerv only ever applies it at the next checkpoint. Keeping two tools for one behavior invites the LLM to pick the wrong one and confuses users about immediacy. This removes `steer_coding_task` everywhere: manifest, registration, gating, tests, docs.

**Files:**

- `plugins/nerv/plugin.json:9-15` (`contributes.tools`)
- `plugins/nerv/event-tools.ts:16,38-45` (`eventTool()` type param, `steerCodingTaskTool` deletion)
- `plugins/nerv/index.ts:1-9,82-101` (import, registration, prompt fragment text)
- `src/llm-orchestrator-tools.ts:46-50` (`NERV_TASK_ACTION_TOOLS`)
- `tests/plugins/nerv/event-tools.test.ts` (delete the `steer` test block)
- `tests/plugins/nerv/who-may-use-nerv.test.ts:23-29,42-45`
- `tests/plugins/nerv/manifest.test.ts` (no edit — it derives its expectation from `plugin.json` + `activate()`)
- `docs/architecture/coding-stack-overview.md:301-330`

Steps:

- [ ] Write the failing test by editing the manifest declaration first (the config is the spec here; `manifest.test.ts` already asserts `contributes.tools` matches what `activate()` registers, so removing the tool from one side without the other is what turns it red). In `plugins/nerv/plugin.json`, remove `"steer_coding_task"` from `contributes.tools`:

  ```json
  "contributes": {
    "tools": [
      "create_coding_task",
      "coding_task_status",
      "list_coding_tasks",
      "followup_coding_task",
      "cancel_coding_task"
    ],
  ```

- [ ] Run the manifest test — confirm it fails for the right reason (`activate()` still registers `steer_coding_task`, which the manifest no longer lists):

  ```
  $ bun test tests/plugins/nerv/manifest.test.ts
  ```

  Expected output:

  ```
  bun test v1.3.13 (bf2e2cec)

  tests/plugins/nerv/manifest.test.ts:
  (fail) nerv plugin manifest > contributes.tools exactly matches the tools registered in activate()

    expect(received).toEqual(expected)

    [
      "cancel_coding_task",
      "coding_task_status",
      "create_coding_task",
      "followup_coding_task",
      "list_coding_tasks",
  +   "steer_coding_task",
    ]

   1 pass
   1 fail
   3 expect() calls
  Ran 2 tests across 1 file.
  ```

- [ ] Implement the removal. In `plugins/nerv/event-tools.ts`: narrow `eventTool()`'s 4th parameter type to the single literal `'chat_followup'`, and delete `steerCodingTaskTool` entirely:

  ```ts
  function eventTool(httpFetch: HttpFetch | undefined, name: string, description: string, type: 'chat_followup'): Tool {
  ```

  (delete the `export function steerCodingTaskTool(...)` block that followed `followupCodingTaskTool`).

  In `plugins/nerv/index.ts`, drop the import and registration call:

  ```ts
  import { cancelCodingTaskTool, followupCodingTaskTool } from './event-tools.js'
  ```

  ```ts
  ctx.registerTool(createCodingTaskTool(ctx.httpFetch))
  ctx.registerTool(codingTaskStatusTool(ctx.httpFetch))
  ctx.registerTool(listCodingTasksTool(ctx.httpFetch))
  ctx.registerTool(followupCodingTaskTool(ctx.httpFetch))
  ctx.registerTool(cancelCodingTaskTool(ctx.httpFetch))
  ```

  and update `NERV_PROMPT_FRAGMENT` so the LLM-facing hint no longer mentions the removed tool:

  ```ts
  const NERV_PROMPT_FRAGMENT =
    'Supervised coding tasks: for long-running work — open/update a GitLab merge request and watch it until CI is ' +
    'green, iterate on review comments, or work across multiple repos — use create_coding_task(project, prompt). ' +
    'It runs until done and notifies the user; use followup_coding_task to queue guidance for the next checkpoint, ' +
    'cancel_coding_task to stop it, and coding_task_status/list_coding_tasks to check progress. Only one task runs ' +
    'per thread. For a single one-shot change that opens a PR immediately, use start_session (the acp plugin) instead.'
  ```

  In `plugins/nerv/event-tools.ts`, also update `followupCodingTaskTool`'s description to reflect that it is now the single entry point:

  ```ts
  export function followupCodingTaskTool(httpFetch: HttpFetch | undefined): Tool {
    return eventTool(
      httpFetch,
      'followup_coding_task',
      'Queue a message or instruction for the running task; it is applied at the next checkpoint.',
      'chat_followup',
    )
  }
  ```

  Delete the now-obsolete `'steer posts steer with text'` test block from `tests/plugins/nerv/event-tools.test.ts` (its assertion was fixed in Task 1; it is removed here, not fixed further).

  In `src/llm-orchestrator-tools.ts`, drop the removed tool from the operator gate:

  ```ts
  const NERV_TASK_ACTION_TOOLS = new Set([
    'plugin_nerv__create_coding_task',
    'plugin_nerv__followup_coding_task',
    'plugin_nerv__cancel_coding_task',
  ])
  ```

  In `tests/plugins/nerv/who-may-use-nerv.test.ts`, drop the tool from `NAMES` and update the expected counts:

  ```ts
  const NAMES = [
    'plugin_nerv__create_coding_task',
    'plugin_nerv__followup_coding_task',
    'plugin_nerv__cancel_coding_task',
    'plugin_nerv__coding_task_status',
    'plugin_nerv__list_coding_tasks',
  ]
  ```

  ```ts
  test('allowlisted actor keeps all nerv tools', () => {
    const filtered = applyWhoMayUseFilter(makeToolSet(NAMES), ['bob'], 'bob')
    expect(Object.keys(filtered).length).toBe(5)
  })
  ```

- [ ] Run the full nerv suite plus the who-may-use gate suite — confirm all green:

  ```
  $ bun test tests/plugins/nerv/
  ```

  Expected output:

  ```
  bun test v1.3.13 (bf2e2cec)

   40 pass
   0 fail
   78 expect() calls
  Ran 40 tests across 9 files. [640.00ms]
  ```

- [ ] Update docs for accuracy. In `docs/architecture/coding-stack-overview.md` §3.8, change "six LLM tools" → "five LLM tools", remove `steer_coding_task` from the tool list, add a sentence explaining its removal, and change "the four nerv action tools" → "the three nerv action tools" (already reflected in the current file text — verify it reads):

  ```
  is green, ingesting review comments and iterating. The plugin exposes five LLM tools —
  `create_coding_task`, `coding_task_status`, `list_coding_tasks`, `followup_coding_task`,
  `cancel_coding_task` — mapping to nerv's `POST /tasks`, `GET /tasks/:id`, and
  `POST /tasks/:id/events`. Admin config `nerv_base_url`/`nerv_token` (bearer, allowlisted via
  `providerAllowedHostsFromConfig`), same shape as acp's `magi_*`. ... There is no separate "steer" tool —
  `followup_coding_task` is the single honest entry point (queued, applied at the next checkpoint); a
  prior dedicated `steer_coding_task` tool was removed since both hit the identical nerv-side
  `chat_instruction` path and implied a distinction that did not exist.
  ```

  ```
  - **Gating**: the three nerv action tools join acp's in the operator `whoMayUse` guardrail via
    `CODING_ACTION_TOOLS` (`src/llm-orchestrator-tools.ts`); status/list stay ungated.
  ```

- [ ] Run typecheck and lint to confirm no stragglers reference the removed export:

  ```
  $ bun run typecheck && bun run lint
  ```

  Expected output:

  ```
  $ tsgo --noEmit
  $ oxlint --config .oxlintrc.json --ignore-path .oxlintignore .
  Found 0 warnings and 0 errors.
  Finished in 3.2s on 2292 files with 204 rules using 12 threads.
  ```

- [ ] Commit:

  ```
  git add plugins/nerv/plugin.json plugins/nerv/event-tools.ts plugins/nerv/index.ts \
    src/llm-orchestrator-tools.ts tests/plugins/nerv/event-tools.test.ts \
    tests/plugins/nerv/who-may-use-nerv.test.ts docs/architecture/coding-stack-overview.md
  git commit -m "refactor(nerv): remove steer_coding_task, followup_coding_task is the single instruction entry point"
  ```

---

### Task 3: Thread `output_language` context config into `create_coding_task` — C4

Groups may want nerv's task output (and, downstream, magi's prose) in a language other than English. papai already has a context-scoped plugin-config mechanism (`configRequirements` entries with `scope: "context"`, auto-wired onto every tool's `runtimeContext.contextConfig` by `buildRuntimeContextConfig()` in `src/plugins/tool-runtime.ts:225` — confirmed precedent: `audio-transcribe`, `mcp-figma`). This task declares the key and forwards it on task creation.

**Files:**

- `plugins/nerv/plugin.json:23-33` (`configRequirements`)
- `plugins/nerv/tools.ts:21-44,124-143,164-194` (`RuntimeContext` type, `buildCreateTaskBody`, `createCodingTaskTool`)
- `tests/plugins/nerv/create-task.test.ts` (new test)
- `docs/architecture/coding-stack-overview.md:309-313`

Steps:

- [ ] Write the failing test. In `tests/plugins/nerv/create-task.test.ts`, add a new test right before the `'multi-repo passes an array of projectPaths'` test:

  ```ts
  test('create passes outputLanguage from context config when set', async () => {
    const captured: Captured[] = []
    const ctx = runtimeCtx(new Map())
    const withLang = {
      ...ctx,
      contextConfig: { get: (): string | undefined => 'Russian' },
    }
    const tool = createCodingTaskTool(capturingFetch(captured, { taskId: 't3' }))
    await tool.execute({ project: 'demo', prompt: 'fix the CI' }, withLang, options())
    expect(asRecord(captured[0]?.body)['outputLanguage']).toBe('Russian')
  })
  ```

  Note: the fixture's `runtimeCtx()` (in `tests/plugins/nerv/support.ts`) already returns an object typed as the real `PluginToolRuntimeContext`, which already declares `contextConfig` — no fixture change is needed, only overriding it per-test as above.

- [ ] Run it — confirm it fails for the right reason (`tools.ts`'s `buildCreateTaskBody` doesn't accept or forward an `outputLanguage` yet, so the wire body never contains the key):

  ```
  $ bun test tests/plugins/nerv/create-task.test.ts
  ```

  Expected output:

  ```
  bun test v1.3.13 (bf2e2cec)

  tests/plugins/nerv/create-task.test.ts:
  (fail) create passes outputLanguage from context config when set

    expect(received).toBe(expected)

    Expected: "Russian"
    Received: undefined

   7 pass
   1 fail
   13 expect() calls
  Ran 8 tests across 1 file.
  ```

- [ ] Implement. In `plugins/nerv/plugin.json`, declare the new context-scoped key:

  ```json
  "configRequirements": [
    { "key": "nerv_base_url", "label": "nerv Base URL", "required": true, "sensitive": false, "scope": "admin" },
    { "key": "nerv_token", "label": "nerv Bearer Token", "required": true, "sensitive": true, "scope": "admin" },
    {
      "key": "output_language",
      "label": "Output language (e.g. English, Russian)",
      "required": false,
      "sensitive": false,
      "scope": "context"
    }
  ],
  ```

  In `plugins/nerv/tools.ts`, add a `ContextConfigReader` type and field on `RuntimeContext`:

  ```ts
  type AdminConfigReader = { get(key: string): string | undefined }
  type ContextConfigReader = { get(key: string): string | undefined }
  type KvStore = {
  ```

  ```ts
  export type RuntimeContext = {
    storageContextId: string
    adminConfig: AdminConfigReader
    contextConfig: ContextConfigReader
    kv: KvStore
  ```

  Thread it through `buildCreateTaskBody`:

  ```ts
  function buildCreateTaskBody(
    args: Record<string, unknown>,
    prompt: string,
    storageContextId: string,
    resolved: { repos: { projectPath: string }[]; targetBranch: string | undefined },
    outputLanguage: string | undefined,
  ): Record<string, unknown> {
    const kind = optionalString(args, 'kind')
    const costBudgetUsd = asNumber(args, 'costBudgetUsd')
    return {
      ...(kind === undefined ? {} : { kind }),
      prompt,
      repos: resolved.repos,
      contextRef: { contextId: storageContextId },
      source: 'chat',
      ...(resolved.targetBranch === undefined ? {} : { targetBranch: resolved.targetBranch }),
      ...(costBudgetUsd === null ? {} : { costBudgetUsd }),
      ...(outputLanguage === undefined ? {} : { outputLanguage }),
    }
  }
  ```

  and read it in `createCodingTaskTool.execute()`, right before building the body:

  ```ts
  const outputLanguage = runtimeContext.contextConfig.get('output_language')
  const body = buildCreateTaskBody(args, prompt, runtimeContext.storageContextId, resolved, outputLanguage)
  const result = await callNerv(httpFetch, cfg, 'POST', '/tasks', body)
  ```

- [ ] Run it again — confirm green:

  ```
  $ bun test tests/plugins/nerv/create-task.test.ts
  ```

  Expected output:

  ```
  bun test v1.3.13 (bf2e2cec)

   8 pass
   0 fail
   13 expect() calls
  Ran 8 tests across 1 file. [690.00ms]
  ```

- [ ] Run the full nerv suite (regression check — nothing else reads `RuntimeContext` in a way `contextConfig` would break):

  ```
  $ bun test tests/plugins/nerv/
  ```

  Expected output:

  ```
  bun test v1.3.13 (bf2e2cec)

   41 pass
   0 fail
   79 expect() calls
  Ran 41 tests across 9 files. [640.00ms]
  ```

- [ ] Update docs. In `docs/architecture/coding-stack-overview.md` §3.8, note the new field:

  ```
  `POST /tasks/:id/events`. Admin config `nerv_base_url`/`nerv_token` (bearer, allowlisted via
  `providerAllowedHostsFromConfig`), same shape as acp's `magi_*`. Context-scoped config
  `output_language` (optional; read via `runtimeContext.contextConfig.get('output_language')`) is
  forwarded as `outputLanguage` on `POST /tasks` when set; unset defaults to English on the nerv side.
  There is no separate "steer" tool —
  ```

- [ ] Run typecheck and lint:

  ```
  $ bun run typecheck && bun run lint
  ```

  Expected output:

  ```
  $ tsgo --noEmit
  $ oxlint --config .oxlintrc.json --ignore-path .oxlintignore .
  Found 0 warnings and 0 errors.
  Finished in 3.2s on 2292 files with 204 rules using 12 threads.
  ```

- [ ] Commit:

  ```
  git add plugins/nerv/plugin.json plugins/nerv/tools.ts tests/plugins/nerv/create-task.test.ts \
    docs/architecture/coding-stack-overview.md
  git commit -m "feat(nerv): forward context-scoped output_language on create_coding_task"
  ```

---

### Task 4: Admin health-probe route for nerv connectivity — C5 (backend)

Admins currently have no way to tell, from the settings UI, whether papai can actually reach nerv (misconfigured token/URL, or nerv down) without triggering a real coding task. This adds a small admin-only route that probes nerv's existing `GET /health` endpoint.

**Files:**

- `tests/debug/settings/admin/nerv-health-routes.ts` — new, written first (the write-hook blocks creating the untested implementation file directly)
- `src/debug/settings/admin/nerv-health-routes.ts` — new
- `src/debug/settings-api-router.ts:6-17,34-67` (import + route dispatch)
- `tests/debug/settings-api-router.test.ts:52-68` (new route-dispatch test)

Steps:

- [ ] Attempt to write the implementation file directly — confirm the TDD write-hook blocks it (papai's write-hook requires a corresponding test file to exist first for any new `src/` file):

  ```
  Write src/debug/settings/admin/nerv-health-routes.ts
  ```

  Expected result:

  ```
  Cannot write src/debug/settings/admin/nerv-health-routes.ts because no test file exists.
  Step 1: Write a failing test: tests/debug/settings/admin/nerv-health-routes.test.ts.
  Step 2: Write the implementation to make the test pass.
  ```

- [ ] Write the failing test first, in a new file `tests/debug/settings/admin/nerv-health-routes.test.ts`:

  ```ts
  // SPDX-License-Identifier: BUSL-1.1
  // Copyright (c) 2026 Dmitriy Lazarev
  // Use of this software is governed by the Business Source License 1.1.
  // See LICENSE in the project root for details.

  import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

  import { z } from 'zod'

  import { handleAdminNervHealthRoutes } from '../../../../src/debug/settings/admin/nerv-health-routes.js'
  import { setPluginAdminConfig } from '../../../../src/plugins/store.js'
  import { addAdmin } from '../../../../src/instances/admin-store.js'
  import { addUser } from '../../../../src/users.js'
  import {
    mockLogger,
    restoreFetch,
    seedTestPlatformInstance,
    setMockFetch,
    setupTestDb,
  } from '../../../utils/test-helpers.js'
  import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

  const NervHealthResponseSchema = z.object({ status: z.enum(['connected', 'misconfigured', 'unreachable']) })

  describe('settings admin nerv-health routes', () => {
    let adminSession: SettingsSession
    let userSession: SettingsSession

    beforeEach(async () => {
      mockLogger()
      process.env['INSTANCE_CONFIG_KEY'] = 'e'.repeat(64)
      await setupTestDb()
      seedTestPlatformInstance({ id: 'pi-1' })
      addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
      addUser({ userId: 'user-1', platformInstanceId: 'pi-1', addedBy: 'admin-1', username: undefined })
      addAdmin('admin-1', 'pi-1')
      adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
      userSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'user-1' })
    })

    afterEach(() => {
      restoreFetch()
    })

    test('non-admin cannot read nerv health', async () => {
      const url = new URL('https://x/settings/api/admin/nerv-health')
      const res = await handleAdminNervHealthRoutes(
        new Request(url, { headers: authHeaders(userSession) }),
        url,
        url.pathname,
      )
      expect(res.status).toBe(403)
    })

    test('unauthenticated request returns 401', async () => {
      const url = new URL('https://x/settings/api/admin/nerv-health')
      const res = await handleAdminNervHealthRoutes(new Request(url), url, url.pathname)
      expect(res.status).toBe(401)
    })

    test('unsupported method returns 405', async () => {
      const url = new URL('https://x/settings/api/admin/nerv-health')
      const res = await handleAdminNervHealthRoutes(
        new Request(url, { method: 'POST', headers: authHeaders(adminSession) }),
        url,
        url.pathname,
      )
      expect(res.status).toBe(405)
    })

    test('returns misconfigured when nerv admin config is unset', async () => {
      const url = new URL('https://x/settings/api/admin/nerv-health')
      const res = await handleAdminNervHealthRoutes(
        new Request(url, { headers: authHeaders(adminSession) }),
        url,
        url.pathname,
      )
      expect(res.status).toBe(200)
      const body = NervHealthResponseSchema.parse(await res.json())
      expect(body.status).toBe('misconfigured')
    })

    test('returns connected when nerv responds 200 to /health', async () => {
      setPluginAdminConfig('nerv', 'nerv_base_url', 'http://nerv:9000', 'admin-1')
      setPluginAdminConfig('nerv', 'nerv_token', 'tok', 'admin-1')
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })))
      const url = new URL('https://x/settings/api/admin/nerv-health')
      const res = await handleAdminNervHealthRoutes(
        new Request(url, { headers: authHeaders(adminSession) }),
        url,
        url.pathname,
      )
      expect(res.status).toBe(200)
      const body = NervHealthResponseSchema.parse(await res.json())
      expect(body.status).toBe('connected')
    })

    test('returns unreachable when nerv responds non-2xx', async () => {
      setPluginAdminConfig('nerv', 'nerv_base_url', 'http://nerv:9000', 'admin-1')
      setPluginAdminConfig('nerv', 'nerv_token', 'tok', 'admin-1')
      setMockFetch(() => Promise.resolve(new Response('', { status: 503 })))
      const url = new URL('https://x/settings/api/admin/nerv-health')
      const res = await handleAdminNervHealthRoutes(
        new Request(url, { headers: authHeaders(adminSession) }),
        url,
        url.pathname,
      )
      const body = NervHealthResponseSchema.parse(await res.json())
      expect(body.status).toBe('unreachable')
    })

    test('returns unreachable when the fetch throws', async () => {
      setPluginAdminConfig('nerv', 'nerv_base_url', 'http://nerv:9000', 'admin-1')
      setPluginAdminConfig('nerv', 'nerv_token', 'tok', 'admin-1')
      setMockFetch(() => Promise.reject(new Error('network down')))
      const url = new URL('https://x/settings/api/admin/nerv-health')
      const res = await handleAdminNervHealthRoutes(
        new Request(url, { headers: authHeaders(adminSession) }),
        url,
        url.pathname,
      )
      const body = NervHealthResponseSchema.parse(await res.json())
      expect(body.status).toBe('unreachable')
    })
  })
  ```

- [ ] Run it — confirm it fails for the right reason (module doesn't exist yet):

  ```
  $ bun test tests/debug/settings/admin/nerv-health-routes.test.ts
  ```

  Expected output:

  ```
  bun test v1.3.13 (bf2e2cec)

  tests/debug/settings/admin/nerv-health-routes.test.ts:

  # Unhandled error between tests
  -------------------------------
  error: Cannot find module '../../../../src/debug/settings/admin/nerv-health-routes.js' from '/Users/ki/Projects/yourpapai/papai/tests/debug/settings/admin/nerv-health-routes.test.ts'
  -------------------------------


   0 pass
   1 fail
   1 error
  Ran 1 test across 1 file.
  ```

- [ ] Implement. Create `src/debug/settings/admin/nerv-health-routes.ts`:

  ```ts
  // SPDX-License-Identifier: BUSL-1.1
  // Copyright (c) 2026 Dmitriy Lazarev
  // Use of this software is governed by the Business Source License 1.1.
  // See LICENSE in the project root for details.

  import { getPluginAdminConfig } from '../../../plugins/store.js'
  import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
  import { authenticate, settingsJson } from '../respond.js'
  import { requireAdmin } from './admin-guard.js'

  export type NervHealthStatus = 'connected' | 'misconfigured' | 'unreachable'

  const PROBE_TIMEOUT_MS = 5000

  /**
   * Connectivity probe for the nerv coding-supervisor plugin: reads its admin-scoped config
   * (nerv_base_url/nerv_token) and calls nerv's GET /health liveness endpoint. Never throws —
   * a missing config, a timeout, or a non-2xx all resolve to a status string, never a hard crash.
   */
  export async function probeNervHealth(): Promise<NervHealthStatus> {
    const baseUrl = getPluginAdminConfig('nerv', 'nerv_base_url')
    const token = getPluginAdminConfig('nerv', 'nerv_token')
    if (baseUrl === undefined || baseUrl.trim() === '' || token === undefined || token.trim() === '') {
      return 'misconfigured'
    }
    const url = `${baseUrl.trim().replace(/\/+$/u, '')}/health`
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token.trim()}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      return res.ok ? 'connected' : 'unreachable'
    } catch {
      return 'unreachable'
    }
  }

  async function handleGet(authed: AuthenticatedSettingsRequest): Promise<Response> {
    const guard = requireAdmin(authed, 'read')
    if (guard !== null) return guard
    const status = await probeNervHealth()
    return settingsJson(200, { status })
  }

  export function handleAdminNervHealthRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
    const auth = authenticate(req)
    if (!auth.ok) return Promise.resolve(auth.response)
    if (pathname === '/settings/api/admin/nerv-health') {
      if (req.method === 'GET') return handleGet(auth.authed)
      return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
    }
    return Promise.resolve(settingsJson(404, { error: 'not found' }))
  }
  ```

  Note: `handleAdminNervHealthRoutes` is intentionally **not** `async` — every branch already returns a `Promise<Response>` (either directly from `handleGet`, or wrapped via `Promise.resolve`), and an `async` keyword with no `await` in the function body trips oxlint's `require-await` rule. This mirrors the existing pattern in every sibling route file (e.g. `handleAdminMcpRedactionRoutes` in `src/debug/settings/admin/mcp-redaction-routes.ts`).

- [ ] Run it — confirm green:

  ```
  $ bun test tests/debug/settings/admin/nerv-health-routes.test.ts
  ```

  Expected output:

  ```
  bun test v1.3.13 (bf2e2cec)

   7 pass
   0 fail
   9 expect() calls
  Ran 7 tests across 1 file. [721.00ms]
  ```

- [ ] Write the failing router-dispatch test. In `tests/debug/settings-api-router.test.ts`, add (after the `/settings/api/admin/byok` test):

  ```ts
  test('routes /settings/api/admin/nerv-health (401 without a session)', async () => {
    const res = await routeSettingsApi(
      new Request('https://x/settings/api/admin/nerv-health'),
      new URL('https://x/settings/api/admin/nerv-health'),
    )
    expect(res).not.toBeNull()
    expect(res?.status).toBe(401)
  })
  ```

- [ ] Run it — confirm it fails for the right reason (route not yet registered, so `routeSettingsApi` falls through and returns `null`):

  ```
  $ bun test tests/debug/settings-api-router.test.ts
  ```

  Expected output:

  ```
  bun test v1.3.13 (bf2e2cec)

  tests/debug/settings-api-router.test.ts:
  61 |   test('routes /settings/api/admin/nerv-health (401 without a session)', async () => {
  ...
  66 |     expect(res).not.toBeNull()
                           ^
  error: expect(received).not.toBeNull()

  Received: null

  (fail) routeSettingsApi > routes /settings/api/admin/nerv-health (401 without a session)

   5 pass
   1 fail
   10 expect() calls
  Ran 6 tests across 1 file.
  ```

- [ ] Implement. In `src/debug/settings-api-router.ts`, add the import (alphabetically, between `mcp-redaction-routes` and `plugin-config-routes`):

  ```ts
  import { handleAdminMcpRedactionRoutes } from './settings/admin/mcp-redaction-routes.js'
  import { handleAdminNervHealthRoutes } from './settings/admin/nerv-health-routes.js'
  import { handleAdminPluginConfigRoutes } from './settings/admin/plugin-config-routes.js'
  ```

  and the route line inside `routeAdminApi()`:

  ```ts
  if (p === '/settings/api/admin/mcp-redaction') return handleAdminMcpRedactionRoutes(req, url, p)
  if (p === '/settings/api/admin/nerv-health') return handleAdminNervHealthRoutes(req, url, p)
  if (p === '/settings/api/admin/release-notes') return handleAdminReleaseNotesRoutes(req, url, p)
  ```

- [ ] Run it — confirm green:

  ```
  $ bun test tests/debug/settings-api-router.test.ts
  ```

  Expected output:

  ```
  bun test v1.3.13 (bf2e2cec)

   6 pass
   0 fail
   11 expect() calls
  Ran 6 tests across 1 file. [667.00ms]
  ```

- [ ] Run typecheck and lint (the route handler's non-`async` shape and the test's imports are exactly what previously tripped `require-await` — confirm clean):

  ```
  $ bun run typecheck && bun run lint
  ```

  Expected output:

  ```
  $ tsgo --noEmit
  $ oxlint --config .oxlintrc.json --ignore-path .oxlintignore .
  Found 0 warnings and 0 errors.
  Finished in 3.2s on 2292 files with 204 rules using 12 threads.
  ```

- [ ] Commit:

  ```
  git add src/debug/settings/admin/nerv-health-routes.ts tests/debug/settings/admin/nerv-health-routes.test.ts \
    src/debug/settings-api-router.ts tests/debug/settings-api-router.test.ts
  git commit -m "feat(settings): add admin nerv connectivity health-probe route"
  ```

---

### Task 5: Nerv-health badge in the admin coding-sessions settings UI — C5 (frontend)

Surface the Task 4 probe in the same settings section admins already use for coding guardrails, so checking nerv connectivity doesn't require a separate page or a raw API call.

**Files:**

- `client/settings/fetcher-schemas-coding-guardrails.ts:20-23` (new schema)
- `client/settings/admin-fetchers.ts:30-35,235-236` (new fetcher)
- `client/settings/sections/admin/AdminCodingGuardrailsSection.svelte:6-28,65-74,150-168,418-422` (state, load function, template, style)
- `tests/client/settings/admin-coding-guardrails-section.test.ts` (two new tests)

Steps:

- [ ] Write the failing tests. In `tests/client/settings/admin-coding-guardrails-section.test.ts`, add a helper and two tests at the end of the `describe` block:

  ```ts
  const nervHealthMock =
    (status: 'connected' | 'misconfigured' | 'unreachable') =>
    (url: string): Promise<Response> =>
      url.includes('nerv-health') ? Promise.resolve(json({ status })) : Promise.resolve(json(defaultPayload))
  ```

  ```ts
  test('renders nerv-health-status badge reflecting the probe status', async () => {
    setMockFetch(nervHealthMock('connected'))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminCodingGuardrailsSection, { target })
    await drain()
    const badge = target.querySelector('[data-testid="nerv-health-status"]')
    expect(badge).not.toBeNull()
    expect(badge!.textContent).toContain('Connected')
    void unmount(component)
  })

  test('renders misconfigured nerv-health-status when nerv admin config is unset', async () => {
    setMockFetch(nervHealthMock('misconfigured'))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminCodingGuardrailsSection, { target })
    await drain()
    const badge = target.querySelector('[data-testid="nerv-health-status"]')
    expect(badge!.textContent).toContain('Not configured')
    void unmount(component)
  })
  ```

  Note the top-level (not inline-in-`test()`) `nervHealthMock` helper: an `if`/ternary written directly inside a `test()` callback trips oxlint's `vitest/no-conditional-in-test` rule; hoisting the branch into a plain top-level function (matching the file's existing `captureMock` helper, which does the same for `init?.method`) keeps it clean.

- [ ] Run it — confirm it fails for the right reason (no probe call is made yet, so no badge exists):

  ```
  $ bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/admin-coding-guardrails-section.test.ts
  ```

  Expected output (2 new failures; the 7 pre-existing tests still pass):

  ```
  bun test v1.3.13 (bf2e2cec)

  tests/client/settings/admin-coding-guardrails-section.test.ts:
  (fail) AdminCodingGuardrailsSection > renders nerv-health-status badge reflecting the probe status
  (fail) AdminCodingGuardrailsSection > renders misconfigured nerv-health-status when nerv admin config is unset

   7 pass
   2 fail
   18 expect() calls
  Ran 9 tests across 1 file.
  ```

- [ ] Implement the schema. In `client/settings/fetcher-schemas-coding-guardrails.ts`, add after `AdminCodingGuardrailsResponseSchema`:

  ```ts
  export const NervHealthResponseSchema = z.object({
    status: z.enum(['connected', 'misconfigured', 'unreachable']),
  })
  export type NervHealthResponse = z.infer<typeof NervHealthResponseSchema>
  ```

- [ ] Implement the fetcher. In `client/settings/admin-fetchers.ts`, extend the existing named import from `./fetcher-schemas-coding-guardrails.js`:

  ```ts
  import {
    AdminCodingGuardrailsResponseSchema,
    NervHealthResponseSchema,
    type AdminCodingGuardrailsResponse,
    type NervHealthResponse,
  } from './fetcher-schemas-coding-guardrails.js'
  ```

  and add, after `postAdminCodingGuardrails`:

  ```ts
  export const fetchAdminNervHealth = (): Promise<NervHealthResponse> =>
    getJson('/settings/api/admin/nerv-health', (b) => NervHealthResponseSchema.parse(b))
  ```

- [ ] Implement the UI. In `client/settings/sections/admin/AdminCodingGuardrailsSection.svelte`, extend the imports:

  ```ts
  import { fetchAdminCodingGuardrails, fetchAdminNervHealth, postAdminCodingGuardrails } from '../../admin-fetchers.js'
  import type { AdminCodingGuardrailsResponse, NervHealthResponse } from '../../fetcher-schemas-coding-guardrails.js'
  ```

  add state right after the existing `data`/`error`/`status`/`loading` declarations:

  ```ts
  let nervHealth: NervHealthResponse | null = $state(null)
  let nervHealthLoading = $state(false)

  const NERV_HEALTH_LABEL: Record<NervHealthResponse['status'], string> = {
    connected: 'Connected',
    misconfigured: 'Not configured',
    unreachable: 'Unreachable',
  }
  ```

  add a load function, isolated so a probe failure never blocks the main guardrails UI:

  ```ts
  async function loadNervHealth(): Promise<void> {
    nervHealthLoading = true
    try {
      nervHealth = await fetchAdminNervHealth()
    } catch {
      nervHealth = null
    } finally {
      nervHealthLoading = false
    }
  }
  ```

  wire it into the existing load `$effect`:

  ```ts
  $effect(() => {
    untrack(() => {
      void load()
      void loadNervHealth()
    })
  })
  ```

  add the badge markup right after `PageHeader`:

  ```svelte
  <p class="nerv-health" data-testid="nerv-health-status">
    nerv coding tasks:
    {#if nervHealthLoading}Checking…{:else if nervHealth === null}Unknown{:else}{NERV_HEALTH_LABEL[nervHealth.status]}{/if}
  </p>
  ```

  and a small style rule:

  ```css
  .nerv-health {
    font-size: 13px;
    color: var(--fg2);
    margin: 0 0 8px;
  }
  ```

- [ ] Run it — confirm green:

  ```
  $ bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/admin-coding-guardrails-section.test.ts
  ```

  Expected output:

  ```
  bun test v1.3.13 (bf2e2cec)

   9 pass
   0 fail
   20 expect() calls
  Ran 9 tests across 1 file. [1002.00ms]
  ```

- [ ] Run typecheck and lint:

  ```
  $ bun run typecheck && bun run lint
  ```

  Expected output:

  ```
  $ tsgo --noEmit
  $ oxlint --config .oxlintrc.json --ignore-path .oxlintignore .
  Found 0 warnings and 0 errors.
  Finished in 3.2s on 2292 files with 204 rules using 12 threads.
  ```

- [ ] Commit:

  ```
  git add client/settings/fetcher-schemas-coding-guardrails.ts client/settings/admin-fetchers.ts \
    client/settings/sections/admin/AdminCodingGuardrailsSection.svelte \
    tests/client/settings/admin-coding-guardrails-section.test.ts
  git commit -m "feat(settings-ui): show nerv connectivity badge in admin coding-sessions section"
  ```

---

### Task 6: nerv enablement runbook — C5 (docs)

Docs-only task: give operators a single place to enable nerv correctly (token matrix, config keys) and verify it end-to-end before rolling it out to real users. No test/run step — this is a new markdown file, following the existing style of `docs/deployment/dashboard-access.md` (numbered sections, "Required configuration" bullet lists).

**Files:**

- `docs/deployment/nerv-enablement.md` — new

Steps:

- [ ] Write `docs/deployment/nerv-enablement.md`:

  ```markdown
  <!--
  SPDX-License-Identifier: BUSL-1.1
  Copyright (c) 2026 Dmitriy Lazarev
  Use of this software is governed by the Business Source License 1.1.
  See LICENSE in the project root for details.
  -->

  # Enabling the nerv coding-supervisor plugin

  The `nerv` plugin (`plugins/nerv/`) drives long-running, supervised GitLab-MR coding tasks through
  the external **nerv** service. It ships `defaultEnabled: false` and is fully inert until an admin
  configures it. This runbook covers the token matrix, enabling the plugin, and a smoke-test checklist
  before turning it on for real users.

  ## 1. Token matrix

  nerv sits between papai and magi. Three tokens must line up across the three deployments:

  | papai config                                   | nerv env var         | magi env var                        |
  | ---------------------------------------------- | -------------------- | ----------------------------------- |
  | `nerv_token` (plugin admin config, per-plugin) | `NERV_AUTH_TOKEN`    | —                                   |
  | `NOTIFY_TOKEN` (papai env)                     | `PAPAI_NOTIFY_TOKEN` | —                                   |
  | —                                              | —                    | `MAGI_NOTIFY_URL` → nerv, not papai |

  - `nerv_token` must equal nerv's `NERV_AUTH_TOKEN` — this is the bearer papai sends on every
    `POST /tasks`, `GET /tasks/:id`, `POST /tasks/:id/events` call.
  - papai's `NOTIFY_TOKEN` must equal nerv's `PAPAI_NOTIFY_TOKEN` — nerv relays task milestones back
    through papai's existing `POST /api/notify` (see `docs/architecture/environment.md`), the same
    proactive-notify path already used by other coding-session integrations.
  - magi's `MAGI_NOTIFY_URL` must point at **nerv**, not papai directly — magi only ever talks to
    nerv; nerv is the one that talks to papai. Getting this backwards silently breaks status updates
    without any error surfaced to the operator.

  ## 2. Required papai configuration

  In the settings UI, admin section, plugin config for `nerv`:

  - `nerv_base_url` — nerv's reachable base URL (e.g. `https://nerv.internal.example.com`).
  - `nerv_token` — the bearer token, must equal nerv's `NERV_AUTH_TOKEN` (see above).

  Per group/context (optional, settings UI, plugin config for `nerv`, context scope):

  - `output_language` — e.g. `English`, `Russian`. Governs the language nerv writes its task output
    and follow-up responses in. Unset defaults to English on the nerv side.

  ## 3. Enabling the plugin

  1. Set `nerv_base_url` / `nerv_token` as above.
  2. In the settings UI admin Plugins section, enable `nerv` for the target platform instance (it
     ships `defaultEnabled: false`).
  3. Verify connectivity: **Admin · Coding sessions** in the settings UI shows a "nerv coding
     tasks:" status line — it must read **Connected**. **Not configured** means
     `nerv_base_url`/`nerv_token` are missing; **Unreachable** means nerv is unreachable or
     erroring — check the token matrix above and nerv's own logs before proceeding.

  ## 4. Smoke-test checklist (manual, staging)

  Run through this full loop in a staging platform instance before enabling nerv for real users:

  - [ ] **Create** — ask the bot to supervise an MR on a configured repo (`create_coding_task`);
        confirm a task record appears and nerv opens/updates a merge request.
  - [ ] **PR** — confirm the MR link surfaces via `coding_task_status`/`list_coding_tasks`.
  - [ ] **Review-comment fix** — leave a review comment on the MR; confirm the task iterates on it.
  - [ ] **CI fix** — break CI on the MR; confirm the task pushes a fix and CI goes green.
  - [ ] **Cancel-and-reap** — cancel the task mid-flight (`cancel_coding_task`); confirm the task
        closes and the underlying magi session(s) are torn down (not left running).
  - [ ] **Language toggle** — set `output_language` to a non-English value for a test group, create
        a task, and confirm the task's primary output (not just a hardcoded string) is in that
        language; confirm an unset `output_language` still defaults to English.
  - [ ] **Follow-up** — while a task is running, send a follow-up instruction
        (`followup_coding_task`); confirm it is honestly acknowledged only when actually applied
        (not a blanket "done").

  Only flip `nerv` to enabled for production groups once every item above is checked.
  ```

- [ ] Commit:

  ```
  git add docs/deployment/nerv-enablement.md
  git commit -m "docs(nerv): add enablement runbook (token matrix, config keys, smoke-test checklist)"
  ```
