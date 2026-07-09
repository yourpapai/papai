// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AuthorizationResult, IncomingMessage, ReplyFn } from '../chat/types.js'

/** A chat command contributed by a trusted module (mirrors PluginCommand, no eligibility gating). */
export type ModuleCommand = {
  name: string
  description: string
  execute: (message: IncomingMessage, reply: ReplyFn, auth: AuthorizationResult) => Promise<void> | void
}

/** A system-prompt fragment contributed by a trusted module (mirrors PluginPromptFragment). */
export type ModulePromptFragment = {
  name: string
  content: string | (() => string)
}

/**
 * Registries of module-contributed commands / prompt fragments, populated at the composition root
 * from each module's `commands`/`promptFragments`. Read by the command-registration adapter and the
 * prompt-section builder.
 *
 * NOTE: keep this file feature-agnostic — the architecture guard scans `src/ports/**` for
 * feature/provider names. Do not reference concrete module or feature names here.
 */
export interface ModuleCommandRegistry {
  register(moduleId: string, commands: readonly ModuleCommand[]): void
  list(): readonly { moduleId: string; command: ModuleCommand }[]
  clear(): void
}

export interface ModulePromptFragmentRegistry {
  register(moduleId: string, fragments: readonly ModulePromptFragment[]): void
  list(): readonly { moduleId: string; fragment: ModulePromptFragment }[]
  clear(): void
}

export function createModuleCommandRegistry(): ModuleCommandRegistry {
  const entries: { moduleId: string; command: ModuleCommand }[] = []
  return {
    register: (moduleId, commands) => {
      for (const command of commands) entries.push({ moduleId, command })
    },
    list: () => entries,
    clear: () => {
      entries.length = 0
    },
  }
}

export function createModulePromptFragmentRegistry(): ModulePromptFragmentRegistry {
  const entries: { moduleId: string; fragment: ModulePromptFragment }[] = []
  return {
    register: (moduleId, fragments) => {
      for (const fragment of fragments) entries.push({ moduleId, fragment })
    },
    list: () => entries,
    clear: () => {
      entries.length = 0
    },
  }
}

/** Process-wide singletons: composition registers here; the command/prompt adapters read them. */
export const moduleCommandRegistry: ModuleCommandRegistry = createModuleCommandRegistry()
export const modulePromptFragmentRegistry: ModulePromptFragmentRegistry = createModulePromptFragmentRegistry()
