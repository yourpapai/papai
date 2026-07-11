// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const SettingsFieldControlSchema = z.enum([
  'text',
  'select',
  'toggle',
  'reveal-secret',
  'readonly-derived',
  'action-button',
])

export const SettingsFieldOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
})

export const SettingsActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  route: z.string(),
  method: z.enum(['POST', 'GET']).optional(),
})

export const ModuleSectionFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string().nullable(),
  sensitive: z.boolean(),
  required: z.boolean(),
  control: SettingsFieldControlSchema.optional(),
  options: z.array(SettingsFieldOptionSchema).optional(),
  actionId: z.string().optional(),
})

export const ModuleSectionSchema = z.object({
  id: z.string(),
  label: z.string(),
  fields: z.array(ModuleSectionFieldSchema),
  scope: z.enum(['admin', 'context', 'group']).optional(),
  actions: z.array(SettingsActionSchema).optional(),
})

export const ModuleSectionsResponseSchema = z.object({
  sections: z.array(ModuleSectionSchema),
})

export type ModuleSectionsResponse = z.infer<typeof ModuleSectionsResponseSchema>
export type ModuleSection = z.infer<typeof ModuleSectionSchema>
export type ModuleSectionField = z.infer<typeof ModuleSectionFieldSchema>
export type SettingsFieldControl = z.infer<typeof SettingsFieldControlSchema>
export type SettingsFieldOption = z.infer<typeof SettingsFieldOptionSchema>
export type SettingsAction = z.infer<typeof SettingsActionSchema>
