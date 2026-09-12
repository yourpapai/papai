// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  buildNoreplyEmail,
  resolveCommitIdentity,
  SERVICE_COMMIT_EMAIL,
  SERVICE_COMMIT_NAME,
} from '../../opencode-agent/src/commit-identity.js'
import type { PipelineConfig } from '../../opencode-agent/src/config.js'
import type { TriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import { stubConfig } from './test-helpers.js'

const silentLog = { debug: (): void => {}, info: (): void => {}, warn: (): void => {}, error: (): void => {} }

const configWith = (over: Partial<Pick<PipelineConfig, 'commitAuthorName' | 'commitAuthorEmail'>>): PipelineConfig => ({
  ...stubConfig(),
  commitAuthorName: over.commitAuthorName ?? SERVICE_COMMIT_NAME,
  commitAuthorEmail: over.commitAuthorEmail ?? SERVICE_COMMIT_EMAIL,
})

const issueTrigger = (login: string): TriggerEvent => ({
  kind: 'issue',
  eventName: 'issue_comment',
  action: 'created',
  senderLogin: login,
  senderType: 'User',
  authorAssociation: 'OWNER',
  issueNumber: 42,
  issueTitle: 't',
  issueBody: 'b',
  isPullRequest: false,
  commentBody: '/approve',
  commentId: 1,
  repositoryOwner: 'acme',
  defaultBranch: 'main',
})

const ciTrigger: TriggerEvent = {
  kind: 'ci',
  eventName: 'workflow_run',
  action: 'completed',
  branch: 'agent/issue-42',
  issueNumber: 42,
  conclusion: 'failure',
  workflowName: 'CI',
  runUrl: 'https://example.test/run/1',
  runId: 32652877782,
  fromThisRepository: true,
  defaultBranch: 'main',
}

const prMergedTrigger: TriggerEvent = {
  kind: 'pr-merged',
  eventName: 'pull_request',
  prNumber: 7,
  issueNumber: 42,
  baseBranch: 'main',
  fromThisRepository: true,
  defaultBranch: 'main',
}

describe('buildNoreplyEmail', () => {
  test('id+login form when id present', () => {
    expect(buildNoreplyEmail('bob', 123)).toBe('123+bob@users.noreply.github.com')
  })
  test('short form when id is null', () => {
    expect(buildNoreplyEmail('bob', null)).toBe('bob@users.noreply.github.com')
  })
})

describe('resolveCommitIdentity', () => {
  test('human trigger resolves to actor with id-prefixed noreply', async () => {
    const github: { getUser: (login: string) => Promise<{ login: string; id: number }> } = {
      getUser: (login: string): Promise<{ login: string; id: number }> => Promise.resolve({ login, id: 999 }),
    }
    const identity = await resolveCommitIdentity(issueTrigger('bob'), configWith({}), github, silentLog)
    expect(identity.author).toEqual({ name: 'bob', email: '999+bob@users.noreply.github.com' })
    expect(identity.committer).toEqual({ name: SERVICE_COMMIT_NAME, email: SERVICE_COMMIT_EMAIL })
  })

  test('ci trigger falls back to service without network call', async () => {
    let called = false
    const github: { getUser: (login: string) => Promise<{ login: string; id: number }> } = {
      getUser: (): Promise<{ login: string; id: number }> => {
        called = true
        return Promise.resolve({ login: 'x', id: 1 })
      },
    }
    const identity = await resolveCommitIdentity(ciTrigger, configWith({}), github, silentLog)
    expect(called).toBe(false)
    expect(identity.author).toEqual({ name: SERVICE_COMMIT_NAME, email: SERVICE_COMMIT_EMAIL })
  })

  test('pr-merged falls back to service', async () => {
    const github: { getUser: (login: string) => Promise<{ login: string; id: number }> } = {
      getUser: (): Promise<{ login: string; id: number }> => Promise.resolve({ login: 'x', id: 1 }),
    }
    const identity = await resolveCommitIdentity(prMergedTrigger, configWith({}), github, silentLog)
    expect(identity.author.name).toBe(SERVICE_COMMIT_NAME)
  })

  test('explicit pin wins per field and skips lookup', async () => {
    let called = false
    const github: { getUser: (login: string) => Promise<{ login: string; id: number }> } = {
      getUser: (): Promise<{ login: string; id: number }> => {
        called = true
        return Promise.resolve({ login: 'bob', id: 1 })
      },
    }
    const cfg = configWith({ commitAuthorName: 'pinned-name', commitAuthorEmail: 'pinned@example.com' })
    const identity = await resolveCommitIdentity(issueTrigger('bob'), cfg, github, silentLog)
    expect(called).toBe(false)
    expect(identity.author).toEqual({ name: 'pinned-name', email: 'pinned@example.com' })
  })

  test('explicit name only overrides name, email from actor', async () => {
    const github: { getUser: (login: string) => Promise<{ login: string; id: number }> } = {
      getUser: (): Promise<{ login: string; id: number }> => Promise.resolve({ login: 'bob', id: 555 }),
    }
    const cfg = configWith({ commitAuthorName: 'pinned-name' })
    const identity = await resolveCommitIdentity(issueTrigger('bob'), cfg, github, silentLog)
    expect(identity.author.name).toBe('pinned-name')
    expect(identity.author.email).toBe('555+bob@users.noreply.github.com')
  })

  test('lookup 404 falls back to short noreply and warns', async () => {
    const warns: unknown[] = []
    const log = {
      debug: (): void => {},
      info: (): void => {},
      warn: (f: unknown): void => void warns.push(f),
      error: (): void => {},
    }
    const github: { getUser: (login: string) => Promise<{ login: string; id: number }> } = {
      getUser: (): Promise<{ login: string; id: number }> => Promise.reject(new Error('404')),
    }
    const identity = await resolveCommitIdentity(issueTrigger('bob'), configWith({}), github, log)
    expect(identity.author).toEqual({ name: 'bob', email: 'bob@users.noreply.github.com' })
    expect(warns.length).toBe(1)
  })
})
