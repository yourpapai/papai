// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parsePublishArgs, publishResearchResults } from './publish-cli.js'

export const runMemoryResearchPublishCli = async (args: readonly string[]): Promise<void> => {
  const outputs = await publishResearchResults(parsePublishArgs(args))
  process.stdout.write(`${outputs.analysisPath}\n${outputs.resultsPath}\n${outputs.markdownPath}\n`)
}

if (import.meta.main) await runMemoryResearchPublishCli(process.argv.slice(2))
