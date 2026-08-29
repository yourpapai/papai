// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SpawnFn, SpawnResult } from '../../review-loop/src/agent-runner.js'
import { SpawnError } from './errors.js'

/** Node child-process launch failures surface as `spawn <cmd> <ERRNO>` in the error event's message. */
const LAUNCH_FAILURE_RE = /\bspawn \S+ [A-Z]+\b/u

/** A resolved spawn result that proves the transport never reached the agent: failed exit, no output, launch-level stderr. */
export function isTransportFailure(result: SpawnResult): boolean {
  return result.exitCode !== 0 && result.stdout.trim().length === 0 && LAUNCH_FAILURE_RE.test(result.stderr)
}

/**
 * The afk-authored injection over `realSpawn` (C6 D1): classify transport
 * failures at the seam — a launch-failure result rejects as a typed
 * `SpawnError` so the drive loop can declare it a run fact; every other
 * result and every non-spawn error crosses unchanged.
 */
export function typedSpawn(inner: SpawnFn): SpawnFn {
  return async function spawnTransportChecked(command, args, options, onLine) {
    const result = await inner(command, args, options, onLine)
    if (isTransportFailure(result)) {
      throw new SpawnError(`could not reach the agent: ${result.stderr.trim()}`, { cause: result })
    }
    return result
  }
}
