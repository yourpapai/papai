// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import type { ParityGroup } from './group.js'

/**
 * YouTrack-only parity groups: they prove status and priority round-trip through
 * YouTrack's custom-field model (State = StateBundle, Priority = EnumBundle),
 * exercising buildIssueCustomFields (bundle resolution) on write and
 * getCustomFieldValue on read. Values are YouTrack-specific, so these are not
 * canonicalize-based and live outside the frozen shared module. The fake seeds
 * State values ['Open','In Progress','Done'] and Priority values
 * ['high','normal','low'] (tests/stories/harness/fake-youtrack/state.ts).
 */

export const youtrackCustomFieldGroups: readonly ParityGroup[] = [
  {
    id: 'SCN-youtrack-custom-field-status',
    title: 'SCN-youtrack-custom-field-status: status round-trips through the State custom field',
    async run({ provider, projectId }) {
      const created = await provider.createTask({ projectId, title: 'CF Status', status: 'In Progress' })
      expect(created.status).toBe('In Progress')
      const fetched = await provider.getTask(created.id)
      expect(fetched.status).toBe('In Progress')
      const updated = await provider.updateTask(created.id, { status: 'Done' })
      expect(updated.status).toBe('Done')
      const refetched = await provider.getTask(created.id)
      expect(refetched.status).toBe('Done')
    },
  },
  {
    id: 'SCN-youtrack-custom-field-priority',
    title: 'SCN-youtrack-custom-field-priority: priority round-trips through the Priority custom field',
    async run({ provider, projectId }) {
      const created = await provider.createTask({ projectId, title: 'CF Priority', priority: 'high' })
      expect(created.priority).toBe('high')
      const fetched = await provider.getTask(created.id)
      expect(fetched.priority).toBe('high')
      const updated = await provider.updateTask(created.id, { priority: 'low' })
      expect(updated.priority).toBe('low')
      const refetched = await provider.getTask(created.id)
      expect(refetched.priority).toBe('low')
    },
  },
] as const
