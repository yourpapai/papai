// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Logger mock utilities for tests
 *
 * IMPORTANT: This file must NOT import from any src/ files to avoid
 * loading the real logger before mocks are set up.
 */

import { mock, type Mock } from 'bun:test'

export interface LogCall {
  level: 'debug' | 'info' | 'warn' | 'error'
  args: unknown[]
}

export interface TrackedLoggerMock {
  /** The logger mock object to pass to mock.module() */
  logger: {
    debug: Mock<(...args: unknown[]) => void>
    info: Mock<(...args: unknown[]) => void>
    warn: Mock<(...args: unknown[]) => void>
    error: Mock<(...args: unknown[]) => void>
    child: Mock<() => { debug: () => void; info: () => void; warn: () => void; error: () => void }>
  }
  /** Mock getLogLevel function that returns 'info' by default */
  getLogLevel: Mock<() => string>
  /** Get all logged calls across all levels */
  getCalls: () => LogCall[]
  /** Get calls for a specific level */
  getCallsByLevel: (level: LogCall['level']) => LogCall[]
  /** Clear all tracked calls */
  clearCalls: () => void
}

/**
 * Create a complete logger mock with all methods.
 * Use with: void mock.module('../../src/logger.js', () => ({ logger: createLoggerMock() }))
 */
export function createLoggerMock(): {
  debug: Mock<() => void>
  info: Mock<() => void>
  warn: Mock<() => void>
  error: Mock<() => void>
  child: Mock<() => { debug: () => void; info: () => void; warn: () => void; error: () => void }>
} {
  const childLogger = {
    debug: mock((): void => {}),
    info: mock((): void => {}),
    warn: mock((): void => {}),
    error: mock((): void => {}),
  }
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock((): { debug: () => void; info: () => void; warn: () => void; error: () => void } => childLogger),
  }
}

/**
 * Setup logger mock for tests.
 * Call in describe-level beforeEach (NOT at top level) to avoid mock pollution.
 *
 * @example
 * describe('Feature', () => {
 *   beforeEach(() => {
 *     mockLogger()
 *   })
 * })
 */
export function mockLogger(): void {
  void mock.module('../../src/logger.js', () => ({
    getLogLevel: (): string => 'info',
    logger: createLoggerMock(),
  }))
}

/**
 * Create a tracked logger mock that records all log calls for assertions.
 *
 * Usage:
 * ```typescript
 * const { logger, getLogLevel, getCalls, getCallsByLevel, clearCalls } = createTrackedLoggerMock()
 * void mock.module('../../src/logger.js', () => ({ logger, getLogLevel }))
 *
 * // ... run test code ...
 *
 * // Assert on log calls via helper
 * const infoCalls = getCallsByLevel('info')
 * expect(infoCalls.some(call => call.args[1] === 'Expected message')).toBe(true)
 *
 * // Or check via Bun's mock API
 * expect(logger.info).toHaveBeenCalledWith({ userId }, 'Expected message')
 * ```
 */
export function createTrackedLoggerMock(): TrackedLoggerMock {
  const calls: LogCall[] = []

  const createLevelMock = (level: LogCall['level']): Mock<(...args: unknown[]) => void> =>
    mock((...args: unknown[]): void => {
      calls.push({ level, args })
    })

  const debugMock = createLevelMock('debug')
  const infoMock = createLevelMock('info')
  const warnMock = createLevelMock('warn')
  const errorMock = createLevelMock('error')

  // Child loggers also track to the same calls array using mocks
  const childDebugMock = createLevelMock('debug')
  const childInfoMock = createLevelMock('info')
  const childWarnMock = createLevelMock('warn')
  const childErrorMock = createLevelMock('error')

  const childMock = mock((): { debug: () => void; info: () => void; warn: () => void; error: () => void } => ({
    debug: childDebugMock,
    info: childInfoMock,
    warn: childWarnMock,
    error: childErrorMock,
  }))

  const getLogLevelMock = mock((): string => 'info')

  return {
    logger: {
      debug: debugMock,
      info: infoMock,
      warn: warnMock,
      error: errorMock,
      child: childMock,
    },
    getLogLevel: getLogLevelMock,
    getCalls: (): LogCall[] => [...calls],
    getCallsByLevel: (level: LogCall['level']): LogCall[] => calls.filter((call) => call.level === level),
    clearCalls: (): void => {
      calls.length = 0
    },
  }
}
