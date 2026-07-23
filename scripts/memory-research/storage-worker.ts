// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { StorageJobInputSchema, StorageJobResultSchema } from './storage-contracts.js'
import { executeFrozen100kStorageJob } from './storage-runner.js'

const main = async (): Promise<void> => {
  const input = StorageJobInputSchema.parse(JSON.parse(await Bun.stdin.text()))
  const output = StorageJobResultSchema.parse(await executeFrozen100kStorageJob(input))
  process.stdout.write(`${JSON.stringify(output)}\n`)
}

await main()
