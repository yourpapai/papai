import type { JSONValue } from 'ai'

import type { AppError, LlmError, SystemError, ValidationError, WebFetchError } from './errors.js'
import type { ProviderError } from './providers/errors.js'

type AppErrorDetails = Record<string, JSONValue | undefined> | undefined
const unreachable = (value: never): never => {
  throw new Error(`Unhandled error variant: ${JSON.stringify(value)}`)
}

const getProviderGuidance = (error: ProviderError): string => {
  switch (error.code) {
    case 'task-not-found':
      return `The referenced task does not exist. Search for the task or ask the user for the correct ID before retrying.`
    case 'project-not-found':
      return `The project ID is invalid. Call list_projects before retrying.`
    case 'workspace-not-found':
      return `The provider workspace is not configured correctly. Ask the user to verify provider setup before retrying.`
    case 'comment-not-found':
      return `The comment ID is invalid. Fetch the task comments again before retrying.`
    case 'label-not-found':
      return `The label is unknown. Call list_labels before retrying.`
    case 'relation-not-found':
      return `The requested task relation does not exist. Re-fetch the task relations before retrying.`
    case 'not-found':
      return `The requested ${error.resourceType} was not found. Search or list available resources before retrying.`
    case 'auth-failed':
      return `Authentication failed. Ask the user to verify provider credentials before retrying.`
    case 'rate-limited':
      return `The provider rate limited the request. Wait briefly before retrying.`
    case 'validation-failed':
      return `The provider rejected the "${error.field}" input. Update that field and retry.`
    case 'workflow-validation-failed': {
      const fields = error.requiredFields.map((field) => field.name)
      return fields.length === 0
        ? `The project workflow requires additional fields or constraints before this request can succeed. Ask the user for the missing values and retry with the customFields parameter on create_task or update_task.`
        : `The project workflow requires fields: ${fields.join(', ')}. Ask the user for the missing values and retry using the customFields parameter on create_task or update_task to supply them.`
    }
    case 'unsupported-operation':
      return `This provider does not support "${error.operation}". Pick a different tool or explain the limitation.`
    case 'status-not-found':
      return `The requested status is invalid. Call list_statuses and retry with one of the available names.`
    case 'invalid-response':
      return `The provider returned unexpected data. Do not retry blindly; inspect logs or the debug trace first.`
    case 'unknown':
      return `The provider returned an unclassified error. Inspect logs or the debug trace before retrying.`
  }
  return unreachable(error)
}

const getLlmGuidance = (error: LlmError): string => {
  switch (error.code) {
    case 'api-error':
      return `The AI provider returned an API error. Retry only after checking the upstream service state.`
    case 'rate-limited':
      return `The AI provider is rate limiting requests. Wait briefly before retrying.`
    case 'timeout':
      return `The AI request timed out. Retrying may work if the upstream service is healthy.`
    case 'token-limit':
      return `The prompt is too large. Reduce the request size or summarize context before retrying.`
  }
  return unreachable(error)
}

const getValidationGuidance = (error: ValidationError): string => {
  switch (error.code) {
    case 'invalid-input':
      return `The "${error.field}" input is invalid. Fix the value and retry.`
    case 'missing-required':
      return `The "${error.field}" input is required. Gather it before retrying.`
  }
  return unreachable(error)
}

const getSystemGuidance = (error: SystemError): string => {
  switch (error.code) {
    case 'config-missing':
      return `Required configuration is missing. Ask the user to complete setup before retrying.`
    case 'network-error':
      return `A network problem interrupted the request. Retrying may work once connectivity is restored.`
    case 'unexpected':
      return `The failure was not classified. Inspect logs or the debug trace before retrying.`
  }
  return unreachable(error)
}

const getWebFetchGuidance = (error: WebFetchError): string => {
  switch (error.code) {
    case 'invalid-url':
      return `The URL is malformed. Ask the user for a valid public http(s) URL.`
    case 'blocked-host':
      return `The target host is blocked because it is not public. Ask for a different public URL.`
    case 'blocked-content-type':
      return `The target content type is unsupported. Ask for an HTML, Markdown, plain text, or PDF URL.`
    case 'too-large':
      return `The page exceeds safe fetch limits. Ask for a smaller page or a narrower source.`
    case 'timeout':
      return `The fetch timed out. Retrying may work if the site is temporarily slow.`
    case 'rate-limited':
      return `The fetch quota is exhausted. Wait before retrying.`
    case 'extract-failed':
      return `The page fetched successfully but readable content extraction failed. Try a different source or a PDF/HTML variant.`
    case 'upstream-error':
      return `The upstream site returned an error. Retrying may work if the site is temporarily unhealthy.`
  }
  return unreachable(error)
}

const getProviderErrorDetails = (error: ProviderError): AppErrorDetails => {
  switch (error.code) {
    case 'task-not-found':
      return { taskId: error.taskId }
    case 'project-not-found':
      return { projectId: error.projectId }
    case 'workspace-not-found':
      return { workspaceId: error.workspaceId }
    case 'comment-not-found':
      return { commentId: error.commentId }
    case 'label-not-found':
      return { labelName: error.labelName }
    case 'relation-not-found':
      return { taskId: error.taskId, relatedTaskId: error.relatedTaskId }
    case 'not-found':
      return { resourceType: error.resourceType, resourceId: error.resourceId }
    case 'validation-failed':
      return { field: error.field, reason: error.reason }
    case 'workflow-validation-failed':
      return { projectId: error.projectId, message: error.message, requiredFields: error.requiredFields }
    case 'unsupported-operation':
      return { operation: error.operation }
    case 'status-not-found':
      return { statusName: error.statusName, available: error.available }
    case 'unknown':
      return { originalMessage: error.originalError.message }
    case 'auth-failed':
    case 'rate-limited':
    case 'invalid-response':
      return undefined
  }
  return unreachable(error)
}

const getLlmErrorDetails = (error: LlmError): AppErrorDetails => {
  switch (error.code) {
    case 'api-error':
      return { message: error.message }
    case 'rate-limited':
    case 'timeout':
    case 'token-limit':
      return undefined
  }
  return unreachable(error)
}

const getValidationErrorDetails = (error: ValidationError): AppErrorDetails => {
  switch (error.code) {
    case 'invalid-input':
      return { field: error.field, reason: error.reason }
    case 'missing-required':
      return { field: error.field }
  }
  return unreachable(error)
}

const getSystemErrorDetails = (error: SystemError): AppErrorDetails => {
  switch (error.code) {
    case 'config-missing':
      return { variable: error.variable }
    case 'network-error':
      return { message: error.message }
    case 'unexpected':
      return { originalMessage: error.originalError.message }
  }
  return unreachable(error)
}

const getWebFetchErrorDetails = (error: WebFetchError): AppErrorDetails => {
  switch (error.code) {
    case 'upstream-error':
      return error.status === undefined ? undefined : { status: error.status }
    case 'invalid-url':
    case 'blocked-host':
    case 'blocked-content-type':
    case 'too-large':
    case 'timeout':
    case 'rate-limited':
    case 'extract-failed':
      return undefined
  }
  return unreachable(error)
}

export const getAgentGuidance = (error: AppError): string => {
  switch (error.type) {
    case 'provider':
      return getProviderGuidance(error)
    case 'llm':
      return getLlmGuidance(error)
    case 'validation':
      return getValidationGuidance(error)
    case 'system':
      return getSystemGuidance(error)
    case 'web-fetch':
      return getWebFetchGuidance(error)
  }
  return unreachable(error)
}

export const isRetryableAppError = (error: AppError): boolean => {
  switch (error.type) {
    case 'provider':
      return error.code === 'rate-limited'
    case 'llm':
      return error.code === 'api-error' || error.code === 'rate-limited' || error.code === 'timeout'
    case 'validation':
      return false
    case 'system':
      return error.code === 'network-error'
    case 'web-fetch':
      return error.code === 'timeout' || error.code === 'rate-limited' || error.code === 'upstream-error'
  }
  return unreachable(error)
}

export const getAppErrorDetails = (error: AppError): AppErrorDetails => {
  switch (error.type) {
    case 'provider':
      return getProviderErrorDetails(error)
    case 'llm':
      return getLlmErrorDetails(error)
    case 'validation':
      return getValidationErrorDetails(error)
    case 'system':
      return getSystemErrorDetails(error)
    case 'web-fetch':
      return getWebFetchErrorDetails(error)
  }
  return unreachable(error)
}
