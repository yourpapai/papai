// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  parseStorageResearchArgs,
  publishFrozenStorageOutput,
  releaseFrozenStorageOutputReservation,
  reserveFrozenStorageOutput,
} from './storage-cli.js'
import { runFrozenStorageReport } from './storage-report-runner.js'
import type { FrozenStorageReport } from './storage-report.js'

export type StorageResearchCliDependencies = Readonly<{
  runReport?: typeof runFrozenStorageReport
  writeStdout?: (value: string) => void
}>

export const runStorageResearchCli = async (
  args: readonly string[],
  dependencies: StorageResearchCliDependencies = {},
): Promise<void> => {
  const options = parseStorageResearchArgs(args)
  const reservation = await reserveFrozenStorageOutput(options.output)
  try {
    const execute = dependencies.runReport ?? runFrozenStorageReport
    const report: FrozenStorageReport = await execute({
      workspaceRoot: process.cwd(),
      seed: options.seed,
      queryTimeoutMs: options.queryTimeoutMs,
      workerDeadlineMs: options.workerDeadlineMs,
    })
    const output = await publishFrozenStorageOutput(report, reservation)
    const writeStdout =
      dependencies.writeStdout ??
      ((value: string): void => {
        process.stdout.write(value)
      })
    writeStdout(`${output}\n`)
  } finally {
    await releaseFrozenStorageOutputReservation(reservation)
  }
}

if (import.meta.main) await runStorageResearchCli(process.argv.slice(2))
