// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isAppError } from '../errors.js'

/**
 * Controlled error class for tool-boundary logs: the closed AppError code when
 * available, otherwise the exception constructor name. Never the message —
 * provider payloads and user content must not persist through log metadata.
 */
export const toolErrorClass = (error: unknown): string => {
  if (isAppError(error)) return error.code
  if (error instanceof Error) return error.constructor.name
  return 'non_error'
}

/** Bounded failure metadata for tool execution logs: tool enum plus controlled error class only. */
export const toolFailureMeta = (tool: string, error: unknown): Readonly<{ tool: string; errorClass: string }> => ({
  tool,
  errorClass: toolErrorClass(error),
})
