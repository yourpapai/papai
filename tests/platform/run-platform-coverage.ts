// tests/platform/run-platform-coverage.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { assertCoveredSourceFiles } from '../../scripts/coverage/lane-file-coverage.js'
import { PLATFORM_COVERAGE_FILES } from './scenarios/catalog.js'

const [lcovPath] = Bun.argv.slice(2)
if (lcovPath === undefined) {
  throw new Error('Usage: bun tests/platform/run-platform-coverage.ts <lcov-path>')
}
assertCoveredSourceFiles(await Bun.file(lcovPath).text(), PLATFORM_COVERAGE_FILES)
console.log(`Checked ${PLATFORM_COVERAGE_FILES.length} required source files`)
