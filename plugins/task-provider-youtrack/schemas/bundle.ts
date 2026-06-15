// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// src/providers/youtrack/schemas/bundle.ts
import { z } from 'zod'

export const StateValueSchema = z.object({
  id: z.string(),
  name: z.string(),
  ordinal: z.number().optional(),
  isResolved: z.boolean().optional(),
})

export const StateBundleSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  aggregated: z
    .object({
      project: z.array(z.object({ id: z.string() })).optional(),
    })
    .optional(),
})

export const ProjectCustomFieldSchema = z.object({
  id: z.string().optional(),
  $type: z.string(),
  field: z
    .object({
      id: z.string().optional(),
      name: z.string(),
      localizedName: z.string().optional(),
      $type: z.string().optional(),
      fieldType: z
        .object({
          id: z.string().optional(),
          presentation: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  canBeEmpty: z.boolean().optional(),
  emptyFieldText: z.string().nullable().optional(),
  isPublic: z.boolean().optional(),
  bundle: z
    .object({
      id: z.string(),
      $type: z.string().optional(),
    })
    .optional(),
  defaultValues: z.array(z.object({ name: z.string(), localizedName: z.string().nullable().optional() })).optional(),
})

export const ProjectCustomFieldListSchema = z.array(ProjectCustomFieldSchema)

export const BundleElementSchema = z.object({
  name: z.string(),
  localizedName: z.string().nullable().optional(),
  ordinal: z.number().optional(),
})

export const BundleElementListSchema = z.array(BundleElementSchema)
