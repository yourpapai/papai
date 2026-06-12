// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const decodeCapturedOutput = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (value instanceof Uint8Array) return new TextDecoder().decode(value).trim()
  return ''
}

const formatCapturedOutput = (label: string, value: unknown): string => {
  const output = decodeCapturedOutput(value)
  return output === '' ? '' : `${label}:\n${output}`
}

export const formatProcessFailure = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  if (!isRecord(error)) return message
  const captured = [formatCapturedOutput('stdout', error['stdout']), formatCapturedOutput('stderr', error['stderr'])]
    .filter(Boolean)
    .join('\n')
  return captured === '' ? message : `${message}\n${captured}`
}

export const appendProcessFailure = (message: string, prefix: string, error: unknown): string =>
  `${message}\n${prefix}:\n${formatProcessFailure(error)}`
