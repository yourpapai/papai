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

import { initDb } from '../../src/db/index.js'
import { discoverPlugins } from '../../src/plugins/discovery.js'
import { activatePlugins } from '../../src/plugins/loader.js'
import { pluginRegistry, syncRegistryFromDb } from '../../src/plugins/registry.js'
import { getE2EConfig, cleanupE2E } from './global-setup.js'

// Track if we've already set up hooks to avoid duplicates
let hooksRegistered = false

async function approveAndActivateKaneoPlugin(): Promise<void> {
  initDb()
  const { plugins: discoveredPlugins } = discoverPlugins('plugins')
  syncRegistryFromDb(discoveredPlugins)
  const kaneoEntry = pluginRegistry.getEntry('task-provider-kaneo')
  if (kaneoEntry !== undefined) {
    pluginRegistry.approve('task-provider-kaneo', 'e2e-setup', kaneoEntry.discoveredPlugin.manifestHash)
  }
  const toActivate = pluginRegistry.getApprovedCompatiblePlugins()
  await activatePlugins(toActivate)
}

async function globalSetup(): Promise<void> {
  console.log('🚀 Starting global E2E setup...')
  await approveAndActivateKaneoPlugin()
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
