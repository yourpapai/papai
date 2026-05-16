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
