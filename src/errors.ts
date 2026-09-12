// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { t, type Locale } from './i18n/index.js'
import { ProviderClassifiedError, type ProviderError, getProviderMessage, providerError } from './providers/errors.js'

// Re-export ProviderError and its constructors for backward compatibility
export type { ProviderError }
export { providerError }

export type LlmError =
  | { type: 'llm'; code: 'api-error'; message: string }
  | { type: 'llm'; code: 'rate-limited' }
  | { type: 'llm'; code: 'timeout' }
  | { type: 'llm'; code: 'token-limit' }

export type ValidationError =
  | { type: 'validation'; code: 'invalid-input'; field: string; reason: string }
  | { type: 'validation'; code: 'missing-required'; field: string }

export type SystemError =
  | { type: 'system'; code: 'config-missing'; variable: string }
  | { type: 'system'; code: 'network-error'; message: string }
  | { type: 'system'; code: 'unexpected'; originalError: Error }

export type WebFetchError =
  | { type: 'web-fetch'; code: 'invalid-url' }
  | { type: 'web-fetch'; code: 'blocked-host' }
  | { type: 'web-fetch'; code: 'blocked-content-type' }
  | { type: 'web-fetch'; code: 'too-large' }
  | { type: 'web-fetch'; code: 'timeout' }
  | { type: 'web-fetch'; code: 'rate-limited' }
  | { type: 'web-fetch'; code: 'extract-failed' }
  | { type: 'web-fetch'; code: 'upstream-error'; status?: number }

export type AppError = ProviderError | LlmError | ValidationError | SystemError | WebFetchError

export const systemError = {
  configMissing: (variable: string): AppError => ({
    type: 'system',
    code: 'config-missing',
    variable,
  }),
  networkError: (message: string): AppError => ({ type: 'system', code: 'network-error', message }),
  unexpected: (originalError: Error): AppError => ({
    type: 'system',
    code: 'unexpected',
    originalError,
  }),
}

export const webFetchError = {
  invalidUrl: (): WebFetchError => ({ type: 'web-fetch', code: 'invalid-url' }),
  blockedHost: (): WebFetchError => ({ type: 'web-fetch', code: 'blocked-host' }),
  blockedContentType: (): WebFetchError => ({ type: 'web-fetch', code: 'blocked-content-type' }),
  tooLarge: (): WebFetchError => ({ type: 'web-fetch', code: 'too-large' }),
  timeout: (): WebFetchError => ({ type: 'web-fetch', code: 'timeout' }),
  rateLimited: (): WebFetchError => ({ type: 'web-fetch', code: 'rate-limited' }),
  extractFailed: (): WebFetchError => ({ type: 'web-fetch', code: 'extract-failed' }),
  upstreamError: (status?: number): WebFetchError =>
    status === undefined
      ? { type: 'web-fetch', code: 'upstream-error' }
      : { type: 'web-fetch', code: 'upstream-error', status },
}

const appErrorTypeSchema = z.object({
  type: z.enum(['provider', 'llm', 'validation', 'system', 'web-fetch']),
})

// Type guard to check if error is an AppError
export const isAppError = (error: unknown): error is AppError => appErrorTypeSchema.safeParse(error).success

export const extractAppError = (error: unknown): AppError | null => {
  if (isAppError(error)) return error
  if (error instanceof ProviderClassifiedError) return error.error
  if (typeof error !== 'object' || error === null) return null
  if ('appError' in error && isAppError(error.appError)) return error.appError
  if ('error' in error && isAppError(error.error)) return error.error
  return null
}

const getLlmMessage = (error: LlmError, locale: Locale): string => {
  switch (error.code) {
    case 'api-error':
      return t('errors.llm.apiError', locale, { message: error.message })
    case 'rate-limited':
      return t('errors.llm.rateLimited', locale)
    case 'timeout':
      return t('errors.llm.timeout', locale)
    case 'token-limit':
      return t('errors.llm.tokenLimit', locale)
    default:
      return t('errors.llm.fallback', locale)
  }
}

const getValidationMessage = (error: ValidationError, locale: Locale): string => {
  switch (error.code) {
    case 'invalid-input':
      return t('errors.validation.invalidInput', locale, { field: error.field, reason: error.reason })
    case 'missing-required':
      return t('errors.validation.missingRequired', locale, { field: error.field })
    default:
      return t('errors.validation.fallback', locale)
  }
}

const getSystemMessage = (error: SystemError, locale: Locale): string => {
  switch (error.code) {
    case 'config-missing':
      return t('errors.system.configMissing', locale, { variable: error.variable })
    case 'network-error':
      return t('errors.system.networkError', locale, { message: error.message })
    // Stryker disable next-line StringLiteral,ConditionalExpression: explicit 'unexpected' duplicates default but keeps switch exhaustive - equivalent mutants
    case 'unexpected':
      return t('errors.system.unexpected', locale)
    default:
      return t('errors.system.unexpected', locale)
  }
}

const getWebFetchMessage = (error: WebFetchError, locale: Locale): string => {
  switch (error.code) {
    case 'invalid-url':
      return t('errors.webFetch.invalidUrl', locale)
    case 'blocked-host':
      return t('errors.webFetch.blockedHost', locale)
    case 'blocked-content-type':
      return t('errors.webFetch.blockedContentType', locale)
    case 'too-large':
      return t('errors.webFetch.tooLarge', locale)
    case 'timeout':
      return t('errors.webFetch.timeout', locale)
    case 'rate-limited':
      return t('errors.webFetch.rateLimited', locale)
    case 'extract-failed':
      return t('errors.webFetch.extractFailed', locale)
    case 'upstream-error':
      return t('errors.webFetch.upstreamError', locale)
    default:
      return t('errors.webFetch.fallback', locale)
  }
}

export { getAgentGuidance, getAppErrorDetails, isRetryableAppError } from './error-analysis.js'

export const getUserMessage = (error: AppError, locale: Locale = 'en'): string => {
  switch (error.type) {
    case 'provider':
      return getProviderMessage(error, locale)
    case 'llm':
      return getLlmMessage(error, locale)
    case 'validation':
      return getValidationMessage(error, locale)
    case 'system':
      return getSystemMessage(error, locale)
    case 'web-fetch':
      return getWebFetchMessage(error, locale)
    default:
      return t('errors.system.unexpected', locale)
  }
}
