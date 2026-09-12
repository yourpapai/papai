// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { issueNumberFromBranch } from './git.js'

/**
 * The `pull_request.closed(merged)` door — D7, the archive trigger.
 *
 * Split out of `trigger-events.ts` when a new field on the `ci` door pushed
 * that file past `max-lines`, along the seam `pr-trigger.ts` already cut: one
 * door's parse, in the module that owns its vocabulary. The file's own doctrine
 * holds — *what an event is* sits here, *whether the pipeline may act on it*
 * stays in the policy layer — so this module imports nothing from it.
 */

/**
 * A merged PR on an agent branch — the archive door (D7). A system event (no
 * sender): `pull_request.closed(merged)` runs `ARCHIVE`. Fully parsed from the
 * payload, since `head.ref` rides on a `pull_request` webhook.
 */
export interface PrMergedTriggerEvent {
  kind: 'pr-merged'
  eventName: string
  prNumber: number
  issueNumber: number
  baseBranch: string
  fromThisRepository: boolean
  defaultBranch: string | null
}

const prMergedSchema = z.object({
  action: z.literal('closed'),
  pull_request: z.object({
    merged: z.literal(true),
    number: z.number().int().positive(),
    head: z.object({
      ref: z.string().min(1),
      repo: z.object({ full_name: z.string().default('') }).optional(),
    }),
    base: z.object({ ref: z.string().min(1) }),
  }),
  repository: z.object({ full_name: z.string().default(''), default_branch: z.string().min(1).optional() }).optional(),
})

/** `pull_request.closed(merged)` on an agent branch — the archive door (D7). */
export const parsePrMergedEvent = (eventName: string, payload: unknown): PrMergedTriggerEvent | null => {
  const parsed = prMergedSchema.safeParse(payload)
  if (!parsed.success) return null
  const { pull_request: pr, repository } = parsed.data
  const issueNumber = issueNumberFromBranch(pr.head.ref)
  if (issueNumber === null) return null
  const headFullName = pr.head.repo?.full_name ?? ''
  const repoFullName = repository?.full_name ?? ''
  return {
    kind: 'pr-merged',
    eventName,
    prNumber: pr.number,
    issueNumber,
    baseBranch: pr.base.ref,
    fromThisRepository: headFullName.length > 0 && headFullName === repoFullName,
    defaultBranch: repository?.default_branch ?? null,
  }
}
