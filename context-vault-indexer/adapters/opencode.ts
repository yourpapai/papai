// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { RepoEntry } from '../config.js'
import { sendIpcRequest, socketPathOf } from '../ipc.js'
import { acquireIndexerLock, handoffIndexerLock, type LockDeps } from '../lock.js'
import type { RegisterAction, RegisterResult } from '../registry.js'

const DEFAULT_MAX_REGISTER_ATTEMPTS = 5
const DEFAULT_REGISTER_BACKOFF_MS = 200

export type SpawnRequest = {
  command: string[]
  options: { detached: boolean; stdio: 'ignore' }
}

export type RegisterCall = RepoEntry & { socketPath: string }

export type AdapterDeps = {
  lock: LockDeps
  /** Spawns the daemon detached and returns its process id. */
  spawnDetached(request: SpawnRequest): number
  /** Sends one register request to the daemon's socket. */
  register(call: RegisterCall): Promise<RegisterResult>
  sleep(ms: number): Promise<void>
  pid?: number
  maxRegisterAttempts?: number
  registerBackoffMs?: number
}

export type ActivateInput = RepoEntry & {
  stateDir: string
  daemonEntry: string
}

export type ActivateResult = {
  daemon: 'spawned' | 'already-running'
  registration: RegisterAction | 'failed'
}

const RegisterResponseSchema = z.union([
  z.object({ ok: z.literal(true), repo: z.string(), action: z.enum(['registered', 'updated', 'unchanged']) }),
  z.object({ ok: z.literal(false), error: z.string() }),
])

/**
 * Default wiring: registration goes over the daemon's unix socket. The response
 * is validated rather than trusted — a daemon on the other end of that socket
 * may be an older build with a different reply shape.
 */
export const registerOverIpc = async (call: RegisterCall): Promise<RegisterResult> => {
  const response = await sendIpcRequest(call.socketPath, {
    op: 'register',
    repo: call.repo,
    specDir: call.specDir,
  })
  return RegisterResponseSchema.parse(response)
}

/**
 * Retries a refused connection: a daemon this activation just spawned needs a
 * moment to bind its socket, and an activation that found the lock already held
 * can race a daemon that is still starting.
 */
const attemptRegister = async (
  call: RegisterCall,
  deps: AdapterDeps,
  attempt: number,
  maxAttempts: number,
  backoffMs: number,
): Promise<RegisterAction | 'failed'> => {
  try {
    const result = await deps.register(call)
    // A daemon-side rejection (a bad spec dir, say) is a verdict, not a race:
    // retrying it would just repeat the same answer.
    return result.ok ? result.action : 'failed'
  } catch {
    if (attempt >= maxAttempts) return 'failed'
    await deps.sleep(backoffMs * 2 ** (attempt - 1))
    return attemptRegister(call, deps, attempt + 1, maxAttempts, backoffMs)
  }
}

const registerWithRetry = (call: RegisterCall, deps: AdapterDeps): Promise<RegisterAction | 'failed'> =>
  attemptRegister(
    call,
    deps,
    1,
    deps.maxRegisterAttempts ?? DEFAULT_MAX_REGISTER_ATTEMPTS,
    deps.registerBackoffMs ?? DEFAULT_REGISTER_BACKOFF_MS,
  )

/**
 * Reference coding-agent adapter: on session start it performs the lock check,
 * spawns the daemon detached when the lock was free, and registers this
 * session's repository with the daemon either way. It never scans, watches, or
 * pushes in-process — coding-agent plugin lifecycles are per-session, so the
 * daemon must live in its own process (see design §8).
 *
 * The adapter acquires the lock with its own (short-lived) pid purely to
 * serialize concurrent activations, then immediately hands the record off to
 * the spawned daemon's pid. From then on the daemon owns the lock and
 * refreshes its heartbeat on every scan tick, so the lock stays live after
 * the plugin process exits.
 *
 * Registration failure is reported, never thrown: the coding session is the
 * user's actual work, and losing indexing is a degradation rather than a
 * reason to break activation.
 */
export async function activateOpencodeAdapter(input: ActivateInput, deps: AdapterDeps): Promise<ActivateResult> {
  const pid = deps.pid ?? process.pid
  const acquired = acquireIndexerLock(input.stateDir, pid, deps.lock)
  const call: RegisterCall = {
    socketPath: socketPathOf(input.stateDir),
    repo: input.repo,
    specDir: input.specDir,
  }

  if (!acquired.acquired) {
    return { daemon: 'already-running', registration: await registerWithRetry(call, deps) }
  }

  try {
    const daemonPid = deps.spawnDetached({
      command: ['bun', 'run', input.daemonEntry, input.stateDir],
      options: { detached: true, stdio: 'ignore' },
    })
    handoffIndexerLock(acquired.lockPath, pid, daemonPid, deps.lock)
  } catch {
    // The lock is ours but no daemon came up. Registration will fail its
    // attempts and report that, rather than throwing into the session.
    return { daemon: 'spawned', registration: 'failed' }
  }
  return { daemon: 'spawned', registration: await registerWithRetry(call, deps) }
}
