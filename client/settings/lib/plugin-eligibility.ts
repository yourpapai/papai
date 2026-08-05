// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PluginEntry } from '../fetcher-schemas.js'

export type EligibilityTone = 'accent' | 'warn' | 'mute'

export interface EligibilityCopy {
  tone: EligibilityTone
  /** Short status shown in the Pill. */
  label: string
  /** Sentence naming the consequence and the next step; absent when the pill says it all. */
  explanation?: string
}

/** "a", "a and b", "a, b and c" — an inline list a sentence can end with. */
function joinPhrases(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * Missing keys arrive as storage keys. The user chose values against the *labels*,
 * so resolve back through the plugin's own declared fields; fall back to the key
 * when a plugin reports a requirement it does not declare as a context field.
 */
function labelsForKeys(plugin: PluginEntry, keys: readonly string[]): string[] {
  return keys.map((key) => plugin.contextConfig.find((c) => c.key === key)?.label ?? key)
}

export function eligibilityCopy(plugin: PluginEntry): EligibilityCopy {
  if (plugin.eligibility.eligible) return { tone: 'accent', label: 'Ready' }

  switch (plugin.eligibility.reason) {
    case 'disabled':
      // No explanation: the toggle beside this pill already reads "Enable".
      return { tone: 'mute', label: 'Off' }
    case 'inactive':
      return {
        tone: 'mute',
        label: 'Unavailable',
        explanation: 'An operator must approve this plugin before it can be enabled here.',
      }
    case 'config_missing':
      return {
        tone: 'warn',
        label: 'Needs setup',
        explanation: `Needs ${joinPhrases(labelsForKeys(plugin, plugin.eligibility.missingKeys))} before it can run.`,
      }
    case 'capability_missing':
      // registry-context-eligibility.ts merges the required task and chat capability
      // lists into one flat array, so the client cannot tell which provider is at
      // fault — name both rather than guess. Ids stay verbatim: a client-side label
      // map would be a second source of truth with nothing testing it against the
      // real capability set.
      return {
        tone: 'warn',
        label: 'Not supported here',
        explanation: `The task or chat provider assigned to this context does not support ${joinPhrases(plugin.eligibility.missingCapabilities)}.`,
      }
    default:
      throw new Error(`Unhandled eligibility reason: ${String((plugin.eligibility as { reason?: unknown }).reason)}`)
  }
}
