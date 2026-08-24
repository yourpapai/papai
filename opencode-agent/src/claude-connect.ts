// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ClaudeCredential } from './config-values.js'

/**
 * How the `claude` CLI is **started and addressed** — the `opencode-connect.ts`
 * seam carried to the second backend: a spawned detached process leading its
 * own group, the child environment, a job-scoped config dir, and the group-kill
 * both the stop and the teardown ride. What the CLI *says* is
 * `claude-contract.ts`; the session the pipeline holds is `claude-adapter.ts`.
 */

/** The binary the workflow's gated install step puts on PATH. */
export const CLAUDE_BINARY = 'claude'

/**
 * How long a group kill waits between SIGTERM and SIGKILL.
 *
 * Named, and a constant rather than a knob: a grace two runners could disagree
 * on is the thing the pinned install exists to prevent. Long enough for a CLI
 * mid-write to flush on SIGTERM, short enough that a stop answers well inside
 * the wrap-up window that follows it.
 */
export const KILL_GRACE_MS = 5_000

/** The environment names the child must never carry, whatever scrubbing missed. */
const STRIPPED_NAMES = ['LLM_BASE_URL', 'AGENT_MCP_SERVERS', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'] as const

/** The CLI child as this layer sees it: a pid, a stdin, two streams, an exit. */
export interface ClaudeChildProcess {
  readonly pid: number
  readonly stdin: { write(chunk: string): void; end(): void }
  readonly stdout: AsyncIterable<Uint8Array>
  readonly stderr: AsyncIterable<Uint8Array>
  /** Resolves with the exit code (or `null` for an unkillable signal death). */
  readonly exited: Promise<number | null>
}

/** One CLI invocation to start. */
export interface ClaudeSpawnRequest {
  argv: readonly string[]
  /** Delivered on stdin — a single Linux argument is capped at 128 KiB. */
  stdinPrompt: string
  /**
   * The chosen Anthropic credential, when this spawn holds one. The API-key
   * spelling rides the child env; the OAuth spelling rides the helper files
   * `claude-credential.ts` materializes into the config dir, and no Anthropic
   * value enters the env (design D3).
   */
  credential?: ClaudeCredential | null
  /** The checkout the CLI works in. */
  workspace: string
  /**
   * The job-scoped config dir — one per adapter, not per spawn, because the
   * `--resume` session files of one job's turns live side by side in it.
   */
  configDir: string
  /** The post-scrub `process.env` of this process. */
  env: Record<string, string | undefined>
}

export interface ClaudeSpawnOptions {
  /** Injection seam for tests; defaults to the real detached `node:child_process` spawn. */
  spawn?: SpawnClaude
}

/** The spawn this layer performs — recorded by tests, real in production. */
export type SpawnClaude = (
  binary: string,
  argv: readonly string[],
  options: { detached: true; shell: false; env: Record<string, string>; cwd: string; stdio: 'pipe' },
) => ClaudeChildProcess

export interface ClaudeChild {
  readonly process: ClaudeChildProcess
  readonly configDir: string
  /** The environment the child runs with. Assertable in tests; never logged. */
  readonly env: Record<string, string>
}

/**
 * The job-scoped CLI config dir, under the OS tmp root and never the checkout
 * workspace — where a job's `--resume` session files live and die, so no
 * `~/.claude` state crosses jobs and `git add --all` in the implement phase
 * can never stage it.
 */
export const createClaudeConfigDir = (tmpRoot: string = tmpdir()): string =>
  mkdtempSync(path.join(tmpRoot, 'opencode-agent-claude-'))

/**
 * Builds the child environment: the post-scrub environment plus exactly the
 * injected values, name-stripped of everything this route must not carry.
 *
 * The scrub matched by *value* and already removed the credentials; the
 * name-strip exists for the carriers value-matching cannot see — `LLM_BASE_URL`
 * (a non-secret URL), `AGENT_MCP_SERVERS` (a JSON document with credentials
 * embedded *inside* it) — and for the two Anthropic spellings, so the one
 * that rides env can be re-added alone. Only the API-key spelling is
 * re-added: under `--bare` the pinned CLI never reads the env OAuth token,
 * so that spelling's carrier is the helper files and no Anthropic value
 * enters any spawned environment (design D3).
 */
const childEnv = (request: ClaudeSpawnRequest): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(request.env)) {
    if (value !== undefined) env[name] = value
  }
  for (const name of STRIPPED_NAMES) Reflect.deleteProperty(env, name)

  const credential = request.credential
  if (credential !== null && credential !== undefined && credential.name === 'ANTHROPIC_API_KEY') {
    env[credential.name] = credential.value
  }
  env['DISABLE_AUTOUPDATER'] = '1'
  env['CLAUDE_CONFIG_DIR'] = request.configDir
  return env
}

/** An async iterable that yields nothing — the stand-in for a missing stream. */
const emptyChunks = (): AsyncIterable<Uint8Array> => {
  const iterator: AsyncIterator<Uint8Array> = {
    next: (): Promise<IteratorResult<Uint8Array>> => Promise.resolve({ done: true, value: undefined }),
  }
  return { [Symbol.asyncIterator]: (): AsyncIterator<Uint8Array> => iterator }
}

/** Adapts `node:child_process`'s handle onto the narrow interface this layer names. */
export const liveSpawn: SpawnClaude = (binary, argv, options): ClaudeChildProcess => {
  const child: ChildProcess = spawn(binary, [...argv], {
    detached: options.detached,
    shell: options.shell,
    env: options.env,
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return {
    pid: child.pid ?? -1,
    stdin: {
      write: (chunk: string): void => {
        child.stdin?.write(chunk)
      },
      end: (): void => {
        child.stdin?.end()
      },
    },
    stdout: child.stdout ?? emptyChunks(),
    stderr: child.stderr ?? emptyChunks(),
    exited: new Promise((resolve) => {
      child.once('exit', (code: number | null) => {
        resolve(code)
      })
    }),
  }
}

/**
 * Spawns one `claude` turn: detached, so the CLI leads its own process group
 * and a group kill reaches the `Bash` tool's children; `shell: false` and an
 * argv vector, per this workspace's untrusted-input rule; the prompt on stdin;
 * `CLAUDE_CONFIG_DIR` at the job-scoped config dir the request names.
 */
export const spawnClaude = (request: ClaudeSpawnRequest, options: ClaudeSpawnOptions = {}): ClaudeChild => {
  const env = childEnv(request)
  const spawner = options.spawn ?? liveSpawn
  const child = spawner(CLAUDE_BINARY, request.argv, {
    detached: true,
    shell: false,
    env,
    cwd: request.workspace,
    stdio: 'pipe',
  })

  child.stdin.write(request.stdinPrompt)
  child.stdin.end()

  return { process: child, configDir: request.configDir, env }
}

/** Reads one output stream to a string. */
const readStream = async (stream: AsyncIterable<Uint8Array>): Promise<string> => {
  const decoder = new TextDecoder()
  let text = ''
  for await (const chunk of stream) text += decoder.decode(chunk, { stream: true })
  return text
}

/**
 * Collects a child's streams and exit status concurrently — the read half of
 * the spawn this layer owns.
 */
export const collectChild = (
  child: ClaudeChildProcess,
): Promise<[stdout: string, stderr: string, exitCode: number | null]> =>
  Promise.all([readStream(child.stdout), readStream(child.stderr), child.exited])

export interface GroupKillSeams {
  /**
   * Delivers a signal to a process-group target (`-pid`); throws when no such
   * group exists. Injected so the kill order is testable without a live child.
   */
  signal?: (target: number, signal: 'SIGTERM' | 'SIGKILL') => void
  /** The grace wait, injected so a test need not sit through five real seconds. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * SIGTERM → named grace → SIGKILL on the CLI's whole process group, reporting
 * whether the kill landed.
 *
 * `true` means the group is gone or dying: the escalation ends in an
 * untrappable SIGKILL, and a SIGTERM-trapping process that kept writing gets
 * escalated past within the grace — which is what lets the salvage fence treat
 * `true` as "the writer stopped". `false` means the first signal found no live
 * group (already gone, or refused) and nothing was escalated; a caller that
 * must not stage a tree whose writer may still run treats that exactly as
 * conservative as it reads.
 */
export const killGroup = async (pid: number, seams: GroupKillSeams = {}): Promise<boolean> => {
  const signal =
    seams.signal ??
    ((target: number, sig: 'SIGTERM' | 'SIGKILL'): void => {
      process.kill(target, sig)
    })
  const sleep = seams.sleep ?? ((ms: number): Promise<void> => Bun.sleep(ms))

  try {
    signal(-pid, 'SIGTERM')
  } catch {
    return false
  }

  await sleep(KILL_GRACE_MS)
  try {
    signal(-pid, 'SIGKILL')
  } catch {
    // Already gone: the SIGTERM landed and the group died inside the grace.
  }
  return true
}

export interface TeardownSeams extends GroupKillSeams {
  /** The config-dir removal, injectable so the test asserts it without a disk. */
  removeDir?: (dir: string) => void
}

/**
 * Teardown: never a stop, never a fallback for a kill that did not land, and
 * it reports nothing. What it does is make sure nothing outlives the job —
 * a live group found here (a turn deadline-abandoned outside the implement
 * phase, or a crashed run) gets the same escalation `killGroup` delivers,
 * **fire-and-forget** so the grace timer never blocks process exit or the
 * teardown reserve; the exit listener on the child reaps what remains, and the
 * job-scoped config dir is best-effort removed once the kill has settled.
 */
export const teardownClaude = (child: ClaudeChild, seams: TeardownSeams = {}): Promise<void> => {
  const remove =
    seams.removeDir ??
    ((dir: string): void => {
      rmSync(dir, { recursive: true, force: true })
    })

  void killGroup(child.process.pid, seams)
    .then(() => {
      remove(child.configDir)
    })
    .catch(() => {
      remove(child.configDir)
    })

  return Promise.resolve()
}
