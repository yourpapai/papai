<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Providerless Task-Tracker Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let papai continue serving normal LLM turns when the task provider cannot be resolved, while clearly explaining task-tracker unavailability through a providerless prompt and reduced tool surface.

**Architecture:** Split the runtime into two invocation modes. Provider-backed turns stay as they are; unresolved-provider turns use a providerless system prompt plus provider-independent tools only. Remove the regex-based tool router entirely so the reduced tool surface is deterministic and mode-based instead of heuristic.

**Tech Stack:** Bun, TypeScript, Vercel AI SDK, SQLite/Drizzle, bun:test

---

**Execution note:** This plan intentionally omits git commit steps. Only commit if the user explicitly asks for it.

## File Map

- Modify: `src/system-prompt.ts:14-226`
  - Add a providerless prompt builder and shared prompt assembly helpers.
- Modify: `src/llm-orchestrator-types.ts:14-71`
  - Make invocation args support `TaskProvider | null` and remove routing telemetry.
- Modify: `src/llm-orchestrator-invoke.ts:200-239`
  - Select provider-backed vs providerless system prompt at model-call time.
- Test: `tests/system-prompt.test.ts`
  - Covers providerless prompt wording and guardrails.

- Modify: `src/tools/tools-builder.ts:78-285`
  - Split provider-independent vs provider-dependent tool assembly.
- Modify: `src/tools/index.ts:23-169`
  - Add a providerless descriptor builder that can still merge user MCP and plugin MCP tools without a `TaskProvider`.
- Modify: `src/llm-orchestrator-tools.ts:26-151`
  - Prepare provider-backed and providerless invocations without heuristic routing.
- Test: `tests/tools/tools-builder.test.ts`
  - Covers providerless tool inclusion/exclusion.
- Test: `tests/llm-orchestrator-tools.test.ts`
  - Covers providerless descriptor caching and enabled-tool derivation.

- Modify: `src/llm-orchestrator.ts:123-220`
  - Remove the hard stop on unresolved providers, stop using `ensureRequiredConfig()` as a turn gate, and invoke providerless mode.
- Modify: `tests/llm-orchestrator.test.ts:400-543`
  - Replace old `/config` early-return assertions with providerless-turn assertions.

- Delete: `src/tools/tool-router.ts`
  - Remove regex-based tool routing.
- Modify: `src/commands/context-tool-resolution.ts:13-128`
  - Stop routing `/context` tool surfaces by last user text.
- Modify: `src/commands/context.ts:17-127`
  - Remove routing info plumbing from context snapshot assembly.
- Modify: `src/commands/context-collector.ts:18-35,212-230`
  - Simplify tool-surface detail text.
- Modify: `src/deferred-prompts/proactive-llm-full.ts:18-32`
  - Stop heuristic pruning in proactive mode.
- Modify: `scripts/tool-surface-benchmark-scenarios.ts:6-54`
  - Remove direct-routed benchmark mode.
- Test: `tests/commands/context-tool-resolution.test.ts`
  - Remove routing assertions.
- Delete: `tests/tools/tool-router.test.ts`
  - Delete the obsolete router suite.
- Modify: `tests/scripts/tool-surface-benchmark-scenarios.test.ts`
  - Update benchmark expectations after routed mode removal.

### Task 1: Add the Providerless Prompt Path

**Files:**

- Modify: `src/system-prompt.ts:14-226`
- Modify: `src/llm-orchestrator-types.ts:14-71`
- Modify: `src/llm-orchestrator-invoke.ts:200-239`
- Test: `tests/system-prompt.test.ts`

- [ ] **Step 1: Write the failing providerless-prompt tests**

```ts
import { beforeEach, describe, expect, test, mock } from 'bun:test'

import { buildProviderlessSystemPrompt } from '../src/system-prompt.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('buildProviderlessSystemPrompt', () => {
  beforeEach(async () => {
    mockLogger()
    mock.restore()
    await setupTestDb()
  })

  test('explains task tracker unavailability and recovery path', () => {
    const prompt = buildProviderlessSystemPrompt('ctx-providerless', new Set(['web_fetch', 'get_current_time']))

    expect(prompt).toContain('task tracker tools are unavailable')
    expect(prompt).toContain('/config')
    expect(prompt).toContain('bot admin')
  })

  test('forbids pretending to inspect tracker data', () => {
    const prompt = buildProviderlessSystemPrompt('ctx-providerless', new Set(['web_fetch', 'get_current_time']))

    expect(prompt).toContain('must not pretend')
    expect(prompt).toContain('inspect, search, create, update, or comment on tracker data')
  })
})
```

- [ ] **Step 2: Run the prompt test and verify it fails**

Run: `bun test tests/system-prompt.test.ts`

Expected: FAIL with `buildProviderlessSystemPrompt` missing from `src/system-prompt.ts`.

- [ ] **Step 3: Implement the providerless system prompt and nullable invoke contract**

```ts
// src/system-prompt.ts
const PROVIDERLESS_INTRO = `You are papai, a personal assistant.

Task tracker tools are unavailable in this chat because task tracker configuration is missing or incomplete.
You must not pretend you can inspect, search, create, update, or comment on tracker data.
When the user asks for task-tracker-backed help, explain that those tools are unavailable and suggest checking /config or asking the bot admin.`

function assembleBasePrompt(
  intro: string,
  contextId: string,
  enabledToolNames: ReadonlySet<string> | undefined,
  options: AssembleOptions,
): string {
  const sharedContextId = getConfigContextIdFromStorageContextId(contextId)
  const parts: string[] = [intro]
  for (const fragment of FRAGMENTS) {
    if (fragmentIncluded(fragment, enabledToolNames)) parts.push(fragment.text)
  }
  parts.push(buildOutputRules(enabledToolNames))
  if (enabledToolNames !== undefined) {
    const prefs = getToolPrefs(sharedContextId)
    const unavailable = buildUnavailableLine(prefs, enabledToolNames)
    if (unavailable !== null) parts.push(unavailable)
    if (options.askPermissionAvailable) {
      const askLine = buildAskToolsLine(prefs, enabledToolNames)
      if (askLine !== null) parts.push(askLine)
    }
  }
  return `${buildInstructionsBlock(sharedContextId)}${parts.join('\n\n')}`
}

export function buildProviderlessSystemPrompt(
  contextId: string,
  enabledToolNames?: ReadonlySet<string>,
  options: { askPermissionAvailable: boolean } = { askPermissionAvailable: true },
): string {
  const basePrompt = assembleBasePrompt(PROVIDERLESS_INTRO, contextId, enabledToolNames, options)
  const activePluginIds = getPluginsForContext(getConfigContextIdFromStorageContextId(contextId)).map(
    (p) => p.manifest.id,
  )
  const pluginSection = buildPluginPromptSection(activePluginIds)
  return pluginSection === '' ? basePrompt : `${basePrompt}\n\n${pluginSection}`
}
```

```ts
// src/llm-orchestrator-types.ts
export type InvokeModelArgs = {
  contextId: string
  chatUserId: string
  contextType: 'dm' | 'group'
  mainModel: string
  model: ReturnType<ReturnType<typeof createOpenAICompatible>>
  provider: TaskProvider | null
  tools: ToolSet
  enabledToolNames: ReadonlySet<string>
  messages: ModelMessage[]
  deps: LlmOrchestratorDeps
} & Partial<Record<'progressReporter', AiProgressReporter>>
```

```ts
// src/llm-orchestrator-invoke.ts
import { buildProviderlessSystemPrompt, buildSystemPrompt } from './system-prompt.js'

const systemPrompt =
  provider === null
    ? buildProviderlessSystemPrompt(contextId, enabledToolNames, { askPermissionAvailable: true })
    : buildSystemPrompt(provider, contextId, enabledToolNames, { askPermissionAvailable: true })

const result = await deps.generateText({
  model,
  system: systemPrompt,
  messages,
  tools,
  timeout: 1_200_000,
  stopWhen: deps.stepCountIs(25),
  experimental_onToolCallStart: buildToolCallStartHandler(ctx),
  experimental_onToolCallFinish: buildToolCallFinishHandler(ctx),
})
```

- [ ] **Step 4: Run the targeted tests and verify they pass**

Run: `bun test tests/system-prompt.test.ts tests/llm-orchestrator-invoke.test.ts`

Expected: PASS, including the new providerless prompt assertions.

### Task 2: Split Provider-Independent Tool Assembly

**Files:**

- Modify: `src/tools/tools-builder.ts:135-285`
- Modify: `src/tools/index.ts:23-169`
- Modify: `src/llm-orchestrator-tools.ts:26-151`
- Test: `tests/tools/tools-builder.test.ts`
- Test: `tests/llm-orchestrator-tools.test.ts`

- [ ] **Step 1: Write the failing providerless-tool tests**

```ts
import { beforeEach, describe, expect, it } from 'bun:test'

import { buildProviderlessTools } from '../../src/tools/tools-builder.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('buildProviderlessTools', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('includes provider-independent tools only', () => {
    const tools = buildProviderlessTools('user-123', 'user-123', 'normal', 'dm')

    expect(tools).toHaveProperty('get_current_time')
    expect(tools).toHaveProperty('save_memo')
    expect(tools).toHaveProperty('list_recurring_tasks')
    expect(tools).toHaveProperty('save_instruction')
    expect(tools).toHaveProperty('web_fetch')
  })

  it('excludes task-provider-backed tools', () => {
    const tools = buildProviderlessTools('user-123', 'user-123', 'normal', 'dm')

    expect(tools).not.toHaveProperty('create_task')
    expect(tools).not.toHaveProperty('search_tasks')
    expect(tools).not.toHaveProperty('promote_memo')
    expect(tools).not.toHaveProperty('set_my_identity')
  })
})
```

```ts
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ToolSet } from 'ai'

import { userCachesForTesting } from '../src/cache.js'
import { prepareLlmInvocation } from '../src/llm-orchestrator-tools.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

const buildProviderlessToolDescriptorsSpy = mock(
  (_opts: unknown): Promise<ToolSet> => Promise.resolve({ web_fetch: {} as ToolSet[string] }),
)

void mock.module('../src/tools/index.js', () => ({
  buildToolDescriptors: mock(() => Promise.resolve({})),
  buildProviderlessToolDescriptors: buildProviderlessToolDescriptorsSpy,
  applyToolPreferences: (tools: ToolSet): ToolSet => tools,
}))

test('uses providerless descriptors when provider is null', async () => {
  const result = await prepareLlmInvocation({
    contextId: 'ctx-providerless',
    configId: 'ctx-providerless',
    chatUserId: 'user-1',
    username: null,
    contextType: 'dm',
    provider: null,
    history: [],
    userText: 'summarize this link',
    stagedDownloadFn: undefined,
    askPermission: undefined,
  })

  expect(buildProviderlessToolDescriptorsSpy).toHaveBeenCalledTimes(1)
  expect(result.enabledToolNames.has('web_fetch')).toBe(true)
})
```

- [ ] **Step 2: Run the new tool tests and verify they fail**

Run: `bun test tests/tools/tools-builder.test.ts tests/llm-orchestrator-tools.test.ts`

Expected: FAIL because `buildProviderlessTools`, `buildProviderlessToolDescriptors`, and nullable `provider` support do not exist yet.

- [ ] **Step 3: Implement providerless tool builders and invocation preparation**

```ts
// src/tools/tools-builder.ts
export function buildProviderlessTools(
  chatUserId: string | undefined,
  contextId: string | undefined,
  mode: ToolMode,
  contextType: ContextType | undefined,
  username?: string | null,
  stagedDownloadFn?: StagedFileDownloadFn,
): ToolSet {
  const storageOwnerId = getStorageOwnerId(chatUserId, contextId)
  const tools: ToolSet = {
    get_current_time: makeGetCurrentTimeTool(storageOwnerId),
  }

  if (contextId !== undefined && isS3Configured()) {
    tools['list_files'] = makeListFilesTool(contextId)
    tools['delete_file'] = makeDeleteFileTool(contextId)
    tools['search_staged_files'] = makeSearchStagedFilesTool(contextId)
    if (stagedDownloadFn !== undefined) {
      tools['resolve_staged_file'] = makeResolveStagedFileTool(contextId, stagedDownloadFn)
    }
  }

  addRecurringTools(tools, storageOwnerId)
  addMemoToolsWithoutPromotion(tools, storageOwnerId)
  addInstructionTools(tools, storageOwnerId)
  addLookupGroupHistoryTool(tools, chatUserId, contextId)
  addWebFetchTool(tools, contextId, storageOwnerId, contextType)
  if (mode === 'normal' && storageOwnerId !== undefined) {
    addDeferredPromptTools(tools, storageOwnerId, chatUserId, contextId, contextType, username)
  }
  return tools
}

function addMemoToolsWithoutPromotion(tools: ToolSet, userId: string | undefined): void {
  if (userId === undefined) return
  tools['save_memo'] = makeSaveMemoTool(userId)
  tools['search_memos'] = makeSearchMemosTool(userId)
  tools['list_memos'] = makeListMemosTool(userId)
  tools['archive_memos'] = makeArchiveMemosTool(userId)
}
```

```ts
// src/tools/index.ts
export async function buildProviderlessToolDescriptors(options: MakeToolsOptions): Promise<ToolSet> {
  const descriptors = wrapToolSet(
    buildProviderlessTools(
      options.chatUserId,
      options.storageContextId,
      options.mode ?? 'normal',
      options.contextType,
      options.username,
      options.stagedDownloadFn,
    ),
  )

  const sharedContextId =
    options.storageContextId === undefined
      ? undefined
      : getConfigContextIdFromStorageContextId(options.storageContextId)
  let mcpTools: ToolSet = {}
  if (sharedContextId !== undefined) {
    mcpTools = await buildMcpToolSet(sharedContextId)
    const activePlugins = getPluginsForContext(sharedContextId)
    const mcpPluginIds = activePlugins
      .filter((plugin) => plugin.manifest.mcp !== undefined)
      .map((plugin) => plugin.manifest.id)
    if (mcpPluginIds.length > 0) {
      const descriptors = buildPluginMcpDescriptors(mcpPluginIds, sharedContextId)
      Object.assign(mcpTools, await buildPluginMcpToolSet(mcpPluginIds, descriptors, adaptMcpPool()))
    }
  }

  return { ...descriptors, ...mcpTools }
}
```

```ts
// src/llm-orchestrator-tools.ts
export type LlmInvocationOptions = {
  contextId: string
  configId: string
  chatUserId: string
  username: string | null
  contextType: 'dm' | 'group'
  provider: TaskProvider | null
  history: readonly ModelMessage[]
  userText: string
  stagedDownloadFn: StagedFileDownloadFn | undefined
  askPermission: AskPermissionFn | undefined
}

const descriptors =
  provider === null
    ? await buildProviderlessToolDescriptors({
        storageContextId: contextId,
        chatUserId,
        username,
        contextType,
        stagedDownloadFn,
      })
    : await getOrCreateDescriptors(contextId, chatUserId, username, provider, contextType, stagedDownloadFn)

const fullTools = applyToolPreferences(descriptors, contextId, askPermission)
const enabledToolNames = new Set(Object.keys(fullTools))
return { tools: fullTools, validatedMessages, enabledToolNames }
```

- [ ] **Step 4: Run the focused tool tests and verify they pass**

Run: `bun test tests/tools/tools-builder.test.ts tests/llm-orchestrator-tools.test.ts`

Expected: PASS, including providerless inclusion/exclusion assertions.

### Task 3: Switch the Orchestrator to Providerless Fallback

**Files:**

- Modify: `src/llm-orchestrator.ts:123-220`
- Modify: `tests/llm-orchestrator.test.ts:400-543`

- [ ] **Step 1: Write the failing unresolved-provider tests**

```ts
test('invokes the model instead of replying with /config guidance when resolver returns null', async () => {
  let generateCalled = 0
  generateTextImpl = async () => {
    generateCalled += 1
    return {
      text: 'Task tracker tools are unavailable right now. Check /config or ask the bot admin.',
      response: { messages: [] },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
    } satisfies GenerateTextResult
  }

  const deps: LlmOrchestratorDeps = {
    generateText: (...args) => realAi.generateText(...args),
    stepCountIs: (...args) => realAi.stepCountIs(...args),
    buildOpenAI: buildMockOpenAI,
    resolve: () => null,
    maybeAutoProvision: () => Promise.resolve(false),
  }

  const { reply, textCalls } = createMockReply()
  await processMessage(reply, 'resolver-null-context', 'user-1', null, 'show my tasks', 'dm', undefined, deps)

  expect(generateCalled).toBe(1)
  expect(textCalls).not.toContain('I need /config before I can do that.')
})
```

```ts
test('does not fail early on missing provider config when providerless fallback can answer', async () => {
  const deps: LlmOrchestratorDeps = {
    generateText: (...args) => realAi.generateText(...args),
    stepCountIs: (...args) => realAi.stepCountIs(...args),
    buildOpenAI: buildMockOpenAI,
    resolve: () => null,
    maybeAutoProvision: () => Promise.resolve(false),
  }

  const { reply, textCalls } = createMockReply()
  await processMessage(reply, 'missing-youtrack-token', 'user-1', null, 'hello', 'dm', undefined, deps)

  expect(textCalls.some((text) => text.includes('Missing configuration:'))).toBe(false)
})
```

- [ ] **Step 2: Run the orchestrator test file and verify it fails**

Run: `bun test tests/llm-orchestrator.test.ts`

Expected: FAIL because the orchestrator still returns early with `/config` guidance and still uses `ensureRequiredConfig()` as a turn gate.

- [ ] **Step 3: Implement providerless fallback in the orchestrator**

```ts
// src/llm-orchestrator.ts
type PreparedInvocation = Awaited<ReturnType<typeof prepareLlmInvocation>>

const callLlm = async (args: CallLlmArgs): Promise<{ response: { messages: ModelMessage[] } }> => {
  const { reply, contextId, chatUserId, username, contextType, deps, configContextId, turnId } = args
  const configId = resolveConfigId(contextId, configContextId)

  if (contextType === 'dm') {
    try {
      await deps.maybeAutoProvision(reply, configId, chatUserId, username)
    } catch {
      // opportunistic only
    }
  }

  const { llmApiKey, llmBaseUrl, mainModel } = getLlmConfig()
  const model = deps.buildOpenAI(llmApiKey, llmBaseUrl)(mainModel)
  const provider = await deps.resolve(configId)
  if (provider !== null) {
    await maybeAutoLinkIdentity(chatUserId, username, provider)
  } else {
    log.warn({ contextId, configId }, 'Task provider unavailable for LLM turn; using providerless fallback')
  }

  const prepared = await prepareLlmInvocation(buildLlmInvocationOpts(args, configId, provider, deps.stagedDownloadFn))
  const progressReporter = createProgressReporterForContext(reply, contextId)
  const result = await invokeModelWithTyping(reply, {
    contextId,
    chatUserId,
    contextType,
    mainModel,
    model,
    provider,
    tools: prepared.tools,
    enabledToolNames: prepared.enabledToolNames,
    messages: prepared.validatedMessages,
    deps,
    progressReporter,
    turnId,
  })
  progressReporter.reasoning(result.reasoningText, result.reasoning)
  persistFactsFromResults(contextId, result)
  await sendLlmResponse(reply, contextId, result, progressReporter)
  return result
}
```

- [ ] **Step 4: Run the orchestrator tests and verify they pass**

Run: `bun test tests/llm-orchestrator.test.ts`

Expected: PASS, with unresolved-provider turns now invoking the LLM instead of emitting hardcoded `/config` guidance.

### Task 4: Remove the Tool Router and Cleanup Remaining Call Sites

**Files:**

- Delete: `src/tools/tool-router.ts`
- Modify: `src/commands/context-tool-resolution.ts:13-128`
- Modify: `src/commands/context.ts:17-127`
- Modify: `src/commands/context-collector.ts:18-35,212-230`
- Modify: `src/deferred-prompts/proactive-llm-full.ts:18-32`
- Modify: `scripts/tool-surface-benchmark-scenarios.ts:6-54`
- Modify: `tests/commands/context-tool-resolution.test.ts`
- Modify: `tests/scripts/tool-surface-benchmark-scenarios.test.ts`
- Delete: `tests/tools/tool-router.test.ts`

- [ ] **Step 1: Write the failing cleanup assertions**

```ts
import { beforeEach, describe, expect, test } from 'bun:test'

import { buildInvocationToolSet, resolveContextToolSurface } from '../../src/commands/context-tool-resolution.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('context-tool-resolution without router', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns the full live tool surface even when lastUserText is provided', async () => {
    const provider = createMockProvider()
    const full = await resolveContextToolSurface('user-1', 'user-1', 'dm', provider, buildInvocationToolSet)
    const withLastUserText = await resolveContextToolSurface(
      'user-1',
      'user-1',
      'dm',
      provider,
      buildInvocationToolSet,
      'remember that I prefer morning standups',
    )

    expect(withLastUserText.routing).toBeUndefined()
    expect(Object.keys(withLastUserText.definitions).length).toBe(Object.keys(full.definitions).length)
  })
})
```

```ts
import { describe, expect, it } from 'bun:test'

import { createBenchmarkStore, toolsForMode } from '../../scripts/tool-surface-benchmark-scenarios.js'

describe('tool-surface benchmark scenarios', () => {
  it('uses the full direct tool surface for every mode after router removal', () => {
    const store = createBenchmarkStore()
    const direct = toolsForMode('direct', 'remember this note', store)

    expect(direct.exposedToolCount).toBe(direct.fullToolCount)
  })
})
```

- [ ] **Step 2: Run the cleanup-focused tests and verify they fail**

Run: `bun test tests/commands/context-tool-resolution.test.ts tests/scripts/tool-surface-benchmark-scenarios.test.ts`

Expected: FAIL because routing metadata and routed benchmark behavior still exist.

- [ ] **Step 3: Remove the router and simplify the remaining surfaces**

```ts
// src/commands/context-tool-resolution.ts
export interface ResolvedContextToolSurface {
  definitions: Record<string, unknown>
}

export async function resolveContextToolSurface(
  storageContextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
  provider: TaskProvider | null,
  buildLiveToolSet: BuildLiveToolSet,
  _lastUserText?: string,
): Promise<ResolvedContextToolSurface> {
  try {
    const liveTools = await buildLiveToolSet(storageContextId, actorUserId, contextType, provider)
    if (liveTools !== null) return { definitions: toToolRecord(liveTools) }
  } catch (error) {
    log.warn(
      { storageContextId, actorUserId, contextType, error: error instanceof Error ? error.message : String(error) },
      'Live tool resolution failed; falling back to cached tools',
    )
  }
  return buildDegradedToolSurface(storageContextId)
}
```

```ts
// src/commands/context-collector.ts
export interface ContextCollectorDeps {
  getMainModel: () => string | null
  buildSystemPrompt: () => string
  buildInstructionsBlock: () => string
  getProviderAddendum: () => string
  getHistory: () => readonly ModelMessage[]
  getMemoryMessage: () => string | null
  getSummary: () => string | null
  getFacts: () => readonly Fact[]
  getActiveToolDefinitions: () => Record<string, unknown>
  getProviderName: () => string
  countTokens: (text: string) => number
}

const buildToolsDetail = (exposedCount: number, providerName: string): string => {
  return `${String(exposedCount)} active, gated by ${providerName}`
}
```

```ts
// src/deferred-prompts/proactive-llm-full.ts
export async function buildFullToolSet(
  provider: TaskProvider,
  createdByUserId: string,
  storageContextId: string,
  contextType: 'dm' | 'group',
  _prompt: string,
): Promise<{ tools: ToolSet; enabledToolNames: ReadonlySet<string> }> {
  const fullTools = await makeTools(provider, {
    storageContextId,
    chatUserId: createdByUserId,
    mode: 'proactive',
    contextType,
  })
  return { tools: fullTools, enabledToolNames: new Set(Object.keys(fullTools)) }
}
```

```ts
// scripts/tool-surface-benchmark-scenarios.ts
export const toolsForMode = (mode: BenchmarkMode, _prompt: string, store: BenchmarkStore): BenchmarkToolSetup => {
  const directTools = buildDirectTools(store)
  const fullToolCount = Object.keys(directTools).length

  if (mode === 'direct_routed') {
    return { tools: directTools, fullToolCount, exposedToolCount: fullToolCount }
  }

  return { tools: directTools, fullToolCount, exposedToolCount: fullToolCount }
}
```

- [ ] **Step 4: Run the router-removal tests and a focused final verification set**

Run: `bun test tests/commands/context-tool-resolution.test.ts tests/scripts/tool-surface-benchmark-scenarios.test.ts tests/llm-orchestrator-tools.test.ts tests/tools/tools-builder.test.ts tests/system-prompt.test.ts tests/llm-orchestrator.test.ts`

Expected: PASS, with no imports of `src/tools/tool-router.ts` remaining in runtime code or tests.

## Self-Review Checklist

- Spec coverage:
  - Providerless prompt path: Task 1
  - Provider-independent tool assembly: Task 2
  - Providerless orchestrator fallback: Task 3
  - Router removal and surface cleanup: Task 4
- Placeholder scan:
  - No `TODO` / `TBD`
  - Every task includes explicit files, test commands, and concrete code shape
- Type consistency:
  - `provider` becomes `TaskProvider | null` consistently in invocation planning
  - `prepareLlmInvocation()` returns `{ tools, validatedMessages, enabledToolNames }` consistently after router removal
