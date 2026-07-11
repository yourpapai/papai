// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Render control for a settings field. Defaults to a text input (password when `sensitive`). */
export type SettingsFieldControl = 'text' | 'select' | 'toggle' | 'reveal-secret' | 'readonly-derived' | 'action-button'

/** An option for `select`/`toggle` controls. */
export type SettingsFieldOption = { value: string; label: string }

/** An action a section exposes (e.g. a provisioning button), invoked via a contributed route. */
export type SettingsAction = { id: string; label: string; route: string; method?: 'POST' | 'GET' }

/** Section-level visibility, evaluated server-side per context; the client only receives resolved sections. */
export type SettingsVisibilityRule = { kind: 'providerCapability'; capability: string }

/** Config scope a section reads/writes. Defaults to `'admin'` (the only scope supported before Phase 4b). */
export type SettingsSectionScope = 'admin' | 'context' | 'group'

/** A single admin settings field. `sensitive` values are masked on read. */
export type SettingsField = {
  key: string
  label: string
  required?: boolean
  sensitive?: boolean
  /** Render control. Omitted → a text input (password when `sensitive`). */
  control?: SettingsFieldControl
  /** Options for `select`/`toggle` controls. */
  options?: readonly SettingsFieldOption[]
  /** For `action-button` fields: the id of the `SettingsAction` this button invokes. */
  actionId?: string
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
  /** Config scope. Omitted → `'admin'`. */
  scope?: SettingsSectionScope
  /** Section-level visibility, evaluated server-side per context. */
  visibleWhen?: SettingsVisibilityRule
  /** Actions (buttons) the section exposes. */
  actions?: readonly SettingsAction[]
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
