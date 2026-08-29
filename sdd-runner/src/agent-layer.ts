// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { agentWritePath, runAgent } from '../../review-loop/src/agent-runner.js'
import type { AgentUsage, SpawnFn } from '../../review-loop/src/agent-runner.js'
import { createAgentReporter } from './agent-reporter.js'
import { INACTIVITY_TIMEOUT_MS, WALL_CLOCK_TIMEOUT_MS, modelFor } from './config.js'
import type { AgentRole, ExecGitFn, RunnerConfig } from './config.js'
import type { EventInput } from './events.js'
import { nextSessionAttempt, recordSessionId, settleSessionAttempt, transcriptPathFor } from './session-ledger.js'
import { guardWorkingTree, snapshotWorkingTree } from './working-tree-guard.js'

export const FindingSchema = z.object({
  id: z.string().min(1),
  class: z.enum(['BLOCKER', 'MATERIAL', 'NITPICK']),
  gap: z.string().min(1),
  question: z.string().min(1),
  code_evidence_attempted: z.string().min(1),
})
export type Finding = z.infer<typeof FindingSchema>

export const FindingsSidecarSchema = z.object({ findings: z.array(FindingSchema) })

export const ResolutionSchema = z
  .object({
    id: z.string().min(1),
    class: z.enum(['BLOCKER', 'MATERIAL', 'NITPICK']),
    resolution: z.enum(['edited', 'evidence-answered', 'assumed', 'dismissed']),
    outcome: z.string().min(1).optional(),
    justification: z.string().min(1).optional(),
  })
  .refine((record) => record.resolution !== 'dismissed' || record.justification !== undefined, {
    message: 'dismissed resolutions require a justification',
  })
export type Resolution = z.infer<typeof ResolutionSchema>

export const ResolutionsSidecarSchema = z.object({ resolutions: z.array(ResolutionSchema) })

export const AssumptionRecordSchema = z.object({
  id: z.string().regex(/^A\d+$/u, 'assumptions[].id must follow the A-prefix convention (A1, A2, …)'),
  text: z.string().min(1),
  basis: z.enum(['code-evidence', 'convention', 'default']),
  confidence: z.enum(['high', 'medium', 'low']),
  blast_radius: z.string().min(1),
  status: z.enum(['open', 'confirmed', 'vetoed']),
  evidence: z.object({ files: z.array(z.string().min(1)).min(1) }),
  /**
   * The finding this assumption was logged against, when it came from one. It
   * is what lets an `assumed` resolution be closed as traceable rather than
   * taken on trust; sidecars written before the link existed carry none, and
   * the openness predicate falls back to a round-level check for those.
   */
  findingId: z.string().min(1).optional(),
})
export type AssumptionRecord = z.infer<typeof AssumptionRecordSchema>

export const AssumptionsSidecarSchema = z.object({ assumptions: z.array(AssumptionRecordSchema) })

export const DepthSignalsSchema = z.object({
  cross_module: z.boolean(),
  db_migration: z.boolean(),
  provider_surface: z.boolean(),
  credentials: z.boolean(),
  novelty: z.enum(['new-subsystem', 'existing-modules']),
})
export type DepthSignals = z.infer<typeof DepthSignalsSchema>

export const DepthClassificationSchema = z.object({
  implicated_files: z.array(z.string().min(1)),
  signals: DepthSignalsSchema,
  rationale: z.string().min(1),
  capabilities: z.array(z.string().min(1)).optional(),
  oversize: z.boolean().optional(),
})
export type DepthClassification = z.infer<typeof DepthClassificationSchema>

export interface AgentLayerDeps {
  readonly spawn: SpawnFn
  readonly config: RunnerConfig
  readonly execGit: ExecGitFn
  readonly emit: (event: EventInput) => void
}

export interface RunStageAgentOptions<T> {
  readonly role: AgentRole
  readonly changeName: string
  readonly cwd: string
  readonly prompt: string
  readonly outputPath: string
  readonly outputSchema: z.ZodType<T>
  readonly label: string
  /** Run dir owning `sessions.jsonl` and `transcripts/` for this spawn. */
  readonly runDir: string
  /** Review round the spawn belongs to (0 for pre-review stages). */
  readonly round: number
  readonly sidecarDir: string
  /**
   * Resume continuation (D2): continue this opencode session at its exact
   * prior context instead of a fresh prompt-rebuild spawn. Any continuation
   * failure falls back to the prompt-rebuild spawn.
   */
  readonly continueSessionId?: string
}

export interface AgentRunInfo<T> {
  readonly value: T
  readonly usage: AgentUsage
  readonly attempts: number
}

const MAX_VALIDATION_ATTEMPTS = 2

interface ContinuationSpawn {
  readonly sessionId: string
}

/** Continuation prompt (D2): restates the output target; never the original prompt. */
function buildContinuationPrompt(options: { readonly cwd: string; readonly outputPath: string }): string {
  return [
    'Continue the interrupted task in this session.',
    'You were mid-run when the process died; finish the work you had in flight.',
    `Write your JSON result to ${agentWritePath(options.cwd, path.basename(options.outputPath))} now.`,
  ].join('\n')
}

/** Build the spawn prompt: continuation restates the target; retries append the validator error. */
function spawnPrompt<T>(
  options: RunStageAgentOptions<T>,
  lastError: string | null,
  continuation: ContinuationSpawn | null,
): string {
  if (continuation !== null) return buildContinuationPrompt(options)
  if (lastError === null) return options.prompt
  return `${options.prompt}\n\nPrevious attempt failed validation:\n${lastError}`
}

/** Session ledger bookkeeping around one spawn: record id, settle status. */
function ledgerHooks<T>(
  options: RunStageAgentOptions<T>,
  model: string,
): {
  spawnInput: { label: string; role: string; round: number; model: string }
  ledgerAttempt: number
  sessionLedger: { recordSessionId: (id: string, preferred: number) => void }
} {
  const spawnInput = { label: options.label, role: options.role, round: options.round, model }
  // One ledger attempt per validation attempt; the session id is recorded the
  // moment the first session-bearing event line arrives (D1). A stall retry
  // inside runAgent shares the attempt number and appends to the transcript.
  const ledgerAttempt = nextSessionAttempt(options.runDir, options.label, options.round)
  return {
    spawnInput,
    ledgerAttempt,
    sessionLedger: {
      recordSessionId: (id: string, preferred: number): void => {
        recordSessionId(options.runDir, spawnInput, id, preferred)
      },
    },
  }
}

async function attemptStageAgent<T>(
  deps: AgentLayerDeps,
  options: RunStageAgentOptions<T>,
  attempt: number,
  lastError: string | null,
  before: Set<string>,
  continuation: ContinuationSpawn | null = null,
): Promise<AgentRunInfo<T>> {
  const prompt = spawnPrompt(options, lastError, continuation)
  const model = modelFor(deps.config, options.role)
  deps.emit({ altitude: 'L1', type: 'spawned', agent: options.label, role: options.role, model })
  const absoluteOutput = path.join(options.sidecarDir, path.basename(options.outputPath))
  const reporter = createAgentReporter(options.label, deps.emit)
  const { spawnInput, ledgerAttempt, sessionLedger } = ledgerHooks(options, model)
  const logPath = transcriptPathFor(options.runDir, options.label, options.round, ledgerAttempt)
  mkdirSync(path.dirname(logPath), { recursive: true })
  try {
    const result = await runSpawn(deps, options, {
      prompt,
      model,
      absoluteOutput,
      logPath,
      sessionLedger,
      ledgerAttempt,
      reporter,
      continuation,
      attempt,
    })
    await guardWorkingTree(deps.execGit, options.cwd, before, options.changeName)
    const parsed = options.outputSchema.safeParse(result.value)
    if (parsed.success) {
      deps.emit({ altitude: 'L1', type: 'done', agent: options.label, model, usage: result.usage })
      settleSessionAttempt(options.runDir, spawnInput, ledgerAttempt, 'done')
      return { value: parsed.data, usage: result.usage, attempts: attempt }
    }
    settleSessionAttempt(options.runDir, spawnInput, ledgerAttempt, 'killed')
    if (attempt >= MAX_VALIDATION_ATTEMPTS) {
      throw new Error(
        `stage agent ${options.label} failed validation after ${MAX_VALIDATION_ATTEMPTS} attempts: ${parsed.error.message}`,
      )
    }
    deps.emit({ altitude: 'L1', type: 'retrying', agent: options.label, reason: 'validation', attempt: attempt + 1 })
    return await attemptStageAgent(deps, options, attempt + 1, parsed.error.message, before)
  } catch (error) {
    settleSessionAttempt(options.runDir, spawnInput, ledgerAttempt, 'killed')
    throw error instanceof Error ? error : new Error(String(error))
  }
}

interface SpawnInputs {
  readonly prompt: string
  readonly model: string
  readonly absoluteOutput: string
  readonly logPath: string
  readonly sessionLedger: { recordSessionId: (id: string, preferred: number) => void }
  readonly ledgerAttempt: number
  readonly reporter: ReturnType<typeof createAgentReporter>
  readonly continuation: ContinuationSpawn | null
  readonly attempt: number
}

function runSpawn<T>(
  deps: AgentLayerDeps,
  options: RunStageAgentOptions<T>,
  inputs: SpawnInputs,
): Promise<{ value: unknown; usage: AgentUsage }> {
  return runAgent({
    spawn: deps.spawn,
    model: inputs.model,
    cwd: options.cwd,
    prompt: inputs.prompt,
    outputPath: inputs.absoluteOutput,
    outputSchema: z.unknown(),
    label: options.label,
    logPath: inputs.logPath,
    extraArgs: inputs.continuation === null ? [] : ['--session', inputs.continuation.sessionId],
    noRetry: inputs.continuation !== null,
    timeoutMs: WALL_CLOCK_TIMEOUT_MS,
    inactivityTimeoutMs: INACTIVITY_TIMEOUT_MS,
    reporter: inputs.reporter,
    sessionLedger: inputs.sessionLedger,
    sessionAttempt: inputs.ledgerAttempt,
    onRetry: () => {
      deps.emit({ altitude: 'L1', type: 'retrying', agent: options.label, reason: 'stall', attempt: inputs.attempt })
    },
  })
}

export async function runStageAgent<T>(
  deps: AgentLayerDeps,
  options: RunStageAgentOptions<T>,
): Promise<AgentRunInfo<T>> {
  const before = await snapshotWorkingTree(deps.execGit, options.cwd)
  if (options.continueSessionId !== undefined) {
    // D2: any continuation failure (session pruned, provider error, invalid
    // sidecar) falls back to the prompt-rebuild spawn — never worse than today.
    const continued = await attemptStageAgent(deps, options, 1, null, before, {
      sessionId: options.continueSessionId,
    }).catch(() => null)
    if (continued !== null) return continued
    deps.emit({
      altitude: 'L1',
      type: 'retrying',
      agent: options.label,
      reason: 'validation',
      attempt: 2,
    })
  }
  return attemptStageAgent(deps, options, 1, null, before)
}
