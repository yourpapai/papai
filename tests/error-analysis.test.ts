import { describe, expect, test } from 'bun:test'

import { getAgentGuidance, getAppErrorDetails, isRetryableAppError } from '../src/error-analysis.js'
import { providerError } from '../src/errors.js'

describe('error-analysis', () => {
  test('returns structured details for workflow validation errors', () => {
    const error = providerError.workflowValidationFailed('PRJ', 'Workflow blocked request', [
      { name: 'Sprint', description: 'Required sprint field' },
    ])

    expect(getAppErrorDetails(error)).toEqual({
      projectId: 'PRJ',
      message: 'Workflow blocked request',
      requiredFields: [{ name: 'Sprint', description: 'Required sprint field' }],
    })
  })

  test('returns no details for auth failures', () => {
    expect(getAppErrorDetails(providerError.authFailed())).toBeUndefined()
  })

  test('marks provider rate limits as retryable and explains next step', () => {
    const error = providerError.rateLimited()

    expect(isRetryableAppError(error)).toBe(true)
    expect(getAgentGuidance(error)).toContain('Wait briefly before retrying')
  })

  test('instructs retrying workflow validation failures with customFields', () => {
    const error = providerError.workflowValidationFailed('PRJ', 'Workflow blocked request', [{ name: 'Type' }])

    expect(getAgentGuidance(error)).toContain('customFields')
  })
})
