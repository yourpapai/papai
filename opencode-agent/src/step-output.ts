// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { appendFile } from 'node:fs/promises'

import type { Logger } from './logger.js'
import type { RunResult } from './run-result.js'
import { errorMessage } from './types.js'

/**
 * The one thing this pipeline tells the rest of its own workflow.
 *
 * Its own file for the reason `run-report.ts` is: that module is what the run
 * says to a maintainer, this is what it says to the next step of the job, and
 * the two change for different reasons. `index.ts` wires and exits; it does not
 * need to carry the Actions runner's file-command channel as well.
 */

/**
 * The step output name the workflow's fallback failure comment is gated on.
 *
 * Exported so `tests/opencode-agent/workflow.test.ts` can assert the `if:`
 * expression names the same key this writes, rather than the two agreeing by
 * having been typed the same way twice.
 */
export const REPORTED_OUTPUT = 'reported'

/**
 * Tells the workflow that the issue already carries this run's report.
 *
 * The last step of `.github/workflows/agent-pipeline.yml` posts an "Agent job
 * failed" comment under `if: failure()`, which selects every red job — and six
 * pipeline paths exit 1 *after* posting their own report, so every genuine
 * failure drew a second comment claiming the issue state was unchanged when it
 * had just been moved to `FAILED`. Gating that step on this marker leaves it
 * covering the case its wording describes and no other: a job that died before
 * or during the run — install failure, runner timeout, cancelled job, a config
 * error thrown before anything could be posted, a crash — with nothing on the
 * issue at all.
 *
 * The marker survives the process exiting 1 because the runner does not read
 * `$GITHUB_OUTPUT` from the step's exit code: `ActionRunner.RunAsync` calls
 * `fileCommandManager.ProcessFiles` in a `finally` around the handler, so a
 * failing step's file commands are processed exactly like a passing one's.
 * Nothing is written when the run posted nothing, so an absent output reads as
 * the empty string in the `if:` and the fallback fires.
 *
 * Writing is best-effort in both directions. `GITHUB_OUTPUT` is absent on a
 * local `--event-path` run, which is a normal way to use this CLI and not a
 * failure; and a write that does fail must not turn a run that already reported
 * on the issue into a crash that reports nothing — the failure mode this whole
 * marker exists to remove.
 */
export const recordReport = async (result: RunResult, env: NodeJS.ProcessEnv, log: Logger): Promise<void> => {
  const outputPath = env['GITHUB_OUTPUT']
  if (!result.reported || outputPath === undefined || outputPath.length === 0) return

  await appendFile(outputPath, `${REPORTED_OUTPUT}=true\n`, 'utf8').catch((error: unknown) => {
    log.warn({ error: errorMessage(error) }, 'Could not record that the pipeline reported on the issue')
  })
}
