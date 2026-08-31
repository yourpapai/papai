// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { copyFile, mkdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

import type { z } from 'zod'

import {
  agentWritePath,
  buildAgentCommand,
  defaultCreateClaudeSpawnDir,
  findMisplacedScratches,
  loadClaudeConventions,
  type ClaudeSpawnContext,
  type ClaudeSpawnDir,
  type CreateClaudeSpawnDir,
} from './agent-command.js'
import { scrubCredentialValue, type ClaudeRunContext } from './backend-select.js'
import { createClaudeStreamDecoder } from './claude-stream.js'
import type { AgentBackend } from './config.js'
import { createLineHandler, enqueueLog } from './line-handler.js'
import type { LineHandler, SessionLedgerSeam } from './line-handler.js'
import type { ProgressReporter } from './progress-log.js'
import type { AgentUsage } from './run-stats.js'
import type { LineSink, SpawnFn, SpawnResult } from './spawn.js'

export { agentWritePath, findMisplacedScratches } from './agent-command.js'
export type { LineSink, SpawnFn, SpawnResult } from './spawn.js'
export { emptyUsage } from './run-stats.js'
export type { AgentUsage } from './run-stats.js'
export type { ClaudeSpawnDir, CreateClaudeSpawnDir } from './agent-command.js'
export type { ClaudeRunContext } from './backend-select.js'
export { createLineHandler } from './line-handler.js'
export type { LineHandler, SessionLedgerSeam } from './line-handler.js'

export interface AgentRunResult<T> {
  value: T
  usage: AgentUsage
}

export class AgentRunError extends Error {
  readonly usage: AgentUsage
  constructor(message: string, usage: AgentUsage) {
    super(message)
    this.name = 'AgentRunError'
    this.usage = usage
  }
}

export interface RunAgentOptions<T> {
  spawn: SpawnFn
  model: string
  /** The role's reasoning-effort tier, composed as `--effort` on the claude branch (D4); absent is no flag (D6). */
  effort?: string
  cwd: string
  prompt: string
  outputPath: string
  outputSchema: z.ZodType<T>
  label: string
  /**
   * Slot identity for live rendering; defaults to `label`. Callers that run
   * several agents as one on-screen unit (mutation-improve's iteration) pass a
   * shared key so each agent's live line replaces the previous one in place.
   */
  slotKey?: string
  /**
   * When false, dispose leaves the slot live instead of committing it — the
   * unit's owner (e.g. the mutation-improve pipeline) commits once at the end.
   */
  commitOnDispose?: boolean
  logPath: string
  extraArgs: readonly string[]
  reporter?: ProgressReporter
  onRetry?: () => void
  timeoutMs?: number
  inactivityTimeoutMs?: number
  /**
   * Session-capture seam (D1): called once, the moment the first
   * session-bearing event line of this spawn arrives. The host records the id
   * synchronously so a crash mid-agent still leaves it on disk.
   */
  sessionLedger?: SessionLedgerSeam
  /** Preferred ledger attempt number for this spawn (default 1). */
  sessionAttempt?: number
  /**
   * Fail fast instead of retrying a soft failure once. Resume continuations
   * set this: their fallback path is the caller's prompt-rebuild spawn, not a
   * second continuation of a session that may no longer exist.
   */
  noRetry?: boolean
  /** Which subprocess backend serves this spawn; absent is `opencode` (D2). */
  backend?: AgentBackend
  /** Required on the claude route; assembled once in `runCli` and threaded to every spawn. */
  claude?: ClaudeRunContext
  /**
   * The per-spawn config-dir creation seam (D8): each spawn gets its own child
   * under the run parent, with the native profile's empty-MCP document written
   * into it by the same seam. Injectable so tests need no filesystem.
   */
  createClaudeSpawnDir?: CreateClaudeSpawnDir
}

interface AttemptResult<T> {
  ok: true
  value: T
}

interface AttemptError {
  ok: false
  error: Error
  timedOut: boolean
  stalled: boolean
}

type Attempt<T> = AttemptResult<T> | AttemptError

function attemptRun<T>(
  options: RunAgentOptions<T>,
  spawnDir: ClaudeSpawnDir | null,
  onLine?: LineSink,
  systemPrompt?: string,
): Promise<SpawnResult> {
  const claude: ClaudeSpawnContext | undefined =
    options.claude === undefined || spawnDir === null
      ? undefined
      : {
          profile: options.claude.profile,
          credentialName: options.claude.credentialName,
          credentialValue: options.claude.credentialValue,
          configDir: spawnDir.configDir,
          mcpConfigPath: spawnDir.mcpConfigPath,
          envSource: options.claude.envSource,
        }
  const command = buildAgentCommand({
    backend: options.backend,
    model: options.model,
    effort: options.effort,
    cwd: options.cwd,
    prompt: options.prompt,
    extraArgs: options.extraArgs,
    label: options.label,
    claude,
    systemPrompt,
  })
  return options.spawn(
    command.command,
    command.args,
    {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      inactivityTimeoutMs: options.inactivityTimeoutMs,
      stdin: command.stdin,
      env: command.env,
    },
    onLine,
  )
}

/**
 * The non-zero-exit attempt failure, scrubbed once before it is embedded
 * anywhere (D5): both the enqueued stderr line and the error message flow
 * from this one copy, which later persists into needs-human reasoning.
 */
function spawnFailure<T>(
  options: RunAgentOptions<T>,
  handler: LineHandler,
  result: { exitCode: number; stderr: string; timedOut?: boolean; stalled?: boolean },
): Attempt<T> {
  const stderr = scrubCredentialValue(result.stderr, options.claude?.credentialValue ?? null)
  enqueueLog(handler.ctx, `[${options.label}] stderr: ${stderr}\n`)
  return {
    ok: false,
    error: new Error(`${options.label} exited with code ${result.exitCode}: ${stderr}`),
    timedOut: result.timedOut === true,
    stalled: result.stalled === true,
  }
}

async function runAttempt<T>(
  options: RunAgentOptions<T>,
  handler: LineHandler,
  systemPrompt?: string,
): Promise<Attempt<T>> {
  await mkdir(path.resolve(options.cwd, '.review-loop'), { recursive: true })
  // Re-arm session capture: a stall retry is a fresh opencode session, and its
  // id must be recorded even though the first attempt already captured one.
  handler.ctx.sessionId = null
  // Re-arm the decoder on the claude route (D6): the tool-pairing map and the
  // result outcome are attempt state, so a retry never reads the stalled
  // attempt's result line as its own.
  if (options.backend === 'claude') {
    handler.decoder = createClaudeStreamDecoder()
  }
  const spawnDir =
    options.claude === undefined
      ? null
      : await (options.createClaudeSpawnDir ?? defaultCreateClaudeSpawnDir)(options.claude)
  const result = await attemptRun(options, spawnDir, handler.onLine, systemPrompt)
  if (result.exitCode !== 0) return spawnFailure(options, handler, result)
  if (options.backend === 'claude') {
    // Result-outcome gate (D6): an exit-0 turn whose result line is missing or
    // error-signalling fails the attempt through the existing error path
    // **before** the output file is accepted — never an empty success.
    const outcome = handler.decoder.resultOutcome()
    if (!outcome.seen || outcome.isError) {
      const why = outcome.isError ? 'its result line signals an error' : 'no result line arrived'
      return {
        ok: false,
        error: new Error(
          `${options.label} exited 0 but ${why} — a drifted CLI presents as this failure; ` +
            'check the pinned @anthropic-ai/claude-code version.',
        ),
        timedOut: false,
        stalled: false,
      }
    }
  }
  return exchangeOutput(options)
}

/**
 * The file-based output exchange's accept step, split from `runAttempt` when
 * the claude seams pushed that function past `max-lines-per-function`. Reads
 * the agent's scratch, copies it to the destination and validates the schema;
 * a missing scratch keeps the backend-agnostic misplaced-scratch diagnosis.
 */
async function exchangeOutput<T>(options: RunAgentOptions<T>): Promise<Attempt<T>> {
  try {
    const agentFile = agentWritePath(options.cwd, options.outputPath)
    await mkdir(path.dirname(options.outputPath), { recursive: true })
    await copyFile(agentFile, options.outputPath)
    await unlink(agentFile)
    const raw = await readFile(options.outputPath, 'utf8')
    return { ok: true, value: options.outputSchema.parse(JSON.parse(raw)) }
  } catch (error) {
    const isEnoent =
      error !== null && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
    if (isEnoent) {
      const misplaced = findMisplacedScratches(
        agentWritePath(options.cwd, options.outputPath),
        options.cwd,
        path.basename(options.outputPath),
      )
      const hint = misplaced.length === 0 ? '' : ` Possible misplaced file(s): ${misplaced.join(', ')}.`
      const agentFile = agentWritePath(options.cwd, options.outputPath)
      return {
        ok: false,
        error: new Error(`${options.label} did not write to the expected scratch path: ${agentFile}.${hint}`),
        timedOut: false,
        stalled: false,
      }
    }
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
      timedOut: false,
      stalled: false,
    }
  }
}

export async function runAgent<T>(options: RunAgentOptions<T>): Promise<AgentRunResult<T>> {
  const handler = createLineHandler(options)
  const systemPrompt = options.backend === 'claude' ? await loadClaudeConventions(options.cwd) : undefined
  const buildUsage = (): AgentUsage => ({
    ...handler.ctx.usage,
    wallMs: handler.ctx.firstStepAt === null ? 0 : Date.now() - handler.ctx.firstStepAt,
  })
  const finalize = (value: T): AgentRunResult<T> => ({ value, usage: buildUsage() })
  try {
    const first = await runAttempt(options, handler, systemPrompt)
    if (first.ok) return finalize(first.value)
    // Wall-clock timeouts are not retried (the task genuinely overran its
    // budget), but stalls are: a hung provider stream is transient, and the
    // retry usually lands on a healthy request path.
    if (first.timedOut && !first.stalled) throw new AgentRunError(first.error.message, buildUsage())
    if (options.noRetry === true) throw new AgentRunError(first.error.message, buildUsage())
    options.onRetry?.()
    const second = await runAttempt(options, handler, systemPrompt)
    if (second.ok) return finalize(second.value)
    throw new AgentRunError(second.error.message, buildUsage())
  } finally {
    await handler.dispose()
  }
}
