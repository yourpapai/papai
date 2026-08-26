// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Global test setup - suppress console output during tests
// This prevents noisy console.log and pino logger output from cluttering test results

// Set log level to silent before any modules load
process.env['LOG_LEVEL'] = 'silent'

// Store original console methods
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  debug: console.debug,
}

// Suppress console methods during tests
console.log = (): void => {}
console.info = (): void => {}
console.warn = (): void => {}
console.debug = (): void => {}

// Keep console.error visible for debugging test failures
// console.error is intentionally NOT suppressed

// Export original methods for tests that need to capture output
export { originalConsole }

// Register the Svelte loader plugin when the paired mutation runner asks for it.
//
// The Stryker bun runner's coverage preload eagerly imports every mutate target
// and is passed as a --preload ahead of the ones the paired config supplies in
// bunArgs. For a client target that (transitively) imports a `.svelte.ts`
// module, `tests/client-setup.ts` therefore registers the loader too late: the
// untransformed module throws `$state is not defined`, Bun caches that failed
// module, and the test file that imports it cannot load at all — Stryker then
// aborts the file with "No tests were executed".
//
// bunfig's `preload` runs before any CLI `--preload`, so this file is the only
// hook early enough. It stays inert for every other run: server-side suites
// never set the flag, so neither `bun` nor `svelte/compiler` is imported.
if (process.env['PAPAI_SVELTE_TEST_PLUGIN'] === '1') {
  const { plugin } = await import('bun')
  const { sveltePlugin } = await import('./utils/svelte-plugin.js')
  void plugin(sveltePlugin())
}
