// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pino from 'pino'

export const getLogLevel = (): string => {
  const envLevel = process.env['LOG_LEVEL']?.toLowerCase()
  const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']
  if (envLevel !== undefined && envLevel !== '' && validLevels.includes(envLevel)) {
    return envLevel
  }
  return 'info'
}

const logLevel = getLogLevel()

/** @public -- debug server calls .add() to attach the log buffer stream */
export const logMultistream = pino.multistream([{ level: logLevel, stream: process.stdout }])

export const logger = pino(
  {
    level: logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: undefined,
  },
  logMultistream,
)
