// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { ScenarioJobInputSchema, ScenarioJobResultSchema } from './runner-contracts.js'
import { executeScenarioJob } from './runner-job.js'

const main = async (): Promise<void> => {
  const input = ScenarioJobInputSchema.parse(JSON.parse(await Bun.stdin.text()))
  const result = ScenarioJobResultSchema.parse(await executeScenarioJob(input))
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

await main()
