// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../logger.js'
import { getPluginAdminConfig, setPluginAdminConfig } from '../plugins/store.js'

const log = logger.child({ scope: 'debug:admin-plugin-config' })

export type AdminPluginConfigKeyState = {
  key: string
  label: string
  value: string | null
  sensitive: boolean
  required: boolean
}

export type AdminPluginConfigEntry = {
  pluginId: string
  keys: AdminPluginConfigKeyState[]
}

export type AdminPluginConfigSnapshot = {
  plugins: AdminPluginConfigEntry[]
}

export type AdminPluginConfigErrorKind = 'bad-plugin' | 'bad-key' | 'bad-value'

export class AdminPluginConfigError extends Error {
  readonly kind: AdminPluginConfigErrorKind
  constructor(kind: AdminPluginConfigErrorKind, message: string) {
    super(message)
    this.name = 'AdminPluginConfigError'
    this.kind = kind
  }
}

export type PluginConfigDescriptor = {
  pluginId: string
  configRequirements: Array<{
    key: string
    label: string
    required: boolean
    sensitive: boolean
    scope: string
  }>
}

function maskSensitive(value: string): string {
  return value.length <= 4 ? '****' : `****${value.slice(-4)}`
}

export const getAdminPluginConfigSnapshot = (descriptors: PluginConfigDescriptor[]): AdminPluginConfigSnapshot => {
  const plugins: AdminPluginConfigEntry[] = []
  for (const descriptor of descriptors) {
    const adminKeys = descriptor.configRequirements.filter((req) => req.scope === 'admin')
    if (adminKeys.length === 0) continue
    const keys: AdminPluginConfigKeyState[] = adminKeys.map((req) => {
      const raw = getPluginAdminConfig(descriptor.pluginId, req.key)
      return {
        key: req.key,
        label: req.label,
        value: raw === undefined ? null : req.sensitive ? maskSensitive(raw) : raw,
        sensitive: req.sensitive,
        required: req.required,
      }
    })
    plugins.push({ pluginId: descriptor.pluginId, keys })
  }
  return { plugins }
}

const UpdateBodySchema = z.object({
  pluginId: z.string(),
  key: z.string(),
  value: z.string(),
})

export const applyAdminPluginConfigUpdate = (
  body: unknown,
  updatedBy: string,
  descriptors: PluginConfigDescriptor[],
): { pluginId: string; key: string; updatedAt: number } => {
  const parsed = UpdateBodySchema.safeParse(body)
  if (!parsed.success) {
    throw new AdminPluginConfigError('bad-value', 'invalid body shape')
  }

  const descriptor = descriptors.find((d) => d.pluginId === parsed.data.pluginId)
  if (descriptor === undefined) {
    throw new AdminPluginConfigError('bad-plugin', `unknown plugin: ${parsed.data.pluginId}`)
  }

  const requirement = descriptor.configRequirements.find((req) => req.key === parsed.data.key && req.scope === 'admin')
  if (requirement === undefined) {
    throw new AdminPluginConfigError('bad-key', `undeclared or non-admin key: ${parsed.data.key}`)
  }

  const trimmed = parsed.data.value.trim()
  if (trimmed === '') {
    throw new AdminPluginConfigError('bad-value', 'value must be a non-empty string')
  }

  const updatedAt = Date.now()
  setPluginAdminConfig(parsed.data.pluginId, parsed.data.key, trimmed, updatedBy)
  log.info({ pluginId: parsed.data.pluginId, key: parsed.data.key, updatedBy }, 'admin plugin config updated')
  return { pluginId: parsed.data.pluginId, key: parsed.data.key, updatedAt }
}
