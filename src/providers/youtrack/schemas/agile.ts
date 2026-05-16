// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const AgileSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const AgileWithSprintsSchema = z.object({
  id: z.string(),
  sprints: z.array(z.object({ id: z.string() })).optional(),
})

export type YouTrackAgile = z.infer<typeof AgileSchema>
export type YouTrackAgileWithSprints = z.infer<typeof AgileWithSprintsSchema>
