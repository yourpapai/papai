// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AppError } from 'papai/plugin-types'
import { providerError, systemError } from 'papai/plugin-types'

import { GitHubApiError, isRateLimitedError } from './client.js'

export class GitHubClassifiedError extends Error {
  constructor(
    message: string,
    public readonly appError: AppError,
  ) {
    super(message)
    this.name = 'GitHubClassifiedError'
  }
}

interface ClassificationContext {
  taskId?: string
  projectId?: string
}

interface GitHubErrorBody {
  message?: string
}

function isGitHubErrorBody(body: unknown): body is GitHubErrorBody {
  if (body === null || typeof body !== 'object') return false
  const message: unknown = Reflect.get(body, 'message')
  return message === undefined || typeof message === 'string'
}

/** Prefer the upstream message field; fall back to the wrapped error message. */
const extractGitHubErrorMessage = (error: GitHubApiError): string => {
  const body = isGitHubErrorBody(error.body) ? error.body : undefined
  return body?.message ?? error.message
}

const extractValidationMessage = (error: GitHubApiError): string => {
  const body = isGitHubErrorBody(error.body) ? error.body : undefined
  const upstream = body?.message ?? ''
  if (upstream.length > 0) return upstream
  return `GitHub validation failed with status ${error.statusCode}`
}

const classifyApiError = (error: GitHubApiError, context?: ClassificationContext): GitHubClassifiedError => {
  const { statusCode } = error
  const message = extractGitHubErrorMessage(error)

  // Header precedence: GitHub overloads 403 for both authorization failure and
  // rate limiting, so the rate-limit shape wins over the plain auth mapping.
  if (isRateLimitedError(error)) {
    return new GitHubClassifiedError(message, providerError.rateLimited())
  }

  if (statusCode === 401 || statusCode === 403) {
    return new GitHubClassifiedError(message, providerError.authFailed())
  }

  if (statusCode === 404) {
    // One instance = one repository: the context says which resource was sought.
    if (context?.taskId !== undefined) {
      return new GitHubClassifiedError(message, providerError.taskNotFound(context.taskId))
    }
    return new GitHubClassifiedError(message, providerError.projectNotFound(context?.projectId ?? 'unknown'))
  }

  if (statusCode === 400 || statusCode === 422) {
    return new GitHubClassifiedError(
      message,
      providerError.validationFailed('unknown', extractValidationMessage(error)),
    )
  }

  return new GitHubClassifiedError(message, systemError.unexpected(error))
}

const classifyGenericError = (error: Error): GitHubClassifiedError => {
  const msg = error.message.toLowerCase()

  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('fetch failed')) {
    return new GitHubClassifiedError(error.message, systemError.networkError(error.message))
  }
  if (msg.includes('network') || msg.includes('connect')) {
    return new GitHubClassifiedError(error.message, systemError.networkError(error.message))
  }

  return new GitHubClassifiedError(error.message, systemError.unexpected(error))
}

/** Classify a GitHub error into a GitHubClassifiedError carrying a standardised AppError. */
export const classifyGitHubError = (error: unknown, context?: ClassificationContext): GitHubClassifiedError => {
  if (error instanceof GitHubClassifiedError) {
    return error
  }

  if (error instanceof GitHubApiError) {
    return classifyApiError(error, context)
  }

  if (error instanceof Error) {
    return classifyGenericError(error)
  }

  return new GitHubClassifiedError(String(error), systemError.unexpected(new Error(String(error))))
}
