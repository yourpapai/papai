<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Remove deferred-prompt execution modes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the three deferred-prompt execution modes (`lightweight`/`context`/`full`) into one unified full run that always exposes the task-tracker toolset, kept lean by wiring progressive disclosure into the proactive firing path.

**Architecture:** The proactive path (`src/deferred-prompts/`) currently branches on a stored `mode` field and, in `full` mode, serializes the entire toolset because progressive disclosure was never wired into it. We first make the `full` path lean by adding disclosure (additive, de-risks the linchpin), then route every prompt through it, then delete the now-dead `mode` field and its branches.

**Tech Stack:** Bun, TypeScript (strict, `.js` import extensions), Zod v4, Vercel AI SDK (`generateText`), `bun test`.

## Global Constraints

- Runtime **Bun**; validation **Zod v4**; LLM via **Vercel AI SDK**.
- Strict TypeScript; **use `.js` extension in import paths**.
- Error extraction: `error instanceof Error ? error.message : String(error)`.
- **Never add lint-disable or type-ignore comments** — fix the underlying issue.
- Every deferred prompt fires on the **main model** (no small-model branch).
- **No DB migration** — the `execution_metadata` column is retained; Zod strips the legacy `mode` key from old rows automatically.
- Result compaction stays **out of scope** — disclosure only; `expand_result` is not registered in the proactive path.
- Structured, metadata-first pino logging; never log tokens/keys.
- Commit after every green task. Never commit with failing checks (the pre-commit hook runs lint/typecheck/format/license-headers).

## File Structure

**Modified — disclosure wiring (Task 1):**

- `src/deferred-prompts/proactive-llm-full.ts` — `buildFullToolSet` applies `maybeApplyDisclosure`, returns the session.
- `src/deferred-prompts/proactive-llm-helpers.ts` — `FullGenerationInput` gains `disclosure`; `buildFullSystemPrompt` enables `progressiveDisclosure`.
- `src/deferred-prompts/proactive-llm.ts` — `prepareFullGenerationInput` threads the session; `runFullGeneration` attaches the disclosure `prepareStep`.

**Modified — unify dispatch (Task 2):**

- `src/deferred-prompts/proactive-llm.ts` — delete `invokeLightweight`/`invokeWithContext`; `dispatchExecution` always runs full; drop `smallModel` from `LlmConfig`.
- `src/deferred-prompts/proactive-llm-helpers.ts` — delete `modelIdForLightweight`, `buildContextMessages`, `buildMinimalSystemPrompt`, `persistLightweightResponse`, `persistContextResponse`.

**Modified — remove `mode` (Task 3):**

- `src/deferred-prompts/types.ts` — remove `EXECUTION_MODES`/`ExecutionMode`; drop `mode` from schemas + default.
- `src/deferred-prompts/poller-scheduled.ts` — `mergeExecutionMetadata` loses priority logic.
- `src/deferred-prompts/poller.ts` — drop `mode` from log.
- `src/deferred-prompts/tool-handlers.ts` — `ExecutionInput` drops `mode`.
- `src/deferred-prompts/schedule-update-helpers.ts` — `parseExecution` input type drops `mode`.
- `src/deferred-prompts/proactive-llm-helpers.ts` — `finalizeAndLog` drops the `mode` param.
- `src/deferred-prompts/proactive-llm.ts` — update `finalizeAndLog` call site.
- `src/tools/create-deferred-prompt.ts`, `src/tools/update-deferred-prompt.ts` — tool description/schema no longer mention modes.

**Modified — docs (Task 4):**

- `docs/architecture/tools.md`, `src/tools/CLAUDE.md`.

**Tests:** `tests/deferred-prompts/proactive-llm.test.ts` (currently `execution-modes` oriented), `tests/deferred-prompts/poller-scheduled.test.ts`, `tests/deferred-prompts/proactive-llm-full.test.ts`, `tests/deferred-prompts/tool-handlers.test.ts`, `tests/deferred-prompts/tools.test.ts`, `tests/deferred-prompts/proactive-llm-helpers.test.ts`, `tests/deferred-prompts/poller.test.ts`.

---

## Task 1: Wire progressive disclosure into the proactive full path

Additive change — no `mode` touched. After this task, `full`-mode runs expose `search_tools`/`load_tool` and gate tool schemas per step, exactly like normal chat. This de-risks the two design unknowns (disclosure standalone in a `generateText`-direct context; `turnId` synthesis) before any removal.

**Files:**

- Modify: `src/deferred-prompts/proactive-llm-full.ts` (`buildFullToolSet`)
- Modify: `src/deferred-prompts/proactive-llm-helpers.ts` (`FullGenerationInput`, `buildFullSystemPrompt`)
- Modify: `src/deferred-prompts/proactive-llm.ts` (`prepareFullGenerationInput`, `runFullGeneration`)
- Test: `tests/deferred-prompts/proactive-llm-full.test.ts`

**Interfaces:**

- Consumes: `maybeApplyDisclosure(tools, contextId, retriever)` from `../tools/disclosure/wire.js` → `{ tools: ToolSet; disclosure: DisclosureSession }`; `getToolRetriever(configContextId, callContext)` from `../tools/disclosure/embedding-tool-retriever.js`; `createDisclosurePrepareStep(session, contextId, turnId?)` from `../tools/disclosure/prepare-step.js`; `getConfigContextIdFromStorageContextId` from `../chat/scoped-context.js`.
- Produces: `buildFullToolSet(...)` now returns `{ tools; enabledToolNames; disclosure: DisclosureSession }`. `FullGenerationInput` gains `disclosure: DisclosureSession`.

- [ ] **Step 1: Write the failing test**

Add to `tests/deferred-prompts/proactive-llm-full.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import { buildFullToolSet } from '../../src/deferred-prompts/proactive-llm-full.js'
import { createMockProvider } from '../tools/mock-provider.js'

describe('buildFullToolSet disclosure wiring', () => {
  test('injects search_tools and load_tool and returns a disclosure session', async () => {
    const provider = createMockProvider()
    const { tools, disclosure } = await buildFullToolSet(provider, 'user-1', 'ctx-1', 'dm', 'remind me')
    expect(Object.keys(tools)).toContain('search_tools')
    expect(Object.keys(tools)).toContain('load_tool')
    expect(disclosure).toBeDefined()
    expect(typeof disclosure.activeToolNames).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/proactive-llm-full.test.ts -t "disclosure wiring"`
Expected: FAIL — `tools` has no `search_tools`/`load_tool`, and the returned object has no `disclosure`.

- [ ] **Step 3: Update `buildFullToolSet` to apply disclosure**

In `src/deferred-prompts/proactive-llm-full.ts`, add imports at the top of the import block:

```typescript
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { getToolRetriever } from '../tools/disclosure/embedding-tool-retriever.js'
import { maybeApplyDisclosure } from '../tools/disclosure/wire.js'
import type { DisclosureSession } from '../tools/disclosure/registry.js'
```

Replace the body of `buildFullToolSet` (keep its existing parameter list) so the return type and final lines become:

```typescript
export async function buildFullToolSet(
  provider: TaskProvider | null,
  createdByUserId: string,
  storageContextId: string,
  contextType: 'dm' | 'group',
  _prompt: string,
): Promise<{
  tools: ToolSet
  enabledToolNames: ReadonlySet<string>
  disclosure: DisclosureSession
}> {
  const options = {
    storageContextId,
    chatUserId: createdByUserId,
    mode: 'proactive' as const,
    contextType,
  }
  const fullTools =
    provider === null
      ? applyToolPreferences(await buildProviderlessToolDescriptors(options), storageContextId, undefined)
      : await makeTools(provider, options)
  const retriever = getToolRetriever(getConfigContextIdFromStorageContextId(storageContextId), {
    storageContextId,
    contextType,
    chatUserId: createdByUserId,
  })
  const { tools, disclosure } = maybeApplyDisclosure(fullTools, storageContextId, retriever)
  return { tools, enabledToolNames: new Set(Object.keys(tools)), disclosure }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/proactive-llm-full.test.ts -t "disclosure wiring"`
Expected: PASS.

- [ ] **Step 5: Thread the session through `FullGenerationInput` and enable the prompt fragment**

In `src/deferred-prompts/proactive-llm-helpers.ts`:

Add the import:

```typescript
import type { DisclosureSession } from '../tools/disclosure/registry.js'
```

Extend `FullGenerationInput`:

```typescript
export type FullGenerationInput = Readonly<{
  storageContextId: string
  tools: ToolSet
  systemPrompt: string
  messages: ModelMessage[]
  disclosure: DisclosureSession
}>
```

Update `buildFullSystemPrompt` to turn on the disclosure preamble:

```typescript
export const buildFullSystemPrompt = (
  provider: TaskProvider | null,
  storageContextId: string,
  enabledToolNames: ReadonlySet<string>,
): string =>
  provider === null
    ? buildProviderlessSystemPrompt(storageContextId, enabledToolNames, {
        askPermissionAvailable: false,
        progressiveDisclosure: true,
      })
    : buildSystemPrompt(provider, storageContextId, enabledToolNames, {
        askPermissionAvailable: false,
        progressiveDisclosure: true,
      })
```

- [ ] **Step 6: Thread the session in `prepareFullGenerationInput` and attach the prepareStep in `runFullGeneration`**

In `src/deferred-prompts/proactive-llm.ts`, add the import:

```typescript
import { createDisclosurePrepareStep } from '../tools/disclosure/prepare-step.js'
```

In `prepareFullGenerationInput`, capture `disclosure` from `buildFullToolSet` and include it in the returned object:

```typescript
const { tools, enabledToolNames, disclosure } = await buildFullToolSet(
  provider,
  createdByUserId,
  storageContextId,
  deliveryTarget.contextType,
  prompt,
)
const systemPrompt = buildFullSystemPrompt(provider, storageContextId, enabledToolNames)
const { messages } = buildFullMessages(
  createdByUserId,
  storageContextId,
  type,
  prompt,
  matchedTasksSummary,
  metadata,
  deliveryTarget.contextType,
)
return { storageContextId, tools, systemPrompt, messages, disclosure }
```

In `runFullGeneration`, mint a synthetic turn id and attach the prepareStep to the `generateText` call:

```typescript
const prepared = await prepareFullGenerationInput(execCtx, type, prompt, metadata, matchedTasksSummary, provider)
const turnId = `proactive:${prepared.storageContextId}:${String(Date.now())}`
log.debug(
  {
    userId: createdByUserId,
    mainModel: config.mainModel,
    historyLength: prepared.messages.length,
  },
  'generateText',
)
const result = await deps.generateText({
  model,
  system: prepared.systemPrompt,
  messages: prepared.messages,
  tools: prepared.tools,
  stopWhen: deps.stepCountIs(25),
  timeout: 1_200_000,
  prepareStep: createDisclosurePrepareStep(prepared.disclosure, prepared.storageContextId, turnId),
})
```

(Note: the `mode: 'full'` key was removed from this `log.debug` metadata — Task 3 removes the field type; removing it here now is harmless and avoids a later edit.)

- [ ] **Step 7: Run the full deferred suite + typecheck**

Run: `bun test tests/deferred-prompts/ && bun run typecheck`
Expected: PASS. Existing full-mode tests still pass; the new disclosure test passes; no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/deferred-prompts/proactive-llm-full.ts src/deferred-prompts/proactive-llm-helpers.ts src/deferred-prompts/proactive-llm.ts tests/deferred-prompts/proactive-llm-full.test.ts
git commit -m "feat(deferred): wire progressive disclosure into proactive full path"
```

---

## Task 2: Route every deferred prompt through the unified full run

Make `dispatchExecution` always invoke the full path and delete the lightweight/context invocation code. The `mode` field still exists on the type after this task (removed in Task 3) but is no longer read for behavior.

**Files:**

- Modify: `src/deferred-prompts/proactive-llm.ts` (delete `invokeLightweight`, `invokeWithContext`; simplify `dispatchExecution`; drop `smallModel`)
- Modify: `src/deferred-prompts/proactive-llm-helpers.ts` (delete now-dead helpers)
- Test: `tests/deferred-prompts/proactive-llm.test.ts`

**Interfaces:**

- Consumes: `invokeFull(...)` (unchanged signature) from `proactive-llm.ts`.
- Produces: `dispatchExecution(...)` unchanged public signature; always runs the full path regardless of stored metadata.

- [ ] **Step 1: Rewrite the dispatch test to assert unified behavior**

In `tests/deferred-prompts/proactive-llm.test.ts`, replace the mode-branching assertions with a single assertion that any metadata routes through the full toolset. Add this test (adapt the existing harness/mocks already in the file for building `execCtx`, seeding the admin LLM binding, and capturing `generateText` calls):

```typescript
test('dispatchExecution always builds the full toolset regardless of stored metadata', async () => {
  // metadata that used to select the "lightweight" branch must now still expose task tools
  const metadata = {
    delivery_brief: 'be brief',
    context_snapshot: null,
  } as unknown as ExecutionMetadata
  const execCtx = makeExecCtx() // existing helper in this file
  await dispatchExecution(execCtx, 'scheduled', 'ping', metadata, () => createMockProvider())
  const call = lastGenerateTextCall() // existing helper capturing the mocked generateText args
  const toolNames = Object.keys(call.tools as Record<string, unknown>)
  expect(toolNames).toContain('search_tools')
  expect(toolNames).toContain('load_tool')
})
```

Delete any existing tests that assert lightweight uses the small model, that context mode omits tools, or that `dispatchExecution` branches on `metadata.mode`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/proactive-llm.test.ts -t "always builds the full toolset"`
Expected: FAIL — with a `lightweight`-shaped metadata the current `dispatchExecution` calls `invokeLightweight`, whose toolset is `get_current_time` only.

- [ ] **Step 3: Simplify `dispatchExecution` and delete the branch functions**

In `src/deferred-prompts/proactive-llm.ts`, replace `dispatchExecution` with:

```typescript
export function dispatchExecution(...args: DispatchExecutionArgs): Promise<string> {
  const [execCtx, type, prompt, metadata, buildProviderFn, matchedTasksSummary, deps] = args
  const { createdByUserId } = execCtx
  const resolvedDeps = resolveDeps(deps)
  log.debug({ userId: createdByUserId }, 'dispatchExecution called')
  return invokeFull(execCtx, type, prompt, metadata, buildProviderFn, matchedTasksSummary, resolvedDeps)
}
```

Delete the entire `invokeLightweight` function and the entire `invokeWithContext` function.

- [ ] **Step 4: Drop `smallModel` from the LLM config**

In `src/deferred-prompts/proactive-llm.ts`:

Change the type:

```typescript
type LlmConfig = { apiKey: string; baseURL: string; mainModel: string }
```

In `getLlmConfig`, drop the `smallModel` line from the returned object:

```typescript
return {
  apiKey: resolved.main.apiKey,
  baseURL: resolved.main.baseUrl,
  mainModel: resolved.main.model,
}
```

Remove the now-unused import `modelIdForLightweight` from the `./proactive-llm-helpers.js` import list.

- [ ] **Step 5: Delete the now-dead helpers**

In `src/deferred-prompts/proactive-llm-helpers.ts`, delete these exported functions (all were used only by the deleted lightweight/context branches):

- `modelIdForLightweight`
- `buildContextMessages`
- `buildMinimalSystemPrompt`
- `persistLightweightResponse`
- `persistContextResponse`

Remove any imports left unused by these deletions (e.g. `buildMessagesWithMemory` if no longer referenced — verify with the typecheck in Step 6; `persistProactiveResults` and `buildMetadataMessages` stay).

- [ ] **Step 6: Run tests + typecheck + lint**

Run: `bun test tests/deferred-prompts/ && bun run typecheck && bun run lint`
Expected: PASS. Lint flags any leftover unused import — remove it. If `proactive-llm.test.ts` still imports a helper you deleted, drop that import and its test.

- [ ] **Step 7: Commit**

```bash
git add src/deferred-prompts/proactive-llm.ts src/deferred-prompts/proactive-llm-helpers.ts tests/deferred-prompts/proactive-llm.test.ts
git commit -m "refactor(deferred): route all prompts through the unified full run"
```

---

## Task 3: Remove the `mode` field and all remaining references

With nothing reading `mode` for behavior, delete it from the schema, types, merge logic, logs, and tool surface. Zod strips the legacy key from old DB rows, so no migration is needed.

**Files:**

- Modify: `src/deferred-prompts/types.ts`
- Modify: `src/deferred-prompts/poller-scheduled.ts`
- Modify: `src/deferred-prompts/poller.ts`
- Modify: `src/deferred-prompts/tool-handlers.ts`
- Modify: `src/deferred-prompts/schedule-update-helpers.ts`
- Modify: `src/deferred-prompts/proactive-llm-helpers.ts` (`finalizeAndLog`)
- Modify: `src/deferred-prompts/proactive-llm.ts` (`finalizeAndLog` call site)
- Modify: `src/tools/create-deferred-prompt.ts`, `src/tools/update-deferred-prompt.ts`
- Test: `tests/deferred-prompts/poller-scheduled.test.ts`, `tests/deferred-prompts/tool-handlers.test.ts`, `tests/deferred-prompts/tools.test.ts`

**Interfaces:**

- Produces: `ExecutionMetadata = { delivery_brief: string; context_snapshot: string | null }` (no `mode`). `mergeExecutionMetadata(prompts)` returns that shape. `finalizeAndLog(result, userId, verification?)` — the `mode` positional param is removed.

- [ ] **Step 1: Write the failing legacy-row + merge tests**

In `tests/deferred-prompts/proactive-llm-helpers.test.ts` (or the file that tests `parseExecutionMetadata`), add:

```typescript
import { parseExecutionMetadata } from '../../src/deferred-prompts/types.js'

test('parseExecutionMetadata drops a legacy mode key from old rows', () => {
  const parsed = parseExecutionMetadata('{"mode":"context","delivery_brief":"hi","context_snapshot":null}')
  expect(parsed).toEqual({ delivery_brief: 'hi', context_snapshot: null })
  expect('mode' in parsed).toBe(false)
})
```

In `tests/deferred-prompts/poller-scheduled.test.ts`, replace any mode-priority assertion with:

```typescript
test('mergeExecutionMetadata concatenates briefs and snapshots without a mode', () => {
  const merged = mergeExecutionMetadata([
    makeScheduledPrompt({
      executionMetadata: { delivery_brief: 'a', context_snapshot: null },
    }),
    makeScheduledPrompt({
      executionMetadata: { delivery_brief: 'b', context_snapshot: 's' },
    }),
  ])
  expect(merged).toEqual({
    delivery_brief: 'a\n---\nb',
    context_snapshot: 's',
  })
  expect('mode' in merged).toBe(false)
})
```

(`makeScheduledPrompt` is the existing test factory in that file — adjust its `executionMetadata` fixtures to drop `mode`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/deferred-prompts/poller-scheduled.test.ts tests/deferred-prompts/proactive-llm-helpers.test.ts`
Expected: FAIL — `parseExecutionMetadata` currently returns an object containing `mode`; `mergeExecutionMetadata` returns one too.

- [ ] **Step 3: Remove `mode` from `types.ts`**

In `src/deferred-prompts/types.ts`:

Delete these two lines:

```typescript
export const EXECUTION_MODES = ['lightweight', 'context', 'full'] as const
export type ExecutionMode = (typeof EXECUTION_MODES)[number]
```

Change `executionMetadataSchema`:

```typescript
export const executionMetadataSchema = z.object({
  delivery_brief: z.string(),
  context_snapshot: z.string().nullable().default(null),
})
```

Change `DEFAULT_EXECUTION_METADATA`:

```typescript
export const DEFAULT_EXECUTION_METADATA: ExecutionMetadata = {
  delivery_brief: '',
  context_snapshot: null,
}
```

Change `executionInputSchema` — drop the `mode` field and rewrite the top-level description:

```typescript
export const executionInputSchema = z
  .object({
    delivery_brief: z
      .string()
      .describe('Freeform instructions for the executing LLM: intent, tone, key details, entities to reference.'),
    context_snapshot: z
      .string()
      .optional()
      .describe(
        'When the user references something from the current conversation, distill only the relevant parts into a summary here.',
      ),
  })
  .optional()
  .describe('Delivery instructions for the firing LLM.')
```

- [ ] **Step 4: Simplify `mergeExecutionMetadata`**

In `src/deferred-prompts/poller-scheduled.ts`:

Delete the `MODE_PRIORITY` and `MODE_BY_PRIORITY` constants and drop `ExecutionMode` from the type import. Rewrite the function:

```typescript
export function mergeExecutionMetadata(prompts: ScheduledPrompt[]): ExecutionMetadata {
  const briefs: string[] = []
  const snapshots: string[] = []

  for (const prompt of prompts) {
    const metadata = prompt.executionMetadata
    if (metadata.delivery_brief !== '') briefs.push(metadata.delivery_brief)
    if (metadata.context_snapshot !== null) snapshots.push(metadata.context_snapshot)
  }

  return {
    delivery_brief: briefs.join('\n---\n'),
    context_snapshot: snapshots.length > 0 ? snapshots.join('\n---\n') : null,
  }
}
```

- [ ] **Step 5: Drop `mode` from the poller log and the metadata input types**

In `src/deferred-prompts/poller.ts`, change the log call to:

```typescript
log.debug({ userId: createdByUserId, promptCount: prompts.length, promptIds }, 'Executing scheduled prompts')
```

In `src/deferred-prompts/tool-handlers.ts`, change `ExecutionInput`:

```typescript
type ExecutionInput = { delivery_brief: string } & Partial<Readonly<{ context_snapshot: string }>>
```

In `src/deferred-prompts/schedule-update-helpers.ts`, change the `parseExecution` parameter type:

```typescript
export function parseExecution(
  input: ({ delivery_brief: string } & Partial<Readonly<{ context_snapshot: string }>>) | undefined,
): ExecutionMetadata {
```

- [ ] **Step 6: Drop the `mode` param from `finalizeAndLog`**

In `src/deferred-prompts/proactive-llm-helpers.ts`, change the `finalizeAndLog` signature and its log metadata:

```typescript
export const finalizeAndLog = async (
  result: DeliveryResultLike & { response?: { messages: readonly ModelMessage[] } },
  userId: string,
  verification?: { verifier: VerifierDeps; history: readonly ModelMessage[] },
): Promise<string> => {
  const stepCount = Array.isArray(result.steps) ? result.steps.length : undefined
  const meta = { userId, finishReason: result.finishReason, stepCount }
```

(The rest of the function body is unchanged.) In `src/deferred-prompts/proactive-llm.ts`, update the single `finalizeAndLog` call inside `runFullGeneration` to drop the `'full'` argument:

```typescript
return finalizeAndLog(
  result,
  createdByUserId,
  buildProactiveVerification(deps, model, prepared.tools, [...prepared.messages, ...result.response.messages]),
)
```

- [ ] **Step 7: Clean the tool description + schema imports**

In `src/tools/create-deferred-prompt.ts`, change `buildToolDescription` so the `allowTaskConditions` branch reads:

```typescript
    ? 'Create a scheduled task or monitoring alert. Provide either a schedule (for time-based) or a condition (for event-based), not both.'
```

(`executionInputSchema` is imported from `types.ts` and already updated in Step 3 — no further change in `create-deferred-prompt.ts` or `update-deferred-prompt.ts` beyond confirming they still compile.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test tests/deferred-prompts/poller-scheduled.test.ts tests/deferred-prompts/proactive-llm-helpers.test.ts`
Expected: PASS.

- [ ] **Step 9: Full deferred + tools suite, typecheck, lint**

Run: `bun test tests/deferred-prompts/ tests/tools/tools-builder.test.ts && bun run typecheck && bun run lint`
Expected: PASS. Fix any remaining test fixtures that still set `mode:` on `executionMetadata`/`execution` inputs (search: `grep -rn "mode:" tests/deferred-prompts`), and any lingering import of the deleted `EXECUTION_MODES`/`ExecutionMode`.

- [ ] **Step 10: Grep for stragglers**

Run:

```bash
grep -rniE "lightweight|EXECUTION_MODES|ExecutionMode|MODE_PRIORITY|modelIdForLightweight" src
```

Expected: no matches in `src/`. (`smallModel` still legitimately appears in memory/group-history/provider code — that is expected and out of scope.)

- [ ] **Step 11: Commit**

```bash
git add src/deferred-prompts/ src/tools/create-deferred-prompt.ts src/tools/update-deferred-prompt.ts tests/deferred-prompts/
git commit -m "refactor(deferred): remove execution mode field and its references"
```

---

## Task 4: Update documentation

**Files:**

- Modify: `docs/architecture/tools.md`
- Modify: `src/tools/CLAUDE.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Update `docs/architecture/tools.md`**

In the **Progressive disclosure (always on)** paragraph, the text says disclosure runs via the normal `buildFullToolSet` and that "proactive runs never compact". Update it to state that the **proactive/deferred path also applies progressive disclosure** (via its own `buildFullToolSet` in `src/deferred-prompts/proactive-llm-full.ts`, attaching the prepareStep in `runFullGeneration`), while **still not compacting** (so `expand_result` remains unregistered there). Leave the compaction paragraph's "proactive runs never compact" claim intact.

- [ ] **Step 2: Update `src/tools/CLAUDE.md`**

The Progressive disclosure bullet describes `maybeApplyDisclosure` running in `buildFullToolSet` with `invokeModel` attaching the prepareStep. Add a sentence noting the deferred/proactive path now also wires disclosure through its own `buildFullToolSet` + a standalone `createDisclosurePrepareStep` on the direct `generateText` call, and that the three deferred-prompt execution modes were removed — every deferred prompt now runs the unified full path on the main model.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/tools.md src/tools/CLAUDE.md
git commit -m "docs: proactive path now uses progressive disclosure; modes removed"
```

---

## Self-Review

**Spec coverage:**

- Remove modes from `types.ts` → Task 3 Step 3. ✓
- Delete `invokeLightweight`/`invokeWithContext`, collapse `dispatchExecution`, drop `smallModel`/`modelIdForLightweight` → Task 2. ✓
- Remove dead helpers (`buildContextMessages`, `buildMinimalSystemPrompt`, `persist*`) → Task 2 Step 5. ✓
- Simplify `mergeExecutionMetadata` → Task 3 Step 4. ✓
- Poller log, `ExecutionInput`, `parseExecution`, `finalizeAndLog` → Task 3 Steps 5–6. ✓
- Tool description/schema cleanup → Task 3 Steps 3/7. ✓
- Wire disclosure (`maybeApplyDisclosure`, `progressiveDisclosure: true`, `createDisclosurePrepareStep`, `turnId` synthesis) → Task 1. ✓
- No DB migration; legacy-row parse test → Task 3 Step 1. ✓
- Docs drift (`tools.md`, `CLAUDE.md`) → Task 4. ✓
- Disclosure-in-proactive test → Task 1 Step 1; per-step gating covered by the unified-dispatch toolset test (Task 2 Step 1). ✓

**Placeholder scan:** No TBD/TODO; every code step shows the code. ✓

**Type consistency:** `ExecutionMetadata` reduced to `{ delivery_brief; context_snapshot }` consistently across schema, merge, and input types; `buildFullToolSet` return `{ tools; enabledToolNames; disclosure }` matches `FullGenerationInput`'s new `disclosure` field and its consumption in `runFullGeneration`; `finalizeAndLog`'s dropped `mode` param matches its single updated call site. ✓
