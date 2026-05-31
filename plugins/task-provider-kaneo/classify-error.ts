// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { type AppError, providerError, systemError } from 'papai/plugin-types'

import { KaneoApiError, KaneoValidationError } from './errors.js'

export class KaneoClassifiedError extends Error {
  constructor(
    message: string,
    public readonly appError: AppError,
  ) {
    super(message)
    this.name = 'KaneoClassifiedError'
  }
}

interface ClassificationContext {
  taskId?: string
  projectId?: string
  commentId?: string
  relatedTaskId?: string
  labelName?: string
}

const classifyApiError = (error: KaneoApiError, context?: ClassificationContext): KaneoClassifiedError => {
  const { statusCode, message } = error
  const messageLower = message.toLowerCase()

  if (statusCode === 401 || statusCode === 403) {
    return new KaneoClassifiedError(message, providerError.authFailed())
  }
  if (statusCode === 429) {
    return new KaneoClassifiedError(message, providerError.rateLimited())
  }
  if (statusCode === 404) {
    if (messageLower.includes('label') || messageLower.includes('/label/')) {
      return new KaneoClassifiedError(message, providerError.labelNotFound(context?.labelName ?? 'unknown'))
    }
    if (messageLower.includes('task-relation') || messageLower.includes('/task-relation/')) {
      return new KaneoClassifiedError(
        message,
        providerError.relationNotFound(context?.taskId ?? 'unknown', context?.relatedTaskId ?? 'unknown'),
      )
    }
    if (messageLower.includes('task') || messageLower.includes('/task/')) {
      return new KaneoClassifiedError(message, providerError.taskNotFound(context?.taskId ?? 'unknown'))
    }
    if (messageLower.includes('project') || messageLower.includes('/project/')) {
      return new KaneoClassifiedError(message, providerError.projectNotFound(context?.projectId ?? 'unknown'))
    }
    if (messageLower.includes('comment') || messageLower.includes('/activity/') || messageLower.includes('/comment/')) {
      return new KaneoClassifiedError(message, providerError.commentNotFound(context?.commentId ?? 'unknown'))
    }
    // Unknown resource type — avoid misreporting as task-not-found
    return new KaneoClassifiedError(message, providerError.unknown(error))
  }
  if (statusCode === 400) {
    return new KaneoClassifiedError(message, providerError.validationFailed('unknown', message))
  }
  return new KaneoClassifiedError(message, systemError.unexpected(error))
}

export const classifyKaneoError = (error: unknown, context?: ClassificationContext): KaneoClassifiedError => {
  if (error instanceof KaneoClassifiedError) {
    return error
  }
  if (error instanceof KaneoApiError) {
    return classifyApiError(error, context)
  }
  if (error instanceof KaneoValidationError) {
    return new KaneoClassifiedError(error.message, providerError.invalidResponse())
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (message.includes('authentication') || message.includes('unauthorized')) {
      return new KaneoClassifiedError(error.message, providerError.authFailed())
    }
    if (message.includes('rate limit') || message.includes('429')) {
      return new KaneoClassifiedError(error.message, providerError.rateLimited())
    }
    // Network error detection before final fallback
    if (
      message.includes('fetch') ||
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('connect')
    ) {
      return new KaneoClassifiedError(error.message, systemError.networkError(error.message))
    }
  }

  return new KaneoClassifiedError(
    error instanceof Error ? error.message : String(error),
    systemError.unexpected(error instanceof Error ? error : new Error(String(error))),
  )
}
