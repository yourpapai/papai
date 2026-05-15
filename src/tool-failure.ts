// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { JSONValue } from 'ai'

import {
  extractAppError,
  getAgentGuidance,
  getAppErrorDetails,
  getUserMessage,
  isRetryableAppError,
  type AppError,
} from './errors.js'

export type ToolFailureType = AppError['type'] | 'tool-execution'
export type ToolFailureCode = AppError['code'] | 'interrupted' | 'unknown'

export interface ToolFailureResult {
  [key: string]: JSONValue | undefined
  success: false
  error: string
  toolName: string
  toolCallId: string
  timestamp: string
  errorType: ToolFailureType
  errorCode: ToolFailureCode
  userMessage: string
  agentMessage: string
  retryable: boolean
  recovered?: boolean
  details?: Record<string, JSONValue | undefined>
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

export function isToolFailureResult(value: unknown): value is ToolFailureResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    value.success === false &&
    'error' in value &&
    typeof value.error === 'string' &&
    'toolName' in value &&
    typeof value.toolName === 'string' &&
    'toolCallId' in value &&
    typeof value.toolCallId === 'string' &&
    'timestamp' in value &&
    typeof value.timestamp === 'string' &&
    'errorType' in value &&
    typeof value.errorType === 'string' &&
    'errorCode' in value &&
    typeof value.errorCode === 'string' &&
    'userMessage' in value &&
    typeof value.userMessage === 'string' &&
    'agentMessage' in value &&
    typeof value.agentMessage === 'string' &&
    'retryable' in value &&
    typeof value.retryable === 'boolean'
  )
}

export function buildToolFailureResult(error: unknown, toolName: string, toolCallId: string): ToolFailureResult {
  const errorMessage = getErrorMessage(error)
  const appError = extractAppError(error)

  if (appError !== null) {
    return {
      success: false,
      error: errorMessage,
      toolName,
      toolCallId,
      timestamp: new Date().toISOString(),
      errorType: appError.type,
      errorCode: appError.code,
      userMessage: getUserMessage(appError),
      agentMessage: getAgentGuidance(appError),
      retryable: isRetryableAppError(appError),
      details: getAppErrorDetails(appError),
    }
  }

  return {
    success: false,
    error: errorMessage,
    toolName,
    toolCallId,
    timestamp: new Date().toISOString(),
    errorType: 'tool-execution',
    errorCode: 'unknown',
    userMessage: `That action failed: ${errorMessage}.`,
    agentMessage: `The tool failed without a classified AppError. Raw error: ${errorMessage}. Inspect the debug trace or logs before retrying.`,
    retryable: false,
  }
}

export function createInterruptedToolFailureResult(toolName: string, toolCallId: string): ToolFailureResult {
  return {
    success: false,
    error: 'Tool execution incomplete or interrupted',
    toolName,
    toolCallId,
    timestamp: new Date().toISOString(),
    errorType: 'tool-execution',
    errorCode: 'interrupted',
    userMessage: `That action did not finish cleanly.`,
    agentMessage: `The tool call was interrupted before a result was recorded. Re-check side effects before retrying.`,
    retryable: true,
    recovered: true,
  }
}
