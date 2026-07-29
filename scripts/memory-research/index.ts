// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  parseMemoryResearchArgs,
  publishResearchOutputs,
  releaseResearchOutputReservation,
  reserveResearchOutputs,
} from './cli.js'
import { importPublicDatasetFile } from './importers.js'
import { runResearchExperiment } from './runner.js'

export type MemoryResearchCliDependencies = Readonly<{
  importDataset?: typeof importPublicDatasetFile
  runExperiment?: typeof runResearchExperiment
  writeStdout?: (value: string) => void
}>

export const runMemoryResearchCli = async (
  args: readonly string[],
  dependencies: MemoryResearchCliDependencies = {},
): Promise<void> => {
  const options = parseMemoryResearchArgs(args)
  const reservation = await reserveResearchOutputs(options.output, options.split, options.overwrite)
  try {
    const importDataset = dependencies.importDataset ?? importPublicDatasetFile
    const imported = options.publicDataset === null ? [] : [await importDataset(options.publicDataset)]
    const importFailure = imported.find((result) => !result.ok)
    if (importFailure !== undefined && !importFailure.ok) {
      throw new Error(importFailure.error.message)
    }
    const execute = dependencies.runExperiment ?? runResearchExperiment
    const report = await execute({
      split: options.split,
      candidateIds: options.candidateIds,
      scale: options.scale,
      seed: options.seed,
      workspaceRoot: process.cwd(),
      queryTimeoutMs: 5_000,
      workerDeadlineMs: 120_000,
      publicDatasets: imported.flatMap((result) => (result.ok ? [result.value] : [])),
      publicDatasetLocalPaths:
        options.publicDataset === null ? {} : { [options.publicDataset.datasetId]: options.publicDataset.path },
    })
    const outputs = await publishResearchOutputs(report, reservation)
    const writeStdout =
      dependencies.writeStdout ??
      ((value: string): void => {
        process.stdout.write(value)
      })
    writeStdout(`${outputs.jsonPath}\n${outputs.markdownPath}\n`)
  } finally {
    await releaseResearchOutputReservation(reservation)
  }
}

if (import.meta.main) {
  await runMemoryResearchCli(process.argv.slice(2))
}
