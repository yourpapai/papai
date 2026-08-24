// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Label } from 'papai/plugin-types'
import { z } from 'zod'

import { logger } from '../../../src/logger.js'
import { classifyGitHubError } from '../classify-error.js'
import type { GitHubConfig } from '../client.js'
import { githubFetch, githubPaginate } from '../client.js'
import { mapIssueLabelToLabel, mapRepoLabelToLabel } from '../mappers.js'
import { GitHubLabelSchema } from '../schemas/issue.js'
import type { GitHubRepoLabel } from '../schemas/label.js'
import { GitHubRepoLabelSchema } from '../schemas/label.js'

const log = logger.child({ scope: 'provider:github:labels' })

const repoLabelPageSchema = z.array(GitHubRepoLabelSchema)
// Issue-level endpoints return labels as plain strings (list-shaped) or
// objects (single-issue); both parse through the session-1 union.
const issueLabelPageSchema = z.array(GitHubLabelSchema)

export interface GitHubCreateLabelParams {
  name: string
  color?: string
  description?: string
}

export interface GitHubUpdateLabelParams {
  name?: string
  color?: string
}

export async function githubListLabels(config: GitHubConfig): Promise<Label[]> {
  log.debug({ repo: config.repo }, 'listLabels')
  try {
    const labels = await githubPaginate(config, `/repos/${config.repo}/labels`, {
      extractPage: (data: unknown): GitHubRepoLabel[] => repoLabelPageSchema.parse(data),
    })
    const results = labels.map(mapRepoLabelToLabel)
    log.info({ count: results.length }, 'Labels listed')
    return results
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list labels')
    throw classifyGitHubError(error, { projectId: config.repo })
  }
}

export async function githubCreateLabel(config: GitHubConfig, params: GitHubCreateLabelParams): Promise<Label> {
  log.debug({ repo: config.repo, name: params.name }, 'createLabel')
  const body: Record<string, unknown> = { name: params.name }
  if (params.color !== undefined) body['color'] = params.color
  if (params.description !== undefined) body['description'] = params.description
  try {
    const raw = await githubFetch(config, 'POST', `/repos/${config.repo}/labels`, { body })
    const label: GitHubRepoLabel = GitHubRepoLabelSchema.parse(raw)
    log.info({ labelName: label.name }, 'Label created')
    return mapRepoLabelToLabel(label)
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), name: params.name },
      'Failed to create label',
    )
    throw classifyGitHubError(error, { projectId: config.repo })
  }
}

export async function githubUpdateLabel(
  config: GitHubConfig,
  name: string,
  params: GitHubUpdateLabelParams,
): Promise<Label> {
  log.debug({ repo: config.repo, name }, 'updateLabel')
  const body: Record<string, unknown> = {}
  if (params.name !== undefined) body['name'] = params.name
  if (params.color !== undefined) body['color'] = params.color
  try {
    const raw = await githubFetch(config, 'PATCH', `/repos/${config.repo}/labels/${encodeURIComponent(name)}`, {
      body,
    })
    const label: GitHubRepoLabel = GitHubRepoLabelSchema.parse(raw)
    log.info({ labelName: label.name }, 'Label updated')
    return mapRepoLabelToLabel(label)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), name }, 'Failed to update label')
    throw classifyGitHubError(error, { projectId: config.repo })
  }
}

export async function githubDeleteLabel(config: GitHubConfig, name: string): Promise<{ id: string }> {
  log.debug({ repo: config.repo, name }, 'deleteLabel')
  try {
    // GitHub answers 204 with no body; the deleted name is echoed locally.
    await githubFetch(config, 'DELETE', `/repos/${config.repo}/labels/${encodeURIComponent(name)}`)
    log.info({ name }, 'Label deleted')
    return { id: name }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), name }, 'Failed to delete label')
    throw classifyGitHubError(error, { projectId: config.repo })
  }
}

export async function githubGetTaskLabels(config: GitHubConfig, taskId: string): Promise<Label[]> {
  log.debug({ taskId }, 'getTaskLabels')
  try {
    const raw = await githubFetch(config, 'GET', `/repos/${config.repo}/issues/${taskId}/labels`)
    const labels = issueLabelPageSchema.parse(raw).map(mapIssueLabelToLabel)
    log.info({ taskId, count: labels.length }, 'Task labels retrieved')
    return labels
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to get task labels')
    throw classifyGitHubError(error, { taskId })
  }
}

export async function githubSetTaskLabels(config: GitHubConfig, taskId: string, names: string[]): Promise<Label[]> {
  log.debug({ taskId, count: names.length }, 'setTaskLabels')
  try {
    // PUT is full-set semantics: the body carries the complete desired set,
    // so labels omitted here are removed upstream.
    const raw = await githubFetch(config, 'PUT', `/repos/${config.repo}/issues/${taskId}/labels`, {
      body: { labels: names },
    })
    const labels = issueLabelPageSchema.parse(raw).map(mapIssueLabelToLabel)
    log.info({ taskId, count: labels.length }, 'Task labels set')
    return labels
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to set task labels')
    throw classifyGitHubError(error, { taskId })
  }
}

export async function githubAddTaskLabels(config: GitHubConfig, taskId: string, names: string[]): Promise<Label[]> {
  log.debug({ taskId, count: names.length }, 'addTaskLabels')
  try {
    // POST is incremental: supplied names are added, existing labels remain.
    const raw = await githubFetch(config, 'POST', `/repos/${config.repo}/issues/${taskId}/labels`, {
      body: { labels: names },
    })
    const labels = issueLabelPageSchema.parse(raw).map(mapIssueLabelToLabel)
    log.info({ taskId, count: labels.length }, 'Task labels added')
    return labels
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to add task labels')
    throw classifyGitHubError(error, { taskId })
  }
}

export async function githubRemoveTaskLabel(config: GitHubConfig, taskId: string, name: string): Promise<void> {
  log.debug({ taskId, name }, 'removeTaskLabel')
  try {
    await githubFetch(config, 'DELETE', `/repos/${config.repo}/issues/${taskId}/labels/${encodeURIComponent(name)}`)
    log.info({ taskId, name }, 'Task label removed')
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, name },
      'Failed to remove task label',
    )
    throw classifyGitHubError(error, { taskId })
  }
}

export async function githubClearTaskLabels(config: GitHubConfig, taskId: string): Promise<void> {
  log.debug({ taskId }, 'clearTaskLabels')
  try {
    await githubFetch(config, 'DELETE', `/repos/${config.repo}/issues/${taskId}/labels`)
    log.info({ taskId }, 'Task labels cleared')
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to clear task labels')
    throw classifyGitHubError(error, { taskId })
  }
}

/**
 * GitHub assigns issue labels by name, while the provider surface passes a
 * reference that may be a numeric label id. A purely numeric reference
 * triggers exactly one repository-label pass resolved by numeric id; anything
 * else is used as the name directly with no lookup. An unmatched numeric
 * reference falls through as the name so the upstream rejection surfaces
 * through the standard classifications.
 */
export async function resolveLabelName(config: GitHubConfig, ref: string): Promise<string> {
  log.debug({ ref }, 'resolveLabelName')
  if (!/^\d+$/u.test(ref)) return ref
  const labels = await githubListLabels(config)
  const matched = labels.find((label) => label.id === ref)
  const name = matched?.name ?? ref
  log.debug({ ref, name, resolved: matched !== undefined }, 'Label reference resolved')
  return name
}
