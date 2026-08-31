// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { rmSync } from 'node:fs'

import type { ClaudeChild } from './claude-connect.js'

/**
 * The claude CLI's group kill and teardown — split from `claude-connect.ts`
 * along the seam its own header names: that module is how the CLI is
 * **started and addressed**, this is how nothing of it **outlives the job**.
 * One concern, two consumers (`teardownClaude` here, the adapter's stop via
 * `killGroup`), and the reason the extraction exists is capacity: the spawn
 * module was at its `max-lines` floor when the custom child environment
 * arrived.
 */

/**
 * How long a group kill waits between SIGTERM and SIGKILL.
 *
 * Named, and a constant rather than a knob: a grace two runners could disagree
 * on is the thing the pinned install exists to prevent. Long enough for a CLI
 * mid-write to flush on SIGTERM, short enough that a stop answers well inside
 * the wrap-up window that follows it.
 */
export const KILL_GRACE_MS = 5_000

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
