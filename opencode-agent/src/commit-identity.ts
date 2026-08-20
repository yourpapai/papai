// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PipelineConfig } from './config.js'
import type { GitHubApi } from './github.js'
import type { Logger } from './logger.js'
import type { TriggerEvent } from './trigger-events.js'

export const SERVICE_COMMIT_NAME = 'github-actions[bot]'
export const SERVICE_COMMIT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com'

export interface CommitIdentity {
  author: { name: string; email: string }
  committer: { name: string; email: string }
}

export const buildNoreplyEmail = (login: string, id: number | null): string => {
  if (id === null || !Number.isSafeInteger(id)) return `${login}@users.noreply.github.com`
  return `${id}+${login}@users.noreply.github.com`
}

const isHumanTrigger = (trigger: TriggerEvent): trigger is Extract<TriggerEvent, { senderLogin: string }> =>
  (trigger.kind === 'issue' || trigger.kind === 'pull-request') && trigger.senderType !== 'Bot'

const isServiceName = (value: string): boolean => value === SERVICE_COMMIT_NAME
const isServiceEmail = (value: string): boolean => value === SERVICE_COMMIT_EMAIL

const serviceIdentity = (name: string | null, email: string | null): CommitIdentity => ({
  author: { name: name ?? SERVICE_COMMIT_NAME, email: email ?? SERVICE_COMMIT_EMAIL },
  committer: { name: SERVICE_COMMIT_NAME, email: SERVICE_COMMIT_EMAIL },
})

const resolveHuman = async (
  login: string,
  explicitName: string | null,
  explicitEmail: string | null,
  github: Pick<GitHubApi, 'getUser'>,
  log: Logger,
): Promise<CommitIdentity> => {
  try {
    const user = await github.getUser(login)
    return {
      author: { name: explicitName ?? user.login, email: explicitEmail ?? buildNoreplyEmail(user.login, user.id) },
      committer: { name: SERVICE_COMMIT_NAME, email: SERVICE_COMMIT_EMAIL },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn({ login, error: message }, 'Could not resolve commit author; falling back to service identity')
    return {
      author: { name: explicitName ?? login, email: explicitEmail ?? `${login}@users.noreply.github.com` },
      committer: { name: SERVICE_COMMIT_NAME, email: SERVICE_COMMIT_EMAIL },
    }
  }
}

export const resolveCommitIdentity = (
  trigger: TriggerEvent,
  config: PipelineConfig,
  github: Pick<GitHubApi, 'getUser'>,
  log: Logger,
): Promise<CommitIdentity> => {
  const explicitName = isServiceName(config.commitAuthorName) ? null : config.commitAuthorName
  const explicitEmail = isServiceEmail(config.commitAuthorEmail) ? null : config.commitAuthorEmail
  if (explicitName !== null && explicitEmail !== null) {
    return Promise.resolve({
      author: { name: explicitName, email: explicitEmail },
      committer: { name: SERVICE_COMMIT_NAME, email: SERVICE_COMMIT_EMAIL },
    })
  }
  if (isHumanTrigger(trigger)) {
    const login = trigger.senderLogin.trim()
    if (login.length > 0) return resolveHuman(login, explicitName, explicitEmail, github, log)
    log.warn({ login }, 'Human trigger has no login; falling back to service identity')
  }
  return Promise.resolve(serviceIdentity(explicitName, explicitEmail))
}
