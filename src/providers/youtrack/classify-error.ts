import type { AppError } from '../../errors.js'
import { providerError, systemError } from '../../errors.js'
import type { CustomFieldRequirement } from '../errors.js'
import { YouTrackApiError } from './client.js'

export class YouTrackClassifiedError extends Error {
  constructor(
    message: string,
    public readonly appError: AppError,
  ) {
    super(message)
    this.name = 'YouTrackClassifiedError'
  }
}

interface ClassificationContext {
  taskId?: string
  projectId?: string
  commentId?: string
  labelId?: string
  queryId?: string
}

interface YouTrackErrorBody {
  error?: string
  error_description?: string
  error_type?: string
  error_rule_name?: string
}

function isYouTrackErrorBody(body: unknown): body is YouTrackErrorBody {
  if (body === null || typeof body !== 'object') return false
  const entries = Object.entries(body)
  for (const [key, value] of entries) {
    if (['error', 'error_description', 'error_type', 'error_rule_name'].includes(key)) {
      if (value !== undefined && typeof value !== 'string') return false
    }
  }
  return true
}

const extractYouTrackErrorMessage = (error: YouTrackApiError): string => {
  const body = isYouTrackErrorBody(error.body) ? error.body : undefined
  if (body === undefined) {
    return error.message
  }
  // Prefer the descriptive error_description (often in local language)
  // Fall back to error message or the raw message
  return body.error_description ?? body.error ?? error.message
}

function normalizeFieldName(rawName: string): string | null {
  const cleaned = rawName
    .trim()
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s+/g, ' ')
  if (cleaned === '') return null
  const lower = cleaned.toLowerCase()
  if (lower === 'field' || lower === 'fields' || lower === 'custom field' || lower === 'custom fields') return null
  return cleaned
}

function appendFieldNames(target: Set<string>, rawList: string): void {
  const normalizedList = rawList.replace(/\sand\s/gi, ',')
  for (const part of normalizedList.split(',')) {
    const normalized = normalizeFieldName(part)
    if (normalized !== null) target.add(normalized)
  }
}

function extractRequiredFields(body: YouTrackErrorBody | undefined, message: string): CustomFieldRequirement[] {
  const names = new Set<string>()
  const candidates = [body?.error_description, body?.error, body?.error_rule_name, message]

  for (const candidate of candidates) {
    if (candidate === undefined) continue

    const listMatch = /requires these custom fields:\s*([^.;]+)/i.exec(candidate)
    if (listMatch?.[1] !== undefined) {
      appendFieldNames(names, listMatch[1])
    }

    const requiredFieldsMatch = /required fields?:\s*([^.;]+)/i.exec(candidate)
    if (requiredFieldsMatch?.[1] !== undefined) {
      appendFieldNames(names, requiredFieldsMatch[1])
    }

    for (const match of candidate.matchAll(/field\s+["']?([^"':.;]+?)["']?\s+is required/gi)) {
      const fieldName = match[1]
      if (fieldName === undefined) continue
      const normalized = normalizeFieldName(fieldName)
      if (normalized !== null) names.add(normalized)
    }
  }

  if (names.size === 0) {
    const allCandidates = [body?.error_description, message]
    for (const candidate of allCandidates) {
      if (candidate === undefined) continue
      for (const match of candidate.matchAll(
        /["\u201C\u201D\u00AB\u00BB]([^"\u201C\u201D\u00AB\u00BB]+)["\u201C\u201D\u00AB\u00BB]/g,
      )) {
        const fieldName = match[1]
        if (fieldName === undefined) continue
        const normalized = normalizeFieldName(fieldName)
        if (normalized !== null) names.add(normalized)
      }
      if (names.size > 0) break
    }
  }

  return Array.from(names, (name) => ({ name }))
}

function classifyWorkflowValidationError(
  message: string,
  body: YouTrackErrorBody | undefined,
  context?: ClassificationContext,
): YouTrackClassifiedError {
  return new YouTrackClassifiedError(
    message,
    providerError.workflowValidationFailed(
      context?.projectId ?? 'unknown',
      message,
      extractRequiredFields(body, message),
    ),
  )
}

const classifyApiError = (error: YouTrackApiError, context?: ClassificationContext): YouTrackClassifiedError => {
  const { statusCode } = error
  const message = extractYouTrackErrorMessage(error)

  if (statusCode === 401 || statusCode === 403) {
    return new YouTrackClassifiedError(message, providerError.authFailed())
  }

  if (statusCode === 429) {
    return new YouTrackClassifiedError(message, providerError.rateLimited())
  }

  if (statusCode === 404) {
    return classifyNotFoundError(message, context)
  }

  if (statusCode === 400) {
    const body = isYouTrackErrorBody(error.body) ? error.body : undefined
    const errorType = body?.error_type
    if (errorType === 'workflow') {
      return classifyWorkflowValidationError(message, body, context)
    }
    return new YouTrackClassifiedError(message, providerError.validationFailed('unknown', message))
  }

  return new YouTrackClassifiedError(message, systemError.unexpected(error))
}

const classifyNotFoundError = (message: string, context?: ClassificationContext): YouTrackClassifiedError => {
  const msg = message.toLowerCase()

  if (msg.includes('issue') || msg.includes('/issues/')) {
    return new YouTrackClassifiedError(message, providerError.taskNotFound(context?.taskId ?? 'unknown'))
  }

  if (msg.includes('project') || msg.includes('/projects/')) {
    return new YouTrackClassifiedError(message, providerError.projectNotFound(context?.projectId ?? 'unknown'))
  }

  if (msg.includes('comment') || msg.includes('/comments/')) {
    return new YouTrackClassifiedError(message, providerError.commentNotFound(context?.commentId ?? 'unknown'))
  }

  if (msg.includes('tag') || msg.includes('/tags/')) {
    return new YouTrackClassifiedError(message, providerError.labelNotFound(context?.labelId ?? 'unknown'))
  }

  if (msg.includes('saved query') || msg.includes('/savedqueries/')) {
    return new YouTrackClassifiedError(message, providerError.notFound('Saved query', context?.queryId ?? 'unknown'))
  }

  return new YouTrackClassifiedError(message, providerError.unknown(new Error(message)))
}

const classifyGenericError = (error: Error): YouTrackClassifiedError => {
  const msg = error.message.toLowerCase()

  if (msg.includes('authentication') || msg.includes('unauthorized')) {
    return new YouTrackClassifiedError(error.message, providerError.authFailed())
  }

  if (msg.includes('rate limit') || msg.includes('429')) {
    return new YouTrackClassifiedError(error.message, providerError.rateLimited())
  }

  // Network error detection before final fallback
  if (
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('connect')
  ) {
    return new YouTrackClassifiedError(error.message, systemError.networkError(error.message))
  }

  return new YouTrackClassifiedError(error.message, systemError.unexpected(error))
}

/** Classify a YouTrack error into a YouTrackClassifiedError carrying a standardised AppError. */
export const classifyYouTrackError = (error: unknown, context?: ClassificationContext): YouTrackClassifiedError => {
  if (error instanceof YouTrackClassifiedError) {
    return error
  }

  if (error instanceof YouTrackApiError) {
    return classifyApiError(error, context)
  }

  if (error instanceof Error) {
    return classifyGenericError(error)
  }

  return new YouTrackClassifiedError(String(error), systemError.unexpected(new Error(String(error))))
}
