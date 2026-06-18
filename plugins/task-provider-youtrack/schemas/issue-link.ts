// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// src/providers/youtrack/schemas/issue-link.ts
import { z } from 'zod'

import { BaseEntitySchema } from './common.js'

/** IssueLinkType as embedded inside an issue link object. */
// IssueLinkType.name is free-form: YouTrack allows custom link type names beyond the built-in set.
const IssueLinkTypeSchema = BaseEntitySchema.extend({
  name: z.string(),
  directed: z.boolean().nullable().optional(),
  aggregation: z.boolean().nullable().optional(),
  sourceToTarget: z.string().nullable().optional(),
  targetToSource: z.string().nullable().optional(),
  localizedName: z.string().nullable().optional(),
  localizedSourceToTarget: z.string().nullable().optional(),
  localizedTargetToSource: z.string().nullable().optional(),
})

/**
 * IssueLink as returned inside an issue's `links` field.
 * Matches field query: links(id,direction,linkType(name,sourceToTarget,targetToSource),issues(id,idReadable,summary))
 */
export const IssueLinkSchema = z.object({
  id: z.string().optional(),
  $type: z.string().optional(),
  direction: z.string().optional(),
  linkType: IssueLinkTypeSchema.optional(),
  issues: z
    .array(
      z.object({
        id: z.string(),
        idReadable: z.string().optional(),
        summary: z.string().optional(),
      }),
    )
    .optional(),
})
