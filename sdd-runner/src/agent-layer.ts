// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { parsePorcelainPaths } from '../../mutation-improve/src/diff-guard.js'
import { runAgent } from '../../review-loop/src/agent-runner.js'
import type { AgentUsage, SpawnFn } from '../../review-loop/src/agent-runner.js'
import { createAgentReporter } from './agent-reporter.js'
import { modelFor } from './config.js'
import type { AgentRole, ExecGitFn, RunnerConfig } from './config.js'
import type { EventInput } from './events.js'
import { nextSessionAttempt, recordSessionId, settleSessionAttempt, transcriptPathFor } from './session-ledger.js'

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
  id: z.string().min(1),
  text: z.string().min(1),
  basis: z.enum(['code-evidence', 'convention', 'default']),
  confidence: z.enum(['high', 'medium', 'low']),
  blast_radius: z.string().min(1),
  status: z.enum(['open', 'confirmed', 'vetoed']),
  evidence: z.object({ files: z.array(z.string().min(1)).min(1) }),
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
}

export interface AgentRunInfo<T> {
  readonly value: T
  readonly usage: AgentUsage
  readonly attempts: number
}

export class DiffGuardViolationError extends Error {
  readonly violations: readonly string[]

  constructor(violations: readonly string[]) {
    super(`agent edited files outside the change folder: ${violations.join(', ')}`)
    this.name = 'DiffGuardViolationError'
    this.violations = violations
  }
}

const MAX_VALIDATION_ATTEMPTS = 2
const ALLOWED_PREFIX = 'openspec/changes/'

function parseDirty(stdout: string): string[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap(parsePorcelainPaths)
    .filter((entry) => entry.length > 0)
}

async function snapshotWorkingTree(execGit: ExecGitFn, cwd: string): Promise<Set<string>> {
  const { stdout } = await execGit(cwd, ['status', '--porcelain', '--untracked-files=all'])
  return new Set(parseDirty(stdout))
}

async function guardWorkingTree(execGit: ExecGitFn, cwd: string, before: Set<string>): Promise<void> {
  const after = await snapshotWorkingTree(execGit, cwd)
  const violations = [...after].filter((entry) => !before.has(entry) && !entry.startsWith(ALLOWED_PREFIX))
  if (violations.length > 0) throw new DiffGuardViolationError(violations)
}

async function attemptStageAgent<T>(
  deps: AgentLayerDeps,
  options: RunStageAgentOptions<T>,
  attempt: number,
  lastError: string | null,
  before: Set<string>,
): Promise<AgentRunInfo<T>> {
  const prompt =
    lastError === null ? options.prompt : `${options.prompt}\n\nPrevious attempt failed validation:\n${lastError}`
  const model = modelFor(deps.config, options.role)
  deps.emit({ altitude: 'L1', type: 'spawned', agent: options.label, role: options.role, model })
  const absoluteOutput = path.join(options.sidecarDir, path.basename(options.outputPath))
  const reporter = createAgentReporter(options.label, deps.emit)
  const spawnInput = { label: options.label, role: options.role, round: options.round, model }
  // One ledger attempt per validation attempt; the session id is recorded the
  // moment the first session-bearing event line arrives (D1). A stall retry
  // inside runAgent shares the attempt number and appends to the transcript.
  const ledgerAttempt = nextSessionAttempt(options.runDir, options.label, options.round)
  const sessionLedger = {
    recordSessionId: (id: string, preferred: number): void => {
      recordSessionId(options.runDir, spawnInput, id, preferred)
    },
  }
  const logPath = transcriptPathFor(options.runDir, options.label, options.round, ledgerAttempt)
  mkdirSync(path.dirname(logPath), { recursive: true })
  try {
    const result = await runAgent({
      spawn: deps.spawn,
      model,
      cwd: options.cwd,
      prompt,
      outputPath: absoluteOutput,
      outputSchema: z.unknown(),
      label: options.label,
      logPath,
      extraArgs: [],
      timeoutMs: deps.config.timeouts.wallClockMs,
      inactivityTimeoutMs: deps.config.timeouts.inactivityMs,
      reporter,
      sessionLedger,
      sessionAttempt: ledgerAttempt,
      onRetry: () => {
        deps.emit({ altitude: 'L1', type: 'retrying', agent: options.label, reason: 'stall', attempt })
      },
    })
    await guardWorkingTree(deps.execGit, options.cwd, before)
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
    return attemptStageAgent(deps, options, attempt + 1, parsed.error.message, before)
  } catch (error) {
    settleSessionAttempt(options.runDir, spawnInput, ledgerAttempt, 'killed')
    throw error instanceof Error ? error : new Error(String(error))
  }
}

export async function runStageAgent<T>(
  deps: AgentLayerDeps,
  options: RunStageAgentOptions<T>,
): Promise<AgentRunInfo<T>> {
  const before = await snapshotWorkingTree(deps.execGit, options.cwd)
  return attemptStageAgent(deps, options, 1, null, before)
}
