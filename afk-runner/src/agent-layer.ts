import { z } from 'zod'

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.
export * from './agent-schemas.js'

import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { parsePorcelainPaths } from '../../mutation-improve/src/diff-guard.js'
import { agentWritePath, runAgent } from '../../review-loop/src/agent-runner.js'
import type { AgentUsage, SpawnFn } from '../../review-loop/src/agent-runner.js'
import { createAgentReporter } from './agent-reporter.js'
import { INACTIVITY_TIMEOUT_MS, WALL_CLOCK_TIMEOUT_MS, modelFor } from './config.js'
import type { AgentRole, ExecGitFn, RunnerConfig } from './config.js'
import type { EventInput } from './events.js'
import {
  nextSessionAttempt,
  findKilledSession,
  recordSessionId,
  settleSessionAttempt,
  transcriptPathFor,
} from './session-ledger.js'

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
   *
   * Also the seam's output (escalation-retry-session-continuation D1): when
   * undefined, `runStageAgent` consults the session ledger for the latest
   * id-bearing `killed` entry of this (label, round) and continues it —
   * precedence explicit id > seam lookup > fresh.
   */
  readonly continueSessionId?: string
}

export interface AgentRunInfo<T> {
  readonly value: T
  readonly usage: AgentUsage
  readonly attempts: number
}

export class DiffGuardViolationError extends Error {
  readonly violations: readonly string[]
  readonly allowedPrefix: string

  constructor(violations: readonly string[], allowedPrefix: string) {
    super(`agent edited files outside the change folder ${allowedPrefix}: ${violations.join(', ')}`)
    this.name = 'DiffGuardViolationError'
    this.violations = violations
    this.allowedPrefix = allowedPrefix
  }
}

export { AgentValidationError } from './errors.js'
import { AgentValidationError } from './errors.js'

const MAX_VALIDATION_ATTEMPTS = 2

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

/**
 * The write set an agent of this run may dirty: exactly its own change folder
 * (`openspec/changes/<changeName>/`, trailing slash load-bearing — it is what
 * makes a prefix-sharing sibling a violation). No tree-wide fallback branch:
 * `changeName` is required on every spawn seam and validated by construction
 * (openspec scaffolds it before any later stage can spawn). If a spawn seam
 * without a change name ever emerges, re-widen explicitly in that seam's terms
 * and re-pin the guard tests — do not resurrect a silent tree-wide default.
 */
async function guardWorkingTree(
  execGit: ExecGitFn,
  cwd: string,
  before: Set<string>,
  allowedPrefix: string,
): Promise<void> {
  const after = await snapshotWorkingTree(execGit, cwd)
  const violations = [...after].filter((entry) => !before.has(entry) && !entry.startsWith(allowedPrefix))
  if (violations.length > 0) throw new DiffGuardViolationError(violations, allowedPrefix)
}

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
    await guardWorkingTree(deps.execGit, options.cwd, before, `openspec/changes/${options.changeName}/`)
    const parsed = options.outputSchema.safeParse(result.value)
    if (parsed.success) {
      deps.emit({ altitude: 'L1', type: 'done', agent: options.label, model, usage: result.usage })
      settleSessionAttempt(options.runDir, spawnInput, ledgerAttempt, 'done')
      return { value: parsed.data, usage: result.usage, attempts: attempt }
    }
    settleSessionAttempt(options.runDir, spawnInput, ledgerAttempt, 'killed')
    if (attempt >= MAX_VALIDATION_ATTEMPTS) {
      throw new AgentValidationError(
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
  // D1 precedence: explicit continueSessionId > seam lookup > fresh. The
  // seam consults the ledger's latest id-bearing `killed` entry — the
  // process-agnostic boundary (D2): in-process failures settle killed
  // (continue); a true crash dangles spawned and stays fresh outside review.
  const seam =
    options.continueSessionId === undefined ? findKilledSession(options.runDir, options.label, options.round) : null
  const continueSessionId = options.continueSessionId ?? seam?.opencodeSessionId ?? undefined
  if (continueSessionId !== undefined) {
    // D2: any continuation failure (session pruned, provider error, invalid
    // sidecar) falls back to the prompt-rebuild spawn — never worse than today.
    const continued = await attemptStageAgent(deps, options, 1, null, before, {
      sessionId: continueSessionId,
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
