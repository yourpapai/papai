// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { generateText, type LanguageModel } from 'ai'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { contextVaultFiles, contextVaultSpecs } from '../db/context-vault-schema.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { buildChatModel } from '../llm-model-builder.js'
import { resolveLlmConfig } from '../llm-providers/resolver.js'
import type { EffectiveLlmConfig, LlmConfigResult } from '../llm-providers/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'context-vault:summarizer' })

export const SPEC_SUMMARY_DEBOUNCE_MS = 15_000

export const SEMANTIC_KINDS: ReadonlySet<string> = new Set(['proposal', 'design', 'plan', 'spec'])
const MAX_FILE_CHARS = 20_000

export interface SummarizerFileInput {
  path: string
  kind: string
  text?: string
}

export interface EnqueueSummarizationInput {
  configContextId: string
  specId: string
  changeName: string
  changedFiles: readonly SummarizerFileInput[]
  deletedPaths?: readonly string[]
  /**
   * Paths among `changedFiles` that arrived with a new hash. Unchanged files
   * are still forwarded in `changedFiles` so the prompt sees the full semantic
   * text set, but only a new-hash semantic file (or a deletion) schedules a
   * job. Omitted by direct callers: every changed file counts as new.
   */
  hashChangedPaths?: readonly string[]
}

export interface SummarizerDeps {
  resolveConfig: (configContextId: string) => LlmConfigResult
  buildModel: (config: EffectiveLlmConfig) => LanguageModel
  generateText: (args: { model: LanguageModel; prompt: string }) => Promise<{ text: string }>
  schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clear: (timer: ReturnType<typeof setTimeout>) => void
  debounceMs: number
}

const defaultDeps: SummarizerDeps = {
  resolveConfig: (configContextId) => resolveLlmConfig(configContextId),
  buildModel: (config) => buildChatModel(config.small.apiKey, config.small.baseUrl, config.small.model),
  generateText: (args) => generateText(args),
  schedule: (fn, ms) => setTimeout(fn, ms),
  clear: (timer) => {
    clearTimeout(timer)
  },
  debounceMs: SPEC_SUMMARY_DEBOUNCE_MS,
}

const SummaryResultSchema = z.object({
  one_line: z.string().min(1).max(200),
  summary: z.string().min(1).max(4_000),
})

export type SpecSummaryResult = z.infer<typeof SummaryResultSchema>

export function parseSpecSummary(text: string): SpecSummaryResult {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('no JSON object found')
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`invalid spec summary: ${message}`, { cause: error })
  }
  const parsed = SummaryResultSchema.safeParse(raw)
  if (!parsed.success) throw new Error('invalid spec summary: schema mismatch')
  return parsed.data
}

const SUMMARY_PROMPT = `You summarize an OpenSpec change for papai's context vault, a memory coding agents query later.

Change: {SPEC_ID}

Return ONLY a raw JSON object with this exact shape:
{"one_line": string, "summary": string}

Rules:
- "one_line": at most 120 characters, present tense, what the change delivers.
- "summary": at most 2000 characters; capture the intent, the key design decisions, and the current state.
- Never include secrets, tokens, or credentials found in the files.

Files:
{FILES}`

const buildPrompt = (specId: string, texts: ReadonlyMap<string, string>): string => {
  const sections = [...texts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, text]) => `--- ${path} ---\n${text.slice(0, MAX_FILE_CHARS)}`)
    .join('\n\n')
  return SUMMARY_PROMPT.replace('{SPEC_ID}', specId).replace('{FILES}', sections)
}

interface PendingJob {
  input: EnqueueSummarizationInput
  texts: Map<string, string>
  sourceHash: string
  semanticHash: string
  timer: ReturnType<typeof setTimeout> | null
  deps: SummarizerDeps
}

const pending = new Map<string, PendingJob>()
const inFlight = new Set<Promise<void>>()

const keyOf = (configContextId: string, specId: string): string => `${configContextId}\n${specId}`

interface SourceHashes {
  sourceHash: string
  semanticHash: string
}

const readSourceHashes = (configContextId: string, specId: string): SourceHashes | undefined => {
  const db = getDrizzleDb()
  const row = db
    .select({ sourceHash: contextVaultSpecs.sourceHash })
    .from(contextVaultSpecs)
    .where(and(eq(contextVaultSpecs.configContextId, configContextId), eq(contextVaultSpecs.id, specId)))
    .get()
  if (row === undefined) return undefined
  const files = db
    .select({ path: contextVaultFiles.path, kind: contextVaultFiles.kind, hash: contextVaultFiles.hash })
    .from(contextVaultFiles)
    .where(and(eq(contextVaultFiles.configContextId, configContextId), eq(contextVaultFiles.specId, specId)))
    .all()
  const digest = createHash('sha256')
  const semanticFiles = files
    .filter((file) => SEMANTIC_KINDS.has(file.kind))
    .sort((a, b) => a.path.localeCompare(b.path))
  for (const f of semanticFiles) {
    digest.update(`${f.path} ${f.hash}\n`)
  }
  return { sourceHash: row.sourceHash, semanticHash: digest.digest('hex') }
}

const storeSummary = (
  configContextId: string,
  specId: string,
  sourceHash: string,
  result: SpecSummaryResult,
): boolean =>
  getDrizzleDb()
    .$client.query<{ changes: number }, [string, string, string, string, string]>(
      `UPDATE context_vault_specs SET one_line = ?, summary = ?
       WHERE config_context_id = ? AND id = ? AND source_hash = ?`,
    )
    .run(result.one_line, result.summary, configContextId, specId, sourceHash).changes > 0

const resolveModel = (job: PendingJob): LanguageModel | null => {
  const resolved = job.deps.resolveConfig(job.input.configContextId)
  if (!resolved.ok) {
    log.warn(
      { configContextId: job.input.configContextId, specId: job.input.specId, source: resolved.source },
      'Context vault summarization skipped: LLM config not available',
    )
    return null
  }
  return job.deps.buildModel(resolved)
}

const runJob = async (job: PendingJob): Promise<void> => {
  try {
    const model = resolveModel(job)
    if (model === null) return
    const prompt = buildPrompt(job.input.specId, job.texts)
    const result = await job.deps.generateText({ model, prompt })
    const summary = parseSpecSummary(result.text)
    let stored = storeSummary(job.input.configContextId, job.input.specId, job.sourceHash, summary)
    if (!stored) {
      const fresh = readSourceHashes(job.input.configContextId, job.input.specId)
      if (fresh !== undefined && fresh.semanticHash === job.semanticHash) {
        stored = storeSummary(job.input.configContextId, job.input.specId, fresh.sourceHash, summary)
      }
    }
    if (stored) {
      log.info(
        { configContextId: job.input.configContextId, specId: job.input.specId },
        'Context vault spec summarized',
      )
    } else {
      log.info(
        { configContextId: job.input.configContextId, specId: job.input.specId },
        'Context vault summary dropped: superseded by a newer push',
      )
    }
  } catch (error) {
    log.warn(
      {
        configContextId: job.input.configContextId,
        specId: job.input.specId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Context vault summarization failed; keeping previous summary',
    )
  }
}

const startJob = (key: string, job: PendingJob): void => {
  pending.delete(key)
  const running = runJob(job).finally(() => {
    inFlight.delete(running)
  })
  inFlight.add(running)
}

/** Enqueue a debounced summary regeneration for a change. Called from the push path. */
export function enqueueSpecSummarization(input: EnqueueSummarizationInput, deps: SummarizerDeps = defaultDeps): void {
  const semanticTexts = input.changedFiles.flatMap((f) =>
    SEMANTIC_KINDS.has(f.kind) && f.text !== undefined ? [[f.path, f.text] as const] : [],
  )
  const deletedPaths = input.deletedPaths ?? []
  const hashChanged = input.hashChangedPaths
  const newSemanticTexts =
    hashChanged === undefined ? semanticTexts : semanticTexts.filter(([path]) => hashChanged.includes(path))
  const key = keyOf(input.configContextId, input.specId)
  if (newSemanticTexts.length === 0 && deletedPaths.length === 0) return

  const existing = pending.get(key)
  if (existing !== undefined && existing.timer !== null) existing.deps.clear(existing.timer)

  const texts = existing?.texts ?? new Map<string, string>()
  for (const path of deletedPaths) texts.delete(path)
  for (const [path, text] of semanticTexts) texts.set(path, text)

  if (texts.size === 0) {
    pending.delete(key)
    return
  }

  const hashes = readSourceHashes(input.configContextId, input.specId)
  if (hashes === undefined) {
    log.warn(
      { configContextId: input.configContextId, specId: input.specId },
      'Context vault summarization skipped: spec row missing',
    )
    pending.delete(key)
    return
  }

  const job: PendingJob = {
    input,
    texts,
    sourceHash: hashes.sourceHash,
    semanticHash: hashes.semanticHash,
    timer: null,
    deps,
  }
  job.timer = deps.schedule(() => {
    startJob(key, job)
  }, deps.debounceMs)
  pending.set(key, job)
}

/** Cancel every scheduled summarization (runtime teardown). */
export function cancelPendingSpecSummarizations(): void {
  for (const job of pending.values()) {
    if (job.timer !== null) job.deps.clear(job.timer)
  }
  pending.clear()
}

/** Cancel scheduled summarizations and wait until every started job settles. */
export async function drainSpecSummarizations(): Promise<void> {
  cancelPendingSpecSummarizations()
  const drain = async (): Promise<void> => {
    const running = [...inFlight]
    if (running.length === 0) return
    await Promise.all(running)
    return drain()
  }
  await drain()
}
