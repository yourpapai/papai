// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { JSONValue } from 'ai'

import { PROVIDER_SCOPE_MISSING_MESSAGE, ProviderScopeMissingError } from './analytics/provider-request-scope.js'
import {
  extractAppError,
  getAgentGuidance,
  getAppErrorDetails,
  getUserMessage,
  isRetryableAppError,
  type AppError,
} from './errors.js'
import { t, type Locale } from './i18n/index.js'
import { getContextLanguage } from './utils/config-language.js'

export type ToolFailureType = AppError['type'] | 'tool-execution'
export type ToolFailureCode = AppError['code'] | 'interrupted' | 'unknown' | 'expired' | 'provider_scope_missing'

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

export interface ToolFailureClassifyEvent {
  toolName: string
  toolCallId: string
  errorType: ToolFailureType
  errorCode: ToolFailureCode
  retryable: boolean
  recovered: boolean
}

export type EmitFailureClassifiedFn = (event: ToolFailureClassifyEvent) => void

export interface BuildToolFailureOptions {
  emitFailureClassified?: EmitFailureClassifiedFn
  locale?: Locale
}

/**
 * Resolve the locale for a failure body from the config context; failure
 * mapping must never throw, so an unreadable config store degrades to `en`.
 */
export const resolveContextLocale = (configContextId: string): Locale => {
  try {
    return getContextLanguage(configContextId)
  } catch {
    return 'en'
  }
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

function maybeEmitClassified(emitFn: EmitFailureClassifiedFn | undefined, result: ToolFailureResult): void {
  if (emitFn === undefined) return
  emitFn({
    toolName: result.toolName,
    toolCallId: result.toolCallId,
    errorType: result.errorType,
    errorCode: result.errorCode,
    retryable: result.retryable,
    recovered: result.recovered ?? false,
  })
}

export function createProviderScopeMissingFailureResult(
  toolName: string,
  toolCallId: string,
  locale: Locale = 'en',
): ToolFailureResult {
  return {
    success: false,
    error: PROVIDER_SCOPE_MISSING_MESSAGE,
    toolName,
    toolCallId,
    timestamp: new Date().toISOString(),
    errorType: 'tool-execution',
    errorCode: 'provider_scope_missing',
    userMessage: t('errors.toolFailure.providerScopeMissing', locale),
    agentMessage:
      'The tool call was rejected before any provider I/O because the controlled provider_scope_missing failure was raised. Do not retry the same call; report the trace to the operator.',
    retryable: false,
  }
}

export function buildToolFailureResult(
  error: unknown,
  toolName: string,
  toolCallId: string,
  options?: BuildToolFailureOptions,
): ToolFailureResult {
  const { emitFailureClassified, locale = 'en' } = options ?? {}
  if (error instanceof ProviderScopeMissingError) {
    const result = createProviderScopeMissingFailureResult(toolName, toolCallId, locale)
    maybeEmitClassified(emitFailureClassified, result)
    return result
  }
  const errorMessage = getErrorMessage(error)
  const appError = extractAppError(error)

  if (appError !== null) {
    const result: ToolFailureResult = {
      success: false,
      error: errorMessage,
      toolName,
      toolCallId,
      timestamp: new Date().toISOString(),
      errorType: appError.type,
      errorCode: appError.code,
      userMessage: getUserMessage(appError, locale),
      agentMessage: getAgentGuidance(appError),
      retryable: isRetryableAppError(appError),
      details: getAppErrorDetails(appError),
    }
    maybeEmitClassified(emitFailureClassified, result)
    return result
  }

  const result: ToolFailureResult = {
    success: false,
    error: errorMessage,
    toolName,
    toolCallId,
    timestamp: new Date().toISOString(),
    errorType: 'tool-execution',
    errorCode: 'unknown',
    userMessage: t('errors.toolFailure.actionFailed', locale, { errorMessage }),
    agentMessage: `The tool failed without a classified AppError. Raw error: ${errorMessage}. Inspect the debug trace or logs before retrying.`,
    retryable: false,
  }
  maybeEmitClassified(emitFailureClassified, result)
  return result
}

export function createInterruptedToolFailureResult(
  toolName: string,
  toolCallId: string,
  locale: Locale = 'en',
): ToolFailureResult {
  return {
    success: false,
    error: 'Tool execution incomplete or interrupted',
    toolName,
    toolCallId,
    timestamp: new Date().toISOString(),
    errorType: 'tool-execution',
    errorCode: 'interrupted',
    userMessage: t('errors.toolFailure.interrupted', locale),
    agentMessage: `The tool call was interrupted before a result was recorded. Re-check side effects before retrying.`,
    retryable: true,
    recovered: true,
  }
}
