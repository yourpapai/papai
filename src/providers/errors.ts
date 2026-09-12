// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { t, type Locale } from '../i18n/index.js'

/**
 * Provider-agnostic error type that will replace KaneoError in the AppError union.
 *
 * Each provider maps its native errors to these codes via its classifyError() method.
 * The codes mirror the current KaneoError codes but are provider-neutral.
 */
export type CustomFieldRequirement = {
  name: string
  description?: string
}

export type ProviderError =
  | { type: 'provider'; code: 'task-not-found'; taskId: string }
  | { type: 'provider'; code: 'project-not-found'; projectId: string }
  | { type: 'provider'; code: 'workspace-not-found'; workspaceId: string }
  | { type: 'provider'; code: 'comment-not-found'; commentId: string }
  | { type: 'provider'; code: 'label-not-found'; labelName: string }
  | { type: 'provider'; code: 'relation-not-found'; taskId: string; relatedTaskId: string }
  | { type: 'provider'; code: 'not-found'; resourceType: string; resourceId: string }
  | { type: 'provider'; code: 'access-denied'; resource: string }
  | { type: 'provider'; code: 'auth-failed' }
  | { type: 'provider'; code: 'rate-limited' }
  | { type: 'provider'; code: 'validation-failed'; field: string; reason: string }
  | {
      type: 'provider'
      code: 'workflow-validation-failed'
      projectId: string
      message: string
      requiredFields: CustomFieldRequirement[]
    }
  | { type: 'provider'; code: 'unsupported-operation'; operation: string }
  | { type: 'provider'; code: 'status-not-found'; statusName: string; available: string[] }
  | { type: 'provider'; code: 'link-type-not-found'; linkTypeName: string; available: string[] }
  | { type: 'provider'; code: 'invalid-response' }
  | { type: 'provider'; code: 'unknown'; originalError: Error }

/** Error constructors for ProviderError. */
export const providerError = {
  taskNotFound: (taskId: string): ProviderError => ({
    type: 'provider',
    code: 'task-not-found',
    taskId,
  }),
  projectNotFound: (projectId: string): ProviderError => ({
    type: 'provider',
    code: 'project-not-found',
    projectId,
  }),
  workspaceNotFound: (workspaceId: string): ProviderError => ({
    type: 'provider',
    code: 'workspace-not-found',
    workspaceId,
  }),
  commentNotFound: (commentId: string): ProviderError => ({
    type: 'provider',
    code: 'comment-not-found',
    commentId,
  }),
  labelNotFound: (labelName: string): ProviderError => ({
    type: 'provider',
    code: 'label-not-found',
    labelName,
  }),
  relationNotFound: (taskId: string, relatedTaskId: string): ProviderError => ({
    type: 'provider',
    code: 'relation-not-found',
    taskId,
    relatedTaskId,
  }),
  notFound: (resourceType: string, resourceId: string): ProviderError => ({
    type: 'provider',
    code: 'not-found',
    resourceType,
    resourceId,
  }),
  accessDenied: (resource: string): ProviderError => ({
    type: 'provider',
    code: 'access-denied',
    resource,
  }),
  authFailed: (): ProviderError => ({ type: 'provider', code: 'auth-failed' }),
  rateLimited: (): ProviderError => ({ type: 'provider', code: 'rate-limited' }),
  validationFailed: (field: string, reason: string): ProviderError => ({
    type: 'provider',
    code: 'validation-failed',
    field,
    reason,
  }),
  workflowValidationFailed: (
    projectId: string,
    message: string,
    requiredFields: CustomFieldRequirement[],
  ): ProviderError => ({
    type: 'provider',
    code: 'workflow-validation-failed',
    projectId,
    message,
    requiredFields,
  }),
  unsupportedOperation: (operation: string): ProviderError => ({
    type: 'provider',
    code: 'unsupported-operation',
    operation,
  }),
  statusNotFound: (statusName: string, available: string[]): ProviderError => ({
    type: 'provider',
    code: 'status-not-found',
    statusName,
    available,
  }),
  linkTypeNotFound: (linkTypeName: string, available: string[]): ProviderError => ({
    type: 'provider',
    code: 'link-type-not-found',
    linkTypeName,
    available,
  }),
  invalidResponse: (): ProviderError => ({ type: 'provider', code: 'invalid-response' }),
  unknown: (originalError: Error): ProviderError => ({
    type: 'provider',
    code: 'unknown',
    originalError,
  }),
}

const getWorkflowValidationMessage = (
  error: Extract<ProviderError, { code: 'workflow-validation-failed' }>,
  locale: Locale,
): string => {
  const fields = error.requiredFields.map((f) => `"${f.name}"`).join(', ')
  const prefix =
    error.projectId === 'unknown'
      ? t('errors.provider.workflowPrefixUnknown', locale)
      : t('errors.provider.workflowPrefixKnown', locale, { projectId: error.projectId })
  if (fields === '') {
    return t('errors.provider.workflowValidationNoFields', locale, { prefix, message: error.message })
  }
  return t('errors.provider.workflowValidationWithFields', locale, { prefix, message: error.message, fields })
}

/** User-facing message mapper for ProviderError. */
export const getProviderMessage = (error: ProviderError, locale: Locale = 'en'): string => {
  switch (error.code) {
    case 'task-not-found':
      return t('errors.provider.taskNotFound', locale, { taskId: error.taskId })
    case 'project-not-found':
      return t('errors.provider.projectNotFound', locale, { projectId: error.projectId })
    case 'workspace-not-found':
      return t('errors.provider.workspaceNotFound', locale)
    case 'comment-not-found':
      return t('errors.provider.commentNotFound', locale, { commentId: error.commentId })
    case 'label-not-found':
      return t('errors.provider.labelNotFound', locale, { labelName: error.labelName })
    case 'relation-not-found':
      return t('errors.provider.relationNotFound', locale, {
        taskId: error.taskId,
        relatedTaskId: error.relatedTaskId,
      })
    case 'not-found':
      return t('errors.provider.notFound', locale, { resourceType: error.resourceType, resourceId: error.resourceId })
    case 'access-denied':
      return t('errors.provider.accessDenied', locale, { resource: error.resource })
    case 'auth-failed':
      return t('errors.provider.authFailed', locale)
    case 'rate-limited':
      return t('errors.provider.rateLimited', locale)
    case 'validation-failed':
      return t('errors.provider.validationFailed', locale, { field: error.field, reason: error.reason })
    case 'workflow-validation-failed':
      return getWorkflowValidationMessage(error, locale)
    case 'unsupported-operation':
      return t('errors.provider.unsupportedOperation', locale, { operation: error.operation })
    case 'status-not-found':
      return t('errors.provider.statusNotFound', locale, {
        statusName: error.statusName,
        available: error.available.join(', '),
      })
    case 'link-type-not-found':
      return t('errors.provider.linkTypeNotFound', locale, {
        linkTypeName: error.linkTypeName,
        available: error.available.join(', '),
      })
    case 'invalid-response':
      return t('errors.provider.invalidResponse', locale)
    case 'unknown':
      return t('errors.provider.fallback', locale)
    default:
      return t('errors.provider.fallback', locale)
  }
}

/**
 * Error class for wrapping classified provider errors, analogous to KaneoClassifiedError.
 * Providers use this to throw errors that carry both a message and a ProviderError payload.
 */
export class ProviderClassifiedError extends Error {
  constructor(
    message: string,
    public readonly error: ProviderError,
  ) {
    super(message)
    this.name = 'ProviderClassifiedError'
  }
}
