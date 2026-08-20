// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import type { AgentHandle } from './agent-handle.js'
import type { CliArgs, MainOptions } from './cli-args.js'
import { parseArgs } from './cli-args.js'
import { resolveOpenSpecMode } from './config-discovery.js'
import { loadConfig } from './config.js'
import type { PipelineConfig } from './config.js'
import { contain } from './contain.js'
import { createRunTranscript } from './debug-transcript.js'
import type { DebugTranscript } from './debug-transcript.js'
import { createOctokitApi } from './github.js'
import type { GitHubApi } from './github.js'
import { createPipelineLogger } from './logger.js'
import type { Logger } from './logger.js'
import { resolveModelFacts } from './model-metadata.js'
import { runPipeline } from './orchestrator.js'
import type { PhaseDeps } from './phase-context.js'
import { resolvePullRequestTrigger } from './pr-trigger.js'
import type { ProviderProxy } from './provider-proxy.js'
import type { RunResult } from './run-result.js'
import { pipelineSecrets, scrubSecrets } from './secrets.js'
import { runCommand } from './shell.js'
import { recordReport } from './step-output.js'
import { parseTriggerEvent } from './trigger-events.js'
import type { TriggerEvent } from './trigger-events.js'
import { errorMessage } from './types.js'

// Re-exported so callers keep naming one module for the entry point. The
// parser is *imported* as well as re-exported — a bare re-export binds no
// local name, and `runCli` calls it, which typechecks and then throws
// `ReferenceError` at runtime.
export { parseArgs, UsageError } from './cli-args.js'
export type { CliArgs } from './cli-args.js'

export type { MainOptions } from './cli-args.js'

// Re-exported, like the parser above: the assembly moved to `contain.ts` when
// this file outgrew `max-lines`, and callers keep naming one module.
export { contain } from './contain.js'
export type { Contained, ContainInput } from './contain.js'

/**
 * The event this run acts on: the payload normalized, and — for a comment typed
 * on a pull request — resolved back to the issue its branch names.
 *
 * `null` covers both halves of "nothing to do": a payload this pipeline does not
 * act on, and a pull-request comment `resolvePullRequestTrigger` declined to
 * claim. Both log their own reason, so this hands back only the fact.
 */
const readEvent = async (args: CliArgs, github: GitHubApi, log: Logger): Promise<TriggerEvent | null> => {
  const payload: unknown = JSON.parse(await readFile(args.eventPath, 'utf8'))
  const parsed = parseTriggerEvent(args.eventName, payload)
  if (parsed === null) {
    log.warn({ eventName: args.eventName }, 'Payload carries nothing this pipeline acts on')
    return null
  }

  if (parsed.kind !== 'pending-pull-request') return parsed
  return resolvePullRequestTrigger(parsed, github, log)
}

/** The credentialled client, built once and handed to both the resolver and `contain`. */
const githubFor = (config: PipelineConfig, secrets: readonly string[], options: MainOptions): GitHubApi =>
  createOctokitApi({
    token: config.githubToken,
    owner: config.owner,
    repo: config.repo,
    secrets,
    ...options.octokit,
  })

/** The run itself, once everything it needs is assembled. Extracted so the
 *  entry point stays under `max-lines` with the lifecycle intact in one piece. */
interface LifecycleInput {
  event: TriggerEvent
  deps: PhaseDeps
  agent: AgentHandle
  proxy: ProviderProxy
  transcript: DebugTranscript | null
  options: MainOptions
  log: Logger
}

/**
 * Runs the pipeline and tears the run down, in that order, whatever happened.
 *
 * The transcript closes **last**: `agent.close()` and `proxy.close()` are what
 * let the process exit, and events can still be draining while they run — so
 * the flush-on-close that turns a crashed run into a partial transcript has to
 * come after them, not before.
 */
const runPipelineLifecycle = async (input: LifecycleInput): Promise<RunResult> => {
  const { event, deps, agent, proxy, transcript, options, log } = input

  log.info(
    { event: event.eventName, kind: event.kind, issue: event.issueNumber, model: deps.config.openai.model },
    'Starting agent pipeline',
  )

  try {
    const result = await runPipeline({ event, deps })
    const phase = result.state === null ? null : result.state.phase
    log.info({ status: result.status, reason: result.reason, phase }, 'Pipeline finished')
    // Only on the returning path. A `runPipeline` that throws is precisely the
    // crash the fallback comment is for, and marking it here would silence the
    // one comment the issue would otherwise get.
    await recordReport(result, options.env, log)
    return result
  } finally {
    // Both hold listening sockets; without this the process stays alive after
    // the work is done and the job dies on its timeout.
    await agent.close()
    await proxy.close()
    await transcript?.close()
  }
}

/**
 * The fail-closed door for a checkout with no `openspec/` tree (design D10).
 *
 * Posts one clear comment naming the remedy and stands down: the agent never
 * scaffolds OpenSpec into a foreign repo, and with `AGENT_SPEC`/`AGENT_PLAN`
 * retired (D12) there is no legacy block mode to fall back to. Called before
 * `contain`, so no OpenCode server spawns for a run that will do no work.
 */
const postStandDown = async (
  reason: string,
  issueNumber: number,
  github: GitHubApi,
  log: Logger,
): Promise<RunResult> => {
  log.warn({ mode: 'stand-down', issue: issueNumber }, 'No openspec/ tree; posting stand-down and exiting')
  await github.createComment(issueNumber, reason)
  return { status: 'skipped', reason: 'stand-down: no openspec/ tree', state: null, reported: true }
}

/**
 * Resolves the event this run acts on, and the two early-exit doors that can
 * close before any work starts: a payload this pipeline ignores, and the
 * OpenSpec stand-down (design D10) for a checkout with no `openspec/` tree.
 *
 * Returning a discriminated union keeps `runCli` under `max-lines-per-function`
 * without spreading the door logic across the entry point. The probe lives here
 * rather than in `loadConfig` because this is its sole consumer, and folding it
 * into config would grow that file past `max-lines` for a single call site.
 */
type DoorResolution =
  | { readonly kind: 'door'; readonly result: RunResult }
  | { readonly kind: 'event'; readonly event: TriggerEvent }

const resolveEventOrDoor = async (args: CliArgs, github: GitHubApi, log: Logger): Promise<DoorResolution> => {
  const event = await readEvent(args, github, log)
  if (event === null) {
    return {
      kind: 'door',
      result: { status: 'skipped', reason: 'Payload carries nothing to act on', state: null, reported: false },
    }
  }

  const mode = resolveOpenSpecMode(args.repoRoot, existsSync)
  if (mode.mode === 'stand-down')
    return { kind: 'door', result: await postStandDown(mode.reason, event.issueNumber, github, log) }

  return { kind: 'event', event }
}

/**
 * Entry point shared by the Action and by local `--event-path` runs.
 *
 * Returns a {@link RunResult} rather than exiting so the same call is drivable
 * from a test; `main` below maps the status onto a process exit code.
 */
/**
 * The config, with whatever this run can learn about its own model filled in.
 *
 * Called after the guardrail door, and that ordering is the point: this is a
 * network read, and a payload the pipeline is about to drop must not pay for one.
 * Best-effort by construction — a catalogue that cannot be read leaves the facts
 * empty, which emits exactly the config this pipeline emitted before the lookup
 * existed.
 */
const describeModel = async (config: PipelineConfig, options: MainOptions, log: Logger): Promise<PipelineConfig> => {
  const { facts } = await resolveModelFacts(config.openai, log, { loadDb: options.modelCatalogue })
  return { ...config, openai: { ...config.openai, facts } }
}

export const runCli = async (options: MainOptions): Promise<RunResult> => {
  const args = parseArgs(options.argv, options.env)
  // Config first, so the logger is built knowing which values must never be
  // printed. Nothing logs before this point; a config error propagates to
  // `main` instead, and carries no credential.
  const config = loadConfig(options.env, args.repoRoot)
  const log = options.logger ?? createPipelineLogger(args.logLevel, config)
  const secrets = pipelineSecrets(config)

  // Before anything can spawn a child. The OpenCode server inherits this
  // process's environment wholesale, so a credential left here is one the model
  // can read with `bash`.
  const scrubbed = scrubSecrets(options.env, secrets)
  if (scrubbed.length > 0) log.debug({ variables: scrubbed }, 'Removed credentials from the environment')

  // Before the event is even known, because resolving a pull-request comment to
  // its issue is an API call — see {@link ContainInput.github}.
  const github = githubFor(config, secrets, options)
  const resolved = await resolveEventOrDoor(args, github, log)
  if (resolved.kind === 'door') return resolved.result
  const { event } = resolved

  // After the event is known: a payload this pipeline ignores must not spend
  // the one keyless warning — or create the empty artefact — on a run that was
  // never going to act.
  const transcript = createRunTranscript(config, secrets, log)

  const described = await describeModel(config, options, log)

  const contained = await contain({
    config: described,
    event,
    log,
    run: options.run ?? runCommand,
    options,
    github,
    transcript: transcript ?? undefined,
  })

  return runPipelineLifecycle({
    event,
    deps: contained.deps,
    agent: contained.agent,
    proxy: contained.proxy,
    transcript,
    options,
    log,
  })
}

/** Exit codes: 0 for skipped/waiting/completed, 1 only for a genuine failure. */
export const main = async (): Promise<number> => {
  try {
    const result = await runCli({ argv: process.argv.slice(2), env: process.env })
    return result.status === 'failed' ? 1 : 0
  } catch (error) {
    const stack = error instanceof Error && error.stack !== undefined ? error.stack : errorMessage(error)
    process.stderr.write(`${stack}\n`)
    return 1
  }
}

/** True when this module is the process entry, under both Bun and Node. */
const isEntryPoint = (): boolean => {
  const entry = process.argv[1]
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href
}

if (isEntryPoint()) {
  process.exit(await main())
}
