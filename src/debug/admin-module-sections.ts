// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../logger.js'
import { deletePluginAdminConfig, getPluginAdminConfig, setPluginAdminConfig } from '../plugins/store.js'
import {
  moduleSettingsRegistry,
  type SettingsAction,
  type SettingsFieldControl,
  type SettingsFieldOption,
  type SettingsSection,
  type SettingsSectionScope,
} from '../ports/settings-sections.js'

const log = logger.child({ scope: 'debug:admin-module-sections' })

export type ModuleSectionFieldState = {
  key: string
  label: string
  value: string | null
  sensitive: boolean
  required: boolean
  control?: SettingsFieldControl
  options?: readonly SettingsFieldOption[]
  actionId?: string
}

export type ModuleSectionState = {
  id: string
  label: string
  fields: ModuleSectionFieldState[]
  scope?: SettingsSectionScope
  actions?: readonly SettingsAction[]
}

export type ModuleSectionsSnapshot = {
  sections: ModuleSectionState[]
}

export type ModuleSectionConfigErrorKind = 'bad-section' | 'bad-key' | 'bad-value'

export class ModuleSectionConfigError extends Error {
  readonly kind: ModuleSectionConfigErrorKind
  constructor(kind: ModuleSectionConfigErrorKind, message: string) {
    super(message)
    this.name = 'ModuleSectionConfigError'
    this.kind = kind
  }
}

/** Snapshot of declared sections, sourced from the module settings registry. */
export function buildModuleSectionDescriptors(): readonly SettingsSection[] {
  return moduleSettingsRegistry.list()
}

function maskSensitive(value: string): string {
  return value.length <= 4 ? '****' : `****${value.slice(-4)}`
}

export function getModuleSectionsSnapshot(descriptors: readonly SettingsSection[]): ModuleSectionsSnapshot {
  const sections: ModuleSectionState[] = descriptors.map((section) => ({
    id: section.id,
    label: section.label,
    ...(section.scope === undefined ? {} : { scope: section.scope }),
    ...(section.actions === undefined ? {} : { actions: section.actions }),
    fields: section.fields.map((field) => {
      const raw = getPluginAdminConfig(section.id, field.key)
      const sensitive = field.sensitive ?? false
      return {
        key: field.key,
        label: field.label,
        value: raw === undefined ? null : sensitive ? maskSensitive(raw) : raw,
        sensitive,
        required: field.required ?? false,
        ...(field.control === undefined ? {} : { control: field.control }),
        ...(field.options === undefined ? {} : { options: field.options }),
        ...(field.actionId === undefined ? {} : { actionId: field.actionId }),
      }
    }),
  }))
  return { sections }
}

const SetBodySchema = z.object({
  action: z.literal('set').optional(),
  id: z.string(),
  key: z.string(),
  value: z.string(),
})

const UnsetBodySchema = z.object({
  action: z.literal('unset'),
  id: z.string(),
  key: z.string(),
})

export const PatchModuleSectionBodySchema = z.union([UnsetBodySchema, SetBodySchema])

const findField = (descriptors: readonly SettingsSection[], id: string, key: string): void => {
  const section = descriptors.find((s) => s.id === id)
  if (section === undefined) throw new ModuleSectionConfigError('bad-section', `unknown section: ${id}`)
  const field = section.fields.find((f) => f.key === key)
  if (field === undefined) throw new ModuleSectionConfigError('bad-key', `undeclared key: ${key}`)
}

export function applyModuleSectionUpdate(
  body: { id: string; key: string; value: string },
  updatedBy: string,
  descriptors: readonly SettingsSection[],
): { id: string; key: string; updatedAt: number } {
  findField(descriptors, body.id, body.key)
  const trimmed = body.value.trim()
  if (trimmed === '') throw new ModuleSectionConfigError('bad-value', 'value must be a non-empty string')
  const updatedAt = Date.now()
  setPluginAdminConfig(body.id, body.key, trimmed, updatedBy)
  log.info({ section: body.id, key: body.key, updatedBy }, 'admin module section config updated')
  return { id: body.id, key: body.key, updatedAt }
}

export function applyModuleSectionUnset(
  body: { id: string; key: string },
  updatedBy: string,
  descriptors: readonly SettingsSection[],
): { id: string; key: string } {
  findField(descriptors, body.id, body.key)
  deletePluginAdminConfig(body.id, body.key)
  log.info({ section: body.id, key: body.key, updatedBy }, 'admin module section config unset')
  return { id: body.id, key: body.key }
}
