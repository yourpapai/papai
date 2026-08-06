// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { iterDir, type MutationImproveRunState } from './run-state.js'

export type FailureEntry = { iter: number; gate: string; reason: string; file?: string }

// Single failure sink: every failed iteration leaves a durable
// iter/<N>/failure.json (runner-spec artifact) and a state.json entry. The
// file is recorded when known so the summary PR can name what was attempted.
export async function recordFailure(
  runState: MutationImproveRunState,
  iter: number,
  gate: string,
  reason: string,
  file?: string,
): Promise<FailureEntry> {
  const entry: FailureEntry = file === undefined ? { iter, gate, reason } : { iter, gate, reason, file }
  await writeFile(path.join(iterDir(runState.runDir, iter), 'failure.json'), `${JSON.stringify(entry, null, 2)}\n`)
  runState.failed.push(entry)
  return entry
}
