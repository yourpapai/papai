// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { PostedComment } from '../../opencode-agent/src/github.js'
import type { LogFields, Logger } from '../../opencode-agent/src/logger.js'
import type { PullRequestTriggerEvent } from '../../opencode-agent/src/pr-trigger.js'
import { noteReview, noteTarget } from '../../opencode-agent/src/pull-request-note.js'
import type { PullRequestNoteDeps, ReviewNote } from '../../opencode-agent/src/pull-request-note.js'
import type { CiTriggerEvent, IssueTriggerEvent } from '../../opencode-agent/src/trigger-events.js'

const ISSUE = 42
const PR_NUMBER = 7

const prTrigger = (): PullRequestTriggerEvent => ({
  kind: 'pull-request',
  eventName: 'issue_comment',
  action: 'created',
  senderLogin: 'maintainer',
  senderType: 'User',
  authorAssociation: 'COLLABORATOR',
  issueNumber: ISSUE,
  prNumber: PR_NUMBER,
  commentBody: '/review',
  commentId: 777,
  defaultBranch: 'main',
})

const issueTrigger = (): IssueTriggerEvent => ({
  kind: 'issue',
  eventName: 'issue_comment',
  action: 'created',
  senderLogin: 'maintainer',
  senderType: 'User',
  authorAssociation: 'COLLABORATOR',
  issueNumber: ISSUE,
  issueTitle: 'Add retries',
  issueBody: 'Please add retries.',
  isPullRequest: false,
  commentBody: '/review',
  commentId: 555,
  repositoryOwner: 'acme',
  defaultBranch: 'main',
})

const ciTrigger = (): CiTriggerEvent => ({
  kind: 'ci',
  eventName: 'workflow_run',
  action: 'completed',
  branch: `agent/issue-${ISSUE}`,
  issueNumber: ISSUE,
  conclusion: 'failure',
  workflowName: 'CI',
  runUrl: 'https://example.test/run/1',
  fromThisRepository: true,
  defaultBranch: 'main',
})

const note = (patch: Partial<ReviewNote> = {}): ReviewNote => ({
  issueNumber: ISSUE,
  verdict: '✅ clean',
  applied: true,
  ...patch,
})

interface NoteIo {
  /** Every create, by the number it addressed — the note is on the *pull request*. */
  posts: { target: number; body: string }[]
  warnings: string[]
  error: Error | null
}

/** The one body a note run posts, so the assertions need no narrowing of their own. */
const noteBody = (io: NoteIo): string => io.posts[0]?.body ?? ''

const makeDeps = (): [PullRequestNoteDeps, NoteIo] => {
  const io: NoteIo = { posts: [], warnings: [], error: null }

  const deps: PullRequestNoteDeps = {
    github: {
      createComment: (issueNumber: number, body: string): Promise<PostedComment> => {
        // Recorded before the refusal, so the failure cases can still prove the
        // channel *asked* — the whole point of a door that swallows everything.
        io.posts.push({ target: issueNumber, body })
        return io.error === null
          ? Promise.resolve({ id: 1, url: 'https://example.test/c/1', authorLogin: 'agent[bot]' })
          : Promise.reject(io.error)
      },
    },
    log: {
      debug: (): void => {},
      info: (): void => {},
      warn: (_fields: LogFields, message: string): void => {
        io.warnings.push(message)
      },
      error: (): void => {},
    } satisfies Logger,
  }

  return [deps, io]
}

/**
 * The note back onto the pull request: a `/review` typed where the diff is is
 * answered on the issue, so without this the pull request carries a 👀 and some
 * commits and never says what the review concluded.
 */
describe('the pull-request note', () => {
  test('lands on the pull request the command was typed on', async () => {
    const [deps, io] = makeDeps()

    await noteReview(deps, prTrigger(), note())

    expect(io.posts).toHaveLength(1)
    expect(io.posts[0]?.target).toBe(PR_NUMBER)
  })

  test('points at the issue and carries the report’s own verdict', async () => {
    const [deps, io] = makeDeps()

    await noteReview(deps, prTrigger(), note({ verdict: '❌ exited 1' }))

    expect(noteBody(io)).toContain(`#${ISSUE}`)
    expect(noteBody(io)).toContain('❌ exited 1')
    // A pointer, not a second report: the account lives on the issue.
    expect(noteBody(io).split('\n').filter(Boolean)).toHaveLength(2)
  })

  test('says whether the findings became commits', async () => {
    const [deps, io] = makeDeps()

    await noteReview(deps, prTrigger(), note({ applied: false }))

    expect(noteBody(io)).toContain('nothing to apply')
  })

  test('says nothing when the review was asked for on the issue', async () => {
    // Decided from the trigger, not from the phase: the report is already where
    // that person is reading, so a note would be the same thing said twice.
    const [deps, io] = makeDeps()

    await noteReview(deps, issueTrigger(), note())

    expect(io.posts).toEqual([])
  })

  test('says nothing for a CI run, which nobody typed', async () => {
    const [deps, io] = makeDeps()

    await noteReview(deps, ciTrigger(), note())

    expect(io.posts).toEqual([])
  })

  test('swallows a rejection, having asked', async () => {
    // The write is asserted rather than inferred from the absence of a throw:
    // this door degrades a bug in itself to the same `warn` as a 403, so a test
    // that only checked it did not reject would pass over a channel that had
    // silently posted nothing at all.
    const [deps, io] = makeDeps()
    io.error = new Error('403 Resource not accessible by integration')

    await noteReview(deps, prTrigger(), note())

    expect(io.posts).toHaveLength(1)
    expect(io.warnings).toHaveLength(1)
  })
})

describe('noteTarget', () => {
  test.each([
    ['a pull-request comment', prTrigger(), PR_NUMBER],
    ['an issue comment', issueTrigger(), null],
    ['a CI run', ciTrigger(), null],
  ])('%s', (_label, trigger, expected) => {
    expect(noteTarget(trigger)).toBe(expected)
  })
})
