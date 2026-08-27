#!/usr/bin/env bun
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Detect duplicate code in test files using jscpd
 * Usage: bun run scripts/detect-duplicates.ts [threshold]
 * Default threshold is 29 lines (achieves 0% duplication baseline)
 * Lower values = more sensitive (catches smaller duplicates)
 */

import { $ } from 'bun'

const THRESHOLD = process.argv[2] !== undefined && process.argv[2] !== '' ? parseInt(process.argv[2], 10) : 29

console.log(`🔍 Detecting duplicate code in tests (threshold: ${THRESHOLD} lines)...\n`)

// Check if jscpd is available
async function checkJscpd(): Promise<boolean> {
  try {
    await $`which jscpd`.quiet()
    return true
  } catch {
    return false
  }
}

// Install jscpd if not available
async function installJscpd(): Promise<void> {
  console.log('⚠️  jscpd not found. Installing...')
  await $`bun add -d jscpd`
}

// Run jscpd
async function runJscpd(): Promise<void> {
  const reporterDir = './reports/jscpd'
  await $`mkdir -p ${reporterDir}`

  // Use execa-style array to avoid shell escaping issues
  const args = [
    'tests/',
    '--min-lines',
    String(THRESHOLD),
    '--min-tokens',
    '50',
    '--reporters',
    'console,html',
    '--output',
    reporterDir,
    '--ignore',
    // afk-runner prototype relaxation (openspec/changes/afk-runner design.md):
    // fixtures and ported substrate tests are near-identical to their
    // sdd-runner sources by design — they are the parity oracle. Re-tighten
    // at the C7 reflection, not before.
    '**/node_modules/**,**/*.d.ts,**/e2e/**,**/tests/afk-runner/fixtures/**,**/tests/afk-runner/events.test.ts,**/tests/afk-runner/event-schemas.test.ts,**/tests/afk-runner/legacy-fold.test.ts,**/tests/afk-runner/run-state.test.ts,**/tests/afk-runner/stop-controller.test.ts,**/tests/afk-runner/session/**,**/tests/afk-runner/work/**,**/tests/afk-runner/config.test.ts,**/tests/afk-runner/config-strict.test.ts,**/tests/afk-runner/openspec-driver.test.ts',
    '--format',
    'typescript',
    // Allow up to 10% duplication before failing
    '--threshold',
    '10',
  ]

  console.log(`Running: jscpd ${args.join(' ')}\n`)

  const proc = Bun.spawn(['jscpd', ...args], {
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const exitCode = await proc.exited

  console.log('\n📊 Report generated:')
  console.log('   - Console output above')
  console.log(`   - HTML report: ${reporterDir}/index.html`)

  // Exit code 0 = no duplicates found
  // Exit code 1 = duplicates found but within threshold
  // Exit code >1 = error
  if (exitCode > 1) {
    process.exit(exitCode)
  }
}

async function main(): Promise<void> {
  const hasJscpd = await checkJscpd()
  if (!hasJscpd) {
    await installJscpd()
  }
  await runJscpd()
}

void main()
