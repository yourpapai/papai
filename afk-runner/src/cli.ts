// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'
import path from 'node:path'

import { pipelineMachine } from './graph/pipeline.js'
import { foldLog } from './kernel/fold.js'

export function runCli(argv: readonly string[]): string {
  const runDir = argv[0]
  if (runDir === undefined || runDir.length === 0) {
    throw new Error('usage: afk-runner <runDir>')
  }
  const logPath = path.join(runDir, 'events.ndjson')
  if (!existsSync(logPath)) {
    throw new Error(`events.ndjson not found: ${logPath}`)
  }
  const { snapshot, accounting } = foldLog(pipelineMachine, logPath)
  const value = typeof snapshot.value === 'string' ? snapshot.value : JSON.stringify(snapshot.value)
  const lines: string[] = [
    `value: ${value}`,
    ...Object.entries(snapshot.context.stages).map(([stage, status]) => `${stage}: ${status}`),
    `events: ${accounting.total} (mapped ${accounting.mapped}, tolerated ${accounting.tolerated})`,
  ]
  const summary = lines.join('\n')
  console.log(summary)
  return summary
}

const argv = process.argv.slice(2)
if (argv.length > 0 && import.meta.main) {
  runCli(argv)
}
