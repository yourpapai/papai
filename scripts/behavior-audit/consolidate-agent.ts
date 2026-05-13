import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { Output, stepCountIs } from 'ai'
import { z } from 'zod'

import { fetchWithoutTimeout, verboseGenerateText } from './agent-helpers.js'
import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE2_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'
import { addAgentUsage, type AgentResult, type AgentUsage } from './phase-stats.js'
import { makeAuditTools } from './tools.js'

function getEnvOrFallback(name: string, fallback: string): string {
  const value = process.env[name]
  if (value === undefined) return fallback
  return value
}

const apiKey = getEnvOrFallback('OPENAI_API_KEY', 'no-key')
const provider = createOpenAICompatible({
  name: 'behavior-audit-consolidate',
  apiKey,
  baseURL: BASE_URL,
  fetch: fetchWithoutTimeout,
  supportsStructuredOutputs: true,
})
const model = provider(MODEL)

const SYSTEM_PROMPT = `You are a senior software analyst reviewing extracted test behaviors from a Telegram/Discord/Mattermost chat bot called "papai".

The batch you receive is a candidate pool formed for context-size control and candidate similarity. It is not guaranteed to describe only one feature.

You must:
1. classify each consolidation as user-facing or internal
2. merge only behaviors that describe the same user-facing capability
3. never force one output per batch or one output per keyword
4. emit multiple consolidated outputs when the batch contains multiple distinct features
5. generate user stories only for user-facing consolidated features
6. keep internal-only consolidations separate and use userStory: null for them

Every user story must be feature-level, user-observable, complete in actor/action/benefit, and free of test names, function names, and implementation jargon.`

const ConsolidationItemSchema = z.object({
  featureName: z.string(),
  isUserFacing: z.boolean(),
  behavior: z.string(),
  userStory: z.string().nullable(),
  context: z.string(),
  sourceBehaviorIds: z.array(z.string()),
  sourceTestKeys: z.array(z.string()),
  supportingInternalRefs: z.array(z.object({ behaviorId: z.string(), summary: z.string() })),
})

const ConsolidationResultSchema = z.object({
  consolidations: z.array(ConsolidationItemSchema),
})

export type ConsolidationResult = z.infer<typeof ConsolidationResultSchema>

export interface ConsolidateBehaviorInput {
  readonly behaviorId: string
  readonly testKey: string
  readonly domain: string
  readonly visibility: 'user-facing' | 'internal' | 'ambiguous'
  readonly featureKey: string
  readonly featureLabel: string | null
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
  readonly confidence: { readonly context: 'high' | 'medium' | 'low' }
  readonly trustFlags: readonly string[]
}

function buildBehaviorEntry(b: ConsolidateBehaviorInput, index: number): string {
  const hasUnsupportedContext = b.trustFlags.includes('unsupported-context-claim')
  const contextLine = hasUnsupportedContext
    ? '   Context: (omitted — unsupported claim)'
    : b.confidence.context === 'low'
      ? '   Context: (low confidence — treat as approximate)'
      : `   Context: ${b.context}`
  const trustWarnings = b.trustFlags
    .filter((f) => f === 'guessed-implementation-path' || f === 'unsupported-context-claim')
    .map((f) => `   ⚠ ${f}`)
    .join('\n')
  const trustSection = trustWarnings.length > 0 ? `\n${trustWarnings}` : ''
  return `${index + 1}. BehaviorId: "${b.behaviorId}"\n   TestKey: "${b.testKey}"\n   Domain: ${b.domain}\n   Visibility: ${b.visibility}\n   Feature key: ${b.featureKey}\n   Feature label: ${b.featureLabel ?? '(none)'}\n   Keywords: ${b.keywords.join(', ')}\n   Behavior: ${b.behavior}\n${contextLine}${trustSection}`
}

function buildPrompt(featureKey: string, behaviors: readonly ConsolidateBehaviorInput[]): string {
  const behaviorList = behaviors.map((b, i) => buildBehaviorEntry(b, i)).join('\n\n')
  return `Feature key: ${featureKey}\n\nBehavior pool:\n\n${behaviorList}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function consolidateSingle(
  prompt: string,
  attempt: number,
): Promise<{ data: ConsolidationResult | null; usage: AgentUsage }> {
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, toolNames: [] }
  const timeout = attempt > 0 ? PHASE2_TIMEOUT_MS * 2 : PHASE2_TIMEOUT_MS
  const tools = makeAuditTools()
  const start = Date.now()
  try {
    const result = await verboseGenerateText({
      model,
      system: SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: 16384,
      tools,
      output: Output.object({ schema: ConsolidationResultSchema }),
      stopWhen: stepCountIs(MAX_STEPS + 1),
      abortSignal: AbortSignal.timeout(timeout),
    })
    usage.inputTokens = result.totalUsage.inputTokens ?? 0
    usage.outputTokens = result.totalUsage.outputTokens ?? 0
    for (const step of result.steps) {
      for (const tc of step.toolCalls) {
        usage.toolCalls += 1
        usage.toolNames.push(tc.toolName)
      }
    }
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    if (result.output === null) {
      console.log(`✗ null output (${elapsed}s)`)
      return { data: null, usage }
    }
    const parsed = ConsolidationResultSchema.safeParse(result.output)
    if (!parsed.success) {
      console.log(`✗ parse error (${elapsed}s)`)
      return { data: null, usage }
    }
    return { data: parsed.data, usage }
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`✗ error: ${err instanceof Error ? err.message : String(err)} (${elapsed}s)`)
    return { data: null, usage }
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function attemptConsolidation(
  prompt: string,
  featureKey: string,
  attempt: number,
  remaining: number,
  accumulatedUsage: AgentUsage,
): Promise<{
  items: readonly { readonly id: string; readonly item: ConsolidationResult['consolidations'][number] }[] | null
  usage: AgentUsage
}> {
  if (remaining <= 0) return { items: null, usage: accumulatedUsage }

  if (attempt > 0) {
    const backoff = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]!
    console.log(`  retry ${attempt}/${MAX_RETRIES - 1}, waiting ${backoff / 1000}s...`)
    await sleep(backoff)
  }

  const { data, usage } = await consolidateSingle(prompt, attempt)
  const combined = addAgentUsage(accumulatedUsage, usage)
  if (data !== null) {
    return {
      items: data.consolidations.map((item) => ({
        id: `${featureKey}::${slugify(item.featureName)}`,
        item,
      })),
      usage: combined,
    }
  }

  return attemptConsolidation(prompt, featureKey, attempt + 1, remaining - 1, combined)
}

export function consolidateWithRetry(
  featureKey: string,
  behaviors: readonly ConsolidateBehaviorInput[],
  attemptOffset: number,
): Promise<AgentResult<
  readonly { readonly id: string; readonly item: ConsolidationResult['consolidations'][number] }[]
> | null> {
  const prompt = buildPrompt(featureKey, behaviors)
  const remaining = MAX_RETRIES - attemptOffset
  const emptyUsage: AgentUsage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, toolNames: [] }
  return attemptConsolidation(prompt, featureKey, attemptOffset, remaining, emptyUsage).then(({ items, usage }) => {
    if (items === null) return null
    return { result: items, usage }
  })
}
