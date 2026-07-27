// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import { PUBLIC_DIR } from './build-client.js'

/**
 * Bundle basenames both debug suites (`tests/debug/server.test.ts`,
 * `tests/debug/debug-smoke.test.ts`) assert on in their `ensurePublicBuilt()`
 * preconditions. Presence of all nine means the debug routes can be served.
 */
export const REQUIRED_BUNDLES: readonly string[] = [
  'debug.js',
  'debug.html',
  'debug.css',
  'admin.js',
  'admin.html',
  'admin.css',
  'settings.js',
  'settings.html',
  'settings.css',
]

/**
 * Pure presence check. Returns the subset of `required` not found in
 * `publicDir`, preserving `required` order. A missing `publicDir` yields the
 * whole `required` list (the common "never built" case), never a throw.
 */
export function missingBundles(publicDir: string, required: readonly string[]): string[] {
  return required.filter((name) => !fs.existsSync(path.join(publicDir, name)))
}

/**
 * Injected collaborators for `ensureClientBuilt`, so the decision logic is
 * unit-testable without running a real (slow) client build.
 */
export type EnsureDeps = {
  publicDir: string
  required: readonly string[]
  missing: (publicDir: string, required: readonly string[]) => string[]
  build: () => void
  log: (message: string) => void
}

/**
 * Ensure the client bundles exist. No-op (returns `'present'`) when all
 * required bundles are already present; otherwise logs the missing set, runs
 * `deps.build()` exactly once, and returns `'built'`.
 */
export function ensureClientBuilt(deps: EnsureDeps): 'present' | 'built' {
  const missing = deps.missing(deps.publicDir, deps.required)
  if (missing.length === 0) {
    deps.log(`Client bundles present in ${deps.publicDir}, skipping build`)
    return 'present'
  }
  deps.log(`Missing client bundles (${missing.join(', ')}); running bun build:client`)
  deps.build()
  return 'built'
}

/**
 * Wire real collaborators and run the guard. `build` spawns `bun build:client`
 * synchronously with inherited stdio; a non-zero exit throws so a broken client
 * build fails the measurement run loudly instead of proceeding to a misleading
 * "3 failing tests" state.
 */
function main(): void {
  ensureClientBuilt({
    publicDir: PUBLIC_DIR,
    required: REQUIRED_BUNDLES,
    missing: missingBundles,
    build: (): void => {
      const proc = Bun.spawnSync(['bun', 'scripts/build-client.ts'], {
        cwd: path.resolve(import.meta.dir, '..'),
        stdio: ['ignore', 'inherit', 'inherit'],
      })
      if (proc.exitCode !== 0) {
        throw new Error(`bun build:client failed with exit code ${proc.exitCode}`)
      }
    },
    log: (message: string): void => {
      console.error(message)
    },
  })
}

if (import.meta.main) {
  main()
}
