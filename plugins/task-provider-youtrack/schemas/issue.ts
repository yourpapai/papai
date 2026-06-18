// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { YouTrackAttachmentSchema } from './attachment.js'
import { BaseEntitySchema, TimestampSchema } from './common.js'
import { CustomFieldValueSchema } from './custom-fields.js'
import { IssueLinkSchema } from './issue-link.js'
import { TagSchema } from './tag.js'
import { UserSchema } from './user.js'
import { VisibilitySchema } from './visibility.js'

export const IssueSchema = BaseEntitySchema.extend({
  idReadable: z.string(),
  numberInProject: z.number().optional(),
  summary: z.string(),
  description: z.string().nullable().optional(),
  project: BaseEntitySchema.extend({
    name: z.string().optional(),
    shortName: z.string().optional(),
  }),
  reporter: z
    .lazy(() => UserSchema)
    .nullable()
    .optional(),
  updater: z
    .lazy(() => UserSchema)
    .nullable()
    .optional(),
  created: TimestampSchema,
  updated: TimestampSchema,
  resolved: TimestampSchema.nullable().optional(),
  customFields: z.array(CustomFieldValueSchema),
  tags: z.array(z.lazy(() => TagSchema)).optional(),
  links: z.array(IssueLinkSchema).optional(),
  commentsCount: z.number().optional(),
  votes: z.number().optional(),
  attachments: z.array(YouTrackAttachmentSchema).optional(),
  watchers: z
    .object({
      issueWatchers: z.array(z.object({ user: z.lazy(() => UserSchema), isStarred: z.boolean() })).optional(),
      hasStar: z.boolean().optional(),
    })
    .optional(),
  visibility: VisibilitySchema.optional(),
  parent: z
    .object({
      issues: z.array(
        z.object({
          id: z.string(),
          idReadable: z.string().optional(),
          summary: z.string(),
        }),
      ),
    })
    .optional(),
  subtasks: z
    .object({
      issues: z.array(
        z.object({
          id: z.string(),
          idReadable: z.string().optional(),
          summary: z.string(),
          resolved: TimestampSchema.nullable().optional(),
        }),
      ),
    })
    .optional(),
})

/** Lighter schema matching ISSUE_LIST_FIELDS (no created/updated/tags/links). */
export const IssueListSchema = z.object({
  id: z.string(),
  $type: z.string().optional(),
  idReadable: z.string().optional(),
  numberInProject: z.number().optional(),
  summary: z.string(),
  resolved: TimestampSchema.nullable().optional(),
  project: BaseEntitySchema.extend({
    name: z.string().optional(),
    shortName: z.string().optional(),
  }).optional(),
  customFields: z.array(CustomFieldValueSchema).optional(),
})
