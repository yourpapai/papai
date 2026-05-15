// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Main E2E test entry point
 *
 * This file orchestrates all E2E tests. Setup/teardown is handled globally
 * via bun-test-setup.ts (loaded via --preload flag in package.json).
 * Run with: bun test tests/e2e/e2e.test.ts
 */

import { afterAll, setDefaultTimeout } from 'bun:test'

import { cleanupE2E } from './global-setup.js'

// Increase timeout for E2E tests
setDefaultTimeout(60000)

// Import all test suites.
// Each suite uses the shared Docker containers started by bun-test-setup.ts.
import './column-management.test.js'
import './error-handling.test.js'
import './label-operations.test.js'
import './project-lifecycle.test.js'
import './project-management.test.js'
import './task-comments.test.js'
import './task-list-compatibility.test.js'
import './task-lifecycle.test.js'
import './task-relations.test.js'
import './task-search.test.js'
import './user-workflows.test.js'

// Register final cleanup at file scope so teardown belongs to the entry file
// rather than an otherwise empty wrapper describe.
afterAll(async () => {
  await cleanupE2E()
})
