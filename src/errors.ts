// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

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
  configMissing: (variable: string): AppError => ({ type: 'system', code: 'config-missing', variable }),
  networkError: (message: string): AppError => ({ type: 'system', code: 'network-error', message }),
  unexpected: (originalError: Error): AppError => ({ type: 'system', code: 'unexpected', originalError }),
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

const getLlmMessage = (error: LlmError): string => {
  switch (error.code) {
    case 'api-error':
      return `AI service error: ${error.message}. Please try again.`
    case 'rate-limited':
      return `AI service rate limit reached. Please wait a moment and try again.`
    case 'timeout':
      return `AI service request timed out. Please try again.`
    case 'token-limit':
      return `Message is too long. Please shorten your request and try again.`
    default:
      return `An AI service error occurred. Please try again later.`
  }
}

const getValidationMessage = (error: ValidationError): string => {
  switch (error.code) {
    case 'invalid-input':
      return `Invalid ${error.field}: ${error.reason}`
    case 'missing-required':
      return `Missing required field: ${error.field}`
    default:
      return `Invalid input provided.`
  }
}

const getSystemMessage = (error: SystemError): string => {
  switch (error.code) {
    case 'config-missing':
      return `Configuration error: ${error.variable} is not set. Please use /setup to configure.`
    case 'network-error':
      return `Network error: ${error.message}. Please check your connection and try again.`
    case 'unexpected':
      return `An unexpected error occurred. Please try again later.`
    default:
      return `An unexpected error occurred. Please try again later.`
  }
}

const getWebFetchMessage = (error: WebFetchError): string => {
  switch (error.code) {
    case 'invalid-url':
      return `That URL doesn't look valid.`
    case 'blocked-host':
      return `I can't fetch that address because it isn't on the public web.`
    case 'blocked-content-type':
      return `That content type isn't supported.`
    case 'too-large':
      return `That page is too large for me to read safely.`
    case 'timeout':
      return `Fetching that page took too long.`
    case 'rate-limited':
      return `You're fetching URLs too quickly. Please try again in a moment.`
    case 'extract-failed':
      return `I couldn't extract readable content from that page.`
    case 'upstream-error':
      return `The site returned an error.`
    default:
      return `I couldn't fetch that page.`
  }
}

export { getAgentGuidance, getAppErrorDetails, isRetryableAppError } from './error-analysis.js'

export const getUserMessage = (error: AppError): string => {
  switch (error.type) {
    case 'provider':
      return getProviderMessage(error)
    case 'llm':
      return getLlmMessage(error)
    case 'validation':
      return getValidationMessage(error)
    case 'system':
      return getSystemMessage(error)
    case 'web-fetch':
      return getWebFetchMessage(error)
    default:
      return `An unexpected error occurred. Please try again later.`
  }
}
