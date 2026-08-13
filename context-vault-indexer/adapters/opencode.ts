// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { acquireIndexerLock, type LockDeps } from '../lock.js'

export type SpawnRequest = {
  command: string[]
  options: { detached: boolean; stdio: 'ignore' }
}

export type AdapterDeps = {
  lock: LockDeps
  spawnDetached(request: SpawnRequest): void
  pid?: number
}

export type ActivateInput = {
  stateDir: string
  daemonEntry: string
}

export type ActivateResult = 'spawned' | 'already-running'

/**
 * Reference coding-agent adapter: on session start it performs the lock check
 * and spawns the daemon detached when the lock was free. It never scans,
 * watches, or pushes in-process — coding-agent plugin lifecycles are
 * per-session, so the daemon must live in its own process (see design §8).
 */
export function activateOpencodeAdapter(input: ActivateInput, deps: AdapterDeps): ActivateResult {
  const pid = deps.pid ?? process.pid
  const acquired = acquireIndexerLock(input.stateDir, pid, deps.lock)
  if (!acquired.acquired) return 'already-running'
  deps.spawnDetached({
    command: ['bun', 'run', input.daemonEntry],
    options: { detached: true, stdio: 'ignore' },
  })
  return 'spawned'
}
