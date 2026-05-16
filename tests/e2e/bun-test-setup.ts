// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Bun test global setup - runs once before all E2E tests
 *
 * This file is loaded via bunfig.toml preload configuration.
 * It sets up the Docker environment and provisions a test user
 * before any test files run.
 */

import { getE2EConfig, cleanupE2E } from './global-setup.js'

// Track if we've already set up hooks to avoid duplicates
let hooksRegistered = false

async function globalSetup(): Promise<void> {
  console.log('🚀 Starting global E2E setup...')
  await getE2EConfig()
  console.log('✅ Global E2E setup complete')
}

async function globalTeardown(): Promise<void> {
  console.log('🧹 Starting global E2E teardown...')
  await cleanupE2E()
  console.log('✅ Global E2E teardown complete')
}

// Register global hooks only once
if (!hooksRegistered) {
  hooksRegistered = true

  // Run setup immediately when this module loads
  await globalSetup()

  // Register cleanup on process exit
  process.on('SIGINT', () => {
    void globalTeardown().then(() => process.exit(0))
  })

  process.on('SIGTERM', () => {
    void globalTeardown().then(() => process.exit(0))
  })
}
