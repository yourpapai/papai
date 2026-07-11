// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { executeApplyYouTrackCommand } from '../../../plugins/task-provider-youtrack/tool-apply-command.js'

type ApplyCommandParams = { query: string; taskIds: string[]; comment?: string; silent?: boolean }

const makeContext = (
  result: unknown,
  calls: ApplyCommandParams[],
): { taskProvider: { applyCommand: (p: ApplyCommandParams) => Promise<unknown> } } => ({
  taskProvider: {
    applyCommand: (p: ApplyCommandParams): Promise<unknown> => {
      calls.push(p)
      return Promise.resolve(result)
    },
  },
})

describe('executeApplyYouTrackCommand', () => {
  test('returns a failure for schema-invalid input', async () => {
    const calls: ApplyCommandParams[] = []
    const result = await executeApplyYouTrackCommand({ query: 'for me' }, makeContext({}, calls))

    expect(result).toMatchObject({ status: 'failed' })
    expect(calls).toHaveLength(0)
  })

  test('rejects bulk (multi-issue) requests with the bulk-disabled reason', async () => {
    const calls: ApplyCommandParams[] = []
    const result = await executeApplyYouTrackCommand(
      { query: 'for me', taskIds: ['TEST-1', 'TEST-2'], confidence: 1 },
      makeContext({}, calls),
    )

    expect(result).toMatchObject({ status: 'failed' })
    assert(typeof result === 'object')
    assert(result !== null)
    assert('error' in result)
    const error = (result as Record<string, unknown>)['error']
    assert(typeof error === 'string')
    expect(error).toContain('Bulk YouTrack commands are disabled for safety')
    expect(calls).toHaveLength(0)
  })

  test('requires confirmation for unsafe commands below the confidence threshold', async () => {
    const calls: ApplyCommandParams[] = []
    const result = await executeApplyYouTrackCommand(
      { query: 'State In Progress', taskIds: ['TEST-1'], confidence: 0.6 },
      makeContext({}, calls),
    )

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(calls).toHaveLength(0)
  })

  test('forwards safe commands to taskProvider.applyCommand and returns its result', async () => {
    const calls: ApplyCommandParams[] = []
    const providerResult = { query: 'for me', taskIds: ['TEST-1'] }
    const result = await executeApplyYouTrackCommand(
      { query: 'for me', taskIds: ['TEST-1'], confidence: 0.6 },
      makeContext(providerResult, calls),
    )

    expect(result).toEqual(providerResult)
    expect(calls).toEqual([{ query: 'for me', taskIds: ['TEST-1'], comment: undefined, silent: undefined }])
  })

  test('forwards unsafe commands once confidence is high enough', async () => {
    const calls: ApplyCommandParams[] = []
    const providerResult = { query: 'State In Progress', taskIds: ['TEST-1'] }
    const result = await executeApplyYouTrackCommand(
      { query: 'State In Progress', taskIds: ['TEST-1'], confidence: 1 },
      makeContext(providerResult, calls),
    )

    expect(result).toEqual(providerResult)
    expect(calls).toHaveLength(1)
  })

  test('forces confirmation when a comment is attached to an otherwise-safe command', async () => {
    const calls: ApplyCommandParams[] = []
    const result = await executeApplyYouTrackCommand(
      { query: 'for me', taskIds: ['TEST-1'], comment: 'On it', confidence: 0.6 },
      makeContext({}, calls),
    )

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(calls).toHaveLength(0)
  })

  test('forces confirmation when silent is requested for an otherwise-safe command', async () => {
    const calls: ApplyCommandParams[] = []
    const result = await executeApplyYouTrackCommand(
      { query: 'for me', taskIds: ['TEST-1'], silent: true, confidence: 0.6 },
      makeContext({}, calls),
    )

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(calls).toHaveLength(0)
  })

  test('returns a failure when the task provider does not support commands', async () => {
    const result = await executeApplyYouTrackCommand(
      { query: 'for me', taskIds: ['TEST-1'], confidence: 1 },
      { taskProvider: {} },
    )

    expect(result).toMatchObject({ status: 'failed', error: 'YouTrack command support is unavailable' })
  })

  test('returns a failure when no task provider is bound at all', async () => {
    const result = await executeApplyYouTrackCommand({ query: 'for me', taskIds: ['TEST-1'], confidence: 1 }, {})

    expect(result).toMatchObject({ status: 'failed', error: 'YouTrack command support is unavailable' })
  })
})
