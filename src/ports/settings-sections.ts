// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** A single admin settings field. `sensitive` values are masked on read. */
export type SettingsField = {
  key: string
  label: string
  required?: boolean
  sensitive?: boolean
}

/**
 * A declarative admin settings section contributed by a trusted module. `id` doubles as the
 * config storage namespace (`plg:<id>:<key>`) and the section id, so a module may use an id
 * distinct from its own module id (contributing a section stored under a legacy namespace).
 */
export type SettingsSection = {
  id: string
  label: string
  fields: readonly SettingsField[]
}

/**
 * Registry of module-contributed admin settings sections, populated at the composition root from
 * each module's `settingsSections`. Read by the generic admin module-sections route.
 *
 * NOTE: keep this file feature-agnostic — the architecture guard scans `src/ports/**` for
 * feature/provider names. Do not reference concrete module, section, or field names here.
 */
export interface SettingsSectionRegistry {
  register(sections: readonly SettingsSection[]): void
  list(): readonly SettingsSection[]
  clear(): void
}

/** Create an isolated registry (used by tests and, as a singleton, by the runtime). */
export function createSettingsSectionRegistry(): SettingsSectionRegistry {
  const sections: SettingsSection[] = []
  return {
    register: (toAdd) => {
      for (const s of toAdd) sections.push(s)
    },
    list: () => sections,
    clear: () => {
      sections.length = 0
    },
  }
}

/** Process-wide singleton: composition registers here; the admin route reads it. */
export const moduleSettingsRegistry: SettingsSectionRegistry = createSettingsSectionRegistry()
