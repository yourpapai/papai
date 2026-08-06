// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface BuildFailureOutput {
  readonly stdout: string
  readonly stderr: string
}

// bun always writes `error: script ... exited with code 1` to stderr when the
// check command fails, so a `stderr || stdout` reason never surfaces check.sh's
// stdout breakdown naming the failing check. Persist the FULL combined output
// to build-output.log in the iteration dir and return only a tail-bounded
// reason for state.json / failure.json.
const BUILD_REASON_TAIL = 4000

export async function recordBuildFailure(iterPath: string, output: BuildFailureOutput): Promise<string> {
  const combined = [output.stderr, output.stdout].filter((s) => s.length > 0).join('\n')
  await writeFile(path.join(iterPath, 'build-output.log'), combined)
  return combined.slice(-BUILD_REASON_TAIL)
}
