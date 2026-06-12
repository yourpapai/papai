// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { pathToFileURL } from 'node:url'

import { z } from 'zod'

import type { TaskProviderConfigValidator } from '../providers/registry.js'
import type { PluginFactory, PluginInstance, PluginManifest } from './types.js'

export type PluginModuleRecord = Record<string, unknown> & { readonly default?: unknown }

export type ImportedPluginModule = Readonly<{
  instance: PluginInstance
  moduleRecord: PluginModuleRecord
}>

type UnknownProviderConfigValidator = (config: Record<string, string>) => unknown

const providerConfigValidatorResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string().min(1) }),
])

const isPluginFactory = (value: unknown): value is PluginFactory => typeof value === 'function'

function isPluginInstance(value: unknown): value is PluginInstance {
  return (
    typeof value === 'object' &&
    value !== null &&
    'activate' in value &&
    typeof (value as Record<string, unknown>)['activate'] === 'function'
  )
}

const isUnknownProviderConfigValidator = (value: unknown): value is UnknownProviderConfigValidator =>
  typeof value === 'function'

const isPluginModuleRecord = (value: unknown): value is PluginModuleRecord =>
  typeof value === 'object' && value !== null

export function toPluginImportSpecifier(entryPoint: string): string {
  return pathToFileURL(entryPoint).href
}

export async function importPluginModule(entryPoint: string): Promise<ImportedPluginModule> {
  const mod: unknown = await import(toPluginImportSpecifier(entryPoint))
  if (!isPluginModuleRecord(mod)) {
    throw new Error('Invalid plugin module contract: module import must return an object')
  }
  const candidate = 'default' in mod ? mod.default : mod
  if (!isPluginFactory(candidate)) {
    throw new Error('Invalid plugin module contract: default export must be a factory function')
  }
  const instance = candidate()
  if (!isPluginInstance(instance))
    throw new Error('Invalid plugin module contract: factory must return an object with activate(ctx)')
  return { instance, moduleRecord: mod }
}

export function resolveProviderConfigValidator(
  manifest: PluginManifest,
  moduleRecord: PluginModuleRecord | undefined,
): TaskProviderConfigValidator | undefined {
  const exportName = manifest.providerConfigValidator
  if (exportName === undefined) return undefined
  if (exportName === 'default')
    throw new Error(`Plugin '${manifest.id}' providerConfigValidator must reference a named export, not 'default'`)
  const candidate = moduleRecord?.[exportName]
  if (!isUnknownProviderConfigValidator(candidate)) {
    throw new Error(
      `Plugin '${manifest.id}' providerConfigValidator export '${exportName}' is missing or not a function`,
    )
  }
  return async (config) => {
    const result = providerConfigValidatorResultSchema.safeParse(await candidate(config))
    if (result.success) return result.data
    return {
      ok: false,
      reason: `Plugin '${manifest.id}' providerConfigValidator export '${exportName}' returned an invalid result`,
    }
  }
}
