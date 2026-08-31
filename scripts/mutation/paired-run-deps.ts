// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { findTestFile } from '../../.hooks/tdd/test-resolver.mjs'
import { readJsonRecord, readStrykerReport } from './json-readers.js'
import type { PairedRunDeps, PairedRunStrykerOptions } from './paired-run.js'
import { resolveNodeModulesBin } from './stryker-bin.js'
import { loadOverrides as loadOverridesFile } from './test-overrides.js'

/**
 * Production wiring for `pairedRun`, kept apart from the run algorithm itself: everything here
 * touches the filesystem or spawns Stryker, and everything in `paired-run.ts` is the batch logic
 * that consumes it through the `PairedRunDeps` seam.
 */

const STRYKER_TIMEOUT_MS = 30 * 60 * 1000

export const defaultRunStryker = (configPath: string, projectRoot: string, options: PairedRunStrykerOptions): void => {
  execFileSync(resolveNodeModulesBin(projectRoot, 'stryker'), ['run', configPath], {
    cwd: projectRoot,
    stdio: options.verbose ? 'inherit' : 'pipe',
    timeout: STRYKER_TIMEOUT_MS,
    maxBuffer: 20 * 1024 * 1024,
  })
}

/**
 * Exported so a caller that needs to override exactly one dep can spread the rest rather than
 * rebuild them. The shard runner does this to inject a `buildMap` served from the plan's
 * published coverage map while keeping the real Stryker wiring.
 */
export const defaultPairedRunDeps: PairedRunDeps = {
  readBaseConfig: (projectRoot) => {
    const configPath = path.join(projectRoot, 'stryker.config.json')
    return readJsonRecord(configPath)
  },
  resolveCompanion: (srcFile, projectRoot) => findTestFile(path.join(projectRoot, srcFile), projectRoot),
  loadOverrides: (projectRoot) => loadOverridesFile(path.join(projectRoot, 'scripts/mutation/overrides.json')),
  runStryker: defaultRunStryker,
  readReport: readStrykerReport,
  log: (message) => {
    console.log(message)
  },
}
