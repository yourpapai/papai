// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const ModuleSectionFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string().nullable(),
  sensitive: z.boolean(),
  required: z.boolean(),
})

export const ModuleSectionSchema = z.object({
  id: z.string(),
  label: z.string(),
  fields: z.array(ModuleSectionFieldSchema),
})

export const ModuleSectionsResponseSchema = z.object({
  sections: z.array(ModuleSectionSchema),
})

export type ModuleSectionsResponse = z.infer<typeof ModuleSectionsResponseSchema>
export type ModuleSection = z.infer<typeof ModuleSectionSchema>
export type ModuleSectionField = z.infer<typeof ModuleSectionFieldSchema>
