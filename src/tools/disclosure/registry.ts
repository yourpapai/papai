// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import { ALWAYS_ON_TOOL_NAMES } from './core.js'

export interface DisclosureSession {
  readonly coreNames: ReadonlySet<string>
  readonly allNames: ReadonlySet<string>
  activeToolNames(): string[]
  markLoaded(names: readonly string[]): { loaded: string[]; unknown: string[] }
  hasLoaded(): boolean
}

export function createDisclosureSession(fullTools: ToolSet, coreNames: ReadonlySet<string>): DisclosureSession {
  const allNames = new Set(Object.keys(fullTools))
  const loaded = new Set<string>()

  const activeToolNames = (): string[] => {
    const active = new Set<string>()
    for (const n of coreNames) if (allNames.has(n)) active.add(n)
    for (const n of ALWAYS_ON_TOOL_NAMES) if (allNames.has(n)) active.add(n)
    for (const n of loaded) if (allNames.has(n)) active.add(n)
    return [...active]
  }

  const markLoaded = (names: readonly string[]): { loaded: string[]; unknown: string[] } => {
    const ok: string[] = []
    const unknown: string[] = []
    for (const n of names) {
      if (allNames.has(n)) {
        if (!loaded.has(n)) loaded.add(n)
        ok.push(n)
      } else {
        unknown.push(n)
      }
    }
    return { loaded: ok, unknown }
  }

  return {
    coreNames,
    allNames,
    activeToolNames,
    markLoaded,
    hasLoaded: () => loaded.size > 0,
  }
}
