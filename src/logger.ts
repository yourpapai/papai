// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pino from 'pino'

import { logBufferStream } from './debug/log-buffer.js'

export const getLogLevel = (): string => {
  const envLevel = process.env['LOG_LEVEL']?.toLowerCase()
  const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']
  if (envLevel !== undefined && envLevel !== '' && validLevels.includes(envLevel)) {
    return envLevel
  }
  return 'info'
}

const logLevel = getLogLevel()

/** @public -- the log buffer stream is attached here at module load */
export const logMultistream = pino.multistream([
  { level: logLevel, stream: process.stdout },
  { level: logLevel, stream: logBufferStream },
])

export const logger = pino(
  {
    level: logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: undefined,
  },
  logMultistream,
)
