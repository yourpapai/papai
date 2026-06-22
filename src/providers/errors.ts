// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

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

/** User-facing message mapper for ProviderError. */
export const getProviderMessage = (error: ProviderError): string => {
  switch (error.code) {
    case 'task-not-found':
      return `Task "${error.taskId}" was not found. Please check the task ID and try again.`
    case 'project-not-found':
      return `Project "${error.projectId}" was not found.`
    case 'workspace-not-found':
      return `Workspace configuration error. Please check your workspace settings.`
    case 'comment-not-found':
      return `Comment "${error.commentId}" was not found.`
    case 'label-not-found':
      return `Label "${error.labelName}" was not found. Use list_labels to see available labels.`
    case 'relation-not-found':
      return `Relation between tasks "${error.taskId}" and "${error.relatedTaskId}" was not found.`
    case 'not-found':
      return `${error.resourceType} "${error.resourceId}" was not found.`
    case 'access-denied':
      return `You don't have access to ${error.resource}. You need to be a member of it (or it must be a public channel) for me to read it.`
    case 'auth-failed':
      return `Failed to connect to the task tracker. Please check your API key.`
    case 'rate-limited':
      return `API rate limit reached. Please wait a moment and try again.`
    case 'validation-failed':
      return `Invalid ${error.field}: ${error.reason}`
    case 'workflow-validation-failed': {
      const fields = error.requiredFields.map((f) => `"${f.name}"`).join(', ')
      const prefix =
        error.projectId === 'unknown'
          ? `The project workflow blocked this request`
          : `The project workflow blocked this request in project "${error.projectId}"`
      if (fields === '') {
        return `${prefix}: ${error.message}.`
      }
      return `${prefix}: ${error.message}. Required fields: ${fields}.`
    }
    case 'unsupported-operation':
      return `Operation "${error.operation}" is not supported by this provider.`
    case 'status-not-found':
      return `Status "${error.statusName}" is not recognised. Available statuses: ${error.available.join(', ')}.`
    case 'link-type-not-found':
      return `Link type "${error.linkTypeName}" was not recognised. Available link types: ${error.available.join(', ')}.`
    case 'invalid-response':
      return `The task tracker returned an unexpected response. Please try again.`
    case 'unknown':
      return `Task tracker API error occurred. Please try again later.`
    default:
      return `Task tracker API error occurred. Please try again later.`
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
