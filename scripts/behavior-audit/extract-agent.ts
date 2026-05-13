import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { Output, stepCountIs } from 'ai'
import { z } from 'zod'

import { fetchWithoutTimeout, verboseGenerateText } from './agent-helpers.js'
import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE1_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'
import { addAgentUsage, type AgentResult, type AgentUsage } from './phase-stats.js'
import { makeAuditTools } from './tools.js'

const ClaimRefSchema = z.object({
  evidenceIndex: z.number(),
  claim: z.string(),
})

const ExtractionResultSchema = z.object({
  behavior: z.string(),
  context: z.string(),
  keywords: z.array(z.string()).min(1).max(20),
  behaviorClaimRefs: z.array(ClaimRefSchema),
  contextClaimRefs: z.array(ClaimRefSchema),
  uncertaintyNotes: z.array(z.string()),
})

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>

function getEnvOrFallback(name: string, fallback: string): string {
  return process.env[name] ?? fallback
}

const apiKey = getEnvOrFallback('OPENAI_API_KEY', 'no-key')
const provider = createOpenAICompatible({
  name: 'behavior-audit-extract',
  apiKey,
  baseURL: BASE_URL,
  fetch: fetchWithoutTimeout,
  supportsStructuredOutputs: true,
})
const model = provider(MODEL)

const SYSTEM_PROMPT = `You are a senior software analyst examining a unit test from a Telegram/Discord/Mattermost chat bot called "papai" that manages tasks via LLM tool-calling.

Return structured output with:
- behavior: plain-language feature description beginning with "When..."
- context: technical implementation summary for developers
- keywords: 10-20 canonical lowercase slug keywords describing the behavior
- behaviorClaimRefs: for each distinct behavior claim, provide { evidenceIndex, claim } referencing the evidence bundle index
- contextClaimRefs: for each distinct context claim, provide { evidenceIndex, claim } referencing the evidence bundle index
- uncertaintyNotes: list any claims not directly supported by provided evidence, or mark where you inferred beyond the evidence

When evidence is provided, always reference it by index. Distinguish between observed behavior (what the test directly demonstrates) and inferred context (what you deduce from implementation patterns).

Keywords must be short canonical slugs like group-targeting or identity-resolution.`

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function extractSingle(
  prompt: string,
  attempt: number,
): Promise<{ data: ExtractionResult | null; usage: AgentUsage }> {
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, toolNames: [] }
  const timeout = attempt > 0 ? PHASE1_TIMEOUT_MS * 2 : PHASE1_TIMEOUT_MS
  try {
    const result = await verboseGenerateText({
      model,
      system: SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: 8192,
      tools: makeAuditTools(),
      output: Output.object({ schema: ExtractionResultSchema }),
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
    const parsed = ExtractionResultSchema.safeParse(result.output)
    return { data: parsed.success ? parsed.data : null, usage }
  } catch (error) {
    console.log(`✗ extract: ${error instanceof Error ? error.message : String(error)}`)
    return { data: null, usage }
  }
}

export async function extractWithRetry(prompt: string, attempt: number): Promise<AgentResult<ExtractionResult> | null> {
  if (attempt > 0) {
    const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]!
    await sleep(backoff)
  }
  const { data, usage } = await extractSingle(prompt, attempt)
  if (data !== null) return { result: data, usage }
  if (attempt >= MAX_RETRIES - 1) return null
  const nextResult = await extractWithRetry(prompt, attempt + 1)
  if (nextResult === null) return null
  return { result: nextResult.result, usage: addAgentUsage(usage, nextResult.usage) }
}
