// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { ClaudeCredentialName, ClaudeInvocationProfile } from './backend-select.js'
import { allowlistForLabel, MAX_ARG_STRLEN, modelIdForCli, profileBlock } from './claude-argv.js'
import type { AgentBackend } from './config.js'

/**
 * The one composition seam between the loop and its agent subprocesses
 * (design D2): `attemptRun` delegates here instead of naming a binary, so the
 * default opencode route is byte-identical by construction and the claude
 * branch is one pure function over its inputs.
 */

/** A refused composition — raised before anything spawns, so no partial spend can follow it. */
export class AgentCommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentCommandError'
  }
}

export interface AgentCommand {
  command: string
  args: readonly string[]
  /** The whole role prompt; present only on the claude branch (one argv entry is capped at 128 KiB). */
  stdin?: string
  /** The child's entire replacement environment; absent inherits `process.env`. */
  env?: Record<string, string>
}

/**
 * The claude route's per-spawn context: the resolver's answer joined with the
 * ready per-spawn config dir (created by the attempt layer through its
 * dir-creation seam, never inside this builder) and the parent env read once
 * at `runCli`'s assembly point. The builder never reads ambient `process.env`.
 */
export interface ClaudeSpawnContext {
  profile: ClaudeInvocationProfile
  credentialName: ClaudeCredentialName
  credentialValue: string
  /** The per-spawn `CLAUDE_CONFIG_DIR` value, already created. */
  configDir: string
  /** The native profile's empty-MCP document path; `null` on bare. */
  mcpConfigPath: string | null
  envSource: Record<string, string | undefined>
}

/** One candidate conventions file's content, or undefined when absent/empty. */
async function readConventionFile(resolved: string): Promise<string | undefined> {
  try {
    const content = await readFile(resolved, 'utf8')
    return content.trim().length === 0 ? undefined : content
  } catch {
    return undefined
  }
}

/**
 * The repo conventions the role prompts assert are "already in your context"
 * (opencode loads them; the pinned claude CLI loads no memory files under
 * either profile — recorded census), appended through the system-prompt seam
 * on the claude route. Read from the spawn cwd: the worktree carries the
 * checkout's own copy, so the conventions always match the tree under review.
 * Absent is fine — the premise simply does not apply.
 */
export async function loadClaudeConventions(cwd: string): Promise<string | undefined> {
  const agents = await readConventionFile(path.resolve(cwd, 'AGENTS.md'))
  if (agents !== undefined) return agents
  return readConventionFile(path.resolve(cwd, 'CLAUDE.md'))
}

export interface AgentCommandOptions {
  /** Default `'opencode'`; both this and `claude` absent is the opencode route. */
  backend?: AgentBackend
  model: string
  /**
   * The reasoning-effort tier this subprocess runs at (design D4); absent
   * composes no flag. The claude branch emits it as `--effort` immediately
   * after `--model` (D6); the opencode branch ignores it — on that route the
   * tier reaches the worker as `agent.build.variant` inside
   * `OPENCODE_CONFIG_CONTENT`, and a flag would be a second source of truth.
   */
  effort?: string
  cwd: string
  prompt: string
  extraArgs: readonly string[]
  label: string
  /** Required when `backend` is `claude`; a named refusal otherwise. */
  claude?: ClaudeSpawnContext
  /** Optional appended system prompt; refused over the single-argument byte cap. */
  systemPrompt?: string
  /**
   * Continuation session id (escalation-retry-session-continuation D4):
   * `--session <id>` on opencode, `--resume <id>` on claude — the mapping is
   * backend-aware here, never hardcoded at a caller. Absent adds no flag.
   */
  continueSessionId?: string
  /**
   * The opencode child's entire replacement environment, caller-composed — the
   * builder never reads ambient `process.env` (afk-runner-agent-mcp D3).
   * Returned verbatim as `AgentCommand.env`; absent stays `undefined`, so
   * `realSpawn` inherits `process.env` byte-identically. The claude branch
   * refuses a set map: afk-runner threads no claude backend, and a silent
   * ignore would hide an operator mistake.
   */
  opencodeEnv?: Record<string, string>
}

function opencodeCommand(options: AgentCommandOptions): AgentCommand {
  return {
    command: 'opencode',
    args: [
      'run',
      '--auto',
      '--format',
      'json',
      '--model',
      options.model,
      '--dir',
      options.cwd,
      ...options.extraArgs,
      ...(options.continueSessionId === undefined ? [] : ['--session', options.continueSessionId]),
      options.prompt,
    ],
    ...(options.opencodeEnv === undefined ? {} : { env: options.opencodeEnv }),
  }
}

/** The credential spelling each profile re-adds; a mismatched spelling injects nothing. */
const PROFILE_CREDENTIAL: Readonly<Record<ClaudeInvocationProfile, ClaudeCredentialName>> = {
  bare: 'ANTHROPIC_API_KEY',
  native: 'CLAUDE_CODE_OAUTH_TOKEN',
}

/**
 * The names the claude child env never carries, whatever the parent env holds
 * (design D5): the other route's carriers, the CLI's endpoint and traffic
 * redirection switches, and the non-selected Anthropic spelling. The one
 * redirection class deliberately left inherited is the standard proxy
 * variables — a laptop that needs its egress proxy must still reach Anthropic.
 */
const STRIPPED_ENV_NAMES = [
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'OPENCODE_CONFIG_CONTENT',
  'AGENT_MCP_SERVERS',
  'AGENT_MCP_ROLE_NARROWING',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_USE_BEDROCK',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'CLAUDE_CODE_USE_VERTEX',
  'ANTHROPIC_VERTEX_BASE_URL',
] as const

/** Strip-then-add over `envSource` only — the passed map replaces, never overlays, `process.env`. */
export function claudeChildEnv(context: ClaudeSpawnContext): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(context.envSource)) {
    if (value !== undefined) env[name] = value
  }
  for (const name of STRIPPED_ENV_NAMES) Reflect.deleteProperty(env, name)
  Reflect.deleteProperty(env, 'ANTHROPIC_API_KEY')
  Reflect.deleteProperty(env, 'CLAUDE_CODE_OAUTH_TOKEN')

  if (context.credentialName === PROFILE_CREDENTIAL[context.profile]) {
    env[context.credentialName] = context.credentialValue
  }
  env['DISABLE_AUTOUPDATER'] = '1'
  env['CLAUDE_CONFIG_DIR'] = context.configDir
  return env
}

/**
 * The opencode-route knobs a claude invocation refuses rather than silently
 * drops (afk-runner-agent-mcp D3): afk-runner threads no claude backend, and
 * an ignored knob would hide an operator mistake.
 */
function refuseOpencodeRouteKnobs(options: AgentCommandOptions): void {
  if (options.extraArgs.length > 0) {
    throw new AgentCommandError(
      `extraArgs is opencode-argv-shaped and cannot ride a claude invocation (got ${options.extraArgs.join(' ')}); ` +
        'remove the knob or run the opencode backend — a silent pass-through could append argv after the allowlist block.',
    )
  }
  if (options.opencodeEnv !== undefined) {
    throw new AgentCommandError(
      `opencodeEnv is an opencode-route knob and cannot ride a claude invocation (got ${Object.keys(options.opencodeEnv).join(' ')}); ` +
        'remove the knob or run the opencode backend — the claude child env is composed from the spawn context alone, ' +
        'and a silent ignore would hide an operator mistake.',
    )
  }
}

function claudeCommand(options: AgentCommandOptions): AgentCommand {
  const context = options.claude
  if (context === undefined) {
    throw new AgentCommandError(
      'The claude backend is selected but no claude context was assembled for this spawn — ' +
        'the run must resolve credentials and a config-dir parent before any role subprocess starts.',
    )
  }
  refuseOpencodeRouteKnobs(options)

  const system = options.systemPrompt
  if (system !== undefined && Buffer.byteLength(system, 'utf8') > MAX_ARG_STRLEN) {
    throw new AgentCommandError(
      `The appended system prompt is ${Buffer.byteLength(system, 'utf8').toLocaleString('en-US')} bytes and the ` +
        `operating system caps one command-line argument at ${MAX_ARG_STRLEN.toLocaleString('en-US')} bytes ` +
        '(MAX_ARG_STRLEN), so the `claude` process could not even start. The system prompt is the one prompt ' +
        'component that grew — shrink it before running again.',
    )
  }

  return {
    command: 'claude',
    args: [
      ...profileBlock(context.profile, context.mcpConfigPath),
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'default',
      '--allowedTools',
      allowlistForLabel(options.label, options.cwd),
      '--model',
      modelIdForCli(options.model),
      ...(options.effort === undefined ? [] : ['--effort', options.effort]),
      ...(options.continueSessionId === undefined ? [] : ['--resume', options.continueSessionId]),
      ...(system === undefined ? [] : ['--append-system-prompt', system]),
    ],
    stdin: options.prompt,
    env: claudeChildEnv(context),
  }
}

/**
 * Absolute path the agent should write its output to.
 *
 * The path is absolute (not relative) so the agent cannot mis-resolve it
 * against an unrelated project root. The worktree cwd itself often lives at
 * `<repoRoot>/.review-loop/worktrees/<runId>/`, and a relative path like
 * `.review-loop/matches.json` is ambiguous: the agent may resolve it against
 * the worktree cwd (correct) or against the project root two levels up
 * (`<repoRoot>/.review-loop/matches.json` — wrong). The runner always reads
 * from `<cwd>/.review-loop/<basename(outputPath)>`, so the prompt must direct
 * the agent there unambiguously.
 */
export function agentWritePath(cwd: string, outputPath: string): string {
  return path.resolve(cwd, '.review-loop', path.basename(outputPath))
}

const MISPLACEMENT_SEARCH_DEPTH = 8

export function findMisplacedScratches(expectedPath: string, cwd: string, basename: string): string[] {
  const expected = path.resolve(expectedPath)
  const found: string[] = []
  let current = path.resolve(cwd)
  for (let i = 0; i < MISPLACEMENT_SEARCH_DEPTH; i += 1) {
    const candidate = path.resolve(current, '.review-loop', basename)
    if (candidate !== expected && existsSync(candidate)) {
      found.push(candidate)
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return found
}

/**
 * Composes one agent invocation. The opencode branch returns today's argv and,
 * when the caller composed one, the verbatim `opencodeEnv` as the child env —
 * absent, `realSpawn` inherits `process.env` exactly as before; the claude
 * branch composes the profile block, the streaming tail, the per-role
 * allowlist, the stripped model id, the prompt on stdin and the strip-then-add
 * child env.
 */
export function buildAgentCommand(options: AgentCommandOptions): AgentCommand {
  return options.backend === 'claude' ? claudeCommand(options) : opencodeCommand(options)
}
