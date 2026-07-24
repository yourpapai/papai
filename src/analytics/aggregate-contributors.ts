// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHmac, randomBytes } from 'node:crypto'

export type ContributorTracker = Readonly<{
  record: (utcDay: string, scope: string, contributorId: string) => void
  count: (utcDay: string, scope: string) => number
  clear: (utcDay: string) => void
  fingerprint: (contributorId: string) => string
}>

export const createContributorTracker = (): ContributorTracker => {
  const key = randomBytes(32)
  const sets = new Map<string, Set<string>>()
  const fingerprint = (contributorId: string): string => createHmac('sha256', key).update(contributorId).digest('hex')
  const setKey = (utcDay: string, scope: string): string => `${utcDay} ${scope}`
  return {
    record: (utcDay, scope, contributorId) => {
      const k = setKey(utcDay, scope)
      const set = sets.get(k) ?? new Set<string>()
      set.add(fingerprint(contributorId))
      sets.set(k, set)
    },
    count: (utcDay, scope) => sets.get(setKey(utcDay, scope))?.size ?? 0,
    clear: (utcDay) => {
      for (const k of sets.keys()) {
        if (k.startsWith(`${utcDay} `)) sets.delete(k)
      }
    },
    fingerprint,
  }
}
